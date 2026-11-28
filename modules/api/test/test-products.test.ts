/**
 * The products for testing a sales flow end to end (docs/funktion/testprodukter.md):
 * on sale, quoted, with health questions, and applied for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from '../src/composition.ts';
import { seedInstallation } from '../src/seed.ts';
import { createApp, validatorFor } from '../src/index.ts';
import { demoAuthenticator } from '../src/demo-tokens.ts';

async function setup() {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedInstallation(inst, clock);
  const app = createApp({ ...inst.deps, auth: demoAuthenticator() });
  let key = 0;
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: 'Bearer dev-all', ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'idempotency-key': `test-key-${++key}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
}

test('the test products are on sale for dogs and cats, published through review', async () => {
  const call = await setup();
  const dogs = await call('GET', '/v1/product-versions?onSale=2026-12-01&market=SE&species=dog');
  const cats = await call('GET', '/v1/product-versions?onSale=2026-12-01&market=SE&species=cat');
  const ids = (r: any) => r.body.items.map((v: any) => v.id);
  for (const id of ['SE-HUND-EXTRA@2026.1', 'SE-HUND-MINI@2026.1']) assert.ok(ids(dogs).includes(id), id);
  assert.deepEqual(ids(cats).sort(), ['SE-KATT-ENKEL@2026.1', 'SE-KATT-EXTRA@2026.1']);
  const extra = dogs.body.items.find((v: any) => v.id === 'SE-HUND-EXTRA@2026.1');
  assert.deepEqual([extra.submittedBy, extra.publishedBy], ['petvold-seed', 'petvold-install']);
  const d = extra.content.vetCare.deductibles;
  assert.deepEqual(d.map((x: any) => x.code), ['f1600-v15', 'f1600-v25', 'f2700-v15', 'f2700-v25', 'f3600-v15', 'f3600-v25']);
  assert.ok(d.every((x: any) => x.terms.periodDays === 135));
  assert.deepEqual([...new Set(d.map((x: any) => x.terms.fixed))], [160_000, 270_000, 360_000]);
  assert.deepEqual([...new Set(d.map((x: any) => x.terms.variableBp))], [1500, 2500]);
});

test('a quote, the three health questions, and applications that are accepted and referred', async () => {
  const call = await setup();
  const party = (await call('POST', '/v1/parties', { kind: 'person', market: 'SE', givenName: 'Test', familyName: 'Person', email: 'test.person@example.test', address: { street: 'Test Street 1', postalCode: '41120', city: 'Gothenburg', country: 'SE' }, language: 'sv' })).body;
  assert.ok(party.id, JSON.stringify(party));
  const animal = async (species: string, breed: string, name: string) =>
    (await call('POST', '/v1/animals', { market: 'SE', species, breed, sex: 'female', neutered: false, name, birthDate: '2026-09-01', allowLookup: true, owner: { partyId: party.id, from: '2026-10-27' } })).body;
  const puppy = await animal('dog', 'dog-labrador-retriever', 'Pup');
  const kitten = await animal('cat', 'cat-domestic', 'Kit');
  assert.ok(puppy.id && kitten.id, JSON.stringify([puppy, kitten]));

  const quote = await call('POST', '/v1/quotes', { market: 'SE', productVersion: 'SE-HUND-EXTRA@2026.1', startDate: '2026-12-01', animalId: puppy.id, policyholderPartyId: party.id, vetCare: { annualLimit: 6_000_000, deductible: 'f2700-v15' }, campaignCode: 'PUPPY30' });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.ok(validatorFor('Quote')(structuredClone(quote.body)), JSON.stringify(validatorFor('Quote').errors));
  // 5 200 kr for 60 000 kr, times 0.9 (under 3 years), 1.15 (Labrador, group B), 1.0 (f2700-v15) and 1.2 (postal code 411, centre).
  assert.equal(quote.body.price.basePremium, 645_800);
  assert.ok(quote.body.price.annualPremium < quote.body.price.basePremium, 'PUPPY30 gives its discount');
  assert.ok(quote.body.price.breakdown.length > 0);
  const cat = await call('POST', '/v1/quotes', { market: 'SE', productVersion: 'SE-KATT-ENKEL@2026.1', startDate: '2026-12-01', animalId: kitten.id, policyholderPartyId: party.id });
  assert.equal(cat.status, 200, JSON.stringify(cat.body));

  for (const [product, species] of [['SE-HUND-EXTRA@2026.1', 'dog'], ['SE-KATT-EXTRA@2026.1', 'cat']]) {
    const q = await call('GET', `/v1/application-questions?productVersion=${product}&species=${species}&date=2026-12-01`);
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.deepEqual(q.body.questions.map((x: any) => x.id), ['previous-illness', 'ongoing-symptoms', 'ongoing-treatment']);
  }

  const products = (await call('GET', '/v1/product-versions?onSale=2026-12-01&market=SE&species=dog')).body.items;
  const documents = products.find((v: any) => v.id === 'SE-HUND-EXTRA@2026.1').content.documents.map(({ type, language, sha256 }: any) => ({ type, language, sha256 }));
  const no = (question: string) => ({ question, value: false });
  const apply = (animalId: string, productVersion: string, answers: unknown[], docs: unknown[]) =>
    call('POST', '/v1/applications', { market: 'SE', animalId, policyholderPartyId: party.id, productVersion, startDate: '2026-12-01', acceptance: { channel: 'web', reference: 'sess-1', acceptedAt: '2026-11-15T09:58:00Z', documents: docs }, answers });

  const healthy = await apply(puppy.id, 'SE-HUND-EXTRA@2026.1', [no('previous-illness'), no('ongoing-symptoms'), no('ongoing-treatment')], documents);
  assert.equal(healthy.status, 201, JSON.stringify(healthy.body));
  assert.deepEqual([healthy.body.status, healthy.body.underwriting.result.outcome], ['accepted', 'accept']);
  assert.match(healthy.body.policyId, /^pol_/);

  const catProducts = (await call('GET', '/v1/product-versions?onSale=2026-12-01&market=SE&species=cat')).body.items;
  const catDocs = catProducts.find((v: any) => v.id === 'SE-KATT-EXTRA@2026.1').content.documents.map(({ type, language, sha256 }: any) => ({ type, language, sha256 }));
  const referred = await apply(kitten.id, 'SE-KATT-EXTRA@2026.1', [no('previous-illness'), { question: 'ongoing-symptoms', value: true }, no('ongoing-treatment')], catDocs);
  assert.equal(referred.status, 201, JSON.stringify(referred.body));
  assert.deepEqual([referred.body.status, referred.body.policyId, referred.body.underwriting.result.reasons], ['referred', undefined, ['ongoing-symptoms']]);
});
