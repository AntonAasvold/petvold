/** From money events to verifications (ADR 0040, punkt 9). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { AccountingService, assertBalanced, InMemoryAccountingStore, split, verificationFor, type AccountingSources, type MoneyEvent } from '../src/index.ts';

const invoice = {
  id: 'inv_1',
  number: 'SE-2026-000001',
  accountId: 'bac_1',
  market: 'SE',
  currency: 'SEK',
  issueDate: '2026-11-21',
  lines: [
    { planId: 'ppl_1', policyId: 'pol_1', seq: 1, periodStart: '2026-12-01', periodEnd: '2027-01-01', premium: 40_000, tax: 0, fee: 500, amount: 40_500 },
    { planId: 'ppl_2', policyId: 'pol_2', seq: 1, periodStart: '2026-12-01', periodEnd: '2027-01-01', premium: 30_000, tax: 0, fee: 500, amount: 30_500 },
  ],
};
const sources = (o: { kind?: 'credit' | 'write-off' } = {}): AccountingSources => ({
  invoice: async (id) => (id === 'inv_1' ? invoice : null),
  creditNote: async (id) =>
    id === 'crn_1' ? { id: 'crn_1', number: 'SE-2026-000002', kind: o.kind ?? 'credit', invoiceId: 'inv_1', accountId: 'bac_1', market: 'SE', currency: 'SEK', issueDate: '2026-12-16', lines: [{ planId: 'ppl_1', policyId: 'pol_1', seq: 1, amount: 20_250 }], total: 20_250 } : null,
});
function setup(o: { kind?: 'credit' | 'write-off' } = {}) {
  let n = 0;
  const store = new InMemoryAccountingStore();
  const service = new AccountingService({ store, sources: sources(o), clock: { now: () => '2026-12-20T10:00:00.000Z' }, ids: { next: (p) => `${p}_${++n}` } });
  return { service, store };
}
const ev = (type: string, extra: Partial<MoneyEvent> = {}, data: Record<string, unknown> = {}): MoneyEvent => ({ id: `e_${type}`, type, market: 'SE', occurredAt: '2026-12-20T10:00:00.000Z', data, ...extra });
const sums = (v: { lines: { account: string; debit: number; credit: number }[] }) => Object.fromEntries(v.lines.map((l) => [l.account, l.debit - l.credit]).reduce((m, [a, x]) => m.set(a as string, (m.get(a as string) ?? 0) + (x as number)), new Map<string, number>()));

test('an invoice: the payer owes it, premium and fees are income for their periods', async () => {
  const { service } = setup();
  const v = (await service.handleEvent(ev('invoice.issued', { invoiceId: 'inv_1' })))!;
  assert.deepEqual([v.number, v.bookingDate, v.source.objectType, v.source.objectId], ['V-SE-2026-000001', '2026-11-21', 'invoice', 'inv_1']);
  assert.deepEqual(sums(v), { 'premium-receivable': 71_000, 'premium-income': -70_000, 'installment-fees': -1_000 });
  assert.deepEqual(v.lines.find((l) => l.policyId === 'pol_2' && l.account === 'premium-income')?.period, { from: '2026-12-01', to: '2027-01-01' });
  assert.equal(v.lines.find((l) => l.account === 'premium-receivable')?.payerAccountId, 'bac_1');
});

test('a credit note takes back income line by line; a write-off is a loss', async () => {
  const credited = (await setup().service.handleEvent(ev('invoice.credited', { invoiceId: 'inv_1' }, { creditNoteId: 'crn_1' })))!;
  // 20 250 of a line with 40 000 premium and 500 fee.
  assert.deepEqual(sums(credited), { 'premium-income': 20_000, 'installment-fees': 250, 'premium-receivable': -20_250 });
  const written = (await setup({ kind: 'write-off' }).service.handleEvent(ev('invoice.credited', { invoiceId: 'inv_1' }, { creditNoteId: 'crn_1' })))!;
  assert.deepEqual(sums(written), { 'customer-losses': 20_250, 'premium-receivable': -20_250 });
});

test('a payment is unmatched until billing matches it; refunds and payouts go through payables', async () => {
  const { service } = setup();
  const paid = (await service.handleEvent(ev('payment.succeeded', { paymentId: 'pay_1' }, { direction: 'incoming', amount: 71_000, currency: 'SEK', reference: '20260000011', bookedOn: '2026-12-02' })))!;
  assert.deepEqual([paid.bookingDate, sums(paid)], ['2026-12-02', { bank: 71_000, 'unmatched-payments': -71_000 }]);
  const matched = (await service.handleEvent(ev('payment.matched', { paymentId: 'pay_1' }, { accountId: 'bac_1', amount: 71_000, currency: 'SEK', how: 'reference', bookedOn: '2026-12-02' })))!;
  assert.deepEqual(sums(matched), { 'unmatched-payments': 71_000, 'premium-receivable': -71_000 });
  const refund = (await service.handleEvent(ev('refund.ordered', { refundId: 'ref_1' }, { accountId: 'bac_1', amount: 5_000, currency: 'SEK' })))!;
  assert.deepEqual(sums(refund), { 'premium-receivable': 5_000, 'refunds-payable': -5_000 });
  const order = (await service.handleEvent(ev('claim.payout_ordered', { claimId: 'clm_1' }, { payoutOrderId: 'po_1', policyId: 'pol_1', amount: 123_400, currency: 'SEK' })))!;
  assert.deepEqual(sums(order), { 'claims-cost': 123_400, 'claims-payable': -123_400 });
  const out = (await service.handleEvent(ev('payout.paid', { payoutId: 'pyo_1' }, { purpose: 'claim', claimId: 'clm_1', orderId: 'po_1', amount: 123_400, currency: 'SEK' })))!;
  assert.deepEqual(sums(out), { 'claims-payable': 123_400, bank: -123_400 });
  const back = (await service.handleEvent(ev('payout.paid', { id: 'e_back', payoutId: 'pyo_2' }, { purpose: 'premium-refund', orderId: 'ref_1', amount: 5_000, currency: 'SEK' })))!;
  assert.deepEqual(sums(back), { 'refunds-payable': 5_000, bank: -5_000 });
  // Every account but bank and the costs nets to what is still owed.
  assert.deepEqual(
    (await service.balances({ market: 'SE' })).map((b) => [b.account, b.balance]),
    [['bank', 71_000 - 123_400 - 5_000], ['premium-receivable', -71_000 + 5_000], ['unmatched-payments', 0], ['claims-cost', 123_400], ['claims-payable', 0], ['refunds-payable', 0]],
  );
});

test('an event is booked once, events without money not at all, and numbers run per market and year', async () => {
  const { service } = setup();
  const e = ev('invoice.issued', { invoiceId: 'inv_1' });
  const a = await service.handleEvent(e);
  assert.equal((await service.handleEvent(e))?.id, a?.id);
  assert.equal(await service.handleEvent(ev('invoice.paid', { invoiceId: 'inv_1' })), null);
  assert.equal(await service.handleEvent(ev('payment.succeeded', { paymentId: 'pay_x' }, { direction: 'outgoing' })), null);
  const next = await service.handleEvent(ev('payment.succeeded', { id: 'e_2027', paymentId: 'pay_2', occurredAt: '2027-01-02T10:00:00.000Z' }, { direction: 'incoming', amount: 1, currency: 'SEK', bookedOn: '2027-01-02' }));
  assert.equal(next?.number, 'V-SE-2027-000001');
  assert.equal((await service.verifications({ market: 'SE', from: '2026-01-01', to: '2026-12-31' })).length, 1);
});

test('every verification balances, whatever the amounts and lines', () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ premium: fc.integer({ min: 0, max: 500_000 }), tax: fc.integer({ min: 0, max: 50_000 }), fee: fc.integer({ min: 0, max: 5_000 }) }), { minLength: 1, maxLength: 5 }),
      fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 5, maxLength: 5 }),
      (parts, shares) => {
        const lines = parts.map((p, i) => ({ planId: `ppl_${i}`, policyId: `pol_${i}`, seq: 1, periodStart: '2026-12-01', periodEnd: '2027-01-01', ...p, amount: p.premium + p.tax + p.fee })).filter((l) => l.amount > 0);
        if (!lines.length) return;
        const inv = { ...invoice, lines };
        const issued = verificationFor(ev('invoice.issued', { invoiceId: 'inv_1' }), { invoice: inv })!;
        assertBalanced(issued);
        const creditLines = lines.map((l, i) => ({ planId: l.planId, policyId: l.policyId, seq: 1, amount: Math.floor(l.amount * shares[i]!) })).filter((l) => l.amount > 0);
        if (!creditLines.length) return;
        const note = { id: 'crn_1', number: 'x', kind: 'credit' as const, invoiceId: 'inv_1', accountId: 'bac_1', market: 'SE', currency: 'SEK', issueDate: '2026-12-16', lines: creditLines, total: creditLines.reduce((s, l) => s + l.amount, 0) };
        const credited = verificationFor(ev('invoice.credited', { invoiceId: 'inv_1' }), { invoice: inv, creditNote: note })!;
        assertBalanced(credited);
        // Never more taken back from an account than the invoice put there.
        for (const k of ['premium-income', 'premium-tax', 'installment-fees'] as const) {
          const put = issued.lines.filter((l) => l.account === k).reduce((s, l) => s + l.credit, 0);
          const back = credited.lines.filter((l) => l.account === k).reduce((s, l) => s + l.debit, 0);
          assert.ok(back <= put, `${k}: ${back} > ${put}`);
        }
      },
    ),
    { numRuns: 300 },
  );
});

test('split keeps the sum and the order of weights', () => {
  assert.deepEqual(split(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(split(5, [0, 0, 0]), [5, 0, 0]);
  assert.deepEqual(split(7, [0, 3, 1]), [0, 5, 2]);
  assert.deepEqual(split(2, [1, 1, 1]), [1, 1, 0], 'never more than the weight');
});
