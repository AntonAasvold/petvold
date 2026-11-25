/** Recovery of a lowered claim payout (ADR 0040, punkt 8): proposed by billing, decided by a person, booked by accounting. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';

test('a lowered payout is proposed for recovery; a clerk offsets one against the credit, recovers one, and may not write off above the limit', async () => {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  const billing = inst.deps.billing!;
  await billing.invoicingRun({ market: 'SE', onDate: '2026-11-15', dryRun: false }, 'scheduler');
  const tokens: Record<string, Principal> = {
    clerk: { subject: 'ekonomi@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    handler: { subject: 'h@example.test', roles: ['handler'], markets: ['SE'] },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let k = 0;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': `key-rcv-${String(++k).padStart(4, '0')}` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as any };
  };

  // A customer pays 1,000 kr too much: credit.
  const invoice = (await call('GET', '/v1/invoices?status=open', 'clerk')).body.items[0];
  await billing.handlePaymentEvent({ id: 'evt_pay_1', type: 'payment.succeeded', paymentId: 'pay_rcv1', market: 'SE', occurredAt: clock.now(), data: { direction: 'incoming', amount: invoice.total + 100_000, currency: 'SEK', reference: invoice.reference.value, bookedOn: '2026-11-15' } });
  const accountCredit = async () => (await call('GET', `/v1/payer-accounts/${invoice.accountId}`, 'clerk')).body.balance.credit;
  assert.equal(await accountCredit(), 100_000);

  // Three decisions lowered payouts on the customer's policy.
  const policyId = invoice.lines[0].policyId;
  const reduced = (n: number, amount: number) => ({ id: `cev_red${n}`, type: 'claim.payout_reduced', claimId: `clm_red${n}`, market: 'SE', occurredAt: clock.now(), data: { payoutReductionId: `pr_${n}`, decisionId: `dec_${n}`, policyId, amount, currency: 'SEK', channel: 'clinic' } });
  const first = (await billing.handleClaimEvent(reduced(1, 40_000)))!;
  assert.equal((await billing.handleClaimEvent(reduced(1, 40_000)))!.id, first.id, 'the same event again: the same recovery');
  await billing.handleClaimEvent(reduced(2, 50_000));
  await billing.handleClaimEvent(reduced(3, 200_000));

  const queue = (await call('GET', '/v1/recoveries?status=proposed', 'clerk')).body.items;
  assert.deepEqual(queue.map((r: any) => [r.claimId, r.amount, r.accountId]), [['clm_red1', 40_000, invoice.accountId], ['clm_red2', 50_000, invoice.accountId], ['clm_red3', 200_000, invoice.accountId]]);
  assert.ok(validatorFor('Recovery')(structuredClone(queue[0])), JSON.stringify(validatorFor('Recovery').errors));
  const [r1, r2, r3] = queue.map((r: any) => r.id);

  assert.equal((await call('POST', `/v1/recoveries/${r1}/decisions`, 'handler', { outcome: 'offset' })).status, 403);
  const offset = await call('POST', `/v1/recoveries/${r1}/decisions`, 'clerk', { outcome: 'offset', note: 'Against the premium to be paid back' });
  assert.equal(offset.status, 201, JSON.stringify(offset.body));
  assert.equal(offset.body.status, 'offset');
  assert.equal(await accountCredit(), 60_000, 'the credit is 400 kr less');
  assert.equal((await call('POST', `/v1/recoveries/${r1}/decisions`, 'clerk', { outcome: 'recover' })).status, 409, 'once');
  assert.equal((await call('POST', `/v1/recoveries/${r3}/decisions`, 'clerk', { outcome: 'offset' })).status, 409, 'more than the credit');
  assert.equal((await call('POST', `/v1/recoveries/${r3}/decisions`, 'clerk', { outcome: 'write-off' })).status, 403, '2,000 kr is above the clerk\'s 1,000 kr');
  assert.equal((await call('POST', `/v1/recoveries/${r2}/decisions`, 'clerk', { outcome: 'recover' })).body.status, 'recovered');
  assert.equal((await call('POST', `/v1/recoveries/${r3}/decisions`, 'clerk', { outcome: 'collect' })).status, 422);

  // Accounting books the offset and the recovery against the claims' cost.
  while ((await inst.relay.tick()) > 0);
  const lines = (await inst.deps.accounting!.verifications({ market: 'SE' })).filter((v) => v.source.objectType === 'claim' && /^clm_red/.test(v.source.objectId)).map((v) => v.lines.map((l) => [l.account, l.debit, l.credit]));
  assert.deepEqual(lines, [
    [['premium-receivable', 40_000, 0], ['claims-cost', 0, 40_000]],
    [['recoveries-receivable', 50_000, 0], ['claims-cost', 0, 50_000]],
  ]);
});
