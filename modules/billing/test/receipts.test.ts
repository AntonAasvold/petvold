/** Payments on the payers' accounts (ADR 0040, punkt 6): matching and allocation. */
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

const issued = (policyId: string, party = 'pty_anna'): SourceEvent => ({
  id: `pev_${policyId}`,
  type: 'policy.issued',
  policyId,
  occurredAt: '2026-11-21T10:00:00.000Z',
  data: { transactionId: `ptx_${policyId}`, policyholderPartyId: party, productVersion: 'P@1', startDate: '2026-12-01', endDate: '2027-12-01', premium: { amount: 480_000, currency: 'SEK' } },
});

let paid = 0;
const payment = (amount: number, reference: string | null, o: { currency?: string; market?: string } = {}) => {
  const id = `pay_${++paid}`;
  return { id: `pmev_${id}`, type: 'payment.succeeded', paymentId: id, market: o.market ?? 'SE', occurredAt: '2026-12-20T09:00:00.000Z', data: { direction: 'incoming', provider: 'fake', amount, currency: o.currency ?? 'SEK', reference, bookedOn: '2026-12-20' } };
};

/** Monthly 400 kr, December and January invoiced on two invoices. */
async function twoInvoices() {
  const s = setup();
  await s.service.handlePolicyEvent(issued('pol_1'));
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-11-22', dryRun: false }, 'scheduler');
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-12-12', dryRun: false }, 'scheduler');
  const [dec, jan] = await s.service.invoices({});
  assert.ok(dec && jan);
  return { ...s, dec, jan };
}

test('a payment with the invoice\'s reference pays it and gives invoice.paid', async () => {
  const { service, store, dec, jan } = await twoInvoices();
  const r = await service.handlePaymentEvent(payment(dec.total, dec.reference.value));
  assert.equal(r?.status, 'matched');
  assert.equal(r?.match?.how, 'reference');
  assert.deepEqual(r?.allocations, [{ invoiceId: dec.id, amount: dec.total }]);
  assert.equal(r?.unallocated, 0);
  assert.deepEqual(await service.invoice(dec.id).then((i) => [i.status, i.paid, i.open]), ['paid', dec.total, 0]);
  assert.equal((await service.invoice(jan.id)).status, 'open');
  const events = (await store.pendingEvents(50)).filter((e) => e.type === 'invoice.paid');
  assert.deepEqual(events.map((e) => [e.invoiceId, e.data.paymentId, e.data.paidOn]), [[dec.id, r?.paymentId, '2026-12-20']]);
  assert.deepEqual((await service.account(dec.accountId)).balance, { open: jan.total, credit: 0 });
});

test('the same event twice is received once', async () => {
  const { service, dec } = await twoInvoices();
  const e = payment(dec.total, dec.reference.value);
  await service.handlePaymentEvent(e);
  await service.handlePaymentEvent(e);
  assert.equal((await service.receivedPayments({})).length, 1);
  assert.equal((await service.invoice(dec.id)).paid, dec.total);
});

test('too little leaves the invoice partly paid; too much pays the oldest other invoice, then is credit', async () => {
  const { service, dec, jan } = await twoInvoices();
  await service.handlePaymentEvent(payment(10_000, jan.reference.value));
  assert.deepEqual(await service.invoice(jan.id).then((i) => [i.status, i.paid, i.open]), ['partly-paid', 10_000, jan.total - 10_000]);
  const r = await service.handlePaymentEvent(payment(dec.total + jan.total, jan.reference.value));
  // January first, as its reference says, then December, and the rest is credit.
  assert.deepEqual(r?.allocations, [{ invoiceId: jan.id, amount: jan.total - 10_000 }, { invoiceId: dec.id, amount: dec.total }]);
  assert.equal(r?.unallocated, 10_000);
  assert.deepEqual((await service.account(dec.accountId)).balance, { open: 0, credit: 10_000 });
  assert.deepEqual((await service.invoices({ status: 'paid' })).map((i) => i.id).sort(), [dec.id, jan.id].sort());
});

test('without a known reference the payment waits, and a person matches it', async () => {
  const { service, dec, jan } = await twoInvoices();
  const none = await service.handlePaymentEvent(payment(dec.total, null));
  const wrong = await service.handlePaymentEvent(payment(jan.total, '999999999999'));
  const euro = await service.handlePaymentEvent(payment(jan.total, jan.reference.value, { currency: 'EUR' }));
  assert.deepEqual([none?.status, wrong?.status, euro?.status], ['unmatched', 'unmatched', 'unmatched']);
  assert.equal((await service.receivedPayments({ status: 'unmatched' })).length, 3);

  const byAccount = await service.matchPayment(none!.paymentId, { accountId: dec.accountId, note: 'The payer named the policy.' }, 'finance@example.test');
  assert.deepEqual([byAccount.match?.how, byAccount.match?.matchedBy, byAccount.allocations], ['manual', 'finance@example.test', [{ invoiceId: dec.id, amount: dec.total }]]);
  const byInvoice = await service.matchPayment(wrong!.paymentId, { invoiceId: jan.id }, 'finance@example.test');
  assert.deepEqual(byInvoice.allocations, [{ invoiceId: jan.id, amount: jan.total }]);
  assert.equal((await service.receivedPayments({ status: 'unmatched' })).length, 1);

  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof BillingError ? e.code : String(e)));
  assert.equal(await code(service.matchPayment(none!.paymentId, { accountId: dec.accountId }, 'x')), 'conflict');
  assert.equal(await code(service.matchPayment(euro!.paymentId, { accountId: dec.accountId }, 'x')), 'validation', 'another currency');
  assert.equal(await code(service.matchPayment(euro!.paymentId, {}, 'x')), 'validation');
  assert.equal(await code(service.matchPayment(euro!.paymentId, { accountId: dec.accountId, invoiceId: dec.id }, 'x')), 'validation');
  assert.equal(await code(service.matchPayment('pay_nope', { accountId: dec.accountId }, 'x')), 'not_found');
});

test('a credit note on a paid invoice turns the paid part it no longer needs into credit', async () => {
  const { service, dec, jan } = await twoInvoices();
  await service.handlePaymentEvent(payment(dec.total, dec.reference.value));
  await service.handlePaymentEvent(payment(jan.total, jan.reference.value));
  // The dog died on 16 January: part of January is credited.
  await service.handlePolicyEvent({ id: 'pev_c', type: 'policy.cancelled', policyId: 'pol_1', occurredAt: '2027-01-16T10:00:00.000Z', data: { transactionId: 'ptx_c', reason: 'need-ceased', effectiveDate: '2027-01-16', refund: { amount: 419_507, currency: 'SEK' } } });
  const j = await service.invoice(jan.id);
  assert.ok(j.credited > 0);
  assert.equal(j.status, 'paid');
  assert.deepEqual((await service.account(jan.accountId)).balance, { open: 0, credit: j.credited });
});

test('other events are not payments', async () => {
  const { service } = setup();
  assert.equal(await service.handlePaymentEvent({ ...payment(100, null), type: 'payment.failed' }), null);
  assert.equal(await service.handlePaymentEvent({ ...payment(100, null), data: { direction: 'outgoing' } }), null);
});
