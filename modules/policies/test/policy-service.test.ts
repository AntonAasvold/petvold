import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryPolicyStore, PolicyError, PolicyService, addMonths, type IssueInput, type ProductOffer } from '../src/index.ts';

const vetCare = { code: 'vet_care' as const, annualLimit: 6_000_000, deductible: { fixed: 200_000, fixedPer: 'period' as const, periodDays: 125, variableBp: 2500 }, waitingPeriodDays: 30 };
const offer = (o: Partial<ProductOffer> = {}): ProductOffer => ({
  market: 'SE',
  currency: 'SEK',
  species: ['dog'],
  onSale: true,
  midTermCancellation: 'term-end',
  vetCareTermsFor: (c) => {
    if (c.annualLimit !== undefined && c.annualLimit !== 6_000_000) throw new Error(`No annual limit ${c.annualLimit}`);
    return { ...vetCare, deductibleOption: c.deductible ?? 'standard' };
  },
  ...o,
});

function setup(offers: Record<string, ProductOffer | null> = { 'SE-HUND@1': offer() }) {
  let n = 0;
  return new PolicyService({
    store: new InMemoryPolicyStore(),
    products: { offer: async (pv) => offers[pv] ?? null },
    animals: {
      get: async (id) =>
        ({
          ani_rex: { market: 'SE', species: 'dog', birthDate: '2024-03-01' },
          ani_cat: { market: 'SE', species: 'cat', birthDate: '2024-03-01' },
          ani_dead: { market: 'SE', species: 'dog', birthDate: '2015-03-01', deceasedOn: '2026-10-01' },
        })[id] ?? null,
    },
    parties: { marketOf: async (id) => ({ pty_anna: 'SE', pty_dag: 'DE' })[id] ?? null },
    clock: { now: () => '2026-11-15T10:00:00.000Z' },
    ids: { next: (p) => `${p}_${++n}` },
  });
}
const by = 'seller@example.test';
const input = (o: Partial<IssueInput> = {}): IssueInput => ({
  market: 'SE',
  animalId: 'ani_rex',
  policyholderPartyId: 'pty_anna',
  productVersion: 'SE-HUND@1',
  startDate: '2026-12-01',
  premium: { amount: 480_000, currency: 'SEK' },
  ...o,
});
const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof PolicyError && e.code === code && (!msg || msg.test(e.message)));

test('months are added to the same day, or the last day of a shorter month', () => {
  assert.equal(addMonths('2026-12-01', 12), '2027-12-01');
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2028-02-29', 12), '2029-02-28');
});

test('a policy is issued with one term of a year, and the claims engine sees it', async () => {
  const s = setup();
  const p = await s.issue(input({ vetCare: { deductible: 'high' } }), by);
  assert.deepEqual([p.id, p.inceptionDate, p.terms.length, p.versions.length], ['pol_1', '2026-12-01', 1, 1]);
  const [t] = p.terms;
  assert.deepEqual([t!.startDate, t!.endDate, t!.productVersion, t!.premium, t!.deductibleOption], ['2026-12-01', '2027-12-01', 'SE-HUND@1', 480_000, 'high']);
  assert.deepEqual([p.versions[0]!.policyholderPartyId, p.versions[0]!.status], ['pty_anna', 'active']);
  const h = await s.history(p.id);
  assert.deepEqual(h.transactions[0]!.steps.map((x) => x.step), ['draft', 'priced', 'underwritten', 'issued']);

  const snap = await s.getPolicyAt(p.id, '2027-03-01');
  assert.deepEqual(
    [snap?.policyVersionId, snap?.currency, snap?.animalBirthDate, snap?.policyYearStart, snap?.policyYearEnd, snap?.inceptionDate, snap?.vetCare?.annualLimit],
    [p.versions[0]!.id, 'SEK', '2024-03-01', '2026-12-01', '2027-12-01', '2026-12-01', 6_000_000],
  );
  assert.equal(await s.getPolicyAt(p.id, '2026-11-30'), null);
  assert.equal(await s.getPolicyAt('pol_none', '2027-03-01'), null);
  assert.deepEqual((await s.findByAnimal('ani_rex')).map((x) => x.id), [p.id]);
  assert.deepEqual((await s.findByPolicyholder('pty_anna')).map((x) => x.id), [p.id]);
});

test('a policy never starts before the day it is issued, and an animal is insured once at a time', async () => {
  const s = setup();
  await rejects(s.issue(input({ startDate: '2026-11-14' }), by), 'validation', /before the day it is issued/);
  await s.issue(input({ startDate: '2026-11-15' }), by);
  await rejects(s.issue(input({ startDate: '2027-01-01' }), by), 'conflict', /already has a policy/);
});

test('invalid applications are refused', async () => {
  const s = setup({ 'SE-HUND@1': offer(), 'SE-OLD@1': offer({ onSale: false }), 'DE-HUND@1': offer({ market: 'DE', currency: 'EUR' }) });
  await rejects(s.issue(input({ market: 'NO' }), by), 'validation', /market profile/);
  await rejects(s.issue(input({ startDate: '2026-13-01' }), by), 'validation', /YYYY-MM-DD/);
  await rejects(s.issue(input({ animalId: 'ani_none' }), by), 'validation', /animal/);
  await rejects(s.issue(input({ animalId: 'ani_dead' }), by), 'validation', /died/);
  await rejects(s.issue(input({ animalId: 'ani_cat' }), by), 'validation', /does not cover cat/);
  await rejects(s.issue(input({ policyholderPartyId: 'pty_dag' }), by), 'validation', /party/);
  await rejects(s.issue(input({ productVersion: 'SE-NONE@1' }), by), 'validation', /does not exist/);
  await rejects(s.issue(input({ productVersion: 'SE-OLD@1' }), by), 'validation', /not on sale/);
  await rejects(s.issue(input({ productVersion: 'DE-HUND@1' }), by), 'validation', /not sold in market SE/);
  await rejects(s.issue(input({ vetCare: { annualLimit: 1 } }), by), 'validation', /annual limit/);
  await rejects(s.issue(input({ premium: { amount: 480_000, currency: 'EUR' } }), by), 'validation', /SEK/);
  await rejects(s.issue(input({ premium: { amount: 4800.5, currency: 'SEK' } }), by), 'validation', /whole number/);
  await rejects(s.get('pol_none'), 'not_found');
});

test('as an ActivitySource: ongoing while a version has not ended', async () => {
  const s = setup();
  await s.issue(input(), by);
  assert.deepEqual(await s.activityOf('pty_anna'), { ongoing: true });
  assert.equal(await s.activityOf('pty_bo'), null);
});

function cancelSetup(midTermCancellation: 'term-end' | 'immediate' = 'term-end') {
  let now = '2026-11-15T10:00:00.000Z';
  let n = 0;
  const store = new InMemoryPolicyStore();
  const s = new PolicyService({
    store,
    products: { offer: async () => offer({ midTermCancellation }) },
    animals: { get: async () => ({ market: 'SE', species: 'dog', birthDate: '2024-03-01' }) },
    parties: { marketOf: async () => 'SE' },
    clock: { now: () => now },
    ids: { next: (p) => `${p}_${++n}` },
  });
  return { s, store, at: (iso: string) => (now = iso) };
}
// A term from 2026-12-01 to 2027-12-01 is 365 days; 365 000 minor units give 1 000 a day.
const yearly = input({ premium: { amount: 365_000, currency: 'SEK' } });

test('the customer cancels to the end of the term, always', async () => {
  const { s, at } = cancelSetup();
  const p = await s.issue(yearly, by);
  at('2027-03-01T10:00:00.000Z');
  const tx = await s.cancel(p.id, { reason: 'customer-term-end' }, 'cs');
  assert.deepEqual([tx.cancellation?.effectiveDate, tx.cancellation?.refund.amount, tx.supersedes], ['2027-12-01', 0, []]);
  // Nothing changes in the versions now; the cancellation will stop the renewal.
  assert.deepEqual((await s.get(p.id)).versions.map((v) => [v.validTo, v.status]), [['2027-12-01', 'active']]);
  assert.deepEqual((await s.cancellationsInForce(p.id)).map((c) => c.id), [tx.id]);
  await rejects(s.cancel(p.id, { reason: 'customer-term-end' }, 'cs'), 'conflict', /already cancelled from 2027-12-01/);
  // An earlier end is still possible, e.g. when the animal dies.
  assert.equal((await s.cancel(p.id, { reason: 'need-ceased', effectiveDate: '2027-03-01', note: 'Died' }, 'cs')).cancellation?.effectiveDate, '2027-03-01');
});

test('the customer cancels at once only if the product allows it, with the rest of the premium back', async () => {
  const kept = cancelSetup('term-end');
  const p1 = await kept.s.issue(yearly, by);
  kept.at('2027-03-01T10:00:00.000Z');
  await rejects(kept.s.cancel(p1.id, { reason: 'customer-immediate' }, 'cs'), 'validation', /keeps the term/);

  const { s, at } = cancelSetup('immediate');
  const p = await s.issue(yearly, by);
  at('2027-03-01T10:00:00.000Z');
  await rejects(s.cancel(p.id, { reason: 'customer-immediate', effectiveDate: '2027-03-01' }, 'cs'), 'validation', /day after notice/);
  const tx = await s.cancel(p.id, { reason: 'customer-immediate' }, 'cs');
  // From 2027-03-02 to 2027-12-01: 274 days of 365.
  assert.deepEqual([tx.cancellation?.effectiveDate, tx.cancellation?.refund], ['2027-03-02', { amount: 274_000, currency: 'SEK' }]);
  const after = await s.get(p.id);
  assert.deepEqual(after.versions.map((v) => [v.validFrom, v.validTo, v.status]), [['2026-12-01', '2027-03-02', 'active'], ['2027-03-02', '2027-12-01', 'cancelled']]);
  assert.equal((await s.getPolicyAt(p.id, '2027-03-10'))?.status, 'cancelled');
  assert.equal((await s.getPolicyAt(p.id, '2027-03-01'))?.status, 'active');
  // What was known before the cancellation still answers the same.
  assert.equal((await s.getPolicyAt(p.id, '2027-03-10', '2027-02-01T00:00:00.000Z'))?.status, 'active');
});

test('withdrawal within 14 days of issue, and not later', async () => {
  const { s, at } = cancelSetup();
  const p = await s.issue(yearly, by); // issued 2026-11-15, starts 2026-12-01
  at('2026-11-20T10:00:00.000Z');
  const tx = await s.cancel(p.id, { reason: 'withdrawal' }, 'cs');
  // Withdrawn before the start: nothing applied, everything back.
  assert.deepEqual([tx.cancellation?.effectiveDate, tx.cancellation?.refund.amount], ['2026-12-01', 365_000]);
  assert.deepEqual((await s.get(p.id)).versions.map((v) => v.status), ['cancelled']);

  const late = cancelSetup();
  const q = await late.s.issue(yearly, by);
  late.at('2026-11-30T10:00:00.000Z');
  await rejects(late.s.cancel(q.id, { reason: 'withdrawal' }, 'cs'), 'validation', /withdrawal period of 14 days/);
});

test('the need ceased in the past, e.g. the animal died, and the cancellation can be reversed', async () => {
  const { s, store, at } = cancelSetup();
  const p = await s.issue(yearly, by);
  at('2027-03-20T10:00:00.000Z');
  await rejects(s.cancel(p.id, { reason: 'need-ceased', effectiveDate: '2027-03-01' }, 'cs'), 'validation', /note/);
  await rejects(s.cancel(p.id, { reason: 'need-ceased', note: 'Died' }, 'cs'), 'validation', /effectiveDate/);
  const tx = await s.cancel(p.id, { reason: 'need-ceased', effectiveDate: '2027-03-01', note: 'The animal died' }, 'cs');
  assert.deepEqual([tx.cancellation?.effectiveDate, tx.cancellation?.refund.amount], ['2027-03-01', 275_000]);

  await rejects(s.reinstate(p.id, { cancellationId: 'ptx_none', note: 'x' }, 'cs'), 'conflict', /latest transaction/);
  const back = await s.reinstate(p.id, { cancellationId: tx.id, note: 'The death was registered on the wrong animal' }, 'cs');
  assert.equal(back.reverses, tx.id);
  const now = await s.get(p.id);
  assert.deepEqual(now.versions.map((v) => [v.validFrom, v.validTo, v.status]), [['2026-12-01', '2027-12-01', 'active']]);
  assert.equal((await s.history(p.id)).versions.length, 4); // issued, cut, cancelled, reinstated
  const events = await store.pendingEvents(100);
  assert.deepEqual(events.map((e) => e.type), [
    'policy.issued',
    'policy.cancelled',
    'policy.version_superseded',
    'policy.reinstated',
    'policy.version_superseded',
    'policy.version_superseded',
  ]);
  await store.markPublished([events[0]!.id], '2027-03-20T11:00:00.000Z');
  assert.equal((await store.pendingEvents(100)).length, 5);
});

test('the insurer cancels with notice, for breach, or for unpaid premium', async () => {
  const a = cancelSetup();
  const p = await a.s.issue(yearly, by);
  a.at('2027-11-02T10:00:00.000Z');
  await rejects(a.s.cancel(p.id, { reason: 'insurer-term-end' }, 'uw'), 'validation', /at least 1 month before/);
  a.at('2027-10-31T10:00:00.000Z');
  assert.equal((await a.s.cancel(p.id, { reason: 'insurer-term-end' }, 'uw')).cancellation?.effectiveDate, '2027-12-01');

  const b = cancelSetup();
  const q = await b.s.issue(yearly, by);
  b.at('2027-03-01T10:00:00.000Z');
  await rejects(b.s.cancel(q.id, { reason: 'insurer-breach' }, 'uw'), 'validation', /note/);
  assert.equal((await b.s.cancel(q.id, { reason: 'unpaid-premium' }, 'billing')).cancellation?.effectiveDate, '2027-03-15');

  const c = cancelSetup();
  const r = await c.s.issue(yearly, by);
  c.at('2027-03-01T10:00:00.000Z');
  assert.equal((await c.s.cancel(r.id, { reason: 'insurer-breach', note: 'Fraud' }, 'uw')).cancellation?.effectiveDate, '2027-03-15');
  await rejects(c.s.cancel(r.id, { reason: 'customer-immediate', receivedOn: '2027-04-01' }, 'cs'), 'validation', /receivedOn/);
  await rejects(c.s.cancel(r.id, { reason: 'whim' as never }, 'cs'), 'validation', /Unknown reason/);
  // An earlier death still moves the end earlier.
  assert.equal((await c.s.cancel(r.id, { reason: 'need-ceased', effectiveDate: '2027-02-20', note: 'Died' }, 'cs')).cancellation?.effectiveDate, '2027-02-20');
});
