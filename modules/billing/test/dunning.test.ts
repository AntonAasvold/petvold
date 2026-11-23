/** Unpaid premium (ADR 0040, punkt 7): reminder, notice of cancellation and its reversal when paid in time. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '@petvold/common';
import { BillingService, InMemoryBillingStore, type PolicyActions, type SourceEvent } from '../src/index.ts';

function setup(o: { reverse?: 'ok' | string } = {}) {
  let n = 0;
  let now = '2026-11-21T09:30:00.000Z';
  const calls: string[] = [];
  const actions: PolicyActions = {
    async cancelForUnpaidPremium(policyId, sentOn, note) {
      calls.push(`cancel ${policyId} ${sentOn} ${note}`);
      if (policyId === 'pol_gone') return { skipped: 'Policy pol_gone is already cancelled' };
      return { transactionId: `ptx_unpaid_${policyId}`, effectiveDate: addDays(sentOn, 14) };
    },
    async reverseCancellation(policyId, transactionId, note) {
      calls.push(`reverse ${policyId} ${transactionId} ${note}`);
      return !o.reverse || o.reverse === 'ok' ? { reversed: true } : { failed: o.reverse };
    },
  };
  const store = new InMemoryBillingStore();
  const service = new BillingService({
    store,
    products: { billing: async () => ({ market: 'SE', currency: 'SEK', paymentIntervals: ['year', 'quarter', 'month'], defaultPaymentInterval: 'year', installmentFee: 0, invoiceLeadDays: 31 }) },
    policies: { policyholderOn: async () => 'pty_anna' },
    clock: { now: () => now },
    ids: { next: (p) => `${p}_${++n}` },
    policyActions: actions,
  });
  return { service, store, calls, at: (t: string) => (now = t) };
}

const issued = (policyId: string): SourceEvent => ({
  id: `pev_${policyId}`,
  type: 'policy.issued',
  policyId,
  occurredAt: '2026-11-21T10:00:00.000Z',
  data: { transactionId: `ptx_${policyId}`, policyholderPartyId: 'pty_anna', productVersion: 'P@1', startDate: '2026-12-01', endDate: '2027-12-01', premium: { amount: 480_000, currency: 'SEK' } },
});

let paid = 0;
const payment = (amount: number, reference: string, bookedOn: string) => {
  const id = `pay_${++paid}`;
  return { id: `pmev_${id}`, type: 'payment.succeeded', paymentId: id, market: 'SE', occurredAt: `${bookedOn}T09:00:00.000Z`, data: { direction: 'incoming', provider: 'fake', amount, currency: 'SEK', reference, bookedOn } };
};

/** One yearly invoice for two dogs, due 5 December 2026. */
async function overdue(o: { reverse?: string } = {}) {
  const s = setup(o);
  await s.service.handlePolicyEvent(issued('pol_1'));
  await s.service.handlePolicyEvent(issued('pol_2'));
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-11-21', dryRun: false }, 'scheduler');
  const [inv] = await s.service.invoices({});
  assert.ok(inv);
  return { ...s, inv };
}

const run = (s: Awaited<ReturnType<typeof overdue>>, onDate: string, dryRun = false) => s.service.dunningRun({ market: 'SE', onDate, dryRun }, 'scheduler');

test('a reminder a week after the due date, once, with invoice.overdue', async () => {
  const s = await overdue();
  assert.deepEqual((await run(s, addDays(s.inv.dueDate, 6))).reminded, []);
  assert.deepEqual((await run(s, addDays(s.inv.dueDate, 7), true)).reminded, [s.inv.id], 'a dry run says it');
  assert.deepEqual((await s.service.invoice(s.inv.id)).dunning, [], 'and does nothing');
  assert.deepEqual((await run(s, addDays(s.inv.dueDate, 7))).reminded, [s.inv.id]);
  assert.deepEqual((await run(s, addDays(s.inv.dueDate, 8))).reminded, [], 'once');
  const events = (await s.store.pendingEvents(50)).filter((e) => e.type === 'invoice.overdue');
  assert.deepEqual(events.map((e) => [e.invoiceId, e.data.open, e.data.reminderNo]), [[s.inv.id, s.inv.total, 1]]);
});

test('notice of cancellation for every policy on the invoice when the reminder did not help', async () => {
  const s = await overdue();
  await run(s, addDays(s.inv.dueDate, 7));
  assert.deepEqual((await run(s, addDays(s.inv.dueDate, 20))).noticed, []);
  const r = await run(s, addDays(s.inv.dueDate, 21));
  assert.deepEqual(r.noticed.map((x) => x.cancellations.map((c) => c.policyId)), [['pol_1', 'pol_2']]);
  assert.ok(s.calls.every((c) => c.includes(`Unpaid premium on invoice ${s.inv.number}`)));
  const steps = (await s.service.invoice(s.inv.id)).dunning;
  assert.deepEqual(steps.map((x) => x.step), ['reminded', 'cancellation-noticed']);
  assert.deepEqual((await run(s, addDays(s.inv.dueDate, 30))).noticed, [], 'once');
});

test('paid before the cancellation takes effect: reversed; paid on or after: left', async () => {
  const s = await overdue();
  await run(s, addDays(s.inv.dueDate, 7));
  const noticeDay = addDays(s.inv.dueDate, 21);
  await run(s, noticeDay);
  await s.service.handlePaymentEvent(payment(s.inv.total, s.inv.reference.value, addDays(noticeDay, 13)));
  assert.deepEqual(s.calls.filter((c) => c.startsWith('reverse')).map((c) => c.split(' ').slice(0, 3).join(' ')), ['reverse pol_1 ptx_unpaid_pol_1', 'reverse pol_2 ptx_unpaid_pol_2']);
  const steps = (await s.service.invoice(s.inv.id)).dunning;
  assert.deepEqual(steps.map((x) => x.step), ['reminded', 'cancellation-noticed', 'cancellation-voided', 'cancellation-voided']);

  const late = await overdue();
  await run(late, addDays(late.inv.dueDate, 7));
  await run(late, noticeDay);
  await late.service.handlePaymentEvent(payment(late.inv.total, late.inv.reference.value, addDays(noticeDay, 14)));
  assert.equal(late.calls.filter((c) => c.startsWith('reverse')).length, 0, 'on the effective day: too late');
});

test('a policy that cannot be noticed is skipped with why, and a failed reversal is kept for a person', async () => {
  const s = setup({ reverse: 'Only the latest transaction can be reversed' });
  await s.service.handlePolicyEvent(issued('pol_gone'));
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-11-21', dryRun: false }, 'scheduler');
  const [inv] = await s.service.invoices({});
  await s.service.dunningRun({ market: 'SE', onDate: addDays(inv!.dueDate, 7), dryRun: false }, 'scheduler');
  const r = await s.service.dunningRun({ market: 'SE', onDate: addDays(inv!.dueDate, 21), dryRun: false }, 'scheduler');
  assert.deepEqual(r.noticed[0]?.skipped, [{ policyId: 'pol_gone', reason: 'Policy pol_gone is already cancelled' }]);

  const t = await overdue({ reverse: 'Only the latest transaction can be reversed' });
  await run(t, addDays(t.inv.dueDate, 7));
  await run(t, addDays(t.inv.dueDate, 21));
  await t.service.handlePaymentEvent(payment(t.inv.total, t.inv.reference.value, addDays(t.inv.dueDate, 22)));
  const steps = (await t.service.invoice(t.inv.id)).dunning;
  assert.deepEqual(steps.slice(2).map((x) => [x.step, 'reason' in x ? x.reason : '']), [
    ['cancellation-void-failed', 'Only the latest transaction can be reversed'],
    ['cancellation-void-failed', 'Only the latest transaction can be reversed'],
  ]);
});

test('a payment matched by hand also voids', async () => {
  const s = await overdue();
  await run(s, addDays(s.inv.dueDate, 7));
  await run(s, addDays(s.inv.dueDate, 21));
  const r = await s.service.handlePaymentEvent({ ...payment(s.inv.total, 'nope', addDays(s.inv.dueDate, 25)), data: { ...payment(1, 'x', '2027-01-01').data, amount: s.inv.total, reference: null, bookedOn: addDays(s.inv.dueDate, 25) } });
  assert.equal(r?.status, 'unmatched');
  await s.service.matchPayment(r!.paymentId, { invoiceId: s.inv.id }, 'finance@example.test');
  assert.equal(s.calls.filter((c) => c.startsWith('reverse')).length, 2);
});
