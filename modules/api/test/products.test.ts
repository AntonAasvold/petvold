/**
 * Products through the API (ADR 0023): a product version is written, reviewed
 * and published, and the claims engine then finds its rules through it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALCULATION_MODELS, ClaimsService } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, fixtures } from '@petvold/claims-store-memory';
import { DecisioningRulesPort, DecisioningService, InMemoryRuleSetStore } from '@petvold/decisioning';
import { CatalogService, InMemoryProductStore, InMemoryReferenceDataStore, ProductService } from '@petvold/catalog';
import { createApp, InMemoryIdempotencyStore, validatorFor, type Principal } from '@petvold/api';

const tokens: Record<string, Principal> = {
  author: { subject: 'author@example.test', roles: ['rules-author'] },
  rulesPublisher: { subject: 'rules-publisher@example.test', roles: ['rules-publisher'] },
  catalog: { subject: 'catalog@example.test', roles: ['catalog-manager'] },
  publisher: { subject: 'catalog-publisher@example.test', roles: ['catalog-publisher'] },
  clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
};

function setup() {
  const clock = new FixedClock('2026-11-13T14:00:00.000Z');
  const decisioning = new DecisioningService({ store: new InMemoryRuleSetStore(), clock, calculationModels: Object.keys(CALCULATION_MODELS) });
  const references = new InMemoryReferenceDataStore();
  const catalog = new CatalogService({ references, clock });
  const products = new ProductService({
    products: new InMemoryProductStore(),
    clock,
    speciesActive: async (code) => (await references.get('species', code))?.active === true,
    ruleSeriesInForce: async (series, onDate) => (await decisioning.rulesInForce(series, onDate)) !== null,
  });
  const service = new ClaimsService({
    policies: new InMemoryPolicyPort([{ snapshot: fixtures.bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]),
    rules: new DecisioningRulesPort(decisioning, (pv) => products.ruleSeriesOf(pv)),
    store: new InMemoryClaimsStore(),
    clock,
    ids: new SequentialIds(),
  });
  const app = createApp({
    service,
    decisioning,
    catalog,
    products,
    clock,
    idempotency: new InMemoryIdempotencyStore(),
    auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) },
  });
  let n = 0;
  return (method: string, path: string, token: string, body?: unknown, lang?: string) =>
    app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `key-prod-${String(++n).padStart(4, '0')}`,
        ...(lang ? { 'accept-language': lang } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
}

const content = {
  market: 'SE',
  currency: 'SEK',
  species: ['dog'],
  names: { en: 'Dog insurance', sv: 'Hundforsakring' },
  ruleSeries: 'SE-HUND-VV',
  vetCare: {
    annualLimits: [3_000_000, 6_000_000],
    defaultAnnualLimit: 6_000_000,
    deductibles: [{ code: 'standard', labels: { en: 'Standard' }, terms: { fixed: 200_000, fixedPer: 'period', periodDays: 125, variableBp: 2500 } }],
    defaultDeductible: 'standard',
    waitingPeriodDays: 30,
  },
};
const base = '/v1/products/SE-HUND-VV-LIV/versions';
const pv = validatorFor('ProductVersion');
const valid = (x: unknown) => assert.ok(pv(structuredClone(x)), JSON.stringify(pv.errors));
const claimInput = () => {
  const { receivedAt: _r, ...rest } = fixtures.otitisClaim();
  return rest;
};

async function publishRules(call: ReturnType<typeof setup>) {
  const { rulesVersion: _v, ...rules } = fixtures.RULES_SE_DOG;
  const r = '/v1/rule-sets/SE-HUND-VV/versions';
  await call('POST', r, 'author', { content: rules, calculationModel: 'vet-care.v1', effectiveFrom: '2026-01-01' });
  await call('POST', `${r}/1/submissions`, 'author', {});
  assert.equal((await call('POST', `${r}/1/publications`, 'rulesPublisher', {})).status, 200);
}

test('a published product version gives the claims engine its rules; before that the claim has no rules', async () => {
  const call = setup();
  await publishRules(call);
  await call('PUT', '/v1/reference-data/species/dog', 'catalog', { labels: { en: 'Dog' } });

  // Bella's policy is on SE-HUND-VV-LIV@2026.2, which does not exist yet.
  assert.equal((await call('POST', '/v1/claims', 'clinic', claimInput())).status, 409);

  const created = await call('POST', base, 'catalog', { version: '2026.2', content, salesFrom: '2026-01-01' });
  assert.equal(created.status, 201);
  valid(await created.json());
  assert.equal((await call('POST', `${base}/2026.2/submissions`, 'catalog', {})).status, 200);
  assert.equal((await call('POST', `${base}/2026.2/publications`, 'catalog', {})).status, 403); // lacks catalog:publish
  const published = await call('POST', `${base}/2026.2/publications`, 'publisher', {}, 'sv');
  assert.equal(published.status, 200);
  const p = (await published.json()) as any;
  valid(p);
  assert.deepEqual([p.id, p.status, p.name], ['SE-HUND-VV-LIV@2026.2', 'published', 'Hundforsakring']);

  const claim = await call('POST', '/v1/claims', 'clinic', claimInput());
  assert.equal(claim.status, 201);
  assert.equal(((await claim.json()) as any).assessment.rulesVersion, 'SE-HUND-VV@1');
});

test('products on sale, terms for a choice, and the end of sales', async () => {
  const call = setup();
  await publishRules(call);
  await call('PUT', '/v1/reference-data/species/dog', 'catalog', { labels: { en: 'Dog' } });
  await call('POST', base, 'catalog', { version: '2026.2', content, salesFrom: '2026-01-01' });
  await call('POST', `${base}/2026.2/submissions`, 'catalog', {});
  await call('POST', `${base}/2026.2/publications`, 'publisher', {});

  const sale = async (q: string) => (await (await call('GET', `/v1/products/on-sale?${q}`, 'clinic')).json()) as any;
  assert.deepEqual((await sale('date=2026-11-20&market=SE&species=dog')).items.map((v: any) => v.id), ['SE-HUND-VV-LIV@2026.2']);
  assert.deepEqual((await sale('date=2026-11-20&species=cat')).items, []);
  assert.equal((await call('GET', '/v1/products/on-sale', 'clinic')).status, 422);

  const terms = await call('GET', `${base}/2026.2/vet-care-terms?annualLimit=3000000`, 'clinic');
  assert.equal(terms.status, 200);
  const t = (await terms.json()) as any;
  assert.ok(validatorFor('VetCareTerms')(structuredClone(t)));
  assert.deepEqual([t.annualLimit, t.deductible.fixed], [3_000_000, 200_000]);
  assert.equal((await call('GET', `${base}/2026.2/vet-care-terms?annualLimit=1`, 'clinic')).status, 422);

  const ended = await call('POST', `${base}/2026.2/sales-ends`, 'publisher', { salesTo: '2026-12-01', reason: 'Replaced by 2027.1' });
  assert.equal(ended.status, 200);
  assert.deepEqual((await sale('date=2026-12-01')).items, []);
  assert.equal((await call('POST', `${base}/2026.2/sales-ends`, 'catalog', { salesTo: '2026-11-20', reason: 'x' })).status, 403);
});

test('errors: unknown versions, invalid drafts, locked versions', async () => {
  const call = setup();
  assert.equal((await call('GET', `${base}/2026.9`, 'clinic')).status, 404);
  assert.equal((await call('POST', base, 'catalog', { version: '2026.2', content: { ...content, colour: 'red' }, salesFrom: '2026-01-01' })).status, 422);
  await call('POST', base, 'catalog', { version: '2026.2', content, salesFrom: '2026-01-01' });
  assert.equal((await call('POST', base, 'catalog', { version: '2026.2', content, salesFrom: '2026-01-01' })).status, 409);
  // No species 'dog' and no rule series yet.
  const submit = await call('POST', `${base}/2026.2/submissions`, 'catalog', {});
  assert.equal(submit.status, 422);
  assert.match(((await submit.json()) as any).title, /species 'dog'/);
  assert.equal((await call('PUT', `${base}/2026.2`, 'catalog', { content: { ...content, currency: 'NOK' }, salesFrom: '2026-01-01' })).status, 200);
  assert.equal((await call('POST', `${base}/2026.2/publications`, 'publisher', {})).status, 409); // still a draft
});
