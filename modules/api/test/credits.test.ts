/** Credit balances through the installation (ADR 0040, punkt 6): a cancellation's credit is paid back and paid out. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE_NOTIFICATION_SCHEMA, signNotification } from '@petvold/payments';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';

const SECRET = `whsec_${Buffer.alloc(32, 'credits-test').toString('base64')}`;

test('a paid invoice credited by a cancellation becomes credit, paid back and paid out to the policyholder', async () => {
  let now = '2026-11-15T10:00:00.000Z';
  const clock = { now: () => now };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock, payments: { fake: { secret: SECRET, markets: [{ market: 'SE', currency: 'SEK' }] } } });
  const tokens: Record<string, Principal> = { clerk: { subject: 'finance@example.test', roles: ['billing-clerk'], markets: ['SE'] } };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let k = 0;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { authorization: 'Bearer clerk', ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': `key-credit-${String(++k).padStart(4, '0')}` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const drain = async () => {
    while ((await inst.relay.tick()) > 0);
  };
  await seedSampleData(inst, clock);
  await drain();
  const billing = inst.deps.billing!;
  await billing.invoicingRun({ market: 'SE', onDate: '2026-11-15', dryRun: false }, 'scheduler');
  await drain();
  // An invoice with one policy, paid in full.
  const inv = (await billing.invoices({ status: 'open' })).find((i) => new Set(i.lines.map((l) => l.policyId)).size === 1)!;
  const policyId = inv.lines[0]!.policyId;
  const raw = signNotification(SECRET, 'msg_1', Date.parse(now) / 1000, JSON.stringify({ schema: FAKE_NOTIFICATION_SCHEMA, payments: [{ id: 'fb_1', market: 'SE', currency: 'SEK', amount: inv.total, reference: inv.reference.value, bookedOn: '2026-11-15' }] }));
  assert.equal((await app.request('/provider-notifications/fake', { method: 'POST', headers: { 'content-type': 'application/json', ...(raw.headers as Record<string, string>) }, body: raw.body })).status, 200);
  await drain();
  const partyId = inv.partyId;
  assert.equal((await call('POST', `/v1/payees/${partyId}/accounts`, { market: 'SE', method: 'se-bank', details: { clearing: '8327', account: '9412345678' } })).status, 201);

  // The customer regrets within fourteen days: the paid premium becomes credit.
  now = '2026-11-20T10:00:00.000Z';
  await inst.deps.policies!.cancel(policyId, { reason: 'withdrawal', receivedOn: '2026-11-20' }, 'kundservice@example.test');
  await drain();
  const account = await call('GET', `/v1/payer-accounts/${inv.accountId}`);
  assert.ok(account.body.balance.credit > 0, JSON.stringify(account.body.balance));
  const credit = account.body.balance.credit;

  // The credit run: the account has nothing more to bill, so the credit is paid back and out.
  now = '2026-11-21T03:30:00.000Z';
  const run = await billing.creditsRun({ market: 'SE', onDate: '2026-11-21', dryRun: false }, 'scheduler');
  const mine = run.refunds.find((r) => r.accountId === inv.accountId);
  assert.equal(mine?.amount, credit);
  await drain();
  const refunds = await call('GET', `/v1/refunds?accountId=${inv.accountId}`);
  assert.equal(refunds.body.items.length, 1);
  assert.ok(validatorFor('Refund')(structuredClone(refunds.body.items[0])), JSON.stringify(validatorFor('Refund').errors));
  const payouts = await call('GET', `/v1/payouts?partyId=${partyId}`);
  const refundPayout = payouts.body.items.find((p: any) => p.purpose === 'premium-refund');
  assert.deepEqual([refundPayout?.orderId, refundPayout?.amount, refundPayout?.status], [refunds.body.items[0].id, credit, 'paid']);
  assert.ok(validatorFor('Payout')(structuredClone(refundPayout)), JSON.stringify(validatorFor('Payout').errors));
  assert.deepEqual((await call('GET', `/v1/payer-accounts/${inv.accountId}`)).body.balance, { open: 0, credit: 0 });
  assert.equal((await call('POST', `/v1/payer-accounts/${inv.accountId}/refunds`, {})).status, 409, 'nothing left');
  assert.equal(inst.relay.deadLetters().length, 0);
});
