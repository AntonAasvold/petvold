import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryPolicyStore, PolicyError, PolicyService, addMonths, type IssueInput, type ProductOffer } from '../src/index.ts';

const vetCare = { code: 'vet_care' as const, annualLimit: 6_000_000, deductible: { fixed: 200_000, fixedPer: 'period' as const, periodDays: 125, variableBp: 2500 }, waitingPeriodDays: 30 };
const offer = (o: Partial<ProductOffer> = {}): ProductOffer => ({
  product: 'SE-HUND',
  termMonths: 12,
  renewalLeadDays: 45,
  transferAcceptanceDays: 30,
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
    products: { offer: async (pv) => offers[pv] ?? null, versionOnSale: async () => 'SE-HUND@1' },
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
    products: { offer: async () => offer({ midTermCancellation }), versionOnSale: async () => 'SE-HUND@1' },
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

function renewalSetup(o: { onSale?: Record<string, string | null>; offers?: Record<string, ProductOffer>; state?: { dead?: boolean; holder?: string | null } } = {}) {
  const state = o.state ?? {};
  let now = '2026-11-15T10:00:00.000Z';
  let n = 0;
  const store = new InMemoryPolicyStore();
  const offers = o.offers ?? { 'SE-HUND@1': offer(), 'SE-HUND@2': offer() };
  const s = new PolicyService({
    store,
    products: { offer: async (pv) => offers[pv] ?? null, versionOnSale: async (product, date) => (o.onSale && date in o.onSale ? o.onSale[date]! : product === 'SE-HUND' ? 'SE-HUND@1' : null) },
    animals: { get: async () => ({ market: 'SE', species: 'dog', birthDate: '2024-03-01', ...(state.dead ? { deceasedOn: '2027-06-01' } : {}) }) },
    parties: { marketOf: async () => (state.holder === undefined ? 'SE' : state.holder) },
    clock: { now: () => now },
    ids: { next: (p) => `${p}_${++n}` },
  });
  return { s, store, at: (iso: string) => (now = iso) };
}

test('the renewal run renews within the lead time, with the version on sale and the same choices and premium', async () => {
  const { s, store, at } = renewalSetup({ onSale: { '2027-12-01': 'SE-HUND@2' } });
  const p = await s.issue(input({ vetCare: { deductible: 'high' } }), by); // term to 2027-12-01
  at('2027-10-01T03:00:00.000Z'); // 61 days before: not yet
  const early = await s.renewalRun({ dryRun: false, markets: '*' }, 'renewal-job');
  assert.deepEqual([early.checked, early.notYet, early.renewed], [1, 1, []]);

  at('2027-10-17T03:00:00.000Z'); // 45 days before
  const dry = await s.renewalRun({ dryRun: true, markets: '*' }, 'renewal-job');
  assert.deepEqual(dry.renewed.map((r) => [r.termNo, r.startDate, r.endDate, r.productVersion, r.premium, r.transactionId]), [[2, '2027-12-01', '2028-12-01', 'SE-HUND@2', 480_000, undefined]]);
  assert.equal((await s.get(p.id)).terms.length, 1);

  const run = await s.renewalRun({ dryRun: false, markets: '*' }, 'renewal-job');
  assert.equal(run.renewed.length, 1);
  const after = await s.get(p.id);
  assert.deepEqual(after.terms.map((t) => [t.termNo, t.startDate, t.productVersion, t.deductibleOption]), [[1, '2026-12-01', 'SE-HUND@1', 'high'], [2, '2027-12-01', 'SE-HUND@2', 'high']]);
  assert.deepEqual(after.versions.map((v) => [v.validFrom, v.validTo, v.termNo]), [['2026-12-01', '2027-12-01', 1], ['2027-12-01', '2028-12-01', 2]]);
  assert.equal((await s.getPolicyAt(p.id, '2028-01-01'))?.policyYearStart, '2027-12-01');
  assert.equal((await s.getPolicyAt(p.id, '2028-01-01'))?.inceptionDate, '2026-12-01'); // the waiting period does not restart
  // Renewed once: the next run finds nothing.
  assert.equal((await s.renewalRun({ dryRun: false, markets: '*' }, 'renewal-job')).checked, 0);
  assert.ok((await store.pendingEvents(100)).some((e) => e.type === 'policy.renewed'));
});

test('a cancellation at the end of the term stops the renewal; a later one ends the renewed term', async () => {
  const a = renewalSetup();
  const p = await a.s.issue(input(), by);
  a.at('2027-10-20T10:00:00.000Z');
  await a.s.cancel(p.id, { reason: 'customer-term-end' }, 'cs');
  const run = await a.s.renewalRun({ dryRun: false, markets: '*' }, 'job');
  assert.deepEqual([run.cancelled, run.renewed.length], [1, 0]);
  await rejects(a.s.renew(p.id, {}, 'cs'), 'conflict', /cancelled from 2027-12-01/);

  const b = renewalSetup();
  const q = await b.s.issue(input(), by);
  b.at('2027-10-20T10:00:00.000Z');
  await b.s.renewalRun({ dryRun: false, markets: '*' }, 'job');
  b.at('2027-11-10T10:00:00.000Z');
  const c = await b.s.cancel(q.id, { reason: 'customer-term-end' }, 'cs'); // after the renewal, before the new term
  assert.deepEqual([c.cancellation?.effectiveDate, c.cancellation?.refund.amount], ['2027-12-01', 480_000]);
  assert.deepEqual((await b.s.get(q.id)).versions.map((v) => [v.validFrom, v.status]), [['2026-12-01', 'active'], ['2027-12-01', 'cancelled']]);
});

test('what the run cannot renew is listed for a decision, and can be renewed by hand', async () => {
  const offers = { 'SE-HUND@1': offer(), 'SE-HUND@2': offer({ vetCareTermsFor: () => { throw new Error('No deductible standard'); } }), 'SE-HUND@3': offer() };
  const changed = renewalSetup({ onSale: { '2027-12-01': 'SE-HUND@2' }, offers });
  const r = await changed.s.issue(input(), by);
  changed.at('2027-11-01T10:00:00.000Z');
  const run = await changed.s.renewalRun({ dryRun: false, markets: '*' }, 'job');
  assert.deepEqual(run.needsDecision.map((x) => [x.policyId, x.issue]), [[r.id, 'option-not-offered']]);
  await rejects(changed.s.renew(r.id, {}, 'cs'), 'validation', /option-not-offered/);
  const manual = await changed.s.renew(r.id, { productVersion: 'SE-HUND@3', premium: { amount: 500_000, currency: 'SEK' } }, 'cs');
  assert.deepEqual(manual.renewal, { termNo: 2, productVersion: 'SE-HUND@3', premium: { amount: 500_000, currency: 'SEK' } });

  const none = renewalSetup({ onSale: { '2027-12-01': null } });
  const q = await none.s.issue(input(), by);
  none.at('2027-11-01T10:00:00.000Z');
  assert.deepEqual((await none.s.renewalRun({ dryRun: true, markets: '*' }, 'job')).needsDecision.map((x) => [x.policyId, x.issue]), [[q.id, 'product-not-on-sale']]);

  const state: { dead?: boolean; holder?: string | null } = {};
  const other = renewalSetup({ state });
  const d = await other.s.issue(input(), by);
  other.at('2027-11-01T10:00:00.000Z');
  state.dead = true;
  assert.deepEqual((await other.s.renewalRun({ dryRun: true, markets: '*' }, 'job')).needsDecision.map((x) => [x.policyId, x.issue]), [[d.id, 'animal-died']]);
  state.dead = false;
  state.holder = null;
  assert.deepEqual((await other.s.renewalRun({ dryRun: true, markets: '*' }, 'job')).needsDecision.map((x) => x.issue), ['policyholder-unavailable']);
  assert.equal((await other.s.renewalRun({ dryRun: true, markets: new Set(['NO']) }, 'job')).checked, 0);
});

test('the term length comes from the product, within the market\'s maximum', async () => {
  const monthly = renewalSetup({ offers: { 'SE-HUND@1': offer({ termMonths: 1, renewalLeadDays: 10 }) } });
  const p = await monthly.s.issue(input(), by);
  assert.deepEqual([p.terms[0]!.startDate, p.terms[0]!.endDate], ['2026-12-01', '2027-01-01']);
  monthly.at('2026-12-22T10:00:00.000Z');
  assert.deepEqual((await monthly.s.renewalRun({ dryRun: false, markets: '*' }, 'job')).renewed.map((x) => x.endDate), ['2027-02-01']);
  const long = renewalSetup({ offers: { 'SE-HUND@1': offer({ termMonths: 24 }) } });
  await rejects(long.s.issue(input(), by), 'validation', /at most 12/);
});

function transferSetup() {
  let now = '2026-11-15T10:00:00.000Z';
  let n = 0;
  const store = new InMemoryPolicyStore();
  const markets: Record<string, string> = { pty_anna: 'SE', pty_bo: 'SE' };
  const s = new PolicyService({
    store,
    products: { offer: async () => offer(), versionOnSale: async () => 'SE-HUND@1' },
    animals: { get: async () => ({ market: 'SE', species: 'dog', birthDate: '2024-03-01' }) },
    parties: { marketOf: async (id) => markets[id] ?? null },
    clock: { now: () => now },
    ids: { next: (p) => `${p}_${++n}` },
  });
  return { s, store, at: (iso: string) => (now = iso) };
}
const sold = (id: string, from: string) => ({ id, type: 'animal.ownership_changed', animalId: 'ani_rex', data: { fromPartyId: 'pty_anna', toPartyId: 'pty_bo', from } });

test('a sale becomes a transfer proposal; accepted, the policy changes policyholder from the day of sale', async () => {
  const { s, store, at } = transferSetup();
  const p = await s.issue(yearly, by); // 2026-12-01 to 2027-12-01, 365 000 a year
  at('2027-06-10T10:00:00.000Z');
  const pr = await s.handleAnimalEvent(sold('aev_1', '2027-06-01'));
  assert.deepEqual([pr?.kind, pr?.deadline, pr?.details], ['transfer', '2027-07-10', { fromPartyId: 'pty_anna', toPartyId: 'pty_bo', from: '2027-06-01' }]);
  assert.equal(await s.handleAnimalEvent(sold('aev_1', '2027-06-01')), null); // handled before
  assert.equal(await s.handleAnimalEvent({ id: 'aev_x', type: 'animal.ownership_changed', animalId: 'ani_other', data: { toPartyId: 'pty_bo', from: '2027-06-01' } }), null);

  await rejects(s.acceptProposal(pr!.id, { channel: ' ' }, 'cs'), 'validation', /channel/);
  const done = await s.acceptProposal(pr!.id, { channel: 'web', reference: 'sign-123' }, 'cs');
  assert.equal(done.decision?.outcome, 'accepted');
  await rejects(s.acceptProposal(pr!.id, { channel: 'web' }, 'cs'), 'conflict', /already accepted/);

  const after = await s.get(p.id);
  assert.deepEqual(after.versions.map((v) => [v.validFrom, v.validTo, v.policyholderPartyId]), [['2026-12-01', '2027-06-01', 'pty_anna'], ['2027-06-01', '2027-12-01', 'pty_bo']]);
  // What was known before the transfer still shows Anna on 1 July.
  assert.equal((await store.versionAt(p.id, '2027-07-01', '2027-06-09T00:00:00.000Z'))?.policyholderPartyId, 'pty_anna');
  const tx = (await s.transactions(p.id)).at(-1)!;
  // From 2027-06-01 to 2027-12-01: 183 days.
  assert.deepEqual([tx.type, tx.transfer?.premium, tx.transfer?.acceptance.channel], ['transfer', { amount: 183_000, currency: 'SEK' }, 'web']);
  assert.equal((await s.getPolicyAt(p.id, '2027-03-01'))?.inceptionDate, '2026-12-01'); // the waiting period does not restart
  assert.deepEqual((await s.findByPolicyholder('pty_bo')).map((x) => x.id), [p.id]);
  assert.deepEqual(await s.holderPeriods('pty_anna'), [{ policyId: p.id, from: '2026-12-01', to: '2027-06-01' }]);
  assert.deepEqual(await s.holderPeriods('pty_bo'), [{ policyId: p.id, from: '2027-06-01', to: '2027-12-01' }]);
  assert.ok((await store.pendingEvents(100)).some((e) => e.type === 'policy.transferred'));
});

test('a transfer the new owner rejects, or does not accept in time, ends the policy from the day of sale', async () => {
  const a = transferSetup();
  const p = await a.s.issue(yearly, by);
  a.at('2027-06-10T10:00:00.000Z');
  const pr = (await a.s.handleAnimalEvent(sold('aev_1', '2027-06-01')))!;
  await rejects(a.s.rejectProposal(pr.id, { reason: ' ' }, 'cs'), 'validation', /reason/);
  const no = await a.s.rejectProposal(pr.id, { reason: 'Bo has his own insurance' }, 'cs');
  assert.equal(no.decision?.outcome, 'rejected');
  const tx = (await a.s.transactions(p.id)).at(-1)!;
  assert.deepEqual([tx.cancellation?.reason, tx.cancellation?.effectiveDate, no.decision?.transactionId], ['need-ceased', '2027-06-01', tx.id]);

  const b = transferSetup();
  const q = await b.s.issue(yearly, by);
  b.at('2027-06-10T10:00:00.000Z');
  const late = (await b.s.handleAnimalEvent(sold('aev_2', '2027-06-01')))!;
  b.at('2027-07-10T10:00:00.000Z');
  assert.deepEqual(await b.s.expireProposals('*', 'job'), []); // the deadline day still counts
  b.at('2027-07-11T10:00:00.000Z');
  await rejects(b.s.acceptProposal(late.id, { channel: 'web' }, 'cs'), 'conflict', /expired 2027-07-10/);
  const expired = await b.s.expireProposals('*', 'job');
  assert.deepEqual(expired.map((x) => [x.id, x.decision?.outcome]), [[late.id, 'expired']]);
  assert.equal((await b.s.getPolicyAt(q.id, '2027-06-15'))?.status, 'cancelled');
});

test('a death becomes a cancellation proposal; accepted, the policy ends from the day of death; rejected, nothing changes', async () => {
  const { s, at } = transferSetup();
  const p = await s.issue(yearly, by);
  at('2027-03-20T10:00:00.000Z');
  const died = { id: 'aev_9', type: 'animal.died', animalId: 'ani_rex', data: { deceasedOn: '2027-03-01' } };
  const pr = (await s.handleAnimalEvent(died))!;
  assert.deepEqual([pr.kind, pr.details, pr.deadline], ['cancel-death', { deceasedOn: '2027-03-01' }, undefined]);
  assert.deepEqual((await s.listProposals({ pending: true })).map((x) => x.id), [pr.id]);
  const wrong = await s.rejectProposal(pr.id, { reason: 'Registered on the wrong animal' }, 'cs');
  assert.deepEqual([wrong.decision?.outcome, wrong.decision?.transactionId], ['rejected', undefined]);
  assert.equal((await s.get(p.id)).versions.length, 1);

  const again = (await s.handleAnimalEvent({ ...died, id: 'aev_10' }))!;
  const yes = await s.acceptProposal(again.id, { channel: 'n/a' }, 'cs');
  const tx = (await s.transactions(p.id)).at(-1)!;
  assert.deepEqual([yes.decision?.transactionId, tx.cancellation?.effectiveDate, tx.cancellation?.refund.amount], [tx.id, '2027-03-01', 275_000]);
  assert.deepEqual((await s.listProposals({ policyId: p.id })).map((x) => x.decision?.outcome), ['rejected', 'accepted']);
  await rejects(s.getProposal('ppr_none'), 'not_found');
});

function changeSetup() {
  let now = '2026-11-15T10:00:00.000Z';
  let n = 0;
  const highOffer = offer({
    vetCareTermsFor: (c) => {
      const annualLimit = c.annualLimit ?? 6_000_000;
      if (![3_000_000, 6_000_000].includes(annualLimit)) throw new Error(`No annual limit ${annualLimit}`);
      const high = c.deductible === 'high';
      return { ...vetCare, annualLimit, deductible: { ...vetCare.deductible, fixed: high ? 400_000 : 200_000 }, deductibleOption: c.deductible ?? 'standard' };
    },
  });
  const s = new PolicyService({
    store: new InMemoryPolicyStore(),
    products: { offer: async () => highOffer, versionOnSale: async () => 'SE-HUND@1' },
    animals: { get: async () => ({ market: 'SE', species: 'dog', birthDate: '2024-03-01' }) },
    parties: { marketOf: async () => 'SE' },
    clock: { now: () => now },
    ids: { next: (p) => `${p}_${++n}` },
  });
  return { s, at: (iso: string) => (now = iso) };
}

test('a change during the term applies from a day, with the premium adjusted for the days left', async () => {
  const { s, at } = changeSetup();
  const p = await s.issue(yearly, by); // 365 000 a year, 2026-12-01 to 2027-12-01
  at('2027-06-01T10:00:00.000Z');
  await rejects(s.change(p.id, { from: '2027-05-31', vetCare: { deductible: 'high' }, premium: { amount: 292_000, currency: 'SEK' }, reason: 'x' }, 'cs'), 'validation', /before today/);
  await rejects(s.change(p.id, { from: '2027-06-01', vetCare: { deductible: 'high' }, premium: { amount: 292_000, currency: 'SEK' }, reason: ' ' }, 'cs'), 'validation', /reason/);
  await rejects(s.change(p.id, { from: '2027-06-01', vetCare: {}, premium: { amount: 365_000, currency: 'SEK' }, reason: 'x' }, 'cs'), 'conflict', /changes nothing/);
  await rejects(s.change(p.id, { from: '2027-06-01', vetCare: { annualLimit: 1 }, premium: { amount: 365_000, currency: 'SEK' }, reason: 'x' }, 'cs'), 'validation', /annual limit/);

  // A higher deductible for a lower premium: 292 000 a year from 2027-06-01, 183 days left of 365.
  const tx = await s.change(p.id, { from: '2027-06-01', vetCare: { deductible: 'high' }, premium: { amount: 292_000, currency: 'SEK' }, reason: 'The customer chose a higher deductible' }, 'cs');
  assert.deepEqual([tx.type, tx.change?.changeNo, tx.change?.deductibleOption, tx.change?.premiumAdjustment], ['change', 1, 'high', -36_600]);
  const after = await s.get(p.id);
  assert.deepEqual(after.versions.map((v) => [v.validFrom, v.validTo, v.changeNo ?? null]), [['2026-12-01', '2027-06-01', null], ['2027-06-01', '2027-12-01', 1]]);
  assert.equal(after.terms[0]!.changes?.length, 1);
  assert.equal((await s.getPolicyAt(p.id, '2027-05-31'))?.vetCare?.deductible.fixed, 200_000);
  assert.equal((await s.getPolicyAt(p.id, '2027-06-15'))?.vetCare?.deductible.fixed, 400_000);
  assert.equal((await s.getPolicyAt(p.id, '2027-06-15', '2027-05-01T00:00:00.000Z'))?.vetCare?.deductible.fixed, 200_000);

  // A cancellation later refunds at the new rate: 2027-09-01 to 2027-12-01 is 91 days at 292 000 a year.
  at('2027-08-31T10:00:00.000Z');
  const c = await s.cancel(p.id, { reason: 'need-ceased', effectiveDate: '2027-09-01', note: 'Died' }, 'cs');
  assert.equal(c.cancellation?.refund.amount, Math.round((292_000 * 91) / 365));
});

test('the renewal keeps the changed choices and premium, and a change is made in the latest term', async () => {
  const { s, at } = changeSetup();
  const p = await s.issue(yearly, by);
  at('2027-06-01T10:00:00.000Z');
  await s.change(p.id, { from: '2027-06-01', vetCare: { annualLimit: 3_000_000 }, premium: { amount: 300_000, currency: 'SEK' }, reason: 'Lower amount' }, 'cs');
  at('2027-10-20T10:00:00.000Z');
  await s.renewalRun({ dryRun: false, markets: '*' }, 'job');
  const t2 = (await s.get(p.id)).terms[1]!;
  assert.deepEqual([t2.vetCare.annualLimit, t2.premium], [3_000_000, 300_000]);
  await rejects(s.change(p.id, { from: '2027-11-01', vetCare: {}, premium: { amount: 365_000, currency: 'SEK' }, reason: 'x' }, 'cs'), 'conflict', /already renewed to term 2/);
  const tx = await s.change(p.id, { from: '2027-12-01', vetCare: { annualLimit: 6_000_000 }, premium: { amount: 365_000, currency: 'SEK' }, reason: 'Back' }, 'cs');
  assert.equal(tx.change?.termNo, 2);
});
