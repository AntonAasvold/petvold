import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillingError, BillingService, InMemoryBillingStore, type BillingMarketRules, type PaymentInterval, type SourceEvent } from '../src/index.ts';

function setup(o: { intervals?: PaymentInterval[]; defaultInterval?: PaymentInterval; fee?: number; now?: string; rules?: Record<string, BillingMarketRules> } = {}) {
  let n = 0;
  let now = o.now ?? '2026-11-21T09:30:00.000Z';
  const store = new InMemoryBillingStore();
  const product = { market: 'SE', currency: 'SEK', paymentIntervals: o.intervals ?? ['year', 'month'], defaultPaymentInterval: o.defaultInterval ?? 'month', installmentFee: o.fee ?? 0 };
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
