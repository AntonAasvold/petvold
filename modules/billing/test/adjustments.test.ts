/** Changes, cancellations and transfers against the plans and the invoices (ADR 0040, punkt 4). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillingService, InMemoryBillingStore, type PaymentInterval, type SourceEvent } from '../src/index.ts';

function setup(interval: PaymentInterval = 'month') {
  let n = 0;
  const store = new InMemoryBillingStore();
  const service = new BillingService({
    store,
    products: { billing: async () => ({ market: 'SE', currency: 'SEK', paymentIntervals: ['year', 'quarter', 'month'], defaultPaymentInterval: interval, installmentFee: 0, invoiceLeadDays: 20 }) },
    policies: { policyholderOn: async () => 'pty_anna' },
    clock: { now: () => '2026-11-21T09:30:00.000Z' },
    ids: { next: (p) => `${p}_${++n}` },
  });
  return { service, store };
}

/** Bella: 4 800 kr from 1 December 2026, a year. */
const issued: SourceEvent = {
  id: 'pev_issue',
  type: 'policy.issued',
  policyId: 'pol_1',
  occurredAt: '2026-11-21T10:00:00.000Z',
  data: { transactionId: 'ptx_1', policyholderPartyId: 'pty_anna', productVersion: 'P@1', startDate: '2026-12-01', endDate: '2027-12-01', premium: { amount: 480_000, currency: 'SEK' } },
};
const event = (id: string, type: string, data: Record<string, unknown>, at = '2027-01-15T10:00:00.000Z'): SourceEvent => ({ id, type, policyId: 'pol_1', occurredAt: at, data: { transactionId: `ptx_${id}`, ...data } });

/** Monthly, December and January invoiced. */
async function invoicedTwoMonths() {
  const s = setup('month');
  await s.service.handlePolicyEvent(issued);
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-11-22', dryRun: false }, 'scheduler');
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-12-12', dryRun: false }, 'scheduler');
  assert.equal((await s.service.invoices({})).length, 2);
  return s;
}

const current = async (s: ReturnType<typeof setup>) => {
  const all = await s.store.plans({ policyId: 'pol_1' });
  return all.filter((p) => !all.some((q) => q.replaces === p.id));
};

test('a higher premium is spread over the months not invoiced', async () => {
  const s = await invoicedTwoMonths();
  await s.service.handlePolicyEvent(event('pev_c1', 'policy.changed', { termNo: 1, changeNo: 1, from: '2027-01-15', premiumAdjustment: 12_000, currency: 'SEK' }));
  const [plan] = await current(s);
  assert.deepEqual(plan!.plan.installments.map((i) => [i.seq, i.amount]), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((seq) => [seq, 41_200]));
  assert.deepEqual([plan!.plan.termPremium, plan!.adjustment?.kind, plan!.replaces], [492_000, 'change', 'ppl_2']);
  // The next run invoices February from the new plan.
  const feb = await s.service.invoicingRun({ market: 'SE', onDate: '2027-01-12', dryRun: false }, 'scheduler');
  assert.deepEqual(feb.invoices.map((i) => i.total), [41_200]);
  assert.equal(await s.service.handlePolicyEvent(event('pev_c1', 'policy.changed', { termNo: 1, from: '2027-01-15', premiumAdjustment: 12_000 })), null, 'the same event again');
});

test('a higher premium when everything is invoiced is a charge of its own', async () => {
  const s = setup('year');
  await s.service.handlePolicyEvent(issued);
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-11-22', dryRun: false }, 'scheduler');
  await s.service.handlePolicyEvent(event('pev_c2', 'policy.changed', { termNo: 1, from: '2027-01-15', premiumAdjustment: 30_000 }));
  const [plan] = await current(s);
  assert.deepEqual(plan!.plan.installments.map((i) => [i.seq, i.periodStart, i.periodEnd, i.amount]), [[2, '2027-01-15', '2027-12-01', 30_000]]);
  const run = await s.service.invoicingRun({ market: 'SE', onDate: '2027-01-15', dryRun: false }, 'scheduler');
  assert.deepEqual(run.invoices.map((i) => [i.total, i.dueDate]), [[30_000, '2027-02-15']], 'a later premium: a month after the invoice');
});

test('a lower premium comes off the months not invoiced; credited only when everything is invoiced', async () => {
  const monthly = await invoicedTwoMonths();
  await monthly.service.handlePolicyEvent(event('pev_c3', 'policy.changed', { termNo: 1, from: '2027-01-15', premiumAdjustment: -10_000 }));
  const [plan] = await current(monthly);
  assert.deepEqual(plan!.plan.installments.map((i) => i.amount), [39_000, ...Array(9).fill(39_000)]);
  assert.equal((await monthly.service.creditNotes({})).length, 0);

  const yearly = setup('year');
  await yearly.service.handlePolicyEvent(issued);
  await yearly.service.invoicingRun({ market: 'SE', onDate: '2026-11-22', dryRun: false }, 'scheduler');
  await yearly.service.handlePolicyEvent(event('pev_c4', 'policy.changed', { termNo: 1, from: '2027-01-15', premiumAdjustment: -10_000 }));
  const [credit] = await yearly.service.creditNotes({});
  const [invoice] = await yearly.service.invoices({});
  assert.deepEqual([credit!.number, credit!.invoiceId, credit!.total, credit!.lines.map((l) => [l.seq, l.amount])], ['SE-2027-000001', invoice!.id, 10_000, [[1, 10_000]]]);
  const events = (await yearly.store.pendingEvents(10)).map((e) => [e.type, e.data.creditNoteNo ?? e.data.invoiceNo]);
  assert.deepEqual(events, [['invoice.issued', 'SE-2026-000001'], ['invoice.credited', 'SE-2027-000001']]);
});

test('a cancellation: the months not invoiced go, what the term still costs stays, the rest is credited', async () => {
  const s = await invoicedTwoMonths();
  // From 16 January: 319 of 365 days back, 419 507.
  await s.service.handlePolicyEvent(event('pev_x', 'policy.cancelled', { reason: 'need-ceased', effectiveDate: '2027-01-16', refund: { amount: 419_507, currency: 'SEK' } }));
  const [plan] = await current(s);
  assert.deepEqual([plan!.plan.installments.length, plan!.adjustment?.kind, plan!.plan.termPremium], [0, 'cancellation', 60_493]);
  const credits = await s.service.creditNotes({ policyId: 'pol_1' });
  assert.deepEqual(credits.map((c) => [c.total, c.lines.map((l) => l.seq)]), [[19_507, [2]]], 'December stays, 20 493 of January stays');
  assert.equal((await s.service.invoicingRun({ market: 'SE', onDate: '2027-03-01', dryRun: false }, 'scheduler')).invoices.length, 0, 'nothing more to invoice');
});

test('a cancellation from the start of the term credits everything; one at the end of the term credits nothing', async () => {
  const s = await invoicedTwoMonths();
  await s.service.handlePolicyEvent(event('pev_w', 'policy.cancelled', { reason: 'withdrawal', effectiveDate: '2026-12-01', refund: { amount: 480_000, currency: 'SEK' } }));
  assert.deepEqual((await s.service.creditNotes({})).map((c) => c.total).sort(), [40_000, 40_000]);

  const t = await invoicedTwoMonths();
  assert.deepEqual(await t.service.handlePolicyEvent(event('pev_e', 'policy.cancelled', { reason: 'customer-term-end', effectiveDate: '2027-12-01', refund: { amount: 0, currency: 'SEK' } })), null);
  assert.equal((await current(t))[0]!.id, 'ppl_2', 'the plan stands');
});

test('a transfer: the former owner is settled from the sale day, the new one gets a plan for the rest of the term', async () => {
  const s = await invoicedTwoMonths();
  // Sold 1 June 2027: 183 of 365 days, 240 658.
  await s.service.handlePolicyEvent(event('pev_t', 'policy.transferred', { fromPartyId: 'pty_anna', toPartyId: 'pty_bo', from: '2027-06-01', premium: { amount: 240_658, currency: 'SEK' } }, '2027-05-20T10:00:00.000Z'));
  const plans = await current(s);
  const anna = plans.find((p) => p.adjustment?.kind === 'transfer-from')!;
  const bo = plans.find((p) => p.adjustment?.kind === 'transfer-to')!;
  // Anna: 480 000 − 240 658 = 239 342, of which 80 000 invoiced; the rest a new charge.
  assert.deepEqual([anna.plan.installments.map((i) => i.amount), anna.plan.termPremium], [[159_342], 239_342]);
  assert.equal((await s.service.creditNotes({})).length, 0);
  // Bo: a new account and a monthly plan from 1 June, his first premium.
  const account = await s.service.account(bo.accountId);
  assert.deepEqual([account.partyId, bo.plan.termStart, bo.plan.termEnd, bo.plan.termPremium, bo.plan.interval, bo.plan.installments.length], ['pty_bo', '2027-06-01', '2027-12-01', 240_658, 'month', 6]);
  assert.ok(bo.input.firstPremium);
});

test('a reinstatement: the months come back, and what was credited is charged again', async () => {
  const s = await invoicedTwoMonths();
  await s.service.handlePolicyEvent(event('pev_x', 'policy.cancelled', { reason: 'need-ceased', effectiveDate: '2027-01-16', refund: { amount: 419_507, currency: 'SEK' } }));
  await s.service.handlePolicyEvent(event('pev_r', 'policy.reinstated', { transactionId: 'ptx_r', reverses: 'ptx_pev_x', refundReversed: { amount: 419_507, currency: 'SEK' } }, '2027-01-20T10:00:00.000Z'));
  const [plan] = await current(s);
  assert.equal(plan!.adjustment?.kind, 'reinstatement');
  // February to November as before, and the 195,07 credited of January as a charge of its own.
  assert.deepEqual(plan!.plan.installments.map((i) => [i.seq, i.amount]), [...[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((seq) => [seq, 40_000]), [13, 19_507]]);
  assert.equal(plan!.plan.termPremium, 480_000);
  assert.equal(await s.service.handlePolicyEvent(event('pev_r', 'policy.reinstated', { transactionId: 'ptx_r', reverses: 'ptx_pev_x' })), null, 'the same event again');
  assert.equal(await s.service.handlePolicyEvent(event('pev_r2', 'policy.reinstated', { transactionId: 'ptx_r2', reverses: 'ptx_other' })), null, 'another cancellation');
});
