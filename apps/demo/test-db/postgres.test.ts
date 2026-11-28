import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresStore } from '../src/postgres.ts';
import { event } from '../test/helpers.ts';

const url = process.env.DEMO_TEST_DATABASE_URL ?? 'postgres://petvold:petvold@127.0.0.1:5432/petvold_demo_test?sslmode=disable';
const store = new PostgresStore(url);
const admin = new pg.Pool({ connectionString: url, max: 1 });

beforeEach(async () => {
  await admin.query('truncate event, delivery, rejected, setting restart identity cascade');
});
after(async () => {
  await store.close();
  await admin.end();
});

const delivery = (at: string, id = 'evt_1') => ({ webhookId: id, receivedAt: at, headers: { 'webhook-id': id } });

test('stores an event once and every call, also when calls come at the same time', async () => {
  const e = event();
  const results = await Promise.all([store.receive(e, delivery('2026-11-28T10:00:01Z')), store.receive(e, delivery('2026-11-28T10:00:02Z'))]);
  assert.deepEqual(results.map((r) => r.duplicate).sort(), [false, true]);
  assert.deepEqual(await store.counts(), { events: 1, deliveries: 2, rejected: 0 });
  const found = await store.event('evt_1');
  assert.deepEqual(found?.stored.event, e);
  assert.equal(found?.stored.deliveries, 2);
  assert.equal(found?.deliveries.length, 2);
});

test('lists newest first with filters and paging', async () => {
  await store.receive(event({ id: 'evt_1', time: '2026-11-27T10:00:00Z' }), delivery('2026-11-28T10:00:00Z', 'evt_1'));
  await store.receive(event({ id: 'evt_2', type: 'petvold.claim.registered.v1', subject: 'clm_1', time: '2026-11-28T09:00:00Z' }), delivery('2026-11-28T10:00:00Z', 'evt_2'));
  await store.receive(event({ id: 'evt_3', type: 'petvold.policy.renewed.v1', time: '2026-11-28T09:30:00Z', market: 'NO' }), delivery('2026-11-28T10:00:00Z', 'evt_3'));
  const ids = async (f: Parameters<typeof store.events>[0], limit = 10, offset = 0) => (await store.events(f, limit, offset)).map((s) => s.id);
  assert.deepEqual(await ids({}), ['evt_3', 'evt_2', 'evt_1']);
  assert.deepEqual(await ids({ type: 'policy.*' }), ['evt_3', 'evt_1']);
  assert.deepEqual(await ids({ type: 'claim.registered' }), ['evt_2']);
  assert.deepEqual(await ids({ market: 'NO' }), ['evt_3']);
  assert.deepEqual(await ids({ subject: 'clm_1' }), ['evt_2']);
  assert.deepEqual(await ids({ from: '2026-11-28T00:00:00Z', to: '2026-11-28T09:30:00Z' }), ['evt_2']);
  assert.deepEqual(await ids({}, 1, 1), ['evt_2']);
});

test('rejected calls, newest first, and settings', async () => {
  await store.reject({ webhookId: 'evt_9', receivedAt: '2026-11-28T10:00:00Z', reason: 'no-match', headers: { 'webhook-id': 'evt_9' }, body: '{}' });
  await store.reject({ webhookId: null, receivedAt: '2026-11-28T10:01:00Z', reason: 'missing-headers', headers: {}, body: '' });
  assert.deepEqual((await store.rejected(10)).map((r) => r.reason), ['missing-headers', 'no-match']);
  assert.equal(await store.setting('subscription'), null);
  await store.setSetting('subscription', { id: 'whs_1', secret: 'whsec_a' }, '2026-11-28T10:00:00Z');
  await store.setSetting('subscription', { id: 'whs_1', secret: 'whsec_b' }, '2026-11-28T10:01:00Z');
  assert.deepEqual(await store.setting('subscription'), { id: 'whs_1', secret: 'whsec_b' });
});
