/** Credit balances (ADR 0040, punkt 6): used on the next invoice, or paid back. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillingError, BillingService, InMemoryBillingStore, type SourceEvent } from '../src/index.ts';

function setup() {
  let n = 0;
  const store = new InMemoryBillingStore();
  const service = new BillingService({
    store,
    products: { billing: async () => ({ market: 'SE', currency: 'SEK', paymentIntervals: ['year', 'quarter', 'month'], defaultPaymentInterval: 'month', installmentFee: 0, invoiceLeadDays: 20 }) },
    policies: { policyholderOn: async () => 'pty_anna' },
    clock: { now: () => '2026-12-20T09:30:00.000Z' },
    ids: { next: (p) => `${p}_${++n}` },
  });
  return { service, store };
}

const issued: SourceEvent = {
  id: 'pev_issue',
  type: 'policy.issued',
  policyId: 'pol_1',
  occurredAt: '2026-11-21T10:00:00.000Z',
  data: { transactionId: 'ptx_1', policyholderPartyId: 'pty_anna', productVersion: 'P@1', startDate: '2026-12-01', endDate: '2027-12-01', premium: { amount: 480_000, currency: 'SEK' } },
};
let paid = 0;
const payment = (amount: number, reference: string) => {
  const id = `pay_${++paid}`;
  return { id: `pmev_${id}`, type: 'payment.succeeded', paymentId: id, market: 'SE', occurredAt: '2026-12-02T09:00:00.000Z', data: { direction: 'incoming', provider: 'fake', amount, currency: 'SEK', reference, bookedOn: '2026-12-02' } };
};
const run = (s: ReturnType<typeof setup>, onDate: string, dryRun = false) => s.service.creditsRun({ market: 'SE', onDate, dryRun }, 'scheduler');

test('credit from an overpayment pays the next invoice, with invoice.paid paid with credit', async () => {
  const s = setup();
  await s.service.handlePolicyEvent(issued);
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-11-22', dryRun: false }, 'scheduler');
  const [dec] = await s.service.invoices({});
  await s.service.handlePaymentEvent(payment(dec!.total + 50_000, dec!.reference.value));
  assert.equal((await s.service.account(dec!.accountId)).balance.credit, 50_000);
  // Nothing open yet, but more to bill: the credit waits.
  assert.deepEqual((await run(s, '2026-12-03')).refunds, []);
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-12-12', dryRun: false }, 'scheduler');
  const jan = (await s.service.invoices({ status: 'open' }))[0]!;
  assert.deepEqual((await run(s, '2026-12-12', true)).applied, [{ accountId: dec!.accountId, invoiceIds: [jan.id], amount: 40_000 }], 'a dry run says it');
  assert.equal((await s.service.invoice(jan.id)).paid, 0, 'and does nothing');
  await run(s, '2026-12-12');
  const after = await s.service.invoice(jan.id);
  assert.deepEqual([after.status, after.paid], ['paid', 40_000]);
  assert.deepEqual((await s.service.account(dec!.accountId)).balance, { open: 0, credit: 10_000 });
  const paidEvents = (await s.store.pendingEvents(100)).filter((e) => e.type === 'invoice.paid' && e.invoiceId === jan.id);
  assert.deepEqual(paidEvents.map((e) => e.data.paidWith), ['credit']);
  assert.deepEqual((await run(s, '2026-12-13')).applied, [], 'nothing left to use it on');
});

test('credit with nothing more to bill is paid back once, as refund.ordered', async () => {
  const s = setup();
  await s.service.handlePolicyEvent(issued);
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-11-22', dryRun: false }, 'scheduler');
  const [dec] = await s.service.invoices({});
  await s.service.handlePaymentEvent(payment(dec!.total, dec!.reference.value));
  // The dog died on 16 December: part of December is credited, and nothing more is billed.
  await s.service.handlePolicyEvent({ id: 'pev_c', type: 'policy.cancelled', policyId: 'pol_1', occurredAt: '2026-12-16T10:00:00.000Z', data: { transactionId: 'ptx_c', reason: 'need-ceased', effectiveDate: '2026-12-16', refund: { amount: 460_274, currency: 'SEK' } } });
  const credit = (await s.service.account(dec!.accountId)).balance.credit;
  assert.ok(credit > 0);
  const r = await run(s, '2026-12-17');
  assert.deepEqual(r.refunds.map((x) => x.amount), [credit]);
  assert.deepEqual((await s.service.account(dec!.accountId)).balance, { open: 0, credit: 0 });
  const [refund] = await s.service.refunds({ accountId: dec!.accountId });
  assert.deepEqual([refund?.reason, refund?.amount, refund?.partyId], ['nothing-more-to-bill', credit, 'pty_anna']);
  const events = (await s.store.pendingEvents(100)).filter((e) => e.type === 'refund.ordered');
  assert.deepEqual(events.map((e) => [e.refundId, e.data.amount, e.data.partyId]), [[refund?.id, credit, 'pty_anna']]);
  assert.deepEqual((await run(s, '2026-12-18')).refunds, [], 'once');
});

test('the payer asks for credit back: all, or part, never more than there is', async () => {
  const s = setup();
  await s.service.handlePolicyEvent(issued);
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-11-22', dryRun: false }, 'scheduler');
  const [dec] = await s.service.invoices({});
  await s.service.handlePaymentEvent(payment(dec!.total + 30_000, dec!.reference.value));
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof BillingError ? e.code : String(e)));
  assert.equal(await code(s.service.requestRefund(dec!.accountId, { amount: 30_001 }, 'x')), 'conflict');
  assert.equal(await code(s.service.requestRefund(dec!.accountId, { amount: 0 }, 'x')), 'validation');
  const part = await s.service.requestRefund(dec!.accountId, { amount: 10_000, note: 'Asked by phone' }, 'kundservice@example.test');
  assert.deepEqual([part.amount, part.reason, part.note], [10_000, 'requested', 'Asked by phone']);
  const rest = await s.service.requestRefund(dec!.accountId, {}, 'kundservice@example.test');
  assert.equal(rest.amount, 20_000);
  assert.equal(await code(s.service.requestRefund(dec!.accountId, {}, 'x')), 'conflict', 'no credit left');
  assert.equal(await code(s.service.requestRefund('bac_x', {}, 'x')), 'not_found');
});
