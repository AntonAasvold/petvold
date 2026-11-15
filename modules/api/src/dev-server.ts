/**
 * Local development server with sample data for Bella.
 *
 * Storage: Postgres when CLAIMS_DATABASE_URL is set (in .env after
 * `npm run dev:up`), so claims, decisions and the ledger survive restarts.
 * Without it everything lives in memory. Policies are always the
 * in-memory sample data until the policy module exists. Rules, reference data and
 * products come from their modules, seeded on the first start.
 *
 * Tokens: 'dev-handler' (claims handler), 'dev-approver' (approver), 'dev-admin'
 * (roles and limits), 'dev-author' and 'dev-publisher' (rule sets), 'dev-catalog' and 'dev-catalog-publisher' (reference data and products), 'dev-registrar' (animals and parties), 'dev-privacy' and 'dev-privacy-2' (erasure), 'dev-retention-job' (retention run), 'dev-seller' (policies), 'dev-renewal-job' (renewal run), 'dev-clinic'
 * (clinic), 'dev-job' (reassessment job), 'dev-customer' (customer channel). Roles map to
 * permissions with DEFAULT_ROLES (ADR 0016).
 * The API page is at /docs and example requests are in examples/claims.http.
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { serve } from '@hono/node-server';
import { ClaimsService, eventClaimId, relayOutbox, type ClaimsEvent, type ClaimsOutbox, type ClaimsStore } from '@petvold/claims-core';
import { InMemoryClaimsStore, fixtures } from '@petvold/claims-store-memory';
import { createPool, PostgresClaimsStore, PostgresIdempotencyStore } from '@petvold/claims-store-postgres';
import { AccessService, InMemoryRoleConfigStore, type RoleConfigStore } from '@petvold/access';
import { PostgresRoleConfigStore } from '@petvold/access/postgres';
import { DecisioningRulesPort, DecisioningService, InMemoryRuleSetStore, ruleSetChecksum, type RuleSetStore, type RuleSetVersion } from '@petvold/decisioning';
import { PostgresRuleSetStore } from '@petvold/decisioning/postgres';
import { InMemoryPartyStore, InMemoryRetentionStore, PartyService, RetentionService, type PartyStore } from '@petvold/parties';
import { PostgresPartyStore, PostgresRetentionStore } from '@petvold/parties/postgres';
import { InMemoryPolicyStore, PolicyService, type PolicyStore } from '@petvold/policies';
import { PostgresPolicyStore } from '@petvold/policies/postgres';
import { animalPort, claimsActivity, productPort } from './wiring.ts';
import { tariffCoverage } from '@petvold/pricing-core';
import { TARIFF } from '@petvold/pricing-core/fixtures';
import {
  CatalogService,
  InMemoryProductStore,
  InMemoryReferenceDataStore,
  isReferenceKind,
  productChecksum,
  ProductService,
  type ProductStore,
  type ProductVersion,
  type ReferenceDataStore,
} from '@petvold/catalog';
import { PostgresProductStore, PostgresReferenceDataStore } from '@petvold/catalog/postgres';
import { AnimalService, InMemoryAnimalStore, type AnimalStore } from '@petvold/animals';
import { PostgresAnimalStore } from '@petvold/animals/postgres';
import referenceSeed from '@petvold/catalog/seed/reference-data.json' with { type: 'json' };
import productSeed from '@petvold/catalog/seed/products.json' with { type: 'json' };
import { CALCULATION_MODEL, CALCULATION_MODELS } from '@petvold/claims-core';
import { createApp, InMemoryIdempotencyStore, type IdempotencyStore, type Principal } from './index.ts';
import { assertRoleDefinitions, DEFAULT_ROLES, type RoleDefinitions } from './permissions.ts';
import { docsPage } from './docs.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env: run in memory.
}

const clock = { now: () => new Date().toISOString() };

/** Stored with every decision (ADR 0018). PETVOLD_VERSION in production, the git commit locally. */
function engineVersion(): string {
  if (process.env.PETVOLD_VERSION) return process.env.PETVOLD_VERSION;
  try {
    return `dev+${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()}`;
  } catch {
    return 'dev+unknown';
  }
}
/** Random ids, so ids never repeat across restarts of a persistent store. */
const ids = { next: (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}` };

const databaseUrl = process.env.CLAIMS_DATABASE_URL;
let store: ClaimsStore & ClaimsOutbox;
let idempotency: IdempotencyStore;
let storage: string;
if (databaseUrl) {
  const pool = createPool(databaseUrl, { max: 5 });
  await pool.query('select 1').catch((err: Error) => {
    console.error(`Cannot reach Postgres (${err.message}). Run npm run dev:up, or remove CLAIMS_DATABASE_URL to run in memory.`);
    process.exit(1);
  });
  store = new PostgresClaimsStore(pool);
  idempotency = new PostgresIdempotencyStore(pool);
  storage = `Postgres (${new URL(databaseUrl).pathname.slice(1)})`;
} else {
  store = new InMemoryClaimsStore();
  idempotency = new InMemoryIdempotencyStore();
  storage = 'memory (data is lost on restart)';
}

// Role settings (ADR 0020): in Postgres with ACCESS_DATABASE_URL, else in memory.
const accessUrl = process.env.ACCESS_DATABASE_URL;
const roleStore: RoleConfigStore<RoleDefinitions> = accessUrl
  ? new PostgresRoleConfigStore<RoleDefinitions>(createPool(accessUrl, { max: 2 }))
  : new InMemoryRoleConfigStore<RoleDefinitions>();
const access = new AccessService<RoleDefinitions>({ store: roleStore, clock, validate: assertRoleDefinitions, defaults: DEFAULT_ROLES });

// Rule sets (ADR 0021): in Postgres with DECISIONING_DATABASE_URL, else in memory.
const decisioningUrl = process.env.DECISIONING_DATABASE_URL;
const ruleStore: RuleSetStore = decisioningUrl ? new PostgresRuleSetStore(createPool(decisioningUrl, { max: 2 })) : new InMemoryRuleSetStore();
const decisioning = new DecisioningService({ store: ruleStore, clock, calculationModels: Object.keys(CALCULATION_MODELS) });
const SERIES = 'SE-HUND-VV';
await seedRules(ruleStore);
await seedTariff(ruleStore);

/** The made-up dog tariff (ADR 0030), which the sample product SE-HUND-BAS is priced with. */
async function seedTariff(store: RuleSetStore): Promise<void> {
  const series = 'SE-HUND-TARIFF';
  if ((await store.list(series)).length > 0) return;
  const now = clock.now();
  const base = { series, version: 1, content: TARIFF as never, calculationModel: 'tariff.v1', effectiveFrom: '2026-01-01' };
  const v: RuleSetVersion = {
    ...base,
    status: 'published',
    checksum: ruleSetChecksum(base),
    revision: 2,
    createdBy: 'petvold-seed',
    createdAt: now,
    submittedBy: 'petvold-seed',
    submittedAt: now,
    publishedBy: 'petvold-install',
    publishedAt: now,
  };
  await store.create({ ...v, status: 'draft', revision: 1 } as RuleSetVersion);
  await store.update(v);
}

/**
 * The first start publishes the sample rules as SE-HUND-VV@1, so the dev server
 * can assess claims at once. An installation seed, not a review: in production
 * the first version goes through draft, review and publication.
 */
async function seedRules(store: RuleSetStore): Promise<void> {
  if ((await store.list(SERIES)).length > 0) return;
  const { rulesVersion: _v, ...content } = fixtures.RULES_SE_DOG;
  const now = clock.now();
  const base = { series: SERIES, version: 1, content, calculationModel: CALCULATION_MODEL, effectiveFrom: '2026-01-01' };
  const v: RuleSetVersion = {
    ...base,
    status: 'published',
    checksum: ruleSetChecksum(base),
    revision: 1,
    createdBy: 'petvold-seed',
    createdAt: now,
    submittedBy: 'petvold-seed',
    submittedAt: now,
    publishedBy: 'petvold-install',
    publishedAt: now,
  };
  await store.create({ ...v, status: 'draft', revision: 1 } as RuleSetVersion);
  await store.update({ ...v, revision: 2 });
}

// Reference data (ADR 0022): in Postgres with CATALOG_DATABASE_URL, else in memory.
const catalogUrl = process.env.CATALOG_DATABASE_URL;
const catalogPool = catalogUrl ? createPool(catalogUrl, { max: 2 }) : null;
const referenceStore: ReferenceDataStore = catalogPool ? new PostgresReferenceDataStore(catalogPool) : new InMemoryReferenceDataStore();
const productStore: ProductStore = catalogPool ? new PostgresProductStore(catalogPool) : new InMemoryProductStore();
const catalog = new CatalogService({ references: referenceStore, clock });
const products = new ProductService({
  products: productStore,
  clock,
  speciesActive: async (code) => (await referenceStore.get('species', code))?.active === true,
  ruleSeriesInForce: async (series, onDate) => (await decisioning.rulesInForce(series, onDate)) !== null,
  tariffProblems: async (series, onDate, product) => {
    const t = await decisioning.tariffInForce(series, onDate);
    return t ? tariffCoverage(t.content, product) : null;
  },
});
await seedReferenceData();
await seedProducts();

/**
 * The first start publishes the sample product SE-HUND-VV-LIV@2026.2, the
 * product of Bella's policy. An installation seed, like the rules: in
 * production a version goes through draft, review and publication.
 */
async function seedProducts(): Promise<void> {
  const now = clock.now();
  for (const p of productSeed as Pick<ProductVersion, 'product' | 'version' | 'salesFrom' | 'content'>[]) {
    if (await productStore.get(p.product, p.version)) continue;
    const draft: ProductVersion = { ...p, status: 'draft', revision: 1, createdBy: 'petvold-seed', createdAt: now };
    await productStore.create(draft);
    await productStore.update({
      ...draft,
      status: 'published',
      checksum: productChecksum(draft),
      revision: 2,
      submittedBy: 'petvold-seed',
      submittedAt: now,
      publishedBy: 'petvold-install',
      publishedAt: now,
    });
  }
}

/** Sample species, sexes and breeds, created once. Parents come first in the file. */
async function seedReferenceData(): Promise<void> {
  for (const [kind, items] of Object.entries(referenceSeed)) {
    if (!isReferenceKind(kind)) continue;
    for (const i of items as { code: string; parent?: string; labels: Record<string, string> }[]) {
      if (await referenceStore.get(kind, i.code)) continue;
      await catalog.putReference(kind, i.code, { labels: i.labels, ...(i.parent ? { parent: i.parent } : {}) }, 'petvold-seed');
    }
  }
}

// Parties (ADR 0026): in Postgres with PARTIES_DATABASE_URL, else in memory.
const partiesUrl = process.env.PARTIES_DATABASE_URL;
const partyStore: PartyStore = partiesUrl ? new PostgresPartyStore(createPool(partiesUrl, { max: 2 })) : new InMemoryPartyStore();
const parties = new PartyService({ store: partyStore, clock, ids });
await seedParties();

/** Bella's owner, made up. No personal number in the sample data. */
async function seedParties(): Promise<void> {
  if (await partyStore.get('pty_owner001')) return;
  await partyStore.register(
    {
      id: 'pty_owner001',
      revision: 1,
      kind: 'person',
      market: 'SE',
      givenName: 'Anna',
      familyName: 'Example',
      email: 'anna@example.test',
      address: { street: 'Example Street 1', postalCode: '11122', city: 'Stockholm', country: 'SE' },
      language: 'sv',
      changedBy: 'petvold-seed',
      changedAt: clock.now(),
    },
    [],
  );
}

// The animal register (ADR 0024): in Postgres with ANIMALS_DATABASE_URL, else in memory.
const animalsUrl = process.env.ANIMALS_DATABASE_URL;
const animalStore: AnimalStore = animalsUrl ? new PostgresAnimalStore(createPool(animalsUrl, { max: 2 })) : new InMemoryAnimalStore();
const animals = new AnimalService({ store: animalStore, references: referenceStore, parties, clock, ids });
await seedAnimals();

/** Bella from the sample policy, with a microchip and her owner since she was a puppy. */
async function seedAnimals(): Promise<void> {
  if (await animalStore.get('ani_bella')) return;
  const now = clock.now();
  const by = 'petvold-seed';
  await animalStore.register(
    { id: 'ani_bella', revision: 1, market: 'SE', species: 'dog', breed: 'dog-labrador-retriever', sex: 'female', neutered: true, name: 'Bella', birthDate: '2019-03-14', allowLookup: true, changedBy: by, changedAt: now },
    [{ type: 'microchip', value: '752098100000001', addedBy: by, addedAt: now }],
    { seq: 1, partyId: 'pty_owner001', validFrom: '2019-05-20', recordedBy: by, recordedAt: now },
  );
}

// Policies (ADR 0029): in Postgres with POLICIES_DATABASE_URL, else in memory.
// The claims engine reads them through PolicyService as its PolicyPort.
const policiesUrl = process.env.POLICIES_DATABASE_URL;
const policyStore: PolicyStore = policiesUrl ? new PostgresPolicyStore(createPool(policiesUrl, { max: 2 })) : new InMemoryPolicyStore();
const policies = new PolicyService({ store: policyStore, products: productPort(products), animals: animalPort(animals), parties, tariffs: decisioning, clock, ids });
await seedPolicies();

/**
 * Bella's policy from the sample data, as known since 3 March 2026. Only the
 * current term is in the sample; the policy began 1 April 2024.
 */
async function seedPolicies(): Promise<void> {
  if (await policyStore.get('pol_bella')) return;
  const snap = fixtures.bellaPolicy();
  const at = '2026-03-03T00:00:00.000Z';
  await policyStore.issue(
    { id: 'pol_bella', market: 'SE', animalId: 'ani_bella', inceptionDate: snap.inceptionDate, createdBy: 'petvold-seed', createdAt: at },
    {
      policyId: 'pol_bella',
      termNo: 1,
      startDate: snap.policyYearStart,
      endDate: snap.policyYearEnd,
      productVersion: snap.productVersion,
      currency: 'SEK',
      vetCare: snap.vetCare!,
      deductibleOption: 'standard',
      premium: 480_000,
      riders: snap.riders,
      transactionId: 'ptx_bellaseed',
    },
    {
      id: 'pv_bellav4',
      policyId: 'pol_bella',
      validFrom: snap.validFrom,
      validTo: snap.validTo!,
      sysFrom: at,
      policyholderPartyId: 'pty_owner001',
      status: 'active',
      termNo: 1,
      transactionId: 'ptx_bellaseed',
    },
    { id: 'ptx_bellaseed', policyId: 'pol_bella', type: 'issue', steps: [{ step: 'issued', at, note: 'Sample data' }], requestedBy: 'petvold-seed', requestedAt: at },
    [],
  );
}

// The animal register's outbox (ADR 0008): delivered to the policy module, which
// turns a sale into a transfer proposal and a death into a cancellation proposal (ADR 0029).
setInterval(
  () =>
    void (async () => {
      const events = await animalStore.pendingEvents(100);
      for (const e of events) {
        const proposal = await policies.handleAnimalEvent(e);
        console.log(`[event] ${e.type} ${e.animalId}${proposal ? ` -> ${proposal.kind} proposal ${proposal.id}` : ''}`);
      }
      if (events.length) await animalStore.markPublished(events.map((e) => e.id), clock.now());
    })().catch((err) => console.error('[animal relay]', err)),
  1_000,
).unref();

// The policy module's outbox (ADR 0008). A superseded version makes the claims
// engine reassess the claims decided on it (ADR 0029); the rest is just logged.
setInterval(
  () =>
    void (async () => {
      const events = await policyStore.pendingEvents(100);
      for (const e of events) {
        console.log(`[event] ${e.type} ${e.policyId}`);
        if (e.type !== 'policy.version_superseded') continue;
        const versionId = String(e.data.versionId);
        for (const r of await service.reassessForPolicyChange([versionId], `Policy version ${versionId} was superseded`, 'policy-change')) {
          console.log(`[reassessed] ${r.claimId}: ${r.decision ? `${r.decision.outcome} ${r.decision.payout}` : 'no change'}`);
        }
      }
      if (events.length) await policyStore.markPublished(events.map((e) => e.id), clock.now());
    })().catch((err) => console.error('[policy relay]', err)),
  1_000,
).unref();

// Retention (ADR 0028): settings in Postgres with the parties, activity from the animal register and the policies.
const retention = new RetentionService({
  parties,
  settings: partiesUrl ? new PostgresRetentionStore(createPool(partiesUrl, { max: 1 })) : new InMemoryRetentionStore(),
  sources: [
    { name: 'animals', activityOf: (id) => animals.activityOf(id) },
    { name: 'policies', activityOf: (id) => policies.activityOf(id) },
    // The claims engine is created further down; look it up when the run asks.
    { name: 'claims', activityOf: (id) => claimsActivity(policies, service).activityOf(id) },
  ],
  clock,
});

const service = new ClaimsService({
  policies,
  // The product version on the policy points at its rule series (ADR 0023).
  rules: new DecisioningRulesPort(decisioning, (pv) => products.ruleSeriesOf(pv)),
  store,
  clock,
  ids,
  engineVersion: engineVersion(),
});

// The relay publishes events from the outbox. Here it just logs them.
const logSink = {
  publish: async (e: ClaimsEvent) =>
    console.log(`[event] ${e.type} ${e.type === 'claim.decided' ? `${e.decision.claimId}#${e.decision.seq}` : eventClaimId(e)}`),
};
setInterval(() => void relayOutbox(store, logSink, clock).catch((err) => console.error('[relay]', err)), 1_000).unref();

const tokens: Record<string, Principal> = {
  'dev-handler': { subject: 'handlaggare@example.test', roles: ['handler'], markets: '*' },
  'dev-approver': { subject: 'attestant@example.test', roles: ['approver'], markets: '*' },
  'dev-admin': { subject: 'admin@example.test', roles: ['admin'] },
  'dev-author': { subject: 'author@example.test', roles: ['rules-author'] },
  'dev-publisher': { subject: 'publisher@example.test', roles: ['rules-publisher'] },
  'dev-catalog': { subject: 'catalog@example.test', roles: ['catalog-manager'] },
  'dev-catalog-publisher': { subject: 'catalog-publisher@example.test', roles: ['catalog-publisher'] },
  'dev-registrar': { subject: 'registrar@example.test', roles: ['animal-registrar', 'party-registrar'], markets: ['SE'] },
  // Two privacy officers, since anonymization needs four eyes (ADR 0028).
  'dev-privacy': { subject: 'privacy-a@example.test', roles: ['privacy-officer'], markets: ['SE'] },
  'dev-privacy-2': { subject: 'privacy-b@example.test', roles: ['privacy-officer'], markets: ['SE'] },
  'dev-seller': { subject: 'seller@example.test', roles: ['policy-registrar'], markets: ['SE'] },
  'dev-renewal-job': { subject: 'renewal-job', roles: ['renewal-job'], markets: '*' },
  'dev-retention-job': { subject: 'retention-job', roles: ['retention-job'], markets: '*' },
  'dev-clinic': { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  'dev-job': { subject: 'reassessment-job', roles: ['reassessment-job'], markets: '*' },
  // Acts for the customer who owns Bella's policy in the sample data.
  'dev-customer': { subject: 'customer-portal', roles: ['customer-channel'], markets: ['SE'], policyIds: ['pol_bella'] },
};

const app = createApp({
  service,
  clock,
  idempotency,
  access,
  decisioning,
  catalog,
  products,
  animals,
  parties,
  retention,
  policies,
  auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) },
});

const port = Number(process.env.PORT ?? 8787);
const docs = docsPage({ specUrl: '/openapi.yaml', defaultToken: 'dev-handler' });

serve({
  port,
  fetch: (req) =>
    new URL(req.url).pathname === '/docs'
      ? new Response(docs, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      : app.fetch(req),
});
console.log(`Petvold listening on http://localhost:${port}`);
console.log(`  Storage:   ${storage}`);
console.log(`  Rules:     ${decisioningUrl ? 'Postgres' : 'memory'}, series ${SERIES} (GET /v1/rule-sets/${SERIES}/versions)`);
console.log(`  Reference: ${catalogUrl ? 'Postgres' : 'memory'} (GET /v1/reference-data/breed?parent=dog)`);
console.log(`  Animals:   ${animalsUrl ? 'Postgres' : 'memory'} (GET /v1/animals/ani_bella)`);
console.log(`  Parties:   ${partiesUrl ? 'Postgres' : 'memory'} (GET /v1/parties/pty_owner001)`);
console.log(`  Policies:  ${policiesUrl ? 'Postgres' : 'memory'} (GET /v1/policies/pol_bella)`);
console.log(`  Products:  ${catalogUrl ? 'Postgres' : 'memory'} (GET /v1/products/on-sale?date=2026-11-15)`);
console.log(`  Roles:     ${accessUrl ? 'Postgres, versioned (GET /v1/access/roles)' : 'memory, versioned (GET /v1/access/roles)'}`);
console.log(`  API page:  http://localhost:${port}/docs`);
console.log(`  Contract:  http://localhost:${port}/openapi.yaml`);
console.log(`  Tokens:    dev-handler (claims handler), dev-approver (approver), dev-admin (roles and limits), dev-author and dev-publisher (rule sets), dev-catalog and dev-catalog-publisher (reference data and products), dev-registrar (animals and parties), dev-privacy and dev-privacy-2 (erasure), dev-retention-job (retention run), dev-seller (policies), dev-renewal-job (renewal run), dev-clinic (clinic), dev-job (reassessment job), dev-customer (customer channel)`);
