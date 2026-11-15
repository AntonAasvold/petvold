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

const tokens: Record<string, Principal> = {
  seller: { subject: 'seller@example.test', roles: ['policy-registrar'], markets: ['SE'] },
  sellerDe: { subject: 'seller-de@example.test', roles: ['policy-registrar'], markets: ['DE'] },
  handler: { subject: 'h@example.test', roles: ['handler'], markets: '*' },
  clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  job: { subject: 'renewal-job', roles: ['renewal-job'], markets: '*' },
};

const content = {
  market: 'SE',
  currency: 'SEK',
  species: ['dog'],
  names: { en: 'Dog insurance' },
  ruleSeries: 'SE-HUND-VV',
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
  const products = new ProductService({ products: new InMemoryProductStore(), clock, speciesActive: async () => true, ruleSeriesInForce: async () => true });
  await products.createDraft('SE-HUND', { version: '1', salesFrom: '2026-11-01', content } as never, 'author');
  await products.submit('SE-HUND', '1', 'author');
  await products.publish('SE-HUND', '1', 'publisher');
  const partyStore = new InMemoryPartyStore();
  await partyStore.register({ id: 'pty_anna', revision: 1, kind: 'person', market: 'SE', givenName: 'Anna', familyName: 'Example', changedBy: 't', changedAt: clock.now() }, []);
  const parties = new PartyService({ store: partyStore, clock, ids });
  const animalStore = new InMemoryAnimalStore();
  const animals = new AnimalService({ store: animalStore, references: { get: async () => ({ active: true, parent: 'dog' }) }, clock, ids });
  await animalStore.register(
    { id: 'ani_rex', revision: 1, market: 'SE', species: 'dog', sex: 'male', neutered: false, name: 'Rex', birthDate: '2024-03-01', allowLookup: false, changedBy: 't', changedAt: clock.now() },
    [],
    { seq: 1, partyId: 'pty_anna', validFrom: '2024-05-01', recordedBy: 't', recordedAt: clock.now() },
  );
  const policies = new PolicyService({ store: new InMemoryPolicyStore(), products: productPort(products), animals: animalPort(animals), parties, clock, ids });
  const service = new ClaimsService({ policies: new InMemoryPolicyPort([]), rules: new StaticRulesPort({}, fixtures.RULES_SE_DOG), store: new InMemoryClaimsStore(), clock, ids: new SequentialIds() });
  const app = createApp({ service, clock, products, animals, parties, policies, idempotency: new InMemoryIdempotencyStore(), auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
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
  return Object.assign(call, { clock });
}

const apply = {
  market: 'SE',
  animalId: 'ani_rex',
  policyholderPartyId: 'pty_anna',
  productVersion: 'SE-HUND@1',
  startDate: '2026-12-01',
  vetCare: { annualLimit: 3_000_000 },
  premium: { amount: 480_000, currency: 'SEK' },
};

test('a policy is issued, found, and seen by the claims engine as of a date', async () => {
  const call = await setup();
  const res = await call('POST', '/v1/policies', 'seller', apply);
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
  const p = (await call('POST', '/v1/policies', 'seller', apply)).body;
  assert.equal((await call('GET', `/v1/policies/${p.id}`, 'sellerDe')).status, 404);
  assert.equal((await call('GET', `/v1/policies/${p.id}`, 'clinic')).status, 403); // no policies:read
  assert.equal((await call('POST', '/v1/policies', 'sellerDe', apply)).status, 403);
  assert.equal((await call('POST', '/v1/policies', 'handler', apply)).status, 403);
  assert.equal((await call('POST', '/v1/policies', 'seller', apply)).status, 409); // insured already
  assert.equal((await call('POST', '/v1/policies', 'seller', { ...apply, animalId: 'ani_none' })).status, 422);
  assert.equal((await call('POST', '/v1/policies', 'seller', { ...apply, startDate: '2026-11-01' })).status, 422);
  assert.equal((await call('POST', '/v1/policies', 'seller', { ...apply, productVersion: 'SE-HUND@9' })).status, 422);
  assert.equal((await call('POST', '/v1/policies', 'seller', { ...apply, vetCare: { annualLimit: 1 } })).status, 422);
  assert.equal((await call('GET', '/v1/policies', 'handler')).status, 422);
  assert.equal((await call('GET', `/v1/policies/${p.id}/snapshot`, 'handler')).status, 422);
  assert.equal((await call('GET', '/v1/policies/pol_none', 'handler')).status, 404);
});

test('a policy is cancelled and the cancellation reversed', async () => {
  const call = await setup();
  const p = (await call('POST', '/v1/policies', 'seller', apply)).body;
  // The test product keeps the term (no policy settings): the customer cannot cancel at once.
  assert.equal((await call('POST', `/v1/policies/${p.id}/cancellations`, 'seller', { reason: 'customer-immediate' })).status, 422);
  assert.equal((await call('POST', `/v1/policies/${p.id}/cancellations`, 'seller', { reason: 'later' })).status, 422);
  assert.equal((await call('POST', `/v1/policies/${p.id}/cancellations`, 'handler', { reason: 'withdrawal' })).status, 403);

  const w = await call('POST', `/v1/policies/${p.id}/cancellations`, 'seller', { reason: 'withdrawal' });
  assert.equal(w.status, 201);
  assert.ok(validatorFor('PolicyTransaction')(structuredClone(w.body)), JSON.stringify(validatorFor('PolicyTransaction').errors));
  assert.deepEqual([w.body.cancellation.effectiveDate, w.body.cancellation.refund], ['2026-12-01', { amount: 480_000, currency: 'SEK' }]);
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
  const p = (await call('POST', '/v1/policies', 'seller', apply)).body;
  assert.equal((await call('POST', '/v1/renewal-runs', 'seller', {})).status, 403); // no policies:renew
  call.clock.set('2027-10-20T03:00:00.000Z');
  const dry = await call('POST', '/v1/renewal-runs', 'job', { dryRun: true });
  assert.equal(dry.status, 200);
  assert.ok(validatorFor('RenewalRunResult')(structuredClone(dry.body)));
  assert.deepEqual(dry.body.renewed.map((r: any) => [r.policyId, r.startDate, r.endDate, r.productVersion]), [[p.id, '2027-12-01', '2028-12-01', 'SE-HUND@1']]);
  const run = await call('POST', '/v1/renewal-runs', 'job', {});
  assert.equal(run.body.renewed.length, 1);
  assert.equal((await call('GET', `/v1/policies/${p.id}`, 'handler')).body.terms.length, 2);
  const manual = await call('POST', `/v1/policies/${p.id}/renewals`, 'seller', { premium: { amount: 500_000, currency: 'SEK' } });
  assert.equal(manual.status, 201);
  assert.deepEqual(manual.body.renewal, { termNo: 3, productVersion: 'SE-HUND@1', premium: { amount: 500_000, currency: 'SEK' } });
});
