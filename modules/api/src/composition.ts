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
import { lookup } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';
import { fetchTransport, InMemoryWebhookStore, SecretBox, WebhookService, WebhookWorker, type Transport, type WebhookStore } from '@petvold/webhooks';
import { PostgresWebhookStore } from '@petvold/webhooks/postgres';
import { InMemorySchedulingStore, Scheduler, type SchedulingStore } from '@petvold/scheduling';
import { PostgresSchedulingStore } from '@petvold/scheduling/postgres';
import { hostname } from 'node:os';
import { defaultJobs } from './jobs.ts';
import { PostgresPolicyStore } from '@petvold/policies/postgres';
import { tariffCoverage } from '@petvold/pricing-core';
import { underwritingCoverage } from '@petvold/underwriting-core';
import { InMemoryIdempotencyStore, type AppDeps, type IdempotencyStore } from './app.ts';
import { assertRoleDefinitions, DEFAULT_ROLES, type RoleDefinitions } from './permissions.ts';
import { Relay, relaySource } from './relay.ts';
import { DocumentService, InMemoryBlobStore, InMemoryDocumentStore, TEMPLATES, type BlobStore, type DocumentStore, type PdfRenderer } from '@petvold/documents';
import { GotenbergRenderer } from '@petvold/documents/gotenberg';
import { ensureNoticePdf } from './notice-pdf.ts';
import { PostgresDocumentStore } from '@petvold/documents/postgres';
import { S3BlobStore, s3ConfigFromEnv, type S3Config } from '@petvold/documents/s3';
import { BillingService, InMemoryBillingStore, type BillingStore } from '@petvold/billing';
import { PostgresBillingStore } from '@petvold/billing/postgres';
import { animalPort, billingProductSource, billingPolicySource, claimSource, claimsActivity, claimsEventForNotices, claimsEventForWebhooks, partySource, policySource, productPort } from './wiring.ts';

export const DATABASES = ['claims', 'access', 'decisioning', 'catalog', 'animals', 'parties', 'policies', 'communications', 'webhooks', 'scheduling', 'documents', 'billing'] as const;
export type DatabaseName = (typeof DATABASES)[number];

export interface InstallationConfig {
  /** Each module's database URL (its own service role). Missing: in memory. */
  databases: Partial<Record<DatabaseName, string>>;
  /** Stored with every decision (ADR 0018), e.g. the release version. */
  engineVersion: string;
  clock?: { now(): string };
  log?: (line: string) => void;
  /** Webhooks (ADR 0033). The key is required when webhooks are stored in Postgres. */
  webhooks?: {
    /** 32 bytes, base64: seals the subscriptions' secrets (PETVOLD_WEBHOOK_KEY). */
    key?: string;
    /** Hosts a subscription may name although local or http, e.g. a receiver in development (PETVOLD_WEBHOOK_ALLOW_HOSTS). */
    allowHosts?: string[];
    /** How deliveries are sent. Defaults to HTTP with fetch. */
    transport?: Transport;
  };
  /**
   * Documents (ADR 0038). The key is required when documents are stored in
   * Postgres. Without s3 the files are kept in memory.
   */
  documents?: {
    /** At least 32 bytes, base64: signs the links (PETVOLD_DOCUMENT_KEY). */
    key?: string;
    /** Where links are opened (PETVOLD_PUBLIC_URL). Default http://localhost:8787. */
    publicBaseUrl?: string;
    /** The archive (PETVOLD_DOCUMENTS_BUCKET and the rest). */
    s3?: S3Config | null;
    /** Gotenberg, which makes PDFs from the templates (PETVOLD_GOTENBERG_URL). Omitted: no PDFs. */
    gotenbergUrl?: string;
    /** A renderer instead of Gotenberg, e.g. in tests. */
    renderer?: PdfRenderer;
  };
  /** The claim number's prefix per market, e.g. { SE: 'S', NO: 'N' } (PETVOLD_CLAIM_NUMBER_PREFIX). 'S' when a market has none. */
  claimNumberPrefix?: Record<string, string>;
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
  webhooks: 'WEBHOOKS_DATABASE_URL',
  scheduling: 'SCHEDULING_DATABASE_URL',
  documents: 'DOCUMENTS_DATABASE_URL',
  billing: 'BILLING_DATABASE_URL',
};

/** The database URLs from the environment, skipping empty ones. */
export function databasesFromEnv(env: Record<string, string | undefined>): Partial<Record<DatabaseName, string>> {
  return Object.fromEntries(DATABASES.flatMap((d) => (env[DATABASE_ENV[d]] ? [[d, env[DATABASE_ENV[d]]!]] : [])));
}

/** Document settings from PETVOLD_DOCUMENT_KEY, PETVOLD_PUBLIC_URL and the archive's variables (ADR 0038). */
export function documentsFromEnv(env: Record<string, string | undefined>): NonNullable<InstallationConfig['documents']> {
  return {
    ...(env.PETVOLD_DOCUMENT_KEY ? { key: env.PETVOLD_DOCUMENT_KEY } : {}),
    ...(env.PETVOLD_PUBLIC_URL ? { publicBaseUrl: env.PETVOLD_PUBLIC_URL } : {}),
    ...(env.PETVOLD_GOTENBERG_URL ? { gotenbergUrl: env.PETVOLD_GOTENBERG_URL } : {}),
    s3: s3ConfigFromEnv(env),
  };
}

/** Webhook settings from PETVOLD_WEBHOOK_KEY and PETVOLD_WEBHOOK_ALLOW_HOSTS (comma-separated). */
export function webhooksFromEnv(env: Record<string, string | undefined>): { key?: string; allowHosts: string[] } {
  return {
    ...(env.PETVOLD_WEBHOOK_KEY ? { key: env.PETVOLD_WEBHOOK_KEY } : {}),
    allowHosts: (env.PETVOLD_WEBHOOK_ALLOW_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
  };
}

/**
 * The claim number's prefix per market from PETVOLD_CLAIM_NUMBER_PREFIX, e.g.
 * "SE=S,NO=N" (ADR 0036). A prefix is letters and digits, so a number stays
 * readable and safe in a URL; anything else stops the start.
 */
export function claimNumberPrefixFromEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (env.PETVOLD_CLAIM_NUMBER_PREFIX ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^([A-Z]{2})=([A-Z0-9]{1,8})$/.exec(part);
    if (!m) throw new Error(`PETVOLD_CLAIM_NUMBER_PREFIX: '${part}' is not MARKET=PREFIX, e.g. SE=S`);
    out[m[1]!] = m[2]!;
  }
  return out;
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
    webhooks: WebhookStore;
    scheduling: SchedulingStore;
    documents: DocumentStore;
    billing: BillingStore;
  };
  relay: Relay;
  /** Runs the daily jobs when they are due (ADR 0037). Start it next to the relay. */
  scheduler: Scheduler;
  /** Sends queued webhook deliveries (ADR 0033). Start it next to the relay. */
  webhookWorker: WebhookWorker;
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

  // Petvold's PDFs (ADR 0038): Gotenberg, or a renderer the tests give.
  const gotenberg = config.documents?.gotenbergUrl ? new GotenbergRenderer(config.documents.gotenbergUrl) : null;
  const renderer = config.documents?.renderer ?? gotenberg;

  // Notices to the customer (ADR 0032), made from the policy module's events below.
  const communicationsPool = pool('communications', 2);
  const noticeStore: NoticeStore = communicationsPool ? new PostgresNoticeStore(communicationsPool) : new InMemoryNoticeStore();
  const communications = new CommunicationsService({
    store: noticeStore,
    settings: communicationsPool ? new PostgresNoticeSettingsStore(communicationsPool) : new InMemoryNoticeSettingsStore(),
    policies: policySource(policies),
    parties: partySource(parties),
    // The claims engine is made below; the port reads it when an event comes.
    claims: { decision: (id, seq) => claimSource(service).decision(id, seq), informationRequest: (id, r) => claimSource(service).informationRequest(id, r) },
    // With a renderer, a market may have Petvold make the notices it has templates for (ADR 0038).
    ...(renderer ? { petvoldTemplates: (type: string, market: string) => TEMPLATES.some((t) => t.name === type && t.market === market) } : {}),
    clock,
    ids,
  });

  // Webhooks to the insurer's systems (ADR 0033), fed by the relay below.
  const webhooksPool = pool('webhooks', 2);
  const webhookKey = config.webhooks?.key;
  if (webhooksPool && !webhookKey) throw new Error('PETVOLD_WEBHOOK_KEY is required when webhooks are stored in Postgres');
  const webhookStore: WebhookStore = webhooksPool ? new PostgresWebhookStore(webhooksPool) : new InMemoryWebhookStore();
  const allowHosts = config.webhooks?.allowHosts ?? [];
  const webhooks = new WebhookService({
    store: webhookStore,
    // In memory without a key: a key for this process only, since nothing outlives it.
    box: new SecretBox(webhookKey ?? randomBytes(32).toString('base64')),
    clock,
    ids,
    allowHosts,
  });
  const webhookWorker = new WebhookWorker({
    service: webhooks,
    store: webhookStore,
    transport: config.webhooks?.transport ?? fetchTransport({ allowHosts, resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address) }),
    clock,
    log,
  });
  /** The market of a policy event, for the subscriptions' markets. */
  const marketOf = async (e: { policyId?: string; applicationId?: string; data: Record<string, unknown> }): Promise<string> => {
    if (typeof e.data.market === 'string') return e.data.market;
    if (e.policyId) return (await policies.get(e.policyId)).market;
    return (await policies.getApplication(e.applicationId!)).market;
  };

  const service = new ClaimsService({
    policies,
    // The product version on the policy points at its rule series (ADR 0023).
    rules: new DecisioningRulesPort(decisioning, (pv) => products.ruleSeriesOf(pv)),
    store: claimsStore,
    clock,
    ids,
    engineVersion: config.engineVersion,
    ...(config.claimNumberPrefix ? { claimNumberPrefix: config.claimNumberPrefix } : {}),
  });

  // Billing (ADR 0040): payer accounts and premium plans from the policy events below.
  const billingPool = pool('billing', 2);
  const billingStore: BillingStore = billingPool ? new PostgresBillingStore(billingPool) : new InMemoryBillingStore();
  const billing = new BillingService({ store: billingStore, products: billingProductSource(products), policies: billingPolicySource(policies), clock, ids });

  const retention = new RetentionService({
    parties,
    settings: partiesPool ? new PostgresRetentionStore(partiesPool) : new InMemoryRetentionStore(),
    sources: [
      { name: 'animals', activityOf: (id) => animals.activityOf(id) },
      { name: 'policies', activityOf: (id) => policies.activityOf(id) },
      claimsActivity(policies, service),
      { name: 'billing', activityOf: (id) => billing.activityOf(id) },
    ],
    clock,
  });

  // Runs (ADR 0037): the jobs run per market, one server at a time. The
  // installation's markets are those with a product or a retention rule.
  const schedulingPool = pool('scheduling', 2);
  const schedulingStore: SchedulingStore = schedulingPool ? new PostgresSchedulingStore(schedulingPool) : new InMemorySchedulingStore();
  const scheduler = new Scheduler({
    store: schedulingStore,
    clock,
    jobs: defaultJobs({ policies, retention, claims: service, billing }),
    markets: async () => {
      const fromProducts = (await products.allProducts()).flatMap((p) => p.versions.map((v) => v.content.market));
      const fromRetention = Object.keys((await retention.current()).markets);
      return [...new Set([...fromProducts, ...fromRetention])].sort();
    },
    holder: `${hostname()}:${process.pid}`,
    log,
    // job.failed to webhooks, so the insurer's operations can alert (ADR 0037).
    onFailed: async (run) => {
      await webhooks.enqueue({ id: run.id, type: 'job.failed', runId: run.id, market: run.market, occurredAt: run.finishedAt ?? run.startedAt, data: { job: run.job, trigger: run.trigger, startedAt: run.startedAt } });
    },
  });

  // The outboxes' relays (ADR 0008). Claims events give notices to the customer
  // (ADR 0036); the others drive the policy module, the notices and the claims engine.
  const relay = new Relay(
    [
      relaySource({
        name: 'claims',
        pending: async (limit) => (await claimsStore.pendingEvents(limit)).map((e) => ({ id: e.id, event: e.event })),
        deliver: async (entry) => {
          const e = entry.event;
          log(`[event] ${e.type} ${e.type === 'claim.decided' ? `${e.decision.claimId}#${e.decision.seq}` : eventClaimId(e)}`);
          const forNotices = claimsEventForNotices(entry);
          const notice = forNotices ? await communications.handleClaimEvent(forNotices) : null;
          if (notice) log(`[notice] ${notice.type} ${notice.id} due ${notice.dueBy}`);
          const queued = await webhooks.enqueue(await claimsEventForWebhooks(entry, (claimId) => service.getClaim(claimId)));
          if (queued) log(`[webhook] ${e.type} ${entry.id} queued for ${queued} subscription(s)`);
        },
        markPublished: (ids, at) => claimsStore.markPublished(ids, at),
      }),
      relaySource({
        name: 'animals',
        pending: (limit) => animalStore.pendingEvents(limit),
        deliver: async (e) => {
          const proposal = await policies.handleAnimalEvent(e);
          log(`[event] ${e.type} ${e.animalId}${proposal ? ` -> ${proposal.kind} proposal ${proposal.id}` : ''}`);
          await webhooks.enqueue({ ...e, market: String(e.data.market) });
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
          const plan = await billing.handlePolicyEvent(e);
          if (plan) log(`[billing] ${plan.policyId} term ${plan.termNo}: ${plan.plan.interval}, ${plan.plan.installments.length} installment(s)`);
          if (e.type !== 'policy.version_superseded') {
            const queued = await webhooks.enqueue({ ...e, market: await marketOf(e) });
            if (queued) log(`[webhook] ${e.type} ${e.id} queued for ${queued} subscription(s)`);
          }
          if (e.type !== 'policy.version_superseded') return;
          const versionId = String(e.data.versionId);
          for (const r of await service.reassessForPolicyChange([versionId], `Policy version ${versionId} was superseded`, 'policy-change')) {
            log(`[reassessed] ${r.claimId}: ${r.decision ? `${r.decision.outcome} ${r.decision.payout}` : 'no change'}`);
          }
        },
        markPublished: (ids, at) => policyStore.markPublished(ids, at),
      }),
      relaySource({
        name: 'billing',
        pending: (limit) => billingStore.pendingEvents(limit),
        deliver: async (e) => {
          log(`[event] ${e.type} ${e.invoiceId}`);
          const queued = await webhooks.enqueue({ ...e });
          if (queued) log(`[webhook] ${e.type} ${e.invoiceId} queued for ${queued} subscription(s)`);
        },
        markPublished: (ids, at) => billingStore.markPublished(ids, at),
      }),
      relaySource({
        name: 'communications',
        pending: (limit) => noticeStore.pendingEvents(limit),
        deliver: async (e) => {
          const queued = await webhooks.enqueue({ ...e });
          if (queued) log(`[webhook] ${e.type} ${e.noticeId} queued for ${queued} subscription(s)`);
          // Petvold makes the notice's PDF (ADR 0038). A failure, e.g. Gotenberg down, is tried again; the webhook is not queued twice.
          if (e.type === 'notice.created' && e.data.documentMaker === 'petvold') {
            const doc = await ensureNoticePdf({ documents, communications, parties, animals, clock }, e.noticeId);
            if (doc) log(`[document] ${e.noticeId} -> ${doc.id}`);
          }
        },
        markPublished: (ids, at) => noticeStore.markPublished(ids, at),
      }),
    ],
    // One server at a time is the relay, and dead letters outlive a restart (ADR 0037).
    { clock, log, state: schedulingStore, holder: `${hostname()}:${process.pid}` },
  );

  // Documents (ADR 0038): the records in their own schema, the files in the archive.
  const documentsPool = pool('documents', 2);
  const documentStore: DocumentStore = documentsPool ? new PostgresDocumentStore(documentsPool) : new InMemoryDocumentStore();
  const s3 = config.documents?.s3 ? new S3BlobStore(config.documents.s3) : null;
  const blobs: BlobStore = s3 ?? new InMemoryBlobStore();
  const documentKey = config.documents?.key ? Buffer.from(config.documents.key, 'base64') : null;
  if (documentsPool && (!documentKey || documentKey.length < 32)) throw new Error('PETVOLD_DOCUMENT_KEY must be at least 32 bytes in base64 when documents are stored in Postgres');
  const documents = new DocumentService({
    ...(renderer ? { renderer } : {}),
    store: documentStore,
    blobs,
    clock,
    ids,
    signingKey: documentKey ?? randomBytes(32),
    publicBaseUrl: config.documents?.publicBaseUrl ?? 'http://localhost:8787',
  });

  return {
    deps: { service, clock, idempotency, access, decisioning, catalog, products, animals, parties, retention, policies, communications, webhooks, scheduler, relay, documents, billing },
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
      webhooks: webhookStore,
      scheduling: schedulingStore,
      documents: documentStore,
      billing: billingStore,
    },
    relay,
    scheduler,
    webhookWorker,
    storage: Object.fromEntries(DATABASES.map((d) => [d, config.databases[d] ? 'postgres' : 'memory'])) as Record<DatabaseName, 'postgres' | 'memory'>,
    async ping() {
      await Promise.all([...pools.map((p) => p.query('select 1')), s3?.ping(), gotenberg?.ping()]);
    },
    async close() {
      await scheduler.stop();
      await relay.stop();
      await webhookWorker.stop();
      await Promise.all(pools.map((p) => p.end()));
      s3?.destroy();
    },
  };
}
