import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryPartyStore,
  InMemoryRetentionStore,
  PartyError,
  PartyService,
  RetentionService,
  addYears,
  combine,
  type Activity,
} from '../src/index.ts';

function setup(activities: Record<string, Activity> = {}) {
  let now = '2026-11-15T10:00:00.000Z';
  const clock = { now: () => now };
  let n = 0;
  const store = new InMemoryPartyStore();
  const parties = new PartyService({ store, clock, ids: { next: (p) => `${p}_${++n}` } });
  const retention = new RetentionService({
    parties,
    settings: new InMemoryRetentionStore(),
    sources: [{ name: 'animals', activityOf: async (id) => activities[id] ?? null }],
    clock,
  });
  return { parties, retention, at: (iso: string) => (now = iso) };
}
const person = (givenName: string, market = 'SE') => ({ kind: 'person' as const, market, givenName, familyName: 'Example' });

test('dates and activities', () => {
  assert.equal(addYears('2016-11-14', 10), '2026-11-14');
  assert.equal(addYears('2016-02-29', 10), '2026-03-01');
  assert.deepEqual(combine([{ lastDate: '2020-01-01' }, null, { lastDate: '2021-05-01' }]), { lastDate: '2021-05-01' });
  assert.deepEqual(combine([{ lastDate: '2020-01-01' }, { ongoing: true }]), { ongoing: true });
  assert.equal(combine([null, null]), null);
});

test('settings start from the defaults and change as versions', async () => {
  const { retention } = setup();
  const v1 = await retention.current();
  assert.deepEqual([v1.version, v1.markets, v1.changedBy], [1, { SE: { years: 10 } }, 'petvold-defaults']);
  const v2 = await retention.change({ markets: { SE: { years: 10 }, NO: { years: 10 } }, basedOnVersion: 1, reason: 'Norway added' }, 'dpo');
  assert.equal(v2.version, 2);
  await assert.rejects(retention.change({ markets: {}, basedOnVersion: 1, reason: 'x' }, 'dpo'), (e: unknown) => e instanceof PartyError && e.code === 'conflict');
  await assert.rejects(retention.change({ markets: { SE: { years: 0 } }, basedOnVersion: 2, reason: 'x' }, 'dpo'), /1-100/);
  await assert.rejects(retention.change({ markets: { se: { years: 5 } }, basedOnVersion: 2, reason: 'x' }, 'dpo'), /market/);
  await assert.rejects(retention.change({ markets: {}, basedOnVersion: 2, reason: ' ' }, 'dpo'), /reason/);
  assert.deepEqual((await retention.versions()).map((v) => v.version), [1, 2]);
});

test('a run asks for anonymization of parties whose retention has ended, and nothing else', async () => {
  const { parties, retention, at } = setup();
  at('2014-03-01T10:00:00.000Z');
  const old = await parties.register(person('Old'), 'cs'); // no relation since 2014
  const de = await parties.register(person('Dag', 'DE'), 'cs'); // DE has no rule
  at('2026-11-15T10:00:00.000Z');
  const recent = await parties.register(person('New'), 'cs');

  const dry = await retention.run({ dryRun: true, markets: '*' }, 'retention-job');
  assert.deepEqual(dry.due.map((d) => [d.partyId, d.lastActivity, d.retainedUntil, d.requestId]), [[old.id, '2014-03-01', '2024-03-01', undefined]]);
  assert.deepEqual([dry.checked, dry.withinRetention, dry.marketsWithoutRule], [3, 1, ['DE']]);
  assert.deepEqual(await parties.listErasureRequests({ pending: true }), []);

  const real = await retention.run({ dryRun: false, markets: '*' }, 'retention-job');
  const [request] = await parties.listErasureRequests({ pending: true });
  assert.deepEqual([request?.partyId, request?.basis, request?.requestedBy, real.due[0]?.requestId], [old.id, 'retention-expired', 'retention-job', request?.id]);
  assert.match(request!.reason, /10 years after 2014-03-01 ended 2024-03-01/);
  // Another run skips the party with an undecided request, and the approval still needs someone else.
  assert.equal((await retention.run({ dryRun: false, markets: '*' }, 'retention-job')).pendingRequest, 1);
  await parties.approveErasure(request!.id, {}, 'officer');
  const after = await retention.run({ dryRun: true, markets: '*' }, 'retention-job');
  assert.deepEqual([after.checked, after.due], [2, []]);
  assert.equal(de.market, 'DE');
  assert.equal((await retention.run({ dryRun: true, markets: new Set(['DE']) }, 'x')).checked, 1);
  assert.equal(recent.market, 'SE');
});

test('a relation elsewhere keeps the party: ongoing, or ended too recently', async () => {
  const activities: Record<string, Activity> = {};
  const { parties, retention, at } = setup(activities);
  at('2010-01-01T10:00:00.000Z');
  const owner = await parties.register(person('Owner'), 'cs');
  const seller = await parties.register(person('Seller'), 'cs');
  const longAgo = await parties.register(person('LongAgo'), 'cs');
  at('2026-11-15T10:00:00.000Z');
  activities[owner.id] = { ongoing: true };
  activities[seller.id] = { lastDate: '2020-06-01' };
  activities[longAgo.id] = { lastDate: '2015-06-01' };
  const run = await retention.run({ dryRun: true, markets: '*' }, 'job');
  assert.deepEqual([run.ongoing, run.withinRetention], [1, 1]);
  assert.deepEqual(run.due.map((d) => [d.partyId, d.lastActivity, d.retainedUntil]), [[longAgo.id, '2015-06-01', '2025-06-01']]);
  assert.deepEqual(await retention.activityOf(owner.id), { ongoing: true });
});
