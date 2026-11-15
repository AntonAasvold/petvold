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
 * (roles and limits), 'dev-author' and 'dev-publisher' (rule sets), 'dev-catalog' and 'dev-catalog-publisher' (reference data and products), 'dev-registrar' (animals), 'dev-clinic'
 * (clinic), 'dev-job' (reassessment job), 'dev-customer' (customer channel). Roles map to
 * permissions with DEFAULT_ROLES (ADR 0016).
 * The API page is at /docs and example requests are in examples/claims.http.
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { serve } from '@hono/node-server';
import { ClaimsService, eventClaimId, relayOutbox, type ClaimsEvent, type ClaimsOutbox, type ClaimsStore } from '@petvold/claims-core';
import { InMemoryClaimsStore, InMemoryPolicyPort, fixtures } from '@petvold/claims-store-memory';
import { createPool, PostgresClaimsStore, PostgresIdempotencyStore } from '@petvold/claims-store-postgres';
import { AccessService, InMemoryRoleConfigStore, type RoleConfigStore } from '@petvold/access';
import { PostgresRoleConfigStore } from '@petvold/access/postgres';
import { DecisioningRulesPort, DecisioningService, InMemoryRuleSetStore, ruleSetChecksum, type RuleSetStore, type RuleSetVersion } from '@petvold/decisioning';
import { PostgresRuleSetStore } from '@petvold/decisioning/postgres';
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

// The animal register (ADR 0024): in Postgres with ANIMALS_DATABASE_URL, else in memory.
const animalsUrl = process.env.ANIMALS_DATABASE_URL;
const animalStore: AnimalStore = animalsUrl ? new PostgresAnimalStore(createPool(animalsUrl, { max: 2 })) : new InMemoryAnimalStore();
const animals = new AnimalService({ store: animalStore, references: referenceStore, clock, ids });
await seedAnimals();

/** Bella from the sample policy, with a microchip and her owner since she was a puppy. */
async function seedAnimals(): Promise<void> {
  if (await animalStore.get('ani_bella')) return;
  const now = clock.now();
  const by = 'petvold-seed';
  await animalStore.register(
    { id: 'ani_bella', revision: 1, market: 'SE', species: 'dog', breed: 'dog-labrador-retriever', sex: 'female', neutered: true, name: 'Bella', birthDate: '2019-03-14', changedBy: by, changedAt: now },
    [{ type: 'microchip', value: '752098100000001', addedBy: by, addedAt: now }],
    { seq: 1, partyId: 'pty_owner001', validFrom: '2019-05-20', recordedBy: by, recordedAt: now },
  );
}

const service = new ClaimsService({
  policies: new InMemoryPolicyPort([{ snapshot: fixtures.bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]),
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
  'dev-registrar': { subject: 'registrar@example.test', roles: ['animal-registrar'], markets: ['SE'] },
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
console.log(`  Products:  ${catalogUrl ? 'Postgres' : 'memory'} (GET /v1/products/on-sale?date=2026-11-15)`);
console.log(`  Roles:     ${accessUrl ? 'Postgres, versioned (GET /v1/access/roles)' : 'memory, versioned (GET /v1/access/roles)'}`);
console.log(`  API page:  http://localhost:${port}/docs`);
console.log(`  Contract:  http://localhost:${port}/openapi.yaml`);
console.log(`  Tokens:    dev-handler (claims handler), dev-approver (approver), dev-admin (roles and limits), dev-author and dev-publisher (rule sets), dev-catalog and dev-catalog-publisher (reference data and products), dev-registrar (animals), dev-clinic (clinic), dev-job (reassessment job), dev-customer (customer channel)`);
