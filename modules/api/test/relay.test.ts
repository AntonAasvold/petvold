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
