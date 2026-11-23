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

test('a payment with the invoice\'s OCR pays it; one without waits until a person matches it', async () => {
  const { inst, app, call, notify, received } = await setup();
  const { seedSampleData } = await import('../src/seed.ts');
  await seedSampleData(inst, { now: () => NOW });
  while ((await inst.relay.tick()) > 0);
  await inst.deps.billing!.invoicingRun({ market: 'SE', onDate: '2027-11-01', dryRun: false }, 'scheduler');
  while ((await inst.relay.tick()) > 0);
  const sub = await app.request('/v1/webhook-subscriptions', {
    method: 'POST',
    headers: { authorization: 'Bearer integration', 'content-type': 'application/json', 'idempotency-key': 'key-pay-0002' },
    body: JSON.stringify({ url: 'https://erp.example.com/petvold', eventTypes: ['invoice.paid'], markets: ['SE'] }),
  });
  assert.equal(sub.status, 201);

  const invoices = (await call('/v1/invoices?status=open', 'clerk')).body.items;
  assert.ok(invoices.length >= 2);
  for (const i of invoices) assert.ok(validatorFor('Invoice')(structuredClone(i)), JSON.stringify(validatorFor('Invoice').errors));
  const [a, b] = invoices;

  await notify([{ ...payment, id: 'fb_a', amount: a.total, reference: a.reference.value }, { ...payment, id: 'fb_b', amount: b.total, reference: null }]);
  while ((await inst.relay.tick()) > 0);
  while ((await inst.webhookWorker.tick()).delivered > 0);

  const paidA = await call(`/v1/invoices/${a.id}`, 'clerk');
  assert.deepEqual([paidA.body.status, paidA.body.paid, paidA.body.open], ['paid', a.total, 0]);
  const events = received.map((r) => JSON.parse(r.body)).filter((e) => e.type === 'petvold.invoice.paid.v1');
  assert.deepEqual(events.map((e) => e.subject), [a.id]);
  for (const e of events) assert.ok(eventValidator('invoice.paid')(e), JSON.stringify(eventValidator('invoice.paid').errors));

  const queue = await call('/v1/received-payments?status=unmatched', 'clerk');
  assert.equal(queue.body.items.length, 1);
  for (const p of queue.body.items) assert.ok(validatorFor('ReceivedPayment')(structuredClone(p)), JSON.stringify(validatorFor('ReceivedPayment').errors));
  const waiting = queue.body.items[0];
  assert.equal((await call(`/v1/received-payments/${waiting.paymentId}`, 'clerkDe')).status, 404);

  const match = (token: string, body: unknown, key: string) =>
    app.request(`/v1/received-payments/${waiting.paymentId}/matches`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
  assert.equal((await match('integration', { invoiceId: b.id }, 'key-match-0001')).status, 403);
  assert.equal((await match('clerk', { invoiceId: b.id, accountId: b.accountId }, 'key-match-0002')).status, 422);
  const done = await match('clerk', { invoiceId: b.id, note: 'The payer gave the policy number in the message.' }, 'key-match-0003');
  assert.equal(done.status, 201);
  const body = (await done.json()) as any;
  assert.deepEqual([body.status, body.match.how, body.match.matchedBy], ['matched', 'manual', 'finance@example.test']);
  assert.equal((await match('clerk', { invoiceId: b.id }, 'key-match-0004')).status, 409);
  assert.equal((await call(`/v1/invoices/${b.id}`, 'clerk')).body.status, 'paid');
  assert.equal((await call('/v1/received-payments?status=unmatched', 'clerk')).body.items.length, 0);
  const account = await call(`/v1/payer-accounts/${a.accountId}`, 'clerk');
  assert.ok(validatorFor('PayerAccount')(structuredClone(account.body)), JSON.stringify(validatorFor('PayerAccount').errors));
});

test('a decided claim is paid out to the policyholder once the payee has details; new details are held for another person', async () => {
  const clock = { now: () => NOW };
  const received: { body: string }[] = [];
  const inst = await compose({
    databases: {},
    engineVersion: 'test',
    clock,
    payments: { fake: { secret: SECRET, markets: [{ market: 'SE', currency: 'SEK' }] }, newPayeeHoldDays: 2 },
    webhooks: { transport: { post: async (_u, _h, body) => (received.push({ body }), { status: 204 }) } },
  });
  const tokens: Record<string, Principal> = {
    clerk: { subject: 'finance@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    clerk2: { subject: 'finance-2@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    integration: { subject: 'integration@example.test', roles: ['integration-admin'], markets: '*' },
    portal: { subject: 'portal', roles: ['customer-channel'], markets: ['SE'], policyIds: ['pol_bella'] },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let k = 0;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': `key-payout-${String(++k).padStart(4, '0')}` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as any };
  };
  assert.equal((await call('POST', '/v1/webhook-subscriptions', 'integration', { url: 'https://erp.example.com/payouts', eventTypes: ['payout.*'], markets: ['SE'] })).status, 201);
  const { seedSampleData } = await import('../src/seed.ts');
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);

  const waiting = await call('GET', '/v1/payouts?status=awaiting-details', 'clerk');
  assert.ok(waiting.body.items.length > 0, 'the sample data has decided claims');
  for (const p of waiting.body.items) assert.ok(validatorFor('Payout')(structuredClone(p)), JSON.stringify(validatorFor('Payout').errors));
  const first = waiting.body.items[0];
  assert.equal(first.partyId, 'pty_owner001');
  assert.equal((await call('GET', '/v1/payouts', 'portal')).status, 403);

  assert.equal((await call('POST', `/v1/payees/${first.partyId}/accounts`, 'clerk', { market: 'SE', method: 'se-bank', details: { clearing: '83', account: '1' } })).status, 422);
  const acc = await call('POST', `/v1/payees/${first.partyId}/accounts`, 'clerk', { market: 'SE', method: 'se-bank', details: { clearing: '8327', account: '9412345678' } });
  assert.equal(acc.status, 201);
  assert.ok(validatorFor('PayeeAccount')(structuredClone(acc.body)), JSON.stringify(validatorFor('PayeeAccount').errors));
  assert.equal(acc.body.details.account, '******5678');

  const held = await call('GET', '/v1/payouts?status=held', 'clerk');
  assert.ok(held.body.items.some((p: any) => p.id === first.id), 'new details: held');
  assert.equal((await call('POST', `/v1/payouts/${first.id}/releases`, 'clerk', {})).status, 403, 'the one who gave the details');
  const released = await call('POST', `/v1/payouts/${first.id}/releases`, 'clerk2', { note: 'Called the customer on the number in the register.' });
  assert.equal(released.status, 201);
  assert.equal(released.body.status, 'paid');
  assert.equal((await call('POST', `/v1/payouts/${first.id}/releases`, 'clerk2', {})).status, 409);

  while ((await inst.relay.tick()) > 0);
  while ((await inst.webhookWorker.tick()).delivered > 0);
  const events = received.map((r) => JSON.parse(r.body)).filter((e) => e.type === 'petvold.payout.paid.v1');
  assert.ok(events.some((e) => e.subject === first.id));
  for (const e of events) {
    assert.ok(eventValidator('payout.paid')(e), JSON.stringify(eventValidator('payout.paid').errors));
    assert.equal(JSON.stringify(e).includes('9412345678'), false, 'never the account number');
  }
  const listed = await call('GET', `/v1/payees/${first.partyId}/accounts`, 'clerk');
  assert.deepEqual(listed.body.items.map((a: any) => a.current), [true]);
});

test('direct settlement: a clinic with an agreement is paid the claims it reports', async () => {
  const clock = { now: () => NOW };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock, payments: { fake: { secret: SECRET, markets: [{ market: 'SE', currency: 'SEK' }] } } });
  const tokens: Record<string, Principal> = {
    clerk: { subject: 'finance@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    handler: { subject: 'h@example.test', roles: ['handler'], markets: ['SE'] },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let k = 0;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': `key-clinic-${String(++k).padStart(4, '0')}` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const { seedSampleData } = await import('../src/seed.ts');
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);

  assert.equal((await call('POST', '/v1/clinic-agreements', 'handler', { clinicId: 'clinic_001', market: 'SE', validFrom: '2026-01-01' })).status, 403);
  const agreement = await call('POST', '/v1/clinic-agreements', 'clerk', { clinicId: 'clinic_001', market: 'SE', validFrom: '2026-01-01' });
  assert.equal(agreement.status, 201);
  assert.ok(validatorFor('ClinicAgreement')(structuredClone(agreement.body)), JSON.stringify(validatorFor('ClinicAgreement').errors));
  assert.equal((await call('POST', '/v1/clinic-agreements', 'clerk', { clinicId: 'clinic_001', market: 'SE', validFrom: '2026-06-01' })).status, 409);
  assert.equal((await call('POST', '/v1/clinics/clinic_001/accounts', 'clerk', { market: 'SE', method: 'iban', details: { iban: 'SE4550000000058398257466' } })).status, 201);

  const { fixtures } = await import('@petvold/claims-store-memory');
  await inst.deps.service.registerClaim(fixtures.otitisClaim({ id: 'clm_clinic1', claimNo: 'S-2026-099001', channel: 'clinic_direct', clinicId: 'clinic_001', receivedAt: '2026-11-30T10:00:00Z' }));
  while ((await inst.relay.tick()) > 0);
  const [payout] = (await call('GET', '/v1/payouts?clinicId=clinic_001', 'clerk')).body.items;
  assert.ok(payout, 'the clinic was paid');
  assert.ok(validatorFor('Payout')(structuredClone(payout)), JSON.stringify(validatorFor('Payout').errors));
  assert.deepEqual([payout.claimId, payout.clinicId, payout.partyId, payout.status], ['clm_clinic1', 'clinic_001', undefined, 'paid']);

  const ended = await call('POST', `/v1/clinic-agreements/${agreement.body.id}/endings`, 'clerk', { validTo: '2026-12-01', reason: 'The clinic ended the agreement.' });
  assert.equal(ended.status, 201);
  assert.equal((await call('GET', '/v1/clinic-agreements?clinicId=clinic_001', 'clerk')).body.items[0].ended.validTo, '2026-12-01');
  const accounts = await call('GET', '/v1/clinics/clinic_001/accounts', 'clerk');
  assert.equal(accounts.body.items[0].details.iban, '********************7466');
});
