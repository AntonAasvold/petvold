/** The relay for every outbox (ADR 0008, granskningen A5). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Relay, relaySource } from '../src/relay.ts';

function source(name: string, events: string[], fail: (id: string, attempt: number) => boolean) {
  const published: string[] = [];
  const attempts = new Map<string, number>();
  const delivered: string[] = [];
  return {
    published,
    delivered,
    src: relaySource({
      name,
      pending: async (limit: number) => events.filter((id) => !published.includes(id)).slice(0, limit).map((id) => ({ id })),
      deliver: async (e: { id: string }) => {
        const n = (attempts.get(e.id) ?? 0) + 1;
        attempts.set(e.id, n);
        if (fail(e.id, n)) throw new Error(`cannot deliver ${e.id}`);
        delivered.push(e.id);
      },
      markPublished: async (ids: string[]) => void published.push(...ids),
    }),
  };
}

test('events are delivered in order and marked only after delivery', async () => {
  let now = Date.parse('2026-11-15T10:00:00Z');
  const a = source('a', ['1', '2', '3'], (id, n) => id === '2' && n < 3);
  const relay = new Relay([a.src], { clock: { now: () => new Date(now).toISOString() } });
  assert.equal(await relay.tick(), 1); // 1 delivered; 2 fails and stops the source, so 3 waits
  assert.deepEqual([a.delivered, a.published], [['1'], ['1']]);
  assert.equal(await relay.tick(), 0); // within the pause, nothing is tried
  now += 1_000;
  assert.equal(await relay.tick(), 0); // second attempt fails
  now += 2_000;
  assert.equal(await relay.tick(), 2); // third attempt works, then 3
  assert.deepEqual(a.delivered, ['1', '2', '3']);
  assert.deepEqual(relay.deadLetters(), []);
});

test('an event that keeps failing becomes a dead letter, and the rest flow', async () => {
  let now = Date.parse('2026-11-15T10:00:00Z');
  const lines: string[] = [];
  const a = source('a', ['1', '2'], (id) => id === '1');
  const b = source('b', ['x'], () => false);
  const relay = new Relay([a.src, b.src], { clock: { now: () => new Date(now).toISOString() }, maxAttempts: 3, log: (l) => lines.push(l) });
  for (let i = 0; i < 5; i++) {
    await relay.tick();
    now += 10_000;
  }
  assert.deepEqual(relay.deadLetters().map((d) => [d.source, d.eventId, d.attempts]), [['a', '1', 3]]);
  assert.deepEqual(a.delivered, ['2']);
  assert.deepEqual(a.published, ['2']); // the dead letter stays unpublished in the outbox
  assert.deepEqual(b.delivered, ['x']); // another source is not held up
  assert.ok(lines.some((l) => /dead letter/.test(l)));
});

test('with a lease, one server at a time is the relay, and the other takes over when it stops (ADR 0037)', async () => {
  const { InMemorySchedulingStore } = await import('@petvold/scheduling');
  const state = new InMemorySchedulingStore();
  const now = '2026-11-19T10:00:00.000Z';
  const a = source('a', ['1', '2'], () => false);
  const one = new Relay([a.src], { clock: { now: () => now }, state, holder: 'server-1' });
  const two = new Relay([a.src], { clock: { now: () => now }, state, holder: 'server-2' });
  assert.equal(await one.tick(), 2);
  assert.equal(await two.tick(), 0, 'server-2 waits');
  assert.deepEqual([one.isLeading(), two.isLeading()], [true, false]);
  await one.stop();
  assert.equal(await two.tick(), 0, 'nothing left, but now it leads');
  assert.equal(two.isLeading(), true);
});

test('dead letters outlive a restart, and one sent again is tried from the start', async () => {
  const { InMemorySchedulingStore } = await import('@petvold/scheduling');
  const state = new InMemorySchedulingStore();
  let now = Date.parse('2026-11-19T10:00:00Z');
  let broken = true;
  const a = source('a', ['1', '2'], (id) => id === '1' && broken);
  const clock = { now: () => new Date(now).toISOString() };
  const first = new Relay([a.src], { clock, state, holder: 'server-1', maxAttempts: 1 });
  assert.equal(await first.tick(), 1, '1 becomes a dead letter at once, 2 flows');
  assert.deepEqual((await state.deadLetters()).map((d) => [d.source, d.eventId, d.attempts]), [['a', '1', 1]]);
  await first.stop();

  // After a restart the new relay reads the dead letter and does not try it again by itself.
  const second = new Relay([a.src], { clock, state, holder: 'server-1', maxAttempts: 1 });
  now += 60_000;
  assert.equal(await second.tick(), 0);
  assert.deepEqual(second.deadLetters().map((d) => d.eventId), ['1']);

  broken = false;
  assert.equal(await second.retryDeadLetter('a', '1'), true);
  assert.equal(await second.tick(), 1);
  assert.deepEqual([second.deadLetters(), await state.deadLetters()], [[], []]);
  assert.deepEqual(a.delivered, ['2', '1']);
});
