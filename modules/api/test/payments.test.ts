/** Payments in from the fake bank through the API (ADR 0017, 0040), with the relay and webhooks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signNotification, FAKE_NOTIFICATION_SCHEMA } from '@petvold/payments';
import { compose } from '../src/composition.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';
import { eventValidator } from '../src/events-contract.ts';

const SECRET = `whsec_${Buffer.alloc(32, 'api-test-fake-bank').toString('base64')}`;
const NOW = '2026-12-01T10:00:00.000Z';

async function setup() {
  const clock = { now: () => NOW };
  const received: { body: string }[] = [];
  const inst = await compose({
    databases: {},
    engineVersion: 'test',
    clock,
    payments: { fake: { secret: SECRET, markets: [{ market: 'SE', currency: 'SEK' }] } },
    webhooks: { transport: { post: async (_url, _headers, body) => (received.push({ body }), { status: 204 }) } },
  });
  const tokens: Record<string, Principal> = {
    clerk: { subject: 'finance@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    clerkDe: { subject: 'finance-de@example.test', roles: ['billing-clerk'], markets: ['DE'] },
    portal: { subject: 'portal', roles: ['customer-channel'], markets: ['SE'], policyIds: ['pol_x'] },
    integration: { subject: 'integration@example.test', roles: ['integration-admin'], markets: '*' },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  const call = async (path: string, token: string) => {
    const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as any };
  };
  const notify = async (payments: object[], o: { secret?: string; at?: number; id?: string } = {}) => {
    const raw = signNotification(o.secret ?? SECRET, o.id ?? 'msg_1', o.at ?? Date.parse(NOW) / 1000, JSON.stringify({ schema: FAKE_NOTIFICATION_SCHEMA, payments }));
    const res = await app.request('/provider-notifications/fake', { method: 'POST', headers: { 'content-type': 'application/json', ...(raw.headers as Record<string, string>) }, body: raw.body });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { inst, app, call, notify, received };
}

const payment = { id: 'fb_1', market: 'SE', currency: 'SEK', amount: 41_200, reference: '202600000121', bookedOn: '2026-12-01' };

test('the fake bank reports a payment: stored once, readable, and sent as payment.succeeded', async () => {
  const { inst, app, call, notify, received } = await setup();
  const sub = await app.request('/v1/webhook-subscriptions', {
    method: 'POST',
    headers: { authorization: 'Bearer integration', 'content-type': 'application/json', 'idempotency-key': 'key-pay-0001' },
    body: JSON.stringify({ url: 'https://bank.example.com/petvold', eventTypes: ['payment.*'], markets: ['SE'] }),
  });
  assert.equal(sub.status, 201);

  assert.deepEqual((await notify([payment])).body, { received: 1, duplicates: 0 });
  assert.deepEqual((await notify([payment, { ...payment, id: 'fb_2', reference: null }], { id: 'msg_2' })).body, { received: 1, duplicates: 1 });

  const list = await call('/v1/payments?market=SE', 'clerk');
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 2);
  for (const p of list.body.items) assert.ok(validatorFor('Payment')(structuredClone(p)), JSON.stringify(validatorFor('Payment').errors));
  const first = list.body.items.find((p: any) => p.providerRef === 'fb_1');
  assert.equal(first.amount, 41_200);
  assert.deepEqual((await call(`/v1/payments/${first.id}`, 'clerk')).body, first);
  assert.deepEqual((await call('/v1/payments?reference=202600000121', 'clerk')).body.items.map((p: any) => p.id), [first.id]);

  while ((await inst.relay.tick()) > 0);
  while ((await inst.webhookWorker.tick()).delivered > 0);
  const events = received.map((r) => JSON.parse(r.body));
  assert.deepEqual(events.map((e) => [e.type, e.source, e.subject]).sort(), list.body.items.map((p: any) => ['petvold.payment.succeeded.v1', '/petvold/payments', p.id]).sort());
  for (const e of events) assert.ok(eventValidator('payment.succeeded')(e), JSON.stringify(eventValidator('payment.succeeded').errors));
  assert.deepEqual(events.map((e) => e.data.reference).sort(), ['202600000121', null].sort());
});

test('only a signed, fresh notification in the bank\'s markets is taken', async () => {
  const { call, notify, app } = await setup();
  assert.equal((await notify([payment], { secret: `whsec_${Buffer.alloc(32, 'someone-else').toString('base64')}` })).status, 401);
  assert.equal((await notify([payment], { at: Date.parse(NOW) / 1000 - 3600 })).status, 401);
  assert.equal((await notify([{ ...payment, market: 'FI', currency: 'EUR' }])).status, 400);
  assert.equal((await notify([{ ...payment, amount: 12.5 }])).status, 400);
  assert.equal((await app.request('/provider-notifications/stripe', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await app.request('/provider-notifications/fake', { method: 'POST', headers: { 'content-length': '2000000' }, body: '{}' })).status, 413);
  assert.equal((await call('/v1/payments', 'clerk')).body.items.length, 0);
});

test('payments are seen in the caller\'s markets, and not by a role bound to policies', async () => {
  const { call, notify } = await setup();
  await notify([payment]);
  const [p] = (await call('/v1/payments', 'clerk')).body.items;
  assert.equal((await call('/v1/payments', 'clerkDe')).body.items.length, 0);
  assert.equal((await call(`/v1/payments/${p.id}`, 'clerkDe')).status, 404);
  assert.equal((await call('/v1/payments', 'portal')).status, 403);
  assert.equal((await call('/v1/payments/pay_nope', 'clerk')).status, 404);
});
