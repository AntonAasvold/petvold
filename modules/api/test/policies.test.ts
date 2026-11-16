/** Policies through the API (ADR 0029), with the real wiring to products, animals and parties. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';
import { AnimalService, InMemoryAnimalStore } from '@petvold/animals';
import { InMemoryProductStore, ProductService } from '@petvold/catalog';
import { InMemoryPartyStore, PartyService } from '@petvold/parties';
import { InMemoryPolicyStore, PolicyService } from '@petvold/policies';
import { createApp, InMemoryIdempotencyStore, validatorFor, type Principal } from '@petvold/api';
import { animalPort, productPort } from '../src/wiring.ts';
import { CALCULATION_MODELS } from '@petvold/claims-core';
import { DecisioningService, InMemoryRuleSetStore } from '@petvold/decisioning';
import { PRICE_TERMS, TARIFF } from '@petvold/pricing-core/fixtures';
import { UNDERWRITING } from '@petvold/underwriting-core/fixtures';

const tokens: Record<string, Principal> = {
  seller: { subject: 'seller@example.test', roles: ['policy-registrar'], markets: ['SE'] },
  sellerDe: { subject: 'seller-de@example.test', roles: ['policy-registrar'], markets: ['DE'] },
  handler: { subject: 'h@example.test', roles: ['handler'], markets: '*' },
  clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  job: { subject: 'renewal-job', roles: ['renewal-job'], markets: '*' },
  underwriter: { subject: 'uw@example.test', roles: ['underwriter'], markets: ['SE'] },
  portal: { subject: 'portal', roles: ['customer-channel'], markets: ['SE'], policyIds: ['pol_x'] },
};

const content = {
  market: 'SE',
  currency: 'SEK',
  species: ['dog'],
  names: { en: 'Dog insurance' },
  ruleSeries: 'SE-HUND-VV',
  tariffSeries: 'SE-HUND-TARIFF',
  priceTermsSeries: 'SE-HUND-TERMS',
  vetCare: {
    annualLimits: [3_000_000, 6_000_000],
    defaultAnnualLimit: 6_000_000,
    deductibles: [{ code: 'standard', labels: { en: 'Standard' }, terms: { fixed: 200_000, fixedPer: 'period', periodDays: 125, variableBp: 2500 } }],
    defaultDeductible: 'standard',
    waitingPeriodDays: 30,
  },
};

async function setup() {
  const clock = new FixedClock('2026-11-15T10:00:00.000Z');
  let n = 0;
  const ids = { next: (p: string) => `${p}_${++n}` };
  const decisioning = new DecisioningService({ store: new InMemoryRuleSetStore(), clock, calculationModels: Object.keys(CALCULATION_MODELS) });
  await decisioning.createDraft('SE-HUND-TARIFF', { content: TARIFF as never, calculationModel: 'tariff.v1', effectiveFrom: '2026-01-01' }, 'author');
  await decisioning.submit('SE-HUND-TARIFF', 1, 'author');
  await decisioning.publish('SE-HUND-TARIFF', 1, 'publisher');
  await decisioning.createDraft('SE-HUND-TERMS', { content: PRICE_TERMS as never, calculationModel: 'price-terms.v1', effectiveFrom: '2026-01-01' }, 'author');
  await decisioning.submit('SE-HUND-TERMS', 1, 'author');
  await decisioning.publish('SE-HUND-TERMS', 1, 'publisher');
  await decisioning.createDraft('SE-UW', { content: UNDERWRITING as never, calculationModel: 'underwriting.v1', effectiveFrom: '2026-01-01' }, 'author');
  await decisioning.submit('SE-UW', 1, 'author');
  await decisioning.publish('SE-UW', 1, 'publisher');
  const products = new ProductService({ products: new InMemoryProductStore(), clock, speciesActive: async () => true, ruleSeriesInForce: async () => true });
  await products.createDraft('SE-HUND', { version: '1', salesFrom: '2026-11-01', content } as never, 'author');
  await products.submit('SE-HUND', '1', 'author');
  await products.publish('SE-HUND', '1', 'publisher');
  await products.createDraft('SE-HUND-UW', { version: '1', salesFrom: '2026-11-01', content: { ...content, underwritingSeries: 'SE-UW' } } as never, 'author');
  await products.submit('SE-HUND-UW', '1', 'author');
  await products.publish('SE-HUND-UW', '1', 'publisher');
  const partyStore = new InMemoryPartyStore();
  await partyStore.register({ id: 'pty_anna', revision: 1, kind: 'person', market: 'SE', givenName: 'Anna', familyName: 'Example', changedBy: 't', changedAt: clock.now() }, []);
  await partyStore.register({ id: 'pty_bo', revision: 1, kind: 'person', market: 'SE', givenName: 'Bo', familyName: 'Example', changedBy: 't', changedAt: clock.now() }, []);
  const parties = new PartyService({ store: partyStore, clock, ids });
  const animalStore = new InMemoryAnimalStore();
  const animals = new AnimalService({ store: animalStore, references: { get: async () => ({ active: true, parent: 'dog' }) }, clock, ids });
  await animalStore.register(
    { id: 'ani_rex', revision: 1, market: 'SE', species: 'dog', sex: 'male', neutered: false, name: 'Rex', birthDate: '2024-03-01', allowLookup: false, changedBy: 't', changedAt: clock.now() },
    [],
    { seq: 1, partyId: 'pty_anna', validFrom: '2024-05-01', recordedBy: 't', recordedAt: clock.now() },
  );
  await animalStore.register(
    { id: 'ani_lo', revision: 1, market: 'SE', species: 'dog', sex: 'female', neutered: false, name: 'Lo', birthDate: '2023-06-01', allowLookup: false, changedBy: 't', changedAt: clock.now() },
    [],
    { seq: 1, partyId: 'pty_bo', validFrom: '2023-08-01', recordedBy: 't', recordedAt: clock.now() },
  );
  const policies = new PolicyService({
    store: new InMemoryPolicyStore(),
    products: productPort(products),
    animals: animalPort(animals),
    parties,
    tariffs: decisioning,
    underwriting: decisioning,
    engineVersion: 'test',
    clock,
    ids,
  });
  const service = new ClaimsService({ policies: new InMemoryPolicyPort([]), rules: new StaticRulesPort({}, fixtures.RULES_SE_DOG), store: new InMemoryClaimsStore(), clock, ids: new SequentialIds() });
  const app = createApp({ service, clock, decisioning, products, animals, parties, policies, idempotency: new InMemoryIdempotencyStore(), auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `key-pol-${String(++n).padStart(4, '0')}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  /** Delivers the animal register's events to the policy module, as the installation's relay does. */
  const relay = async () => {
    const events = await animalStore.pendingEvents(100);
    for (const e of events) await policies.handleAnimalEvent(e);
    await animalStore.markPublished(events.map((e) => e.id), clock.now());
  };
  return Object.assign(call, { clock, animals, relay });
}

const issueBody = {
  market: 'SE',
  animalId: 'ani_rex',
  policyholderPartyId: 'pty_anna',
  productVersion: 'SE-HUND@1',
  startDate: '2026-12-01',
  vetCare: { annualLimit: 3_000_000 },
  acceptance: { channel: 'web', reference: 'sess-1', acceptedAt: '2026-11-15T09:58:00Z' },
};
/** Rex with the test tariff: 240 000 × 0.9 (2 years) × 1.0 × 1.0 × 0.95 (no address: rural) = 205 200. */
const REX_PREMIUM = 205_200;

test('a policy is issued, found, and seen by the claims engine as of a date', async () => {
  const call = await setup();
  const res = await call('POST', '/v1/policies', 'seller', issueBody);
  assert.equal(res.status, 201);
  assert.ok(validatorFor('PolicyRecord')(structuredClone(res.body)), JSON.stringify(validatorFor('PolicyRecord').errors));
  const p = res.body;
  assert.deepEqual([p.terms[0].endDate, p.terms[0].vetCare.annualLimit, p.terms[0].deductibleOption], ['2027-12-01', 3_000_000, 'standard']);

  assert.deepEqual((await call('GET', '/v1/policies?animalId=ani_rex', 'handler')).body.items.map((x: any) => x.id), [p.id]);
  assert.deepEqual((await call('GET', '/v1/policies?policyholderPartyId=pty_anna', 'seller')).body.items.map((x: any) => x.id), [p.id]);
  const history = (await call('GET', `/v1/policies/${p.id}/history`, 'handler')).body;
  assert.deepEqual(history.transactions[0].steps.map((s: any) => s.step), ['draft', 'priced', 'underwritten', 'issued']);

  const snap = await call('GET', `/v1/policies/${p.id}/snapshot?date=2027-03-01`, 'handler');
  assert.equal(snap.status, 200);
  assert.ok(validatorFor('PolicySnapshot')(structuredClone(snap.body)));
  assert.deepEqual([snap.body.productVersion, snap.body.animalBirthDate, snap.body.policyYearEnd], ['SE-HUND@1', '2024-03-01', '2027-12-01']);
  assert.equal((await call('GET', `/v1/policies/${p.id}/snapshot?date=2026-11-30`, 'handler')).status, 404);
  assert.equal((await call('GET', `/v1/policies/${p.id}/snapshot?date=2027-03-01&knownAt=2026-11-15T09:00:00Z`, 'handler')).status, 404);
});

test('scope, permissions and refusals', async () => {
  const call = await setup();
  const p = (await call('POST', '/v1/policies', 'seller', issueBody)).body;
  assert.equal((await call('GET', `/v1/policies/${p.id}`, 'sellerDe')).status, 404);
  assert.equal((await call('GET', `/v1/policies/${p.id}`, 'clinic')).status, 403); // no policies:read
  assert.equal((await call('POST', '/v1/policies', 'sellerDe', issueBody)).status, 403);
  assert.equal((await call('POST', '/v1/policies', 'handler', issueBody)).status, 403);
  assert.equal((await call('POST', '/v1/policies', 'seller', issueBody)).status, 409); // insured already
  assert.equal((await call('POST', '/v1/policies', 'seller', { ...issueBody, animalId: 'ani_none' })).status, 422);
  assert.equal((await call('POST', '/v1/policies', 'seller', { ...issueBody, startDate: '2026-11-01' })).status, 422);
  assert.equal((await call('POST', '/v1/policies', 'seller', { ...issueBody, productVersion: 'SE-HUND@9' })).status, 422);
  assert.equal((await call('POST', '/v1/policies', 'seller', { ...issueBody, vetCare: { annualLimit: 1 } })).status, 422);
  assert.equal((await call('GET', '/v1/policies', 'handler')).status, 422);
  assert.equal((await call('GET', `/v1/policies/${p.id}/snapshot`, 'handler')).status, 422);
  assert.equal((await call('GET', '/v1/policies/pol_none', 'handler')).status, 404);
});

test('a policy is cancelled and the cancellation reversed', async () => {
  const call = await setup();
  const p = (await call('POST', '/v1/policies', 'seller', issueBody)).body;
  // The test product keeps the term (no policy settings): the customer cannot cancel at once.
  assert.equal((await call('POST', `/v1/policies/${p.id}/cancellations`, 'seller', { reason: 'customer-immediate' })).status, 422);
  assert.equal((await call('POST', `/v1/policies/${p.id}/cancellations`, 'seller', { reason: 'later' })).status, 422);
  assert.equal((await call('POST', `/v1/policies/${p.id}/cancellations`, 'handler', { reason: 'withdrawal' })).status, 403);

  const w = await call('POST', `/v1/policies/${p.id}/cancellations`, 'seller', { reason: 'withdrawal' });
  assert.equal(w.status, 201);
  assert.ok(validatorFor('PolicyTransaction')(structuredClone(w.body)), JSON.stringify(validatorFor('PolicyTransaction').errors));
  assert.deepEqual([w.body.cancellation.effectiveDate, w.body.cancellation.refund], ['2026-12-01', { amount: REX_PREMIUM, currency: 'SEK' }]);
  assert.equal((await call('GET', `/v1/policies/${p.id}/snapshot?date=2027-01-01`, 'handler')).body.status, 'cancelled');
  assert.equal((await call('POST', `/v1/policies/${p.id}/cancellations`, 'seller', { reason: 'customer-term-end' })).status, 409);

  assert.equal((await call('POST', `/v1/policies/${p.id}/reinstatements`, 'seller', { cancellationId: 'ptx_none', note: 'x' })).status, 409);
  const back = await call('POST', `/v1/policies/${p.id}/reinstatements`, 'seller', { cancellationId: w.body.id, note: 'Registered by mistake' });
  assert.equal(back.status, 201);
  assert.equal((await call('GET', `/v1/policies/${p.id}/snapshot?date=2027-01-01`, 'handler')).body.status, 'active');
  const history = (await call('GET', `/v1/policies/${p.id}/history`, 'handler')).body;
  assert.deepEqual(history.transactions.map((t: any) => t.type), ['issue', 'cancel', 'reinstate']);
});

test('the renewal run renews with the version on sale, and a policy can be renewed by hand', async () => {
  const call = await setup();
  const p = (await call('POST', '/v1/policies', 'seller', issueBody)).body;
  assert.equal((await call('POST', '/v1/renewal-runs', 'seller', {})).status, 403); // no policies:renew
  call.clock.set('2027-10-20T03:00:00.000Z');
  const dry = await call('POST', '/v1/renewal-runs', 'job', { dryRun: true });
  assert.equal(dry.status, 200);
  assert.ok(validatorFor('RenewalRunResult')(structuredClone(dry.body)));
  assert.deepEqual(dry.body.renewed.map((r: any) => [r.policyId, r.startDate, r.endDate, r.productVersion]), [[p.id, '2027-12-01', '2028-12-01', 'SE-HUND@1']]);
  const run = await call('POST', '/v1/renewal-runs', 'job', {});
  assert.equal(run.body.renewed.length, 1);
  assert.equal((await call('GET', `/v1/policies/${p.id}`, 'handler')).body.terms.length, 2);
  assert.equal((await call('POST', `/v1/policies/${p.id}/renewals`, 'seller', { premium: { amount: 500_000, currency: 'SEK' } })).status, 403); // a manual price
  assert.equal((await call('POST', `/v1/policies/${p.id}/renewals`, 'underwriter', { premium: { amount: 500_000, currency: 'SEK' } })).status, 422); // needs a reason
  const manual = await call('POST', `/v1/policies/${p.id}/renewals`, 'underwriter', { premium: { amount: 500_000, currency: 'SEK' }, priceOverride: { reason: 'Agreed with the customer' } });
  assert.equal(manual.status, 201);
  assert.deepEqual(manual.body.renewal, { termNo: 3, productVersion: 'SE-HUND@1', premium: { amount: 500_000, currency: 'SEK' } });
});

test('a sale in the animal register becomes a transfer proposal, accepted through the API', async () => {
  const call = await setup();
  const p = (await call('POST', '/v1/policies', 'seller', issueBody)).body;
  call.clock.set('2027-06-10T10:00:00.000Z');
  await call.animals.transfer('ani_rex', { partyId: 'pty_bo', from: '2027-06-01', reason: 'Sold' }, 'registrar');
  await call.relay();
  const list = await call('GET', '/v1/policy-proposals?status=pending', 'handler');
  assert.equal(list.status, 200);
  const [pr] = list.body.items;
  assert.ok(validatorFor('PolicyProposal')(structuredClone(pr)));
  assert.deepEqual([pr.kind, pr.policyId, pr.details.toPartyId, pr.deadline], ['transfer', p.id, 'pty_bo', '2027-07-10']);
  assert.equal((await call('GET', '/v1/policy-proposals', 'sellerDe')).body.items.length, 0);
  assert.equal((await call('POST', `/v1/policy-proposals/${pr.id}/acceptances`, 'handler', { channel: 'web' })).status, 403);
  const ok = await call('POST', `/v1/policy-proposals/${pr.id}/acceptances`, 'seller', { channel: 'web', reference: 'sign-1' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.decision.outcome, 'accepted');
  const now = (await call('GET', `/v1/policies/${p.id}`, 'handler')).body;
  assert.deepEqual(now.versions.map((v: any) => v.policyholderPartyId), ['pty_anna', 'pty_bo']);
  assert.equal((await call('POST', `/v1/policy-proposals/${pr.id}/rejections`, 'seller', { reason: 'x' })).status, 409);
  assert.deepEqual((await call('POST', '/v1/proposal-expiry-runs', 'job')).body, { expired: [] });
  assert.equal((await call('POST', '/v1/proposal-expiry-runs', 'seller')).status, 403);
});

test('the choices are changed from a day during the term', async () => {
  const call = await setup();
  const p = (await call('POST', '/v1/policies', 'seller', issueBody)).body; // 3 000 000 limit, 480 000 a year
  call.clock.set('2027-06-01T10:00:00.000Z');
  const res = await call('POST', `/v1/policies/${p.id}/changes`, 'seller', {
    from: '2027-06-01',
    vetCare: { annualLimit: 6_000_000 },
    reason: 'Higher amount',
  });
  assert.equal(res.status, 201);
  assert.ok(validatorFor('PolicyTransaction')(structuredClone(res.body)), JSON.stringify(validatorFor('PolicyTransaction').errors));
  assert.equal(res.body.change.annualLimit, 6_000_000);
  assert.ok(res.body.change.premiumAdjustment > 0);
  assert.equal((await call('GET', `/v1/policies/${p.id}/snapshot?date=2027-07-01`, 'handler')).body.vetCare.annualLimit, 6_000_000);
  assert.equal((await call('GET', `/v1/policies/${p.id}/snapshot?date=2027-05-01`, 'handler')).body.vetCare.annualLimit, 3_000_000);
  const policy = (await call('GET', `/v1/policies/${p.id}`, 'handler')).body;
  assert.ok(validatorFor('PolicyRecord')(structuredClone(policy)));
  assert.equal((await call('POST', `/v1/policies/${p.id}/changes`, 'seller', { from: '2027-05-01', vetCare: {}, premium: { amount: 1, currency: 'SEK' }, reason: 'x' })).status, 422);
  assert.equal((await call('POST', `/v1/policies/${p.id}/changes`, 'handler', { from: '2027-07-01', vetCare: {}, premium: { amount: 1, currency: 'SEK' }, reason: 'x' })).status, 403);
});

test('a household group is created, a policy joins and leaves', async () => {
  const call = await setup();
  const p = (await call('POST', '/v1/policies', 'seller', issueBody)).body;
  assert.equal((await call('POST', '/v1/policy-groups', 'sellerDe', { market: 'SE', kind: 'household', holderPartyId: 'pty_anna' })).status, 403);
  assert.equal((await call('POST', '/v1/policy-groups', 'seller', { market: 'SE', kind: 'litter', holderPartyId: 'pty_anna' })).status, 422);
  const g = await call('POST', '/v1/policy-groups', 'seller', { market: 'SE', kind: 'household', holderPartyId: 'pty_anna' });
  assert.equal(g.status, 201);
  const joined = await call('POST', `/v1/policy-groups/${g.body.id}/members`, 'seller', { policyId: p.id });
  assert.equal(joined.status, 201);
  assert.ok(validatorFor('PolicyGroup')(structuredClone(joined.body)));
  assert.deepEqual(joined.body.members.map((m: any) => [m.policyId, m.from]), [[p.id, '2026-12-01']]);
  assert.equal((await call('POST', `/v1/policy-groups/${g.body.id}/members`, 'seller', { policyId: p.id })).status, 409);
  assert.deepEqual((await call('GET', `/v1/policy-groups?policyId=${p.id}`, 'handler')).body.items.map((x: any) => x.id), [g.body.id]);
  assert.equal((await call('GET', `/v1/policy-groups/${g.body.id}`, 'sellerDe')).status, 404);
  assert.equal((await call('GET', '/v1/policy-groups', 'handler')).status, 422);
  call.clock.set('2027-01-10T10:00:00.000Z');
  const left = await call('POST', `/v1/policy-groups/${g.body.id}/members/${p.id}/ends`, 'seller', { reason: 'Moved out' });
  assert.deepEqual([left.status, left.body.members[0].to], [201, '2027-01-10']);
});

test('a price indication from the product\'s tariff, with ids or with the facts', async () => {
  const call = await setup();
  const body = { market: 'SE', productVersion: 'SE-HUND@1', startDate: '2026-12-01', animalId: 'ani_rex', policyholderPartyId: 'pty_anna' };
  const res = await call('POST', '/v1/quotes', 'seller', body);
  assert.equal(res.status, 200);
  assert.ok(validatorFor('Quote')(structuredClone(res.body)), JSON.stringify(validatorFor('Quote').errors));
  // Rex: 2 years on 2026-12-01, no breed, no postal code: 300 000 × 0.9 × 1.0 × 1.0 × 0.95 = 256 500.
  assert.deepEqual([res.body.endDate, res.body.price.annualPremium, res.body.price.facts.zone, res.body.price.facts.ageYears], ['2027-12-01', 256_500, 'rural', 2]);
  // A customer portal gives the facts, not ids.
  assert.equal((await call('POST', '/v1/quotes', 'portal', body)).status, 403);
  const facts = await call('POST', '/v1/quotes', 'portal', { market: 'SE', productVersion: 'SE-HUND@1', startDate: '2026-12-01', animal: { species: 'dog', birthDate: '2024-03-01' }, postalCode: '111 22', vetCare: { annualLimit: 3_000_000 } });
  assert.equal(facts.status, 200);
  assert.equal(facts.body.price.facts.zone, 'city');
  assert.equal((await call('POST', '/v1/quotes', 'sellerDe', body)).status, 403);
  assert.equal((await call('POST', '/v1/quotes', 'handler', body)).status, 403); // no policies:quote
  assert.equal((await call('POST', '/v1/quotes', 'seller', { ...body, animalId: undefined })).status, 422);
});

test('price terms in a quote: the second animal in a group, and a campaign code', async () => {
  const call = await setup();
  const p = (await call('POST', '/v1/policies', 'seller', issueBody)).body;
  const g = (await call('POST', '/v1/policy-groups', 'seller', { market: 'SE', kind: 'household', holderPartyId: 'pty_anna' })).body;
  await call('POST', `/v1/policy-groups/${g.id}/members`, 'seller', { policyId: p.id });
  const body = { market: 'SE', productVersion: 'SE-HUND@1', startDate: '2026-12-01', animal: { species: 'dog', birthDate: '2024-03-01' }, policyholderPartyId: 'pty_anna' };
  const alone = (await call('POST', '/v1/quotes', 'seller', body)).body.price;
  const second = await call('POST', '/v1/quotes', 'seller', { ...body, groupId: g.id });
  assert.equal(second.status, 200);
  assert.ok(validatorFor('Quote')(structuredClone(second.body)), JSON.stringify(validatorFor('Quote').errors));
  // 256 500 less 10 % (any group, from the second animal) = 230 850 -> 230 900.
  assert.deepEqual([alone.annualPremium, second.body.price.basePremium, second.body.price.annualPremium, second.body.price.facts.discountBp], [256_500, 256_500, 230_900, 1_000]);
  const campaign = (await call('POST', '/v1/quotes', 'seller', { ...body, campaignCode: 'PUPPY2026', startDate: '2026-12-01' })).body.price;
  assert.equal(campaign.facts.discountBp, 2_000);
  assert.equal((await call('POST', '/v1/quotes', 'seller', { ...body, campaignCode: 'NOPE' })).status, 422);
  assert.equal((await call('POST', '/v1/quotes', 'portal', { ...body, policyholderPartyId: undefined, groupId: g.id })).status, 403);
  const portal = await call('POST', '/v1/quotes', 'portal', { ...body, policyholderPartyId: undefined, postalCode: '90000', group: { kind: 'household', memberNo: 2 } });
  assert.equal(portal.body.price.facts.discountBp, 1_000);
});

test('an application on a product with health questions: accepted with a rider, referred, and the queue (ADR 0031)', async () => {
  const call = await setup();
  const no = (question: string) => ({ question, value: false });
  const body = {
    ...issueBody,
    productVersion: 'SE-HUND-UW@1',
    answers: [{ question: 'previous-illness', value: true, diagnosisCodes: ['ORA-OTIT'] }, no('ongoing-symptoms'), no('lameness')],
  };

  // The questions the channel asks, from the rules in force.
  const q = await call('GET', '/v1/application-questions?productVersion=SE-HUND-UW@1&species=dog', 'seller');
  assert.equal(q.status, 200);
  assert.ok(validatorFor('ApplicationQuestions')(structuredClone(q.body)), JSON.stringify(validatorFor('ApplicationQuestions').errors));
  assert.deepEqual([q.body.rules.series, q.body.questions.map((x: any) => x.id)], ['SE-UW', ['previous-illness', 'ongoing-symptoms', 'lameness']]);
  assert.equal((await call('GET', '/v1/application-questions?productVersion=SE-HUND@1&species=dog', 'seller')).status, 409);
  assert.equal((await call('GET', '/v1/application-questions?productVersion=SE-HUND-UW@1', 'seller')).status, 422);
  assert.equal((await call('GET', '/v1/application-questions?productVersion=SE-NONE@1&species=dog', 'seller')).status, 404);

  // A product with underwriting rules is applied for; one without is issued directly.
  assert.equal((await call('POST', '/v1/policies', 'seller', { ...issueBody, productVersion: 'SE-HUND-UW@1' })).status, 422);
  assert.equal((await call('POST', '/v1/applications', 'seller', { ...body, productVersion: 'SE-HUND@1' })).status, 422);
  assert.equal((await call('POST', '/v1/applications', 'seller', { ...body, answers: undefined })).status, 422);
  assert.equal((await call('POST', '/v1/applications', 'seller', { ...body, acceptance: undefined })).status, 422);
  assert.equal((await call('POST', '/v1/applications', 'sellerDe', body)).status, 403);
  assert.equal((await call('POST', '/v1/applications', 'portal', body)).status, 403);

  const res = await call('POST', '/v1/applications', 'seller', body);
  assert.equal(res.status, 201);
  assert.ok(validatorFor('Application')(structuredClone(res.body)), JSON.stringify(validatorFor('Application').errors));
  assert.deepEqual([res.body.status, res.body.underwriting.result.outcome, res.body.underwriting.result.rules.series], ['accepted', 'accept-with-riders', 'SE-UW']);
  const policy = (await call('GET', `/v1/policies/${res.body.policyId}`, 'handler')).body;
  assert.ok(validatorFor('PolicyRecord')(structuredClone(policy)), JSON.stringify(validatorFor('PolicyRecord').errors));
  assert.deepEqual(policy.terms[0].riders.map((r: any) => [r.diagnosisCodes, r.source, r.applicationId]), [[['ORA-OTIT'], 'underwriting', res.body.id]]);
  const history = (await call('GET', `/v1/policies/${res.body.policyId}/history`, 'handler')).body;
  assert.deepEqual([history.transactions[0].issue.applicationId, history.transactions[0].issue.acceptance.channel], [res.body.id, 'web']);

  // Lo has symptoms no vet has examined: referred, and in the queue.
  const referred = (await call('POST', '/v1/applications', 'seller', { ...body, animalId: 'ani_lo', policyholderPartyId: 'pty_bo', answers: [no('previous-illness'), { question: 'ongoing-symptoms', value: true }, no('lameness')] })).body;
  assert.deepEqual([referred.status, referred.policyId, referred.underwriting.result.reasons], ['referred', undefined, ['ongoing-symptoms']]);
  const queue = await call('GET', '/v1/applications?status=referred', 'underwriter');
  assert.deepEqual(queue.body.items.map((a: any) => a.id), [referred.id]);
  assert.deepEqual((await call('GET', '/v1/applications', 'seller')).body.items.map((a: any) => a.status), ['accepted', 'referred']);
  assert.deepEqual((await call('GET', '/v1/applications?policyholderPartyId=pty_bo', 'seller')).body.items.map((a: any) => a.id), [referred.id]);
  assert.equal((await call('GET', '/v1/applications?status=open', 'seller')).status, 422);
  assert.equal((await call('GET', `/v1/applications/${referred.id}`, 'underwriter')).body.id, referred.id);
  assert.equal((await call('GET', `/v1/applications/${referred.id}`, 'sellerDe')).status, 404);
  assert.deepEqual((await call('GET', '/v1/applications', 'sellerDe')).body.items, []);
  assert.equal((await call('GET', '/v1/applications/app_none', 'seller')).status, 404);

  // A quote with the answers says what an application would lead to.
  const quote = await call('POST', '/v1/quotes', 'seller', { market: 'SE', productVersion: 'SE-HUND-UW@1', startDate: '2026-12-01', animal: { species: 'dog', birthDate: '2015-01-01' }, answers: body.answers });
  assert.equal(quote.status, 200);
  assert.ok(validatorFor('Quote')(structuredClone(quote.body)), JSON.stringify(validatorFor('Quote').errors));
  assert.deepEqual([quote.body.underwriting.outcome, quote.body.underwriting.reasons], ['decline', ['too-old']]);
});
