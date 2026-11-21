import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogError, InMemoryProductStore, ProductService, billingSettingsOf, policySettingsOf, productChecksum, vetCareTermsFor, type ProductDraft } from '../src/index.ts';
import { content } from '../test-suites/product-store.ts';

function setup(opts: { species?: string[]; series?: Record<string, string> } = {}) {
  const species = new Set(opts.species ?? ['dog', 'cat']);
  const series = opts.series ?? { 'XX-DOG': '2026-01-01' };
  const s = new ProductService({
    products: new InMemoryProductStore(),
    clock: { now: () => '2026-11-15T10:00:00.000Z' },
    speciesActive: async (c) => species.has(c),
    ruleSeriesInForce: async (name, onDate) => series[name] !== undefined && series[name]! <= onDate,
  });
  return s;
}
const author = 'author@example.test';
const publisher = 'publisher@example.test';
const draft = (o: Partial<ProductDraft> = {}): ProductDraft => ({ version: '2026.1', content: content(), salesFrom: '2026-01-01', ...o });
const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof CatalogError && e.code === code && (!msg || msg.test(e.message)));

async function publish(s: ProductService, d: ProductDraft = draft()) {
  await s.createDraft('XX-DOG-VC', d, author);
  await s.submit('XX-DOG-VC', d.version, author);
  return s.publish('XX-DOG-VC', d.version, publisher);
}

test('a product version goes from draft to published with four eyes, and its rule series is found', async () => {
  const s = setup();
  const d = await s.createDraft('XX-DOG-VC', draft(), author);
  assert.equal(d.status, 'draft');
  assert.equal(await s.ruleSeriesOf('XX-DOG-VC@2026.1'), null); // not published
  const r = await s.submit('XX-DOG-VC', '2026.1', author);
  assert.equal(r.status, 'in_review');
  assert.match(r.checksum!, /^[0-9a-f]{64}$/);
  await rejects(s.publish('XX-DOG-VC', '2026.1', author), 'forbidden', /four eyes/);
  const p = await s.publish('XX-DOG-VC', '2026.1', publisher);
  assert.deepEqual([p.status, p.publishedBy, p.revision], ['published', publisher, 3]);
  assert.equal(await s.ruleSeriesOf('XX-DOG-VC@2026.1'), 'XX-DOG');
  assert.equal(await s.ruleSeriesOf('XX-DOG-VC@2099.1'), null);
  assert.equal(await s.ruleSeriesOf('no-at-sign'), null);
});

test('a draft can change, a version in review cannot, and it can be returned with a reason', async () => {
  const s = setup();
  await s.createDraft('XX-DOG-VC', draft(), author);
  const changed = await s.updateDraft('XX-DOG-VC', '2026.1', { content: content({ names: { en: 'Renamed' } }), salesFrom: '2026-02-01' });
  assert.equal(changed.salesFrom, '2026-02-01');
  await s.submit('XX-DOG-VC', '2026.1', author);
  await rejects(s.updateDraft('XX-DOG-VC', '2026.1', { content: content(), salesFrom: '2026-02-01' }), 'conflict', /in_review/);
  await rejects(s.returnToDraft('XX-DOG-VC', '2026.1', ' '), 'validation', /reason/);
  const back = await s.returnToDraft('XX-DOG-VC', '2026.1', 'Wrong limits');
  assert.deepEqual([back.status, back.note, back.checksum], ['draft', 'Wrong limits', undefined]);
});

test('submitting checks species and that the rule series is in force when sales start', async () => {
  const s = setup({ species: ['cat'], series: { 'XX-DOG': '2026-06-01' } });
  await s.createDraft('XX-DOG-VC', draft(), author);
  await rejects(s.submit('XX-DOG-VC', '2026.1', author), 'validation', /species 'dog'/);
  await s.updateDraft('XX-DOG-VC', '2026.1', { content: content({ species: ['cat'] }), salesFrom: '2026-01-01' });
  await rejects(s.submit('XX-DOG-VC', '2026.1', author), 'validation', /XX-DOG has no published version in force on 2026-01-01/);
  await s.updateDraft('XX-DOG-VC', '2026.1', { content: content({ species: ['cat'] }), salesFrom: '2026-06-01' });
  assert.equal((await s.submit('XX-DOG-VC', '2026.1', author)).status, 'in_review');
});

test('two versions of a product cannot be on sale on the same day', async () => {
  const s = setup();
  await publish(s, draft({ salesTo: '2026-07-01' }));
  await s.createDraft('XX-DOG-VC', draft({ version: '2026.2', salesFrom: '2026-06-01' }), author);
  await s.submit('XX-DOG-VC', '2026.2', author);
  await rejects(s.publish('XX-DOG-VC', '2026.2', publisher), 'conflict', /2026\.1 is on sale/);
  await s.returnToDraft('XX-DOG-VC', '2026.2', 'Start after 2026.1');
  await s.updateDraft('XX-DOG-VC', '2026.2', { content: content(), salesFrom: '2026-07-01' });
  await s.submit('XX-DOG-VC', '2026.2', author);
  await s.publish('XX-DOG-VC', '2026.2', publisher);
  assert.deepEqual((await s.onSale('2026-06-30')).map((v) => v.version), ['2026.1']);
  assert.deepEqual((await s.onSale('2026-07-01')).map((v) => v.version), ['2026.2']);
  assert.deepEqual(await s.onSale('2025-12-31'), []);
  assert.deepEqual((await s.onSale('2026-07-01', { market: 'XX', species: 'dog' })).length, 1);
  assert.deepEqual(await s.onSale('2026-07-01', { species: 'cat' }), []);
  assert.deepEqual(await s.onSale('2026-07-01', { market: 'SE' }), []);
});

test('sales can be brought forward from today, never extended', async () => {
  const s = setup();
  await publish(s, draft({ salesTo: '2027-01-01' }));
  await rejects(s.endSales('XX-DOG-VC', '2026.1', '2026-11-14', publisher, 'Too late'), 'validation', /before today/);
  await rejects(s.endSales('XX-DOG-VC', '2026.1', '2027-02-01', publisher, 'Longer'), 'validation', /brought forward/);
  await rejects(s.endSales('XX-DOG-VC', '2026.1', '2026-12-01', publisher, ''), 'validation', /reason/);
  const e = await s.endSales('XX-DOG-VC', '2026.1', '2026-12-01', publisher, 'Replaced by 2027.1');
  assert.deepEqual([e.salesTo, e.salesEndedBy, e.note, e.status], ['2026-12-01', publisher, 'Replaced by 2027.1', 'published']);
  assert.equal(await s.ruleSeriesOf('XX-DOG-VC@2026.1'), 'XX-DOG'); // policies already written still find their rules
});

test('invalid drafts are refused', async () => {
  const s = setup();
  const bad = (o: Partial<ProductDraft>, msg: RegExp) => rejects(s.createDraft('XX-DOG-VC', draft(o), author), 'validation', msg);
  const vc = content().vetCare;
  await rejects(s.createDraft('xx-dog', draft(), author), 'validation', /Invalid product/);
  await bad({ version: '2026 1' }, /Invalid version/);
  await bad({ salesTo: '2026-01-01' }, /salesTo/);
  await bad({ content: content({ currency: 'eur' }) }, /currency/);
  await bad({ content: content({ species: [] }) }, /species/);
  await bad({ content: content({ species: ['dog', 'dog'] }) }, /twice/);
  await bad({ content: content({ ruleSeries: 'x' }) }, /rule series/);
  await bad({ content: content({ vetCare: { ...vc, defaultAnnualLimit: 1 } }) }, /defaultAnnualLimit/);
  await bad({ content: content({ vetCare: { ...vc, annualLimits: [1.5] } }) }, /annualLimits/);
  await bad({ content: content({ vetCare: { ...vc, defaultDeductible: 'none' } }) }, /defaultDeductible/);
  await bad({ content: content({ vetCare: { ...vc, waitingPeriodDays: -1 } }) }, /waitingPeriodDays/);
  const periodWithoutDays = { code: 'p', labels: { en: 'P' }, terms: { fixed: 1, fixedPer: 'period' as const, variableBp: 0 } };
  await bad({ content: content({ vetCare: { ...vc, deductibles: [...vc.deductibles, periodWithoutDays] } }) }, /periodDays/);
  const overHundred = { code: 'x', labels: { en: 'X' }, terms: { fixed: 1, fixedPer: 'claim' as const, variableBp: 10_001 } };
  await bad({ content: content({ vetCare: { ...vc, deductibles: [...vc.deductibles, overHundred] } }) }, /variableBp/);
  await s.createDraft('XX-DOG-VC', draft(), author);
  await rejects(s.createDraft('XX-DOG-VC', draft(), author), 'conflict', /already exists/);
});

test('the vet care terms follow the customer choices, with defaults', async () => {
  const s = setup();
  const v = await publish(s);
  assert.deepEqual(vetCareTermsFor(v), {
    code: 'vet_care',
    annualLimit: 300_000,
    deductible: { fixed: 5_000, fixedPer: 'claim', variableBp: 2000 },
    waitingPeriodDays: 30,
  });
  const chosen = vetCareTermsFor(v, { annualLimit: 600_000, deductible: 'period' });
  assert.deepEqual([chosen.annualLimit, chosen.deductible.fixedPer, chosen.deductible.periodDays], [600_000, 'period', 120]);
  assert.throws(() => vetCareTermsFor(v, { annualLimit: 400_000 }), /no annual limit 400000/);
  assert.throws(() => vetCareTermsFor(v, { deductible: 'zero' }), /no deductible 'zero'/);
});

test('policy settings have defaults and limits (ADR 0029)', async () => {
  const s = setup();
  const withPolicy = (policy: Record<string, unknown>) => draft({ content: { ...content(), policy } as never });
  const v = await s.createDraft('XX-DOG-VC', draft(), author);
  assert.deepEqual(policySettingsOf(v.content), { midTermCancellation: 'term-end', termMonths: 12, renewalLeadDays: 45, transferAcceptanceDays: 30, applicationExpiryDays: 30, maxStartAheadDays: 90 });
  const monthly = await s.createDraft('XX-DOG-M', withPolicy({ termMonths: 1, renewalLeadDays: 10, midTermCancellation: 'immediate' }), author);
  assert.deepEqual(policySettingsOf(monthly.content).termMonths, 1);
  await rejects(s.createDraft('XX-DOG-X', withPolicy({ termMonths: 13 }), author), 'validation', /termMonths/);
  await rejects(s.createDraft('XX-DOG-X', withPolicy({ termMonths: 1 }), author), 'validation', /shorter than a term of 1 months/); // 45 days by default
  await rejects(s.createDraft('XX-DOG-X', withPolicy({ renewalLeadDays: 0 }), author), 'validation', /renewalLeadDays/);
  await rejects(s.createDraft('XX-DOG-X', withPolicy({ midTermCancellation: 'never' }), author), 'validation', /midTermCancellation/);
  await rejects(s.createDraft('XX-DOG-X', withPolicy({ transferAcceptanceDays: 91 }), author), 'validation', /transferAcceptanceDays/);
  await rejects(s.createDraft('XX-DOG-X', withPolicy({ applicationExpiryDays: 0 }), author), 'validation', /applicationExpiryDays/);
  await rejects(s.createDraft('XX-DOG-X', withPolicy({ maxStartAheadDays: 366 }), author), 'validation', /maxStartAheadDays/);
  await rejects(s.createDraft('XX-DOG-X', withPolicy({ maxStartAheadDays: -1 }), author), 'validation', /maxStartAheadDays/);
  assert.equal(policySettingsOf((await s.createDraft('XX-DOG-T', withPolicy({ maxStartAheadDays: 0 }), author)).content).maxStartAheadDays, 0);
});

test('billing settings have defaults and limits (ADR 0040)', async () => {
  const s = setup();
  const withBilling = (billing: Record<string, unknown>) => draft({ content: { ...content(), billing } as never });
  const v = await s.createDraft('XX-DOG-VC', draft(), author);
  assert.deepEqual(billingSettingsOf(v.content), { paymentIntervals: ['year'], defaultPaymentInterval: 'year', installmentFee: 0, invoiceLeadDays: 31 });
  const monthly = await s.createDraft('XX-DOG-M', withBilling({ paymentIntervals: ['year', 'month'], defaultPaymentInterval: 'month', installmentFee: 2_900 }), author);
  assert.deepEqual(billingSettingsOf(monthly.content), { paymentIntervals: ['year', 'month'], defaultPaymentInterval: 'month', installmentFee: 2_900, invoiceLeadDays: 31 });
  await rejects(s.createDraft('XX-DOG-X', withBilling({ paymentIntervals: [] }), author), 'validation', /paymentIntervals/);
  await rejects(s.createDraft('XX-DOG-X', withBilling({ paymentIntervals: ['week'] }), author), 'validation', /paymentIntervals/);
  await rejects(s.createDraft('XX-DOG-X', withBilling({ paymentIntervals: ['year', 'year'] }), author), 'validation', /twice/);
  await rejects(s.createDraft('XX-DOG-X', withBilling({ defaultPaymentInterval: 'month' }), author), 'validation', /defaultPaymentInterval/);
  await rejects(s.createDraft('XX-DOG-X', withBilling({ installmentFee: -1 }), author), 'validation', /installmentFee/);
  await rejects(s.createDraft('XX-DOG-X', withBilling({ invoiceLeadDays: 61 }), author), 'validation', /invoiceLeadDays/);
});

test('a product with a tariff series needs a tariff in force that covers it (ADR 0030)', async () => {
  let problems: string[] | null = null;
  const s = new ProductService({
    products: new InMemoryProductStore(),
    clock: { now: () => '2026-11-15T10:00:00.000Z' },
    speciesActive: async () => true,
    ruleSeriesInForce: async () => true,
    tariffProblems: async () => problems,
  });
  const priced = draft({ content: { ...content(), tariffSeries: 'XX-DOG-TARIFF' } });
  await s.createDraft('XX-DOG-VC', priced, author);
  await rejects(s.submit('XX-DOG-VC', '2026.1', author), 'validation', /no published version in force/);
  problems = ['No factor for deductible high'];
  await rejects(s.submit('XX-DOG-VC', '2026.1', author), 'validation', /does not cover the product: No factor for deductible high/);
  problems = [];
  assert.equal((await s.submit('XX-DOG-VC', '2026.1', author)).status, 'in_review');
  await rejects(s.createDraft('XX-DOG-X', draft({ content: { ...content(), tariffSeries: 'bad series' } }), author), 'validation', /tariff series/);
});

test('price terms need a tariff, and a version in force that fits the product', async () => {
  let problems: string[] | null = null;
  const s = new ProductService({
    products: new InMemoryProductStore(),
    clock: { now: () => '2026-11-15T10:00:00.000Z' },
    speciesActive: async () => true,
    ruleSeriesInForce: async () => true,
    tariffProblems: async () => [],
    priceTermsProblems: async () => problems,
  });
  await rejects(s.createDraft('XX-DOG-X', draft({ content: { ...content(), priceTermsSeries: 'XX-TERMS' } }), author), 'validation', /needs .* a tariffSeries/);
  await s.createDraft('XX-DOG-VC', draft({ content: { ...content(), tariffSeries: 'XX-TARIFF', priceTermsSeries: 'XX-TERMS' } }), author);
  await rejects(s.submit('XX-DOG-VC', '2026.1', author), 'validation', /price terms series XX-TERMS has no published version/);
  problems = ['The price terms are for SE in SEK'];
  await rejects(s.submit('XX-DOG-VC', '2026.1', author), 'validation', /does not fit the product/);
  problems = [];
  assert.equal((await s.submit('XX-DOG-VC', '2026.1', author)).status, 'in_review');
});

test('underwriting rules need a version in force that covers the product (ADR 0031)', async () => {
  let problems: string[] | null = null;
  const s = new ProductService({
    products: new InMemoryProductStore(),
    clock: { now: () => '2026-11-15T10:00:00.000Z' },
    speciesActive: async () => true,
    ruleSeriesInForce: async () => true,
    underwritingProblems: async () => problems,
  });
  await rejects(s.createDraft('XX-DOG-X', draft({ content: { ...content(), underwritingSeries: 'bad series' } }), author), 'validation', /underwriting series/);
  await s.createDraft('XX-DOG-VC', draft({ content: { ...content(), underwritingSeries: 'XX-UW' } }), author);
  await rejects(s.submit('XX-DOG-VC', '2026.1', author), 'validation', /underwriting series XX-UW has no published version/);
  problems = ['No age limits for cat'];
  await rejects(s.submit('XX-DOG-VC', '2026.1', author), 'validation', /does not cover the product: No age limits for cat/);
  problems = [];
  assert.equal((await s.submit('XX-DOG-VC', '2026.1', author)).status, 'in_review');
});

test('documents are checked, need terms, pre-contract and ipid in the market language, and are locked by the checksum (ADR 0032)', async () => {
  const s = setup();
  const doc = (type: string, language = 'sv', sha = 'a'.repeat(64)) => ({ type, language, uri: `https://documents.example.test/${type}-${language}.pdf`, sha256: sha }) as never;
  const withDocs = (documents: unknown[]) => draft({ content: { ...content(), market: 'SE', documents: documents as never } });
  await rejects(s.createDraft('XX-DOG-X', withDocs([doc('brochure')]), author), 'validation', /document type 'brochure'/);
  await rejects(s.createDraft('XX-DOG-X', withDocs([doc('terms', 'swe')]), author), 'validation', /ISO 639-1/);
  await rejects(s.createDraft('XX-DOG-X', withDocs([doc('terms'), doc('terms')]), author), 'validation', /listed twice/);
  await rejects(s.createDraft('XX-DOG-X', withDocs([{ ...(doc('terms') as object), uri: 'not a uri' }]), author), 'validation', /absolute uri/);
  await rejects(s.createDraft('XX-DOG-X', withDocs([doc('terms', 'sv', 'A'.repeat(64))]), author), 'validation', /sha256/);

  await s.createDraft('XX-DOG-VC', withDocs([doc('terms'), doc('pre-contract'), doc('ipid', 'en')]), author);
  await rejects(s.submit('XX-DOG-VC', '2026.1', author), 'validation', /lack ipid in 'sv', the language of SE/);
  await s.updateDraft('XX-DOG-VC', '2026.1', { content: withDocs([doc('terms'), doc('pre-contract'), doc('ipid'), doc('ipid', 'en')]).content, salesFrom: '2026-01-01' });
  const submitted = await s.submit('XX-DOG-VC', '2026.1', author);
  const without = await setup().createDraft('XX-DOG-VC', withDocs([doc('terms'), doc('pre-contract'), doc('ipid', 'sv', 'b'.repeat(64))]), author);
  assert.notEqual(productChecksum(without), submitted.checksum, 'another document gives another checksum');
  // A market without a default language only has the documents' form checked.
  const other = setup();
  await other.createDraft('XX-DOG-VC', draft({ content: { ...content(), documents: [doc('terms', 'en')] } }), author);
  assert.equal((await other.submit('XX-DOG-VC', '2026.1', author)).status, 'in_review');
});
