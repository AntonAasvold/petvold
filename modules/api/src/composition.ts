/**
 * The composition root (granskningen A1): connects every module once, for both
 * the server in production (server.ts) and the dev server.
 *
 * Each module gets a Postgres store when its database URL is given, else one in
 * memory. In production every URL is required. The ports between modules are
 * connected here (ADR 0001), and so are the outboxes' relays (ADR 0008).
 * Nothing here seeds data or knows about tokens.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { CALCULATION_MODELS, ClaimsService, eventClaimId, type ClaimsOutbox, type ClaimsStore } from '@petvold/claims-core';
import { InMemoryClaimsStore } from '@petvold/claims-store-memory';
import { createPool, PostgresClaimsStore, PostgresIdempotencyStore } from '@petvold/claims-store-postgres';
import { AccessService, InMemoryRoleConfigStore, type RoleConfigStore } from '@petvold/access';
import { PostgresRoleConfigStore } from '@petvold/access/postgres';
import { DecisioningRulesPort, DecisioningService, InMemoryRuleSetStore, type RuleSetStore } from '@petvold/decisioning';
import { PostgresRuleSetStore } from '@petvold/decisioning/postgres';
import {
  CatalogService,
  InMemoryProductStore,
  InMemoryReferenceDataStore,
  ProductService,
  type ProductStore,
  type ReferenceDataStore,
} from '@petvold/catalog';
import { PostgresProductStore, PostgresReferenceDataStore } from '@petvold/catalog/postgres';
import { AnimalService, InMemoryAnimalStore, type AnimalStore } from '@petvold/animals';
import { PostgresAnimalStore } from '@petvold/animals/postgres';
import { InMemoryPartyStore, InMemoryRetentionStore, PartyService, RetentionService, type PartyStore } from '@petvold/parties';
import { PostgresPartyStore, PostgresRetentionStore } from '@petvold/parties/postgres';
import { InMemoryPolicyStore, PolicyService, type PolicyStore } from '@petvold/policies';
import { CommunicationsService, InMemoryNoticeSettingsStore, InMemoryNoticeStore, type NoticeStore } from '@petvold/communications';
import { PostgresNoticeSettingsStore, PostgresNoticeStore } from '@petvold/communications/postgres';
import { PostgresPolicyStore } from '@petvold/policies/postgres';
import { tariffCoverage } from '@petvold/pricing-core';
import { underwritingCoverage } from '@petvold/underwriting-core';
import { InMemoryIdempotencyStore, type AppDeps, type IdempotencyStore } from './app.ts';
import { assertRoleDefinitions, DEFAULT_ROLES, type RoleDefinitions } from './permissions.ts';
import { Relay, relaySource } from './relay.ts';
import { animalPort, claimsActivity, partySource, policySource, productPort } from './wiring.ts';

export const DATABASES = ['claims', 'access', 'decisioning', 'catalog', 'animals', 'parties', 'policies', 'communications'] as const;
export type DatabaseName = (typeof DATABASES)[number];

export interface InstallationConfig {
  /** Each module's database URL (its own service role). Missing: in memory. */
  databases: Partial<Record<DatabaseName, string>>;
  /** Stored with every decision (ADR 0018), e.g. the release version. */
  engineVersion: string;
  clock?: { now(): string };
  log?: (line: string) => void;
}

/** The environment variables a module's database URL is read from. */
export const DATABASE_ENV: Record<DatabaseName, string> = {
  claims: 'CLAIMS_DATABASE_URL',
  access: 'ACCESS_DATABASE_URL',
  decisioning: 'DECISIONING_DATABASE_URL',
  catalog: 'CATALOG_DATABASE_URL',
  animals: 'ANIMALS_DATABASE_URL',
  parties: 'PARTIES_DATABASE_URL',
  policies: 'POLICIES_DATABASE_URL',
  communications: 'COMMUNICATIONS_DATABASE_URL',
};

/** The database URLs from the environment, skipping empty ones. */
export function databasesFromEnv(env: Record<string, string | undefined>): Partial<Record<DatabaseName, string>> {
  return Object.fromEntries(DATABASES.flatMap((d) => (env[DATABASE_ENV[d]] ? [[d, env[DATABASE_ENV[d]]!]] : [])));
}

/** Everything a running Petvold needs, connected. */
export interface Installation {
  /** For createApp; add `auth`. */
  deps: Omit<AppDeps, 'auth'>;
  stores: {
    claims: ClaimsStore & ClaimsOutbox;
    roles: RoleConfigStore<RoleDefinitions>;
    rules: RuleSetStore;
    references: ReferenceDataStore;
    products: ProductStore;
    parties: PartyStore;
    animals: AnimalStore;
    policies: PolicyStore;
    notices: NoticeStore;
  };
  relay: Relay;
  /** Where each module keeps its data: 'postgres' or 'memory'. */
  storage: Record<DatabaseName, 'postgres' | 'memory'>;
  /** Checks that every database answers. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export async function compose(config: InstallationConfig): Promise<Installation> {
  const clock = config.clock ?? { now: () => new Date().toISOString() };
  const log = config.log ?? (() => {});
  const ids = { next: (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}` };
  const pools: pg.Pool[] = [];
  const pool = (name: DatabaseName, max: number) => {
    const url = config.databases[name];
    if (!url) return null;
    const p = createPool(url, { max });
    pools.push(p);
    return p;
  };

  const claimsPool = pool('claims', 5);
  const claimsStore: ClaimsStore & ClaimsOutbox = claimsPool ? new PostgresClaimsStore(claimsPool) : new InMemoryClaimsStore();
  const idempotency: IdempotencyStore = claimsPool ? new PostgresIdempotencyStore(claimsPool) : new InMemoryIdempotencyStore();

  const accessPool = pool('access', 2);
  const roleStore: RoleConfigStore<RoleDefinitions> = accessPool ? new PostgresRoleConfigStore<RoleDefinitions>(accessPool) : new InMemoryRoleConfigStore<RoleDefinitions>();
  const access = new AccessService<RoleDefinitions>({ store: roleStore, clock, validate: assertRoleDefinitions, defaults: DEFAULT_ROLES });

  const rulesPool = pool('decisioning', 2);
  const ruleStore: RuleSetStore = rulesPool ? new PostgresRuleSetStore(rulesPool) : new InMemoryRuleSetStore();
  const decisioning = new DecisioningService({ store: ruleStore, clock, calculationModels: Object.keys(CALCULATION_MODELS) });

  const catalogPool = pool('catalog', 2);
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
    priceTermsProblems: async (series, onDate, product) => {
      const t = await decisioning.priceTermsInForce(series, onDate);
      if (!t) return null;
      return t.content.market === product.market && t.content.currency === product.currency ? [] : [`The price terms are for ${t.content.market} in ${t.content.currency}`];
    },
    underwritingProblems: async (series, onDate, product) => {
      const u = await decisioning.underwritingInForce(series, onDate);
      return u ? underwritingCoverage(u.content, product) : null;
    },
  });

  const partiesPool = pool('parties', 3);
  const partyStore: PartyStore = partiesPool ? new PostgresPartyStore(partiesPool) : new InMemoryPartyStore();
  const parties = new PartyService({ store: partyStore, clock, ids });

  const animalsPool = pool('animals', 2);
  const animalStore: AnimalStore = animalsPool ? new PostgresAnimalStore(animalsPool) : new InMemoryAnimalStore();
  const animals = new AnimalService({ store: animalStore, references: referenceStore, parties, clock, ids });

  const policiesPool = pool('policies', 3);
  const policyStore: PolicyStore = policiesPool ? new PostgresPolicyStore(policiesPool) : new InMemoryPolicyStore();
  const policies = new PolicyService({
    store: policyStore,
    products: productPort(products),
    animals: animalPort(animals),
    parties,
    tariffs: decisioning,
    underwriting: decisioning,
    engineVersion: config.engineVersion,
    clock,
    ids,
  });

  // Notices to the customer (ADR 0032), made from the policy module's events below.
  const communicationsPool = pool('communications', 2);
  const noticeStore: NoticeStore = communicationsPool ? new PostgresNoticeStore(communicationsPool) : new InMemoryNoticeStore();
  const communications = new CommunicationsService({
    store: noticeStore,
    settings: communicationsPool ? new PostgresNoticeSettingsStore(communicationsPool) : new InMemoryNoticeSettingsStore(),
    policies: policySource(policies),
    parties: partySource(parties),
    clock,
    ids,
  });

  const service = new ClaimsService({
    policies,
    // The product version on the policy points at its rule series (ADR 0023).
    rules: new DecisioningRulesPort(decisioning, (pv) => products.ruleSeriesOf(pv)),
    store: claimsStore,
    clock,
    ids,
    engineVersion: config.engineVersion,
  });

  const retention = new RetentionService({
    parties,
    settings: partiesPool ? new PostgresRetentionStore(partiesPool) : new InMemoryRetentionStore(),
    sources: [
      { name: 'animals', activityOf: (id) => animals.activityOf(id) },
      { name: 'policies', activityOf: (id) => policies.activityOf(id) },
      claimsActivity(policies, service),
    ],
    clock,
  });

  // The outboxes' relays (ADR 0008). Claims events have no receiver inside
  // Petvold yet and are logged; the others drive the policy module and the claims engine.
  const relay = new Relay(
    [
      relaySource({
        name: 'claims',
        pending: async (limit) => (await claimsStore.pendingEvents(limit)).map((e) => ({ id: e.id, event: e.event })),
        deliver: async ({ event: e }) => log(`[event] ${e.type} ${e.type === 'claim.decided' ? `${e.decision.claimId}#${e.decision.seq}` : eventClaimId(e)}`),
        markPublished: (ids, at) => claimsStore.markPublished(ids, at),
      }),
      relaySource({
        name: 'animals',
        pending: (limit) => animalStore.pendingEvents(limit),
        deliver: async (e) => {
          const proposal = await policies.handleAnimalEvent(e);
          log(`[event] ${e.type} ${e.animalId}${proposal ? ` -> ${proposal.kind} proposal ${proposal.id}` : ''}`);
        },
        markPublished: (ids, at) => animalStore.markPublished(ids, at),
      }),
      relaySource({
        name: 'policies',
        pending: (limit) => policyStore.pendingEvents(limit),
        deliver: async (e) => {
          log(`[event] ${e.type} ${e.policyId ?? e.applicationId}`);
          const notice = await communications.handlePolicyEvent(e);
          if (notice) log(`[notice] ${notice.type} ${notice.id} due ${notice.dueBy}`);
          if (e.type !== 'policy.version_superseded') return;
          const versionId = String(e.data.versionId);
          for (const r of await service.reassessForPolicyChange([versionId], `Policy version ${versionId} was superseded`, 'policy-change')) {
            log(`[reassessed] ${r.claimId}: ${r.decision ? `${r.decision.outcome} ${r.decision.payout}` : 'no change'}`);
          }
        },
        markPublished: (ids, at) => policyStore.markPublished(ids, at),
      }),
    ],
    { clock, log },
  );

  return {
    deps: { service, clock, idempotency, access, decisioning, catalog, products, animals, parties, retention, policies, communications },
    stores: {
      claims: claimsStore,
      roles: roleStore,
      rules: ruleStore,
      references: referenceStore,
      products: productStore,
      parties: partyStore,
      animals: animalStore,
      policies: policyStore,
      notices: noticeStore,
    },
    relay,
    storage: Object.fromEntries(DATABASES.map((d) => [d, config.databases[d] ? 'postgres' : 'memory'])) as Record<DatabaseName, 'postgres' | 'memory'>,
    async ping() {
      await Promise.all(pools.map((p) => p.query('select 1')));
    },
    async close() {
      await relay.stop();
      await Promise.all(pools.map((p) => p.end()));
    },
  };
}
