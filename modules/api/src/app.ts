import { Hono, type Context } from 'hono';
import { AccessError, AccessService, InMemoryRoleConfigStore } from '@petvold/access';
import { DecisioningService, InMemoryRuleSetStore, RuleSetError, toClaimsRules } from '@petvold/decisioning';
import { AnimalError, AnimalService, IDENTIFIER_TYPES, InMemoryAnimalStore, type AnimalRecord, type IdentifierType } from '@petvold/animals';
import {
  InMemoryPartyStore,
  InMemoryRetentionStore,
  PartyError,
  PartyService,
  RetentionService,
  publicView,
  type ErasureRequest,
  type PartyRecord,
} from '@petvold/parties';
import { InMemoryPolicyStore, PolicyError, PolicyService, type PolicyGroup, type PolicyRecord, type Proposal } from '@petvold/policies';
import { animalPort, claimsActivity, productPort } from './wiring.ts';
import {
  CatalogError,
  CatalogService,
  InMemoryProductStore,
  InMemoryReferenceDataStore,
  labelFor,
  ProductService,
  productVersionId,
  vetCareTermsFor,
  type ProductVersion,
  type ReferenceItem,
} from '@petvold/catalog';
import { CALCULATION_MODELS, simulate } from '@petvold/claims-core';
import type { Claim, ClaimsService, Clock } from '@petvold/claims-core';
import { DomainError } from '@petvold/claims-core';
import { formatErrors, openapiText, operationPermissions, validatorFor, type FieldError } from './contract.ts';
import { routePath } from 'hono/route';
import {
  amountLimitsOf,
  assertRoleDefinitions,
  coversClaim,
  coversPolicy,
  DEFAULT_ROLES,
  isPermission,
  permissionsOf,
  scopeOf,
  type RoleDefinitions,
  type Scope,
  type ScopeAttributes,
} from './permissions.ts';
import { localizeDeep, localizeExplanation, pickLocale } from './messages.ts';

/**
 * Who is calling. Comes from a JWT in production (e.g. the insurer's identity
 * provider, or OAuth for clinics). The scope attributes (markets, clinicId,
 * policyIds) limit which claims the caller may see (ADR 0016).
 */
export interface Principal extends ScopeAttributes {
  subject: string;
  /** Role names from the token. Mapped to permissions with the installation's `roles`. */
  roles: string[];
}

export interface Authenticator {
  authenticate(bearerToken: string | undefined): Promise<Principal | null>;
}

/** Stores responses per idempotency key. A Postgres table in production. */
export interface IdempotencyStore {
  get(key: string): Promise<{ fingerprint: string; status: number; body: unknown } | null>;
  put(key: string, value: { fingerprint: string; status: number; body: unknown }): Promise<void>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private m = new Map<string, { fingerprint: string; status: number; body: unknown }>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async put(k: string, v: { fingerprint: string; status: number; body: unknown }) {
    this.m.set(k, v);
  }
}

export interface AppDeps {
  service: ClaimsService;
  auth: Authenticator;
  idempotency: IdempotencyStore;
  clock: Clock;
  /**
   * The role settings, versioned and changeable through the API (ADR 0020).
   * Omitted: kept in memory, starting from `roles`.
   */
  access?: AccessService<RoleDefinitions>;
  /** Rule sets (ADR 0021). Omitted: kept in memory. Give the same instance to the claims engine's RulesPort. */
  decisioning?: DecisioningService;
  /** The product catalog, for now its reference data (ADR 0022). Omitted: kept in memory. */
  catalog?: CatalogService;
  /**
   * Products and product versions (ADR 0023). Omitted: kept in memory, checking
   * species against `catalog` and rule series against `decisioning`.
   * Give the same instance to the claims engine's RulesPort.
   */
  products?: ProductService;
  /** The animal register (ADR 0024). Omitted: kept in memory, with reference data from `catalog`. */
  animals?: AnimalService;
  /** Parties: persons and organizations (ADR 0026). Omitted: kept in memory. */
  parties?: PartyService;
  /**
   * Retention settings and runs (ADR 0028). Omitted: settings in memory, with the
   * animal register as the only source of activity.
   */
  retention?: RetentionService;
  /**
   * Policies (ADR 0029). Omitted: kept in memory, with products, animals and
   * parties from the services above. Give the same instance to the claims
   * engine as its PolicyPort.
   */
  policies?: PolicyService;
  /** Version 1 of the role settings when `access` is omitted (ADR 0016). Defaults to DEFAULT_ROLES. */
  roles?: RoleDefinitions;
}

type Env = { Variables: { principal: Principal; scope: Scope; roles: RoleDefinitions } };

const PROBLEM = 'application/problem+json';

function problem(c: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 500, title: string, detail?: string, errors?: FieldError[]) {
  return c.body(
    JSON.stringify({ type: `https://errors.petvold.dev/${status}`, title, status, ...(detail ? { detail } : {}), ...(errors ? { errors } : {}) }),
    status,
    { 'content-type': PROBLEM },
  );
}

async function readJson(c: Context, schema: string): Promise<{ ok: true; body: any } | { ok: false; res: Response }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, res: problem(c, 422, 'Invalid JSON') };
  }
  const v = validatorFor(schema);
  if (!v(body)) return { ok: false, res: problem(c, 422, 'The request does not follow the contract', undefined, formatErrors(v.errors)) };
  return { ok: true, body };
}

/** JSON response with rule texts in the language the caller asked for. */
function send(c: Context, body: unknown, status = 200) {
  const locale = pickLocale(c.req.header('accept-language'));
  return c.body(JSON.stringify(localizeDeep(body, locale)), status as 200, {
    'content-type': 'application/json',
    'content-language': locale,
    vary: 'Accept-Language',
  });
}

/**
 * The HTTP layer. Thin on purpose: validate against the contract, authenticate,
 * handle idempotency, call the service and translate domain errors to problem+json.
 */
export function createApp(d: AppDeps) {
  assertRoleDefinitions(d.roles ?? DEFAULT_ROLES);
  const access =
    d.access ??
    new AccessService<RoleDefinitions>({
      store: new InMemoryRoleConfigStore(),
      clock: d.clock,
      validate: assertRoleDefinitions,
      defaults: d.roles ?? DEFAULT_ROLES,
    });
  const contractPermissions = operationPermissions();
  const app = new Hono<Env>();

  app.get('/openapi.yaml', (c) => c.body(openapiText, 200, { 'content-type': 'application/yaml' }));
  app.get('/health', (c) => c.json({ ok: true }));

  app.use('/v1/*', async (c, next) => {
    const header = c.req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const principal = await d.auth.authenticate(token);
    if (!principal) return problem(c, 401, 'Not authenticated');
    c.set('principal', principal);

    // The permission comes from the contract for the matched operation (ADR 0016).
    // No matched operation: fall through to 404.
    const route = routePath(c, -1);
    if (route !== '/v1/*') {
      // The settings in force now: a change through the API applies at once (ADR 0020).
      const roles = (await access.current()).roles;
      c.set('roles', roles);
      const permission = contractPermissions.get(operationKey(c.req.method, route));
      if (!isPermission(permission) || !permissionsOf(principal.roles, roles).has(permission)) {
        return problem(c, 403, 'Not permitted', isPermission(permission) ? `Requires the permission ${permission}` : undefined);
      }
      const scope = scopeOf(principal.roles, principal, roles);
      if ('error' in scope) return problem(c, 403, 'Not permitted', scope.error);
      c.set('scope', scope);
    }
    await next();
  });

  // A claim outside the caller's scope answers exactly like a claim that does
  // not exist, so its existence is not revealed (ADR 0016, OWASP API1).
  app.use('/v1/claims/:claimId/*', async (c, next) => {
    const scope = c.get('scope');
    if (scope) {
      const id = c.req.param('claimId');
      const claim = await d.service.getClaim(id).catch((e: unknown) => {
        if (e instanceof DomainError && e.code === 'not_found') return null;
        throw e;
      });
      if (claim && !coversClaim(scope, claim)) return problem(c, 404, `Claim ${id} does not exist`);
    }
    await next();
  });

  /** Runs a creating operation exactly once per Idempotency-Key. */
  async function idempotent(c: Context<Env>, body: unknown, run: () => Promise<{ status: number; body: unknown }>) {
    const key = c.req.header('idempotency-key');
    if (!key || key.length < 8 || key.length > 128) {
      return problem(c, 422, 'Idempotency-Key is missing or has the wrong length (8–128 characters)');
    }
    const scoped = `${c.get('principal').subject}:${c.req.method}:${c.req.path}:${key}`;
    const fingerprint = JSON.stringify(body);
    const prior = await d.idempotency.get(scoped);
    if (prior) {
      if (prior.fingerprint !== fingerprint) return problem(c, 422, 'Idempotency-Key reused with a different request');
      return prior.status === 204 ? c.body(null, 204) : send(c, prior.body, prior.status);
    }
    const result = await run();
    await d.idempotency.put(scoped, { fingerprint, ...result });
    return result.status === 204 ? c.body(null, 204) : send(c, result.body, result.status);
  }

  app.post('/v1/claims', async (c) => {
    const r = await readJson(c, 'ClaimInput');
    if (!r.ok) return r.res;
    const scope = c.get('scope');
    if (!coversPolicy(scope, r.body.market, r.body.policyId)) return problem(c, 403, 'Not permitted', 'The claim is outside the caller\'s scope');
    return idempotent(c, r.body, async () => {
      const claim: Claim = { ...r.body, ...(scope.clinicId ? { clinicId: scope.clinicId } : {}), receivedAt: d.clock.now() };
      const result = await d.service.registerClaim(claim);
      return { status: 201, body: result };
    });
  });

  app.get('/v1/claims/:claimId', async (c) => send(c, await d.service.getClaim(c.req.param('claimId'))));

  app.get('/v1/claims/:claimId/assessment', async (c) => {
    const knownAt = c.req.query('knownAt');
    if (knownAt !== undefined && Number.isNaN(Date.parse(knownAt))) return problem(c, 422, 'knownAt is not a valid point in time');
    return send(c, await d.service.assessClaim(c.req.param('claimId'), knownAt));
  });

  app.get('/v1/claims/:claimId/decisions', async (c) => send(c, { items: await d.service.getDecisions(c.req.param('claimId')) }));

  app.post('/v1/claims/:claimId/decisions', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'DecideRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => {
      const mayOverride = permissionsOf(p.roles, c.get('roles')).has('claims:override');
      const decisionLimits = amountLimitsOf(p.roles, c.get('roles'), 'decide');
      const result = await d.service.decide(c.req.param('claimId'), { ...r.body, decidedBy: p.subject, mayOverride, decisionLimits });
      // 201: decided. 202: above the handler's limit, proposed for approval (ADR 0019).
      return result.decision ? { status: 201, body: result.decision } : { status: 202, body: result.proposal };
    });
  });

  app.get('/v1/claims/:claimId/proposals', async (c) => send(c, { items: await d.service.getProposals(c.req.param('claimId')) }));

  app.post('/v1/claims/:claimId/proposals/:proposalId/approvals', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'ApproveRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => {
      const approvalLimits = amountLimitsOf(p.roles, c.get('roles'), 'approve');
      const decision = await d.service.approveProposal(c.req.param('claimId'), c.req.param('proposalId'), { approvedBy: p.subject, approvalLimits });
      return { status: 201, body: decision };
    });
  });

  app.post('/v1/claims/:claimId/proposals/:proposalId/returns', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'ReturnProposalRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => {
      const proposal = await d.service.returnProposal(c.req.param('claimId'), c.req.param('proposalId'), { returnedBy: p.subject, reason: r.body.reason });
      return { status: 200, body: proposal };
    });
  });

  app.post('/v1/claims/:claimId/decisions/:seq/replays', async (c) => {
    const seq = parseSeq(c.req.param('seq'));
    if (!seq) return problem(c, 422, 'seq must be a positive integer');
    return send(c, await d.service.replayDecision(c.req.param('claimId'), seq));
  });

  app.get('/v1/claims/:claimId/decisions/:seq/explanation', async (c) => {
    const seq = parseSeq(c.req.param('seq'));
    if (!seq) return problem(c, 422, 'seq must be a positive integer');
    const explanation = await d.service.explainDecision(c.req.param('claimId'), seq);
    const locale = pickLocale(c.req.header('accept-language'));
    return send(c, localizeExplanation(explanation, locale));
  });

  app.post('/v1/claims/:claimId/decisions/:seq/review-requests', async (c) => {
    const p = c.get('principal');
    const seq = parseSeq(c.req.param('seq'));
    if (!seq) return problem(c, 422, 'seq must be a positive integer');
    const r = await readJson(c, 'ReviewRequestInput');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => {
      const request = await d.service.requestReview(c.req.param('claimId'), seq, { ...r.body, requestedBy: p.subject });
      return { status: 201, body: request };
    });
  });

  app.get('/v1/claims/:claimId/review-requests', async (c) => send(c, { items: await d.service.getReviewRequests(c.req.param('claimId')) }));

  app.post('/v1/claims/:claimId/reassessments', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'ReassessRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => {
      const decision = await d.service.reassess(c.req.param('claimId'), p.subject, r.body.reason);
      return decision ? { status: 201, body: decision } : { status: 204, body: null };
    });
  });

  app.post('/v1/claim-previews', async (c) => {
    const r = await readJson(c, 'ClaimInput');
    if (!r.ok) return r.res;
    const scope = c.get('scope');
    if (!coversPolicy(scope, r.body.market, r.body.policyId)) return problem(c, 403, 'Not permitted', 'The claim is outside the caller\'s scope');
    const draft: Claim = { ...r.body, ...(scope.clinicId ? { clinicId: scope.clinicId } : {}), receivedAt: d.clock.now() };
    return send(c, await d.service.preview(draft));
  });

  app.get('/v1/policies/:policyId/animals/:animalId/limits', async (c) => {
    const onDate = c.req.query('onDate');
    if (!onDate) return problem(c, 422, 'onDate is required');
    // A clinic is not tied to policies, so it cannot look up limits by policy id.
    const scope = c.get('scope');
    const notFound = () => problem(c, 404, 'No vet care cover in force for the animal on that date');
    if (scope.clinicId || (scope.policyIds && !scope.policyIds.has(c.req.param('policyId')))) return notFound();
    const limits = await d.service.getLimits(c.req.param('policyId'), c.req.param('animalId'), onDate);
    if (!coversPolicy(scope, limits.market, limits.policyId)) return notFound();
    return send(c, limits);
  });

  const decisioning =
    d.decisioning ?? new DecisioningService({ store: new InMemoryRuleSetStore(), clock: d.clock, calculationModels: Object.keys(CALCULATION_MODELS) });
  const ruleSet = '/v1/rule-sets/:series/versions/:version';
  const version = (c: Context) => parseSeq(c.req.param('version') ?? '');

  app.get('/v1/rule-sets/:series/versions', async (c) => send(c, { items: await decisioning.list(c.req.param('series')) }));

  app.post('/v1/rule-sets/:series/versions', async (c) => {
    const r = await readJson(c, 'RuleSetDraft');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({
      status: 201,
      body: await decisioning.createDraft(c.req.param('series'), r.body, c.get('principal').subject),
    }));
  });

  app.get(ruleSet, async (c) => {
    const v = version(c);
    if (!v) return problem(c, 422, 'version must be a positive integer');
    return send(c, await decisioning.get(c.req.param('series'), v));
  });

  app.put(ruleSet, async (c) => {
    const v = version(c);
    if (!v) return problem(c, 422, 'version must be a positive integer');
    const r = await readJson(c, 'RuleSetDraft');
    if (!r.ok) return r.res;
    return send(c, await decisioning.updateDraft(c.req.param('series'), v, r.body));
  });

  /** A lifecycle step: POST with an Idempotency-Key and a body following `schema`. */
  const step = (path: string, schema: string, run: (series: string, v: number, by: string, body: any) => Promise<unknown>) =>
    app.post(`${ruleSet}/${path}`, async (c) => {
      const v = version(c);
      if (!v) return problem(c, 422, 'version must be a positive integer');
      const r = await readJson(c, schema);
      if (!r.ok) return r.res;
      return idempotent(c, r.body, async () => ({ status: 200, body: await run(c.req.param('series'), v, c.get('principal').subject, r.body) }));
    });
  // Simulation (ADR 0018): the version's rules against stored decisions from the
  // same series, within the caller's scope. Nothing is stored.
  app.post(`${ruleSet}/simulations`, async (c) => {
    const v = version(c);
    if (!v) return problem(c, 422, 'version must be a positive integer');
    const r = await readJson(c, 'SimulationRequest');
    if (!r.ok) return r.res;
    const series = c.req.param('series');
    const target = await decisioning.get(series, v);
    const scope = c.get('scope');
    const stored = (await d.service.decisionsForSimulation(r.body.from, r.body.to)).filter(
      (x) => x.evidence.input.rules.rulesVersion.startsWith(`${series}@`) && coversClaim(scope, x.evidence.input.claim),
    );
    return send(c, simulate(stored, toClaimsRules(target), target.calculationModel));
  });

  step('submissions', 'EmptyRequest', (s, v, by) => decisioning.submit(s, v, by));
  step('returns', 'ReasonRequest', (s, v, _by, b) => decisioning.returnToDraft(s, v, b.reason));
  step('publications', 'EmptyRequest', (s, v, by) => decisioning.publish(s, v, by));
  step('retirements', 'ReasonRequest', (s, v, by, b) => decisioning.retire(s, v, by, b.reason));

  // Reference data (ADR 0022). `label` is resolved from Accept-Language; `labels` has every language.
  const catalog = d.catalog ?? new CatalogService({ references: new InMemoryReferenceDataStore(), clock: d.clock });
  const withLabel = (c: Context, i: ReferenceItem) => ({ ...i, label: labelFor(i.labels, c.req.header('accept-language')) });
  const reference = '/v1/reference-data/:kind/:code';

  app.get('/v1/reference-data/:kind', async (c) => {
    const active = c.req.query('active');
    if (active !== undefined && active !== 'true' && active !== 'false') return problem(c, 422, 'active must be true or false');
    const parent = c.req.query('parent');
    const items = await catalog.listReferences(c.req.param('kind'), {
      ...(parent !== undefined ? { parent } : {}),
      ...(active !== undefined ? { active: active === 'true' } : {}),
    });
    return send(c, { items: items.map((i) => withLabel(c, i)) });
  });

  app.get(reference, async (c) => send(c, withLabel(c, await catalog.getReference(c.req.param('kind'), c.req.param('code')))));

  app.get(`${reference}/revisions`, async (c) => {
    const items = await catalog.referenceHistory(c.req.param('kind'), c.req.param('code'));
    return send(c, { items: items.map((i) => withLabel(c, i)) });
  });

  app.put(reference, async (c) => {
    const r = await readJson(c, 'ReferenceItemChange');
    if (!r.ok) return r.res;
    const { item, created } = await catalog.putReference(c.req.param('kind'), c.req.param('code'), r.body, c.get('principal').subject);
    return send(c, withLabel(c, item), created ? 201 : 200);
  });

  // Products (ADR 0023). The catalog checks species itself and asks decisioning
  // through the service, never its tables (ADR 0001).
  const products =
    d.products ??
    new ProductService({
      products: new InMemoryProductStore(),
      clock: d.clock,
      speciesActive: async (code) => (await catalog.listReferences('species', { active: true })).some((i) => i.code === code),
      ruleSeriesInForce: async (series, onDate) => (await decisioning.rulesInForce(series, onDate)) !== null,
    });
  const withName = (c: Context, v: ProductVersion) => ({
    ...v,
    id: productVersionId(v),
    name: labelFor(v.content.names, c.req.header('accept-language')),
  });
  const productVersion = '/v1/products/:product/versions/:version';
  const pathOf = (c: Context) => [c.req.param('product') ?? '', c.req.param('version') ?? ''] as const;

  app.get('/v1/products/on-sale', async (c) => {
    const date = c.req.query('date');
    if (!date) return problem(c, 422, 'date is required');
    const market = c.req.query('market');
    const species = c.req.query('species');
    const items = await products.onSale(date, { ...(market ? { market } : {}), ...(species ? { species } : {}) });
    return send(c, { items: items.map((v) => withName(c, v)) });
  });

  app.get('/v1/products/:product/versions', async (c) => send(c, { items: (await products.list(c.req.param('product'))).map((v) => withName(c, v)) }));

  app.post('/v1/products/:product/versions', async (c) => {
    const r = await readJson(c, 'ProductDraft');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({
      status: 201,
      body: withName(c, await products.createDraft(c.req.param('product'), r.body, c.get('principal').subject)),
    }));
  });

  app.get(productVersion, async (c) => send(c, withName(c, await products.get(...pathOf(c)))));

  app.put(productVersion, async (c) => {
    const r = await readJson(c, 'ProductDraftUpdate');
    if (!r.ok) return r.res;
    return send(c, withName(c, await products.updateDraft(...pathOf(c), r.body)));
  });

  app.get(`${productVersion}/vet-care-terms`, async (c) => {
    const raw = c.req.query('annualLimit');
    const annualLimit = raw === undefined ? undefined : Number(raw);
    if (annualLimit !== undefined && (!Number.isSafeInteger(annualLimit) || annualLimit < 0)) {
      return problem(c, 422, 'annualLimit must be a non-negative integer');
    }
    const deductible = c.req.query('deductible');
    const v = await products.get(...pathOf(c));
    return send(c, vetCareTermsFor(v, { ...(annualLimit !== undefined ? { annualLimit } : {}), ...(deductible ? { deductible } : {}) }));
  });

  const productStep = (path: string, schema: string, run: (p: string, v: string, by: string, body: any) => Promise<ProductVersion>) =>
    app.post(`${productVersion}/${path}`, async (c) => {
      const r = await readJson(c, schema);
      if (!r.ok) return r.res;
      return idempotent(c, r.body, async () => ({ status: 200, body: withName(c, await run(...pathOf(c), c.get('principal').subject, r.body)) }));
    });
  productStep('submissions', 'EmptyRequest', (p, v, by) => products.submit(p, v, by));
  productStep('returns', 'ReasonRequest', (p, v, _by, b) => products.returnToDraft(p, v, b.reason));
  productStep('publications', 'EmptyRequest', (p, v, by) => products.publish(p, v, by));
  productStep('sales-ends', 'SalesEndRequest', (p, v, by, b) => products.endSales(p, v, b.salesTo, by, b.reason));

  // Parties first: the animal register checks owners against them (ADR 0026).
  const parties =
    d.parties ??
    new PartyService({
      store: new InMemoryPartyStore(),
      clock: d.clock,
      ids: { next: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}` },
    });
  // The animal register (ADR 0024). Scope: the caller's markets. A role bound to a
  // clinic or to policies sees no animals, since the register cannot tell which are theirs.
  const animals =
    d.animals ??
    new AnimalService({
      store: new InMemoryAnimalStore(),
      references: { get: (kind, code) => catalog.getReference(kind, code).catch(() => null) },
      parties,
      clock: d.clock,
      ids: { next: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}` },
    });
  const sees = (scope: Scope, a: AnimalRecord) =>
    !scope.clinicId && !scope.policyIds && (scope.markets === '*' || scope.markets.has(a.market));
  const visibleAnimal = async (c: Context<Env>) => {
    const id = c.req.param('animalId') ?? '';
    const a = await animals.get(id).catch((e: unknown) => {
      if (e instanceof AnimalError && e.code === 'not_found') return null;
      throw e;
    });
    if (!a || !sees(c.get('scope'), a)) throw new AnimalError('not_found', `Animal ${id} does not exist`);
    return a;
  };

  app.get('/v1/animals', async (c) => {
    const filters = (['microchip', 'registration', 'passport', 'ownerPartyId'] as const).flatMap((k) => {
      const v = c.req.query(k);
      return v === undefined ? [] : [[k, v] as const];
    });
    if (filters.length !== 1) return problem(c, 422, 'Give exactly one of microchip, registration, passport or ownerPartyId');
    const [key, value] = filters[0]!;
    const found = key === 'ownerPartyId' ? await animals.findByOwner(value) : await animals.findByIdentifier({ type: key as IdentifierType, value });
    return send(c, { items: found.filter((a) => sees(c.get('scope'), a)) });
  });

  // Lookup by identifier (ADR 0025): only animals open for lookup, as a summary
  // without owners, so bindings to a clinic or to policies do not limit it. Markets do.
  app.get('/v1/animal-lookup', async (c) => {
    const filters = IDENTIFIER_TYPES.flatMap((k) => {
      const v = c.req.query(k);
      return v === undefined ? [] : [[k, v] as const];
    });
    if (filters.length !== 1) return problem(c, 422, 'Give exactly one of microchip, registration or passport');
    const [type, value] = filters[0]!;
    const scope = c.get('scope');
    const found = await animals.lookup({ type, value });
    return send(c, { items: found.filter((a) => scope.markets === '*' || scope.markets.has(a.market)) });
  });

  app.post('/v1/animals', async (c) => {
    const r = await readJson(c, 'RegisterAnimalRequest');
    if (!r.ok) return r.res;
    const scope = c.get('scope');
    if (scope.clinicId || scope.policyIds || !(scope.markets === '*' || scope.markets.has(r.body.market))) {
      return problem(c, 403, 'Not permitted', 'The market is outside the caller\'s scope');
    }
    return idempotent(c, r.body, async () => ({ status: 201, body: await animals.register(r.body, c.get('principal').subject) }));
  });

  app.get('/v1/animals/:animalId', async (c) => send(c, await visibleAnimal(c)));

  // Litters (ADR 0027): same scope as animals.
  app.post('/v1/litters', async (c) => {
    const r = await readJson(c, 'RegisterLitterRequest');
    if (!r.ok) return r.res;
    const scope = c.get('scope');
    if (scope.clinicId || scope.policyIds || !(scope.markets === '*' || scope.markets.has(r.body.market))) {
      return problem(c, 403, 'Not permitted', 'The market is outside the caller\'s scope');
    }
    return idempotent(c, r.body, async () => ({ status: 201, body: await animals.registerLitter(r.body, c.get('principal').subject) }));
  });

  app.get('/v1/litters/:litterId', async (c) => {
    const id = c.req.param('litterId');
    const l = await animals.getLitter(id);
    const scope = c.get('scope');
    if (scope.clinicId || scope.policyIds || !(scope.markets === '*' || scope.markets.has(l.market))) {
      throw new AnimalError('not_found', `Litter ${id} does not exist`);
    }
    return send(c, l);
  });

  app.put('/v1/animals/:animalId', async (c) => {
    const a = await visibleAnimal(c);
    const r = await readJson(c, 'CorrectAnimalRequest');
    if (!r.ok) return r.res;
    return send(c, await animals.correct(a.id, r.body, c.get('principal').subject));
  });

  app.get('/v1/animals/:animalId/revisions', async (c) => send(c, { items: await animals.revisions((await visibleAnimal(c)).id) }));

  app.post('/v1/animals/:animalId/identifiers', async (c) => {
    const a = await visibleAnimal(c);
    const r = await readJson(c, 'IdentifierInput');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await animals.addIdentifier(a.id, r.body, c.get('principal').subject) }));
  });

  app.post('/v1/animals/:animalId/ownerships', async (c) => {
    const a = await visibleAnimal(c);
    const r = await readJson(c, 'TransferAnimalRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await animals.transfer(a.id, r.body, c.get('principal').subject) }));
  });

  // Parties (ADR 0026). Same scope as animals: the caller's markets, and no
  // parties for roles bound to a clinic or to policies. Personal numbers are
  // masked in every response and searched for in a request body, never in the URL.
  const inMarkets = (scope: Scope, market: string) => !scope.clinicId && !scope.policyIds && (scope.markets === '*' || scope.markets.has(market));
  const hasPrivacy = (c: Context<Env>) => permissionsOf(c.get('principal').roles, c.get('roles')).has('parties:privacy');
  // A restricted party (ADR 0028) is visible only with parties:privacy.
  const seesParty = (c: Context<Env>, p: PartyRecord) => inMarkets(c.get('scope'), p.market) && (hasPrivacy(c) || !parties.isRestricted(p));
  const visibleParty = async (c: Context<Env>) => {
    const id = c.req.param('partyId') ?? '';
    const p = await parties.get(id).catch((e: unknown) => {
      if (e instanceof PartyError && e.code === 'not_found') return null;
      throw e;
    });
    if (!p || !seesParty(c, p)) throw new PartyError('not_found', `Party ${id} does not exist`);
    return p;
  };
  const visibleErasure = async (c: Context<Env>): Promise<ErasureRequest> => {
    const r = await parties.getErasureRequest(c.req.param('requestId') ?? '');
    if (!inMarkets(c.get('scope'), r.market)) throw new PartyError('not_found', `Erasure request ${r.id} does not exist`);
    return r;
  };

  app.post('/v1/party-searches', async (c) => {
    const r = await readJson(c, 'PartySearchRequest');
    if (!r.ok) return r.res;
    const found = await parties.findByIdentifier(r.body);
    return send(c, { items: found.filter((p) => seesParty(c, p)).map(publicView) });
  });

  app.post('/v1/parties', async (c) => {
    const r = await readJson(c, 'RegisterPartyRequest');
    if (!r.ok) return r.res;
    const scope = c.get('scope');
    if (scope.clinicId || scope.policyIds || !(scope.markets === '*' || scope.markets.has(r.body.market))) {
      return problem(c, 403, 'Not permitted', 'The market is outside the caller\'s scope');
    }
    return idempotent(c, r.body, async () => ({ status: 201, body: publicView(await parties.register(r.body, c.get('principal').subject)) }));
  });

  app.get('/v1/parties/:partyId', async (c) => send(c, publicView(await visibleParty(c))));

  app.put('/v1/parties/:partyId', async (c) => {
    const p = await visibleParty(c);
    const r = await readJson(c, 'ChangePartyRequest');
    if (!r.ok) return r.res;
    return send(c, publicView(await parties.change(p.id, r.body, c.get('principal').subject)));
  });

  // Erasure (ADR 0028): request, approve with four eyes, or reject.
  app.post('/v1/parties/:partyId/erasure-requests', async (c) => {
    const p = await visibleParty(c);
    const r = await readJson(c, 'ErasureRequestInput');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await parties.requestErasure(p.id, r.body, c.get('principal').subject) }));
  });

  app.get('/v1/erasure-requests', async (c) => {
    const status = c.req.query('status');
    if (status !== undefined && status !== 'pending' && status !== 'decided') return problem(c, 422, 'status is pending or decided');
    const partyId = c.req.query('partyId');
    const items = await parties.listErasureRequests({
      ...(partyId ? { partyId } : {}),
      ...(status ? { pending: status === 'pending' } : {}),
    });
    return send(c, { items: items.filter((r) => inMarkets(c.get('scope'), r.market)) });
  });

  app.get('/v1/erasure-requests/:requestId', async (c) => send(c, await visibleErasure(c)));

  app.post('/v1/erasure-requests/:requestId/approvals', async (c) => {
    const e = await visibleErasure(c);
    const r = await readJson(c, 'ErasureApprovalInput');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await parties.approveErasure(e.id, r.body, c.get('principal').subject) }));
  });

  app.post('/v1/erasure-requests/:requestId/rejections', async (c) => {
    const e = await visibleErasure(c);
    const r = await readJson(c, 'ErasureRejectionInput');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await parties.rejectErasure(e.id, r.body, c.get('principal').subject) }));
  });

  // Policies (ADR 0029). Scope: the caller's markets, and for a role bound to
  // policies only those. A role bound to a clinic sees none.
  const policies =
    d.policies ??
    new PolicyService({
      store: new InMemoryPolicyStore(),
      products: productPort(products),
      animals: animalPort(animals),
      parties,
      clock: d.clock,
      ids: { next: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}` },
    });
  const seesPolicy = (scope: Scope, p: PolicyRecord) => !scope.clinicId && coversPolicy(scope, p.market, p.id);
  const visiblePolicy = async (c: Context<Env>) => {
    const id = c.req.param('policyId') ?? '';
    const p = await policies.get(id).catch((e: unknown) => {
      if (e instanceof PolicyError && e.code === 'not_found') return null;
      throw e;
    });
    if (!p || !seesPolicy(c.get('scope'), p)) throw new PolicyError('not_found', `Policy ${id} does not exist`);
    return p;
  };

  app.post('/v1/policies', async (c) => {
    const r = await readJson(c, 'IssuePolicyRequest');
    if (!r.ok) return r.res;
    const scope = c.get('scope');
    if (scope.clinicId || scope.policyIds || !(scope.markets === '*' || scope.markets.has(r.body.market))) {
      return problem(c, 403, 'Not permitted', 'The market is outside the caller\'s scope');
    }
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.issue(r.body, c.get('principal').subject) }));
  });

  app.get('/v1/policies', async (c) => {
    const animalId = c.req.query('animalId');
    const partyId = c.req.query('policyholderPartyId');
    if ((animalId === undefined) === (partyId === undefined)) return problem(c, 422, 'Give exactly one of animalId or policyholderPartyId');
    const found = animalId !== undefined ? await policies.findByAnimal(animalId) : await policies.findByPolicyholder(partyId!);
    return send(c, { items: found.filter((p) => seesPolicy(c.get('scope'), p)) });
  });

  app.get('/v1/policies/:policyId', async (c) => send(c, await visiblePolicy(c)));

  app.post('/v1/policies/:policyId/cancellations', async (c) => {
    const p = await visiblePolicy(c);
    const r = await readJson(c, 'CancelPolicyRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.cancel(p.id, r.body, c.get('principal').subject) }));
  });

  app.post('/v1/policies/:policyId/changes', async (c) => {
    const p = await visiblePolicy(c);
    const r = await readJson(c, 'ChangePolicyRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.change(p.id, r.body, c.get('principal').subject) }));
  });

  app.post('/v1/policies/:policyId/renewals', async (c) => {
    const p = await visiblePolicy(c);
    const r = await readJson(c, 'RenewPolicyRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.renew(p.id, r.body, c.get('principal').subject) }));
  });

  app.post('/v1/renewal-runs', async (c) => {
    const r = await readJson(c, 'RenewalRunRequest');
    if (!r.ok) return r.res;
    const scope = c.get('scope');
    if (scope.clinicId || scope.policyIds) return problem(c, 403, 'Not permitted', 'A role bound to a clinic or to policies cannot run renewals');
    return send(c, await policies.renewalRun({ dryRun: r.body.dryRun ?? false, markets: scope.markets }, c.get('principal').subject));
  });

  // Proposals from the animal register's events (ADR 0029). Same scope as policies.
  const inScope = (c: Context<Env>, pr: Proposal) => {
    const scope = c.get('scope');
    return !scope.clinicId && coversPolicy(scope, pr.market, pr.policyId);
  };
  const visibleProposal = async (c: Context<Env>) => {
    const pr = await policies.getProposal(c.req.param('proposalId') ?? '');
    if (!inScope(c, pr)) throw new PolicyError('not_found', `Proposal ${pr.id} does not exist`);
    return pr;
  };

  app.get('/v1/policy-proposals', async (c) => {
    const status = c.req.query('status');
    if (status !== undefined && status !== 'pending' && status !== 'decided') return problem(c, 422, 'status is pending or decided');
    const policyId = c.req.query('policyId');
    const items = await policies.listProposals({ ...(policyId ? { policyId } : {}), ...(status ? { pending: status === 'pending' } : {}) });
    return send(c, { items: items.filter((pr) => inScope(c, pr)) });
  });

  app.get('/v1/policy-proposals/:proposalId', async (c) => send(c, await visibleProposal(c)));

  app.post('/v1/policy-proposals/:proposalId/acceptances', async (c) => {
    const pr = await visibleProposal(c);
    const r = await readJson(c, 'AcceptProposalRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.acceptProposal(pr.id, r.body, c.get('principal').subject) }));
  });

  app.post('/v1/policy-proposals/:proposalId/rejections', async (c) => {
    const pr = await visibleProposal(c);
    const r = await readJson(c, 'ReasonRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.rejectProposal(pr.id, r.body, c.get('principal').subject) }));
  });

  // Policy groups for a litter or a household (ADR 0007). The caller's markets;
  // none for roles bound to a clinic or to policies.
  const seesGroup = (c: Context<Env>, g: PolicyGroup) => {
    const scope = c.get('scope');
    return !scope.clinicId && !scope.policyIds && (scope.markets === '*' || scope.markets.has(g.market));
  };
  const visibleGroup = async (c: Context<Env>) => {
    const g = await policies.getGroup(c.req.param('groupId') ?? '');
    if (!seesGroup(c, g)) throw new PolicyError('not_found', `Policy group ${g.id} does not exist`);
    return g;
  };

  app.post('/v1/policy-groups', async (c) => {
    const r = await readJson(c, 'CreatePolicyGroupRequest');
    if (!r.ok) return r.res;
    const scope = c.get('scope');
    if (scope.clinicId || scope.policyIds || !(scope.markets === '*' || scope.markets.has(r.body.market))) {
      return problem(c, 403, 'Not permitted', 'The market is outside the caller\'s scope');
    }
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.createGroup(r.body, c.get('principal').subject) }));
  });

  app.get('/v1/policy-groups', async (c) => {
    const holderPartyId = c.req.query('holderPartyId');
    const policyId = c.req.query('policyId');
    if ((holderPartyId === undefined) === (policyId === undefined)) return problem(c, 422, 'Give exactly one of holderPartyId or policyId');
    const found = await policies.findGroups(holderPartyId !== undefined ? { holderPartyId } : { policyId: policyId! });
    return send(c, { items: found.filter((g) => seesGroup(c, g)) });
  });

  app.get('/v1/policy-groups/:groupId', async (c) => send(c, await visibleGroup(c)));

  app.post('/v1/policy-groups/:groupId/members', async (c) => {
    const g = await visibleGroup(c);
    const r = await readJson(c, 'AddGroupMemberRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.addMember(g.id, r.body, c.get('principal').subject) }));
  });

  app.post('/v1/policy-groups/:groupId/members/:policyId/ends', async (c) => {
    const g = await visibleGroup(c);
    const r = await readJson(c, 'EndGroupMemberRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.endMember(g.id, c.req.param('policyId'), r.body, c.get('principal').subject) }));
  });

  app.post('/v1/proposal-expiry-runs', async (c) => {
    const scope = c.get('scope');
    if (scope.clinicId || scope.policyIds) return problem(c, 403, 'Not permitted', 'A role bound to a clinic or to policies cannot run this');
    return send(c, { expired: await policies.expireProposals(scope.markets, c.get('principal').subject) });
  });

  app.post('/v1/policies/:policyId/reinstatements', async (c) => {
    const p = await visiblePolicy(c);
    const r = await readJson(c, 'ReinstatePolicyRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.reinstate(p.id, r.body, c.get('principal').subject) }));
  });

  app.get('/v1/policies/:policyId/history', async (c) => send(c, await policies.history((await visiblePolicy(c)).id)));

  app.get('/v1/policies/:policyId/snapshot', async (c) => {
    const p = await visiblePolicy(c);
    const date = c.req.query('date');
    const knownAt = c.req.query('knownAt');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return problem(c, 422, 'date must be YYYY-MM-DD');
    if (knownAt !== undefined && Number.isNaN(Date.parse(knownAt))) return problem(c, 422, 'knownAt must be a date and time');
    const snap = await policies.getPolicyAt(p.id, date, knownAt === undefined ? undefined : new Date(knownAt).toISOString());
    if (!snap) return problem(c, 404, `Policy ${p.id} is not in force on ${date}`);
    return send(c, snap);
  });

  // Retention (ADR 0028). Activity comes from the animal register and the policies.
  const retention =
    d.retention ??
    new RetentionService({
      parties,
      settings: new InMemoryRetentionStore(),
      sources: [
        { name: 'animals', activityOf: (id) => animals.activityOf(id) },
        { name: 'policies', activityOf: (id) => policies.activityOf(id) },
        claimsActivity(policies, d.service),
      ],
      clock: d.clock,
    });

  app.get('/v1/retention-settings', async (c) => send(c, await retention.current()));

  app.get('/v1/retention-settings/versions', async (c) => send(c, { items: await retention.versions() }));

  app.post('/v1/retention-settings/versions', async (c) => {
    const r = await readJson(c, 'ChangeRetentionRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await retention.change(r.body, c.get('principal').subject) }));
  });

  app.post('/v1/retention-runs', async (c) => {
    const r = await readJson(c, 'RetentionRunRequest');
    if (!r.ok) return r.res;
    const scope = c.get('scope');
    return send(c, await retention.run({ dryRun: r.body.dryRun ?? false, markets: scope.markets }, c.get('principal').subject));
  });

  app.get('/v1/parties/:partyId/revisions', async (c) => send(c, { items: await parties.revisions((await visibleParty(c)).id) }));

  app.post('/v1/parties/:partyId/identifiers', async (c) => {
    const p = await visibleParty(c);
    const r = await readJson(c, 'PartyIdentifierInput');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: publicView(await parties.addIdentifier(p.id, r.body, c.get('principal').subject)) }));
  });

  app.get('/v1/access/roles', async (c) => send(c, await access.current()));

  app.get('/v1/access/roles/versions', async (c) => send(c, { items: await access.versions() }));

  app.post('/v1/access/roles/versions', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'ChangeRolesRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => {
      const config = await access.change({
        roles: r.body.roles,
        basedOnVersion: r.body.basedOnVersion,
        reason: r.body.reason,
        changedBy: p.subject,
        callerRoles: p.roles,
      });
      return { status: 201, body: config };
    });
  });

  // Every operation must have a valid permission in the contract, so a new
  // operation is closed until someone has decided who may call it.
  for (const op of implementedOperations(app)) {
    if (!isPermission(contractPermissions.get(op))) throw new Error(`${op} has no valid x-permission in the contract`);
  }

  app.notFound((c) => problem(c, 404, 'The resource does not exist'));

  app.onError((err, c) => {
    if (err instanceof RuleSetError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 403 : 422;
      return problem(c, status, err.message);
    }
    if (err instanceof PolicyError) {
      return problem(c, err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 422, err.message);
    }
    if (err instanceof PartyError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 403 : 422;
      return problem(c, status, err.message);
    }
    if (err instanceof AnimalError) {
      return problem(c, err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 422, err.message);
    }
    if (err instanceof CatalogError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 403 : 422;
      return problem(c, status, err.message);
    }
    if (err instanceof AccessError) {
      return problem(c, err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 403 : 422, err.message);
    }
    if (err instanceof DomainError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 403 : 422;
      return problem(c, status, err.message);
    }
    console.error(err);
    return problem(c, 500, 'Internal error');
  });

  return app;
}

/** A decision sequence number from the path, or null if it is not a positive integer. */
function parseSeq(raw: string): number | null {
  const seq = Number(raw);
  return Number.isInteger(seq) && seq >= 1 ? seq : null;
}

/** A Hono route as 'METHOD /path' in OpenAPI format. */
function operationKey(method: string, honoPath: string): string {
  return `${method} ${honoPath.replace(/:([A-Za-z]+)/g, '{$1}')}`;
}

/** Hono routes as 'METHOD /path' in OpenAPI format, for the contract check. */
export function implementedOperations(app: Hono<any>): string[] {
  return app.routes.filter((r) => r.path.startsWith('/v1/') && r.method !== 'ALL').map((r) => operationKey(r.method, r.path));
}
