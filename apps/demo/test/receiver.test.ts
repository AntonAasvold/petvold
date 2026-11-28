import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, filtersOf, stockholmMidnight } from '../src/app.ts';
import { MemoryStore } from '../src/store.ts';
import type { SubscriptionStatus } from '../src/views.ts';
import { T } from '../src/texts-sv.ts';
import { SECRET, event, signed } from './helpers.ts';

function setup(secret: string | null = SECRET) {
  const store = new MemoryStore();
  const status: SubscriptionStatus = secret ? { state: 'ready', id: 'whs_1', outcome: 'rotated' } : { state: 'waiting' };
  const app = createApp({ store, secret: () => secret, status: () => status, now: () => new Date('2026-11-28T10:00:10Z'), basePath: '/demo', backofficeUrl: 'https://bo.example/', css: 'body{}' });
  return { store, app };
}

test('a signed event is stored and answered with 204', async () => {
  const { app, store } = setup();
  const body = JSON.stringify(event());
  const res = await app.request('/webhooks/petvold', signed(body));
  assert.equal(res.status, 204);
  const found = await store.event('evt_1');
  assert.equal(found?.stored.event.type, 'petvold.policy.issued.v1');
  assert.equal(found?.deliveries[0]?.headers['webhook-id'], 'evt_1');
  assert.deepEqual(await store.counts(), { events: 1, deliveries: 1, rejected: 0 });
});

test('the same event again is a duplicate, not a new event', async () => {
  const { app, store } = setup();
  const body = JSON.stringify(event());
  await app.request('/webhooks/petvold', signed(body));
  const again = await app.request('/webhooks/petvold', signed(body, { at: Math.floor(Date.parse('2026-11-28T10:00:08Z') / 1000) }));
  assert.equal(again.status, 204);
  assert.deepEqual(await store.counts(), { events: 1, deliveries: 2, rejected: 0 });
  const page = await (await app.request('/')).text();
  assert.ok(page.includes(T.duplicate(2)));
});

test('a wrong signature or an old timestamp is 401 and listed as rejected', async () => {
  const { app, store } = setup();
  const body = JSON.stringify(event());
  const wrong = await app.request('/webhooks/petvold', signed(body, { secret: 'whsec_' + Buffer.alloc(32, 9).toString('base64') }));
  assert.equal(wrong.status, 401);
  const old = await app.request('/webhooks/petvold', signed(body, { at: Math.floor(Date.parse('2026-11-28T09:50:00Z') / 1000) }));
  assert.equal(old.status, 401);
  assert.deepEqual(await store.counts(), { events: 0, deliveries: 0, rejected: 2 });
  assert.deepEqual((await store.rejected(10)).map((r) => r.reason), ['too-old', 'no-match']);
  const page = await (await app.request('/rejected')).text();
  assert.ok(page.includes(T.reasons['no-match']!));
  assert.ok(page.includes(T.reasons['too-old']!));
});

test('a signed body that is not a CloudEvent is 400 and rejected', async () => {
  const { app, store } = setup();
  const res = await app.request('/webhooks/petvold', signed('{"hello":1}'));
  assert.equal(res.status, 400);
  assert.match((await store.rejected(1))[0]!.reason, /^not-a-cloud-event: /);
});

test('before the demo has a secret it answers 503 and stores nothing', async () => {
  const { app, store } = setup(null);
  const res = await app.request('/webhooks/petvold', signed(JSON.stringify(event())));
  assert.equal(res.status, 503);
  assert.deepEqual(await store.counts(), { events: 0, deliveries: 0, rejected: 0 });
  assert.ok((await (await app.request('/')).text()).includes(T.subscriptionWaiting));
});

test('the list filters by type, subject and day, newest first', async () => {
  const { app } = setup();
  const send = (e: ReturnType<typeof event>) => app.request('/webhooks/petvold', signed(JSON.stringify(e), { id: e.id }));
  await send(event({ id: 'evt_1', time: '2026-11-27T10:00:00Z' }));
  await send(event({ id: 'evt_2', type: 'petvold.claim.registered.v1', subject: 'clm_1', source: '/petvold/claims', time: '2026-11-28T09:00:00Z', data: { claimId: 'clm_1' } }));
  await send(event({ id: 'evt_3', type: 'petvold.policy.renewed.v1', time: '2026-11-28T09:30:00Z' }));
  const ids = (html: string) => [...html.matchAll(/\/demo\/events\/(evt_\d)/g)].map((m) => m[1]);
  assert.deepEqual(ids(await (await app.request('/')).text()), ['evt_3', 'evt_2', 'evt_1']);
  assert.deepEqual(ids(await (await app.request('/?type=policy.*')).text()), ['evt_3', 'evt_1']);
  assert.deepEqual(ids(await (await app.request('/live?subject=clm_1')).text()), ['evt_2']);
  assert.deepEqual(ids(await (await app.request('/?fromDay=2026-11-28&toDay=2026-11-28')).text()), ['evt_3', 'evt_2']);
  assert.ok((await (await app.request('/?type=animal.*')).text()).includes(T.noMatch));
});

test('an event page shows the CloudEvent, the calls and a link to the back office', async () => {
  const { app } = setup();
  await app.request('/webhooks/petvold', signed(JSON.stringify(event())));
  const res = await app.request('/events/evt_1');
  assert.equal(res.status, 200);
  const page = await res.text();
  assert.match(page, /https:\/\/bo\.example\/policies\/pol_1/);
  assert.match(page, /webhook-signature: v1,/);
  assert.match(page, /&quot;specversion&quot;: &quot;1.0&quot;/);
  assert.equal((await app.request('/events/evt_404')).status, 404);
});

test('filters from the query, and days in Stockholm time', () => {
  assert.equal(stockholmMidnight('2026-11-28'), '2026-11-27T23:00:00.000Z');
  assert.equal(stockholmMidnight('2026-07-01'), '2026-06-30T22:00:00.000Z');
  const f = filtersOf((k) => ({ market: ' se ', toDay: '2026-11-28', offset: '-5' })[k]);
  assert.deepEqual(f.store, { type: undefined, market: 'SE', subject: undefined, to: '2026-11-28T23:00:00.000Z' });
  assert.equal(f.offset, 0);
});

test('a dropped answer stores the event, answers 500, and the retry is a duplicate', async () => {
  const { app, store } = setup();
  const drop = await app.request('/drop-answer', { method: 'POST' });
  assert.equal(drop.status, 303);
  assert.equal(drop.headers.get('location'), '/demo/');
  assert.ok((await (await app.request('/')).text()).includes(T.dropping(1)));
  const body = JSON.stringify(event());
  assert.equal((await app.request('/webhooks/petvold', signed(body))).status, 500);
  assert.equal((await app.request('/webhooks/petvold', signed(body))).status, 204);
  assert.deepEqual(await store.counts(), { events: 1, deliveries: 2, rejected: 0 });
});
