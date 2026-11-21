import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillingError, BillingService, InMemoryBillingStore, type BillingMarketRules, type PaymentInterval, type SourceEvent } from '../src/index.ts';

function setup(o: { intervals?: PaymentInterval[]; defaultInterval?: PaymentInterval; fee?: number; now?: string; rules?: Record<string, BillingMarketRules> } = {}) {
  let n = 0;
  let now = o.now ?? '2026-11-21T09:30:00.000Z';
  const store = new InMemoryBillingStore();
  const product = { market: 'SE', currency: 'SEK', paymentIntervals: o.intervals ?? ['year', 'month'], defaultPaymentInterval: o.defaultInterval ?? 'month', installmentFee: o.fee ?? 0, invoiceLeadDays: 20 };
  const products = new Map<string, typeof product>([['SE-HUND-BAS@2026.1', product]]);
  const holders = new Map<string, string>([['pol_1', 'pty_anna']]);
  const service = new BillingService({
    store,
    products: { billing: async (pv) => products.get(pv) ?? null },
    policies: { policyholderOn: async (id) => holders.get(id) ?? null },
    clock: { now: () => now },
    ids: { next: (p) => `${p}_${++n}` },
    ...(o.rules ? { rules: o.rules } : {}),
  });
  return { service, store, products, holders, setNow: (t: string) => (now = t) };
}

const issued = (o: Partial<SourceEvent> = {}, data: Record<string, unknown> = {}): SourceEvent => ({
  id: 'pev_1',
  type: 'policy.issued',
  policyId: 'pol_1',
  occurredAt: '2026-11-21T23:30:00.000Z',
  data: { transactionId: 'ptx_1', policyholderPartyId: 'pty_anna', productVersion: 'SE-HUND-BAS@2026.1', startDate: '2026-11-25', endDate: '2027-11-25', premium: { amount: 480_000, currency: 'SEK' }, ...data },
  ...o,
});

test('policy.issued gives a payer account and a plan with the product\'s default interval', async () => {
  const { service } = setup({ fee: 2_900 });
  const plan = await service.handlePolicyEvent(issued());
  assert.ok(plan);
  assert.equal(plan.accountId, 'bac_1');
  assert.deepEqual([plan.termNo, plan.market, plan.plan.interval, plan.plan.installments.length, plan.plan.fees], [1, 'SE', 'month', 12, 12 * 2_900]);
  // The notice went out on 22 November in Stockholm (23:30 UTC): due fourteen days later, after the term start.
  assert.deepEqual(plan.input.firstPremium, { noticeSentOn: '2026-11-22', payWithinDays: 14 });
  assert.equal(plan.plan.installments[0]!.dueDate, '2026-12-06');
  assert.deepEqual(plan.source, { eventId: 'pev_1', eventType: 'policy.issued', occurredAt: '2026-11-21T23:30:00.000Z' });
  assert.deepEqual(await service.account('bac_1'), { id: 'bac_1', partyId: 'pty_anna', market: 'SE', currency: 'SEK', paymentMethod: 'invoice', createdAt: '2026-11-21T09:30:00.000Z' });
});

test('the same event again gives nothing new', async () => {
  const { service, store } = setup();
  await service.handlePolicyEvent(issued());
  assert.equal(await service.handlePolicyEvent(issued()), null);
  assert.equal((await store.plans({ policyId: 'pol_1' })).length, 1);
  assert.equal((await store.accounts({})).length, 1);
});

test('a second policy for the same payer joins the account', async () => {
  const { service } = setup();
  await service.handlePolicyEvent(issued());
  const second = await service.handlePolicyEvent(issued({ id: 'pev_2', policyId: 'pol_2' }));
  assert.equal(second!.accountId, 'bac_1');
  assert.deepEqual((await service.plans({ accountId: 'bac_1' })).map((p) => p.policyId), ['pol_1', 'pol_2']);
});

test('policy.renewed: the policyholder on the start day, and the interval kept while the product allows it', async () => {
  const { service, products } = setup({ defaultInterval: 'year' });
  const first = await service.handlePolicyEvent(issued({}, {}));
  assert.equal(first!.plan.interval, 'year');
  const renewed = (id: string, start: string, end: string): SourceEvent => ({
    id,
    type: 'policy.renewed',
    policyId: 'pol_1',
    occurredAt: '2027-10-11T02:00:00.000Z',
    data: { transactionId: 'ptx_2', termNo: 2, startDate: start, endDate: end, productVersion: 'SE-HUND-BAS@2026.1', premium: { amount: 504_000, currency: 'SEK' } },
  });
  // The customer had year; the product's default is now month, but year is still allowed.
  products.get('SE-HUND-BAS@2026.1')!.defaultPaymentInterval = 'month';
  const second = await service.handlePolicyEvent(renewed('pev_2', '2027-11-25', '2028-11-25'));
  assert.deepEqual([second!.termNo, second!.plan.interval, second!.plan.termPremium, second!.input.firstPremium], [2, 'year', 504_000, undefined]);
  assert.equal(second!.plan.installments[0]!.dueDate, '2027-11-25');
  // The product no longer allows year: the default.
  products.get('SE-HUND-BAS@2026.1')!.paymentIntervals = ['month'];
  const third = await service.handlePolicyEvent({ ...renewed('pev_3', '2028-11-25', '2029-11-25'), data: { ...renewed('x', '2028-11-25', '2029-11-25').data, termNo: 3 } });
  assert.equal(third!.plan.interval, 'month');
});

test('other events give nothing, and missing data is an error the relay retries', async () => {
  const { service, holders } = setup();
  assert.equal(await service.handlePolicyEvent({ ...issued(), type: 'policy.changed' }), null);
  await assert.rejects(service.handlePolicyEvent(issued({}, { productVersion: 'NOPE@1' })), /product version NOPE@1/);
  await assert.rejects(service.handlePolicyEvent(issued({ id: 'pev_9' }, { policyholderPartyId: undefined })), /No policyholder/);
  holders.clear();
  await assert.rejects(setup({ rules: {} }).service.handlePolicyEvent(issued()), /No billing rules for the market SE/);
});

test('reading: an unknown account, and plans need a filter', async () => {
  const { service } = setup();
  await assert.rejects(service.account('bac_x'), (e: unknown) => e instanceof BillingError && e.code === 'not_found');
  await assert.rejects(service.plans({}), (e: unknown) => e instanceof BillingError && e.code === 'validation');
});

test('retention: ongoing while a planned term runs, then its end', async () => {
  const { service, setNow } = setup();
  assert.equal(await service.activityOf('pty_anna'), null);
  await service.handlePolicyEvent(issued());
  assert.deepEqual(await service.activityOf('pty_anna'), { ongoing: true });
  setNow('2027-12-01T10:00:00.000Z');
  assert.deepEqual(await service.activityOf('pty_anna'), { lastDate: '2027-11-25' });
});

test('the invoicing run: one invoice per account with what is due within the lead time', async () => {
  const { service } = setup({ defaultInterval: 'month', now: '2026-11-21T09:30:00.000Z' });
  await service.handlePolicyEvent(issued());
  await service.handlePolicyEvent(issued({ id: 'pev_2', policyId: 'pol_2' }, { startDate: '2026-12-15', endDate: '2027-12-15', premium: { amount: 240_000, currency: 'SEK' } }));
  // On 22 November, with 20 days' lead: pol_1's first installment (due 6 December). pol_2's is due 15 December, beyond.
  const dry = await service.invoicingRun({ market: 'SE', onDate: '2026-11-22', dryRun: true }, 'scheduler');
  assert.deepEqual(dry.invoices.map((i) => [i.accountId, i.lines.map((l) => `${l.policyId}#${l.seq}`), i.dueDate, i.total]), [['bac_1', ['pol_1#1'], '2026-12-06', 40_000]]);
  assert.equal((await service.invoices({})).length, 0, 'a dry run stores nothing');

  const run = await service.invoicingRun({ market: 'SE', onDate: '2026-11-22', dryRun: false }, 'scheduler');
  const inv = await service.invoice(run.invoices[0]!.invoiceId!);
  assert.deepEqual([inv.number, inv.reference.type, inv.issueDate, inv.dueDate, inv.total, inv.partyId, inv.createdBy], ['SE-2026-000001', 'ocr', '2026-11-22', '2026-12-06', 40_000, 'pty_anna', 'scheduler']);
  assert.equal(inv.reference.value, '202600000121');
  // The next day nothing new is due within the lead time.
  assert.equal((await service.invoicingRun({ market: 'SE', onDate: '2026-11-23', dryRun: false }, 'scheduler')).invoices.length, 0);
  // On 12 December: pol_1's second installment (25 December) and pol_2's first premium. A later premium may not be
  // due before a month after the invoice, 12 January, and the first premium not before 26 December (FAL 5 kap. 1 §).
  // A lead of 20 days is shorter than the law's month, so the invoice is due 12 January.
  const dec = await service.invoicingRun({ market: 'SE', onDate: '2026-12-12', dryRun: false }, 'scheduler');
  const second = await service.invoice(dec.invoices[0]!.invoiceId!);
  assert.deepEqual([second.number, second.lines.map((l) => `${l.policyId}#${l.seq}`), second.dueDate, second.total], ['SE-2026-000002', ['pol_2#1', 'pol_1#2'], '2027-01-12', 60_000]);
  assert.deepEqual((await service.invoices({ policyId: 'pol_2' })).map((i) => i.number), ['SE-2026-000002']);
});

test('the first premium is due the market\'s days after the invoice, if that is later than the plan says', async () => {
  const { service } = setup({ defaultInterval: 'year' });
  await service.handlePolicyEvent(issued({}, { startDate: '2026-11-22', endDate: '2027-11-22' }));
  // Plan: due 6 December (14 days after the 22nd). The run is a week late, on the 29th: due 13 December.
  const run = await service.invoicingRun({ market: 'SE', onDate: '2026-11-29', dryRun: false }, 'scheduler');
  assert.equal(run.invoices[0]!.dueDate, '2026-12-13');
});

test('a market without rules cannot be invoiced', async () => {
  const { service } = setup();
  await assert.rejects(service.invoicingRun({ market: 'DE', onDate: '2026-11-22', dryRun: true }, 'x'), (e: unknown) => e instanceof BillingError && e.code === 'validation');
});
