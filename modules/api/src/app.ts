import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { AccessError, AccessService, InMemoryRoleConfigStore } from '@petvold/access';
import { DecisioningService, InMemoryRuleSetStore, RuleSetError, seriesKindOf, toClaimsRules } from '@petvold/decisioning';
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
import { InMemoryPolicyStore, PolicyError, PolicyService, type Application, type ApplicationStatus, type PolicyGroup, type PolicyRecord, type Proposal } from '@petvold/policies';
import { CommunicationsError, CommunicationsService, InMemoryNoticeSettingsStore, InMemoryNoticeStore, NOTICE_TYPES, type NoticeType, type NoticeView } from '@petvold/communications';
import { BillingError, BillingService, InMemoryBillingStore } from '@petvold/billing';
import { InMemoryPaymentsStore, PaymentsError, PaymentsService, ProviderNotificationError } from '@petvold/payments';
import { InMemoryWebhookStore, SecretBox, WebhookError, WebhookService, type Subscription } from '@petvold/webhooks';
import { animalPort, billingPolicySource, billingProductSource, claimSource, claimsActivity, partySource, policySource, productPort } from './wiring.ts';
import { tariffCoverage } from '@petvold/pricing-core';
import { questionsFor, underwritingCoverage } from '@petvold/underwriting-core';
import { marketDate } from '@petvold/common';
import { InMemorySchedulingStore, JobError, Scheduler, nextDailyRun } from '@petvold/scheduling';
import { defaultJobs, jobRunners, type JobRunner } from './jobs.ts';
import type { Relay } from './relay.ts';
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
import { CLAIM_STATES, type Claim, type ClaimState, type ClaimsService, type Clock } from '@petvold/claims-core';
import { DomainError } from '@petvold/claims-core';
import { formatErrors, openapiText, operationPermissions, validatorFor, type FieldError } from './contract.ts';
import { routePath } from 'hono/route';
import {
  amountLimitsOf,
  assertRoleDefinitions,
  coversClaim,
  coversPolicy,
  DEFAULT_ROLES,
  isOperationPermission,
  isPermission,
  SIGNED_IN,
  permissionsOf,
  scopeOf,
  type Permission,
  type RoleDefinitions,
  type Scope,
  type ScopeAttributes,
} from './permissions.ts';
import { DocumentError, DocumentService, InMemoryBlobStore, InMemoryDocumentStore, MAX_UPLOAD_BYTES, sha256, type StoredDocument } from '@petvold/documents';
import { makeNoticePdf } from './notice-pdf.ts';
import { localizeDeep, localizeExplanation, pickLocale, renderRule, type Locale } from './messages.ts';

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
  /**
   * Notices to the customer (ADR 0032). Omitted: kept in memory, reading the
   * services above. The installation's relay feeds it the policy events.
   */
  communications?: CommunicationsService;
  /** Webhook subscriptions (ADR 0033). Omitted: kept in memory; nothing feeds or sends them without the installation's relay and worker. */
  webhooks?: WebhookService;
  /** Documents (ADR 0038). Omitted: kept in memory, with a random signing key and links on http://localhost. */
  documents?: DocumentService;
  /** Billing (ADR 0040). Omitted: kept in memory; the installation's relay feeds it the policy events. */
  billing?: BillingService;
  /** Payments (ADR 0017, 0040). Omitted: kept in memory with no payment providers. */
  payments?: PaymentsService;
  /** Runs (ADR 0037). Omitted: the four jobs over these services, with history in memory. */
  scheduler?: Scheduler;
  /** The relay, to send a dead letter again (ADR 0037). Omitted: the dead letter is only removed from the store. */
  relay?: Pick<Relay, 'retryDeadLetter'>;
  /** Version 1 of the role settings when `access` is omitted (ADR 0016). Defaults to DEFAULT_ROLES. */
  roles?: RoleDefinitions;
  /**
   * Origins of browser applications allowed to call the API (CORS), e.g.
   * ['https://portal.example.test']. Exact origins only; omitted or empty: none.
   */
  corsOrigins?: readonly string[];
}

/**
 * Allowed CORS origins from PETVOLD_CORS_ORIGINS (comma-separated). Each must be
 * an origin (scheme, host and optional port) and never '*': the API is called
 * with a bearer token, so every browser application is named.
 */
export function corsOriginsFromEnv(env: Record<string, string | undefined>, fallback: readonly string[] = []): string[] {
  const raw = env.PETVOLD_CORS_ORIGINS;
  if (raw === undefined) return [...fallback];
  const origins = raw.split(',').map((o) => o.trim()).filter(Boolean);
  for (const o of origins) {
    let ok = false;
    try {
      const u = new URL(o);
      ok = (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === o;
    } catch {
      ok = false;
    }
    if (!ok) throw new Error(`PETVOLD_CORS_ORIGINS: ${o} is not an origin such as https://portal.example.test`);
  }
  return origins;
}

type Env = { Variables: { principal: Principal; scope: Scope; roles: RoleDefinitions } };

const PROBLEM = 'application/problem+json';

function problem(c: Context, status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 500, title: string, detail?: string, errors?: FieldError[]) {
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
/**
 * One page of a list (ADR 0002): `limit` (1-200, default 50) and an opaque
 * `cursor` from the previous page's `nextCursor`. The cursor is the position in
 * the list for now; stores can move to keyset paging without changing the contract.
 */
export function pageOf<T>(c: Context, items: T[]): { items: T[]; nextCursor?: string } | { error: string } {
  const rawLimit = c.req.query('limit');
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return { error: 'limit must be a whole number 1-200' };
  let offset = 0;
  const cursor = c.req.query('cursor');
  if (cursor !== undefined) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
      if (!Number.isInteger(parsed.o) || (parsed.o as number) < 0) throw new Error('bad');
      offset = parsed.o as number;
    } catch {
      return { error: 'cursor is not one this API gave' };
    }
  }
  const page = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? Buffer.from(JSON.stringify({ o: offset + limit })).toString('base64url') : undefined;
  return { items: page, ...(next ? { nextCursor: next } : {}) };
}

/** Sends one page of a list, or 422 for a bad limit or cursor. */
function sendPage<T>(c: Context, items: T[]) {
  const page = pageOf(c, items);
  if ('error' in page) return problem(c, 422, page.error);
  return send(c, page);
}

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

  // CORS before authentication, so that a preflight (OPTIONS) is answered without a token.
  if (d.corsOrigins?.length) {
    const allowed = new Set(d.corsOrigins);
    app.use(
      '*',
      cors({
        origin: (origin) => (allowed.has(origin) ? origin : null),
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'Accept-Language'],
        exposeHeaders: ['Content-Language'],
        maxAge: 600,
      }),
    );
  }

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
      const allowed = permission === SIGNED_IN || (isPermission(permission) && permissionsOf(principal.roles, roles).has(permission));
      if (!allowed) {
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

  // Claims for lists and work queues, within the caller's scope: markets, and a
  // clinic's own claims or the bound policies' claims.
  app.get('/v1/claims', async (c) => {
    const status = c.req.query('status');
    if (status !== undefined && !CLAIM_STATES.includes(status as ClaimState)) {
      return problem(c, 422, `status is one of ${CLAIM_STATES.join(', ')}`);
    }
    const scope = c.get('scope');
    const q = (k: string) => c.req.query(k);
    const found = await d.service.listClaims({
      ...(status ? { state: status as ClaimState } : {}),
      ...(q('policyId') ? { policyId: q('policyId')! } : {}),
      ...(q('animalId') ? { animalId: q('animalId')! } : {}),
      ...(q('market') ? { market: q('market')! } : {}),
      ...(scope.clinicId ? { clinicId: scope.clinicId } : {}),
    });
    // The work queue a claim is in is its status (ADR 0034).
    return sendPage(c, found.filter((x) => coversClaim(scope, x)).map(({ state, ...x }) => ({ ...x, status: state })));
  });

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
    return send(c, await d.service.assessWithRouting(c.req.param('claimId'), knownAt));
  });

  app.get('/v1/claims/:claimId/decisions', async (c) => sendPage(c, await d.service.getDecisions(c.req.param('claimId'))));

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

  app.get('/v1/claims/:claimId/proposals', async (c) => sendPage(c, await d.service.getProposals(c.req.param('claimId'))));

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

  app.post('/v1/claims/:claimId/withdrawals', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'WithdrawClaimRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await d.service.withdraw(c.req.param('claimId'), r.body, p.subject) }));
  });

  app.post('/v1/claims/:claimId/dismissals', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'DismissClaimRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await d.service.dismiss(c.req.param('claimId'), r.body, p.subject) }));
  });

  // Corrections (ADR 0036): a new revision of the claim's details.
  app.post('/v1/claims/:claimId/corrections', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'CorrectClaimRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await d.service.correctClaim(c.req.param('claimId'), r.body, p.subject) }));
  });

  // Attachments (ADR 0036): references to the insurer's archive.
  app.get('/v1/claims/:claimId/attachments', async (c) => sendPage(c, await d.service.getAttachments(c.req.param('claimId'))));

  app.post('/v1/claims/:claimId/attachments', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'AttachmentInput');
    if (!r.ok) return r.res;
    // A file in Petvold's archive (ADR 0038): the document must be on this claim and match.
    const inArchive = /^urn:petvold:doc:(doc_[A-Za-z0-9_]+)$/.exec(r.body.url);
    if (inArchive) {
      const doc = await documents.get(inArchive[1]!).catch(() => null);
      if (!doc || doc.owner.claimId !== c.req.param('claimId')) return problem(c, 422, `Document ${inArchive[1]} is not on the claim`);
      if (doc.sha256 !== r.body.sha256 || doc.size !== r.body.size || doc.mediaType !== String(r.body.mediaType).toLowerCase()) {
        return problem(c, 422, `The attachment does not match document ${doc.id}: sha256, size and mediaType come from the document`);
      }
    }
    return idempotent(c, r.body, async () => ({ status: 201, body: await d.service.addAttachment(c.req.param('claimId'), r.body, p.subject) }));
  });

  app.get('/v1/claims/:claimId/revisions', async (c) => sendPage(c, await d.service.getRevisions(c.req.param('claimId'))));

  // Requests for information (ADR 0036): the claim waits for the customer or the clinic.
  app.get('/v1/claims/:claimId/information-requests', async (c) => sendPage(c, await d.service.getInformationRequests(c.req.param('claimId'))));

  app.post('/v1/claims/:claimId/information-requests', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'InformationRequestInput');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await d.service.requestInformation(c.req.param('claimId'), r.body, p.subject) }));
  });

  app.post('/v1/claims/:claimId/information-requests/:requestId/answers', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'InformationAnswerInput');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({
      status: 201,
      body: await d.service.answerInformationRequest(c.req.param('claimId'), c.req.param('requestId'), r.body, p.subject),
    }));
  });

  app.post('/v1/claims/:claimId/information-requests/:requestId/cancellations', async (c) => {
    const p = c.get('principal');
    const r = await readJson(c, 'CancelInformationRequestInput');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({
      status: 201,
      body: await d.service.cancelInformationRequest(c.req.param('claimId'), c.req.param('requestId'), r.body, p.subject),
    }));
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

  app.get('/v1/claims/:claimId/review-requests', async (c) => sendPage(c, await d.service.getReviewRequests(c.req.param('claimId'))));

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

  app.get('/v1/policies/:policyId/limits', async (c) => {
    const onDate = c.req.query('onDate');
    if (!onDate) return problem(c, 422, 'onDate is required');
    // A clinic is not tied to policies, so it cannot look up limits by policy id.
    const scope = c.get('scope');
    const notFound = () => problem(c, 404, 'No vet care cover in force for the animal on that date');
    if (scope.clinicId || (scope.policyIds && !scope.policyIds.has(c.req.param('policyId')))) return notFound();
    const limits = await d.service.getLimits(c.req.param('policyId'), onDate);
    if (!coversPolicy(scope, limits.market, limits.policyId)) return notFound();
    return send(c, limits);
  });

  const decisioning =
    d.decisioning ?? new DecisioningService({ store: new InMemoryRuleSetStore(), clock: d.clock, calculationModels: Object.keys(CALCULATION_MODELS) });
  const ruleSet = '/v1/rule-sets/:series/versions/:version';
  const version = (c: Context) => parseSeq(c.req.param('version') ?? '');

  app.get('/v1/rule-sets', async (c) => sendPage(c, await decisioning.allSeries()));

  app.get('/v1/rule-sets/:series/versions', async (c) => sendPage(c, await decisioning.list(c.req.param('series'))));

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
    if (seriesKindOf(target.calculationModel) !== 'claims-rules') {
      return problem(c, 422, 'Only claims rules can be simulated against stored decisions; tariffs, price terms and underwriting rules cannot yet (ADR 0030, 0031)');
    }
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
    return sendPage(c, items.map((i) => withLabel(c, i)));
  });

  app.get(reference, async (c) => send(c, withLabel(c, await catalog.getReference(c.req.param('kind'), c.req.param('code')))));

  app.get(`${reference}/revisions`, async (c) => {
    const items = await catalog.referenceHistory(c.req.param('kind'), c.req.param('code'));
    return sendPage(c, items.map((i) => withLabel(c, i)));
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
  const withName = (c: Context, v: ProductVersion) => ({
    ...v,
    id: productVersionId(v),
    name: labelFor(v.content.names, c.req.header('accept-language')),
  });
  const productVersion = '/v1/products/:product/versions/:version';
  const pathOf = (c: Context) => [c.req.param('product') ?? '', c.req.param('version') ?? ''] as const;

  app.get('/v1/product-versions', async (c) => {
    const date = c.req.query('onSale');
    if (!date) return problem(c, 422, 'onSale is required: the date the versions are on sale');
    const market = c.req.query('market');
    const species = c.req.query('species');
    const items = await products.onSale(date, { ...(market ? { market } : {}), ...(species ? { species } : {}) });
    return sendPage(c, items.map((v) => withName(c, v)));
  });

  app.get('/v1/products', async (c) =>
    sendPage(
      c,
      (await products.allProducts()).map((p) => ({ product: p.product, versions: p.versions.map((v) => withName(c, v)) })),
    ),
  );

  app.get('/v1/products/:product/versions', async (c) => sendPage(c, (await products.list(c.req.param('product'))).map((v) => withName(c, v))));

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
  productStep('sales-endings', 'SalesEndRequest', (p, v, by, b) => products.endSales(p, v, b.salesTo, by, b.reason));

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
    return sendPage(c, found.filter((a) => sees(c.get('scope'), a)));
  });

  // Lookup by identifier (ADR 0025): only animals open for lookup, as a summary
  // without owners, so bindings to a clinic or to policies do not limit it. Markets do.
  app.get('/v1/animal-summaries', async (c) => {
    const filters = IDENTIFIER_TYPES.flatMap((k) => {
      const v = c.req.query(k);
      return v === undefined ? [] : [[k, v] as const];
    });
    if (filters.length !== 1) return problem(c, 422, 'Give exactly one of microchip, registration or passport');
    const [type, value] = filters[0]!;
    const scope = c.get('scope');
    const found = await animals.lookup({ type, value });
    return sendPage(c, found.filter((a) => scope.markets === '*' || scope.markets.has(a.market)));
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

  app.get('/v1/animals/:animalId/revisions', async (c) => sendPage(c, await animals.revisions((await visibleAnimal(c)).id)));

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

  app.post('/v1/parties/searches', async (c) => {
    const r = await readJson(c, 'PartySearchRequest');
    if (!r.ok) return r.res;
    // By number, or by a part of the name or email (ADR 0039). Both come in the body and are never logged.
    const scope = c.get('scope');
    const found =
      'text' in r.body
        ? await parties.search(r.body.text, scope.markets === '*' ? '*' : [...scope.markets])
        : await parties.findByIdentifier(r.body);
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
    return sendPage(c, items.filter((r) => inMarkets(c.get('scope'), r.market)));
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
      tariffs: decisioning,
      underwriting: decisioning,
      clock: d.clock,
      ids: { next: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}` },
    });
  /** Whether the caller may set a premium other than the tariff's (ADR 0030). */
  const priceRights = (c: Context<Env>) => ({ mayOverridePrice: permissionsOf(c.get('principal').roles, c.get('roles')).has('policies:price-override') });
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
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.issue(r.body, c.get('principal').subject, priceRights(c)) }));
  });

  // Applications for products with underwriting rules (ADR 0031). A role bound to
  // a clinic or to policies neither applies nor sees applications.
  const seesApplication = (scope: Scope, a: Application) => !scope.clinicId && !scope.policyIds && (scope.markets === '*' || scope.markets.has(a.market));

  app.post('/v1/applications', async (c) => {
    const r = await readJson(c, 'ApplicationRequest');
    if (!r.ok) return r.res;
    const scope = c.get('scope');
    if (scope.clinicId || scope.policyIds || !(scope.markets === '*' || scope.markets.has(r.body.market))) {
      return problem(c, 403, 'Not permitted', 'The market is outside the caller\'s scope');
    }
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.apply(r.body, c.get('principal').subject, priceRights(c)) }));
  });

  app.get('/v1/applications', async (c) => {
    const status = c.req.query('status');
    if (status !== undefined && !['accepted', 'referred', 'declined', 'withdrawn', 'expired'].includes(status)) {
      return problem(c, 422, 'status is accepted, referred, declined, withdrawn or expired');
    }
    const q = (k: string) => c.req.query(k);
    const items = await policies.listApplications({
      ...(status ? { status: status as ApplicationStatus } : {}),
      ...(q('market') ? { market: q('market') } : {}),
      ...(q('animalId') ? { animalId: q('animalId') } : {}),
      ...(q('policyholderPartyId') ? { policyholderPartyId: q('policyholderPartyId') } : {}),
    });
    return sendPage(c, items.filter((a) => seesApplication(c.get('scope'), a)));
  });

  const visibleApplication = async (c: Context<Env>) => {
    const id = c.req.param('applicationId') ?? '';
    const a = await policies.getApplication(id);
    if (!seesApplication(c.get('scope'), a)) throw new PolicyError('not_found', `Application ${id} does not exist`);
    return a;
  };

  app.get('/v1/applications/:applicationId', async (c) => send(c, await visibleApplication(c)));

  // A person's decision on a referred application (ADR 0031).
  app.post('/v1/applications/:applicationId/decisions', async (c) => {
    const a = await visibleApplication(c);
    const r = await readJson(c, 'ApplicationDecisionRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.decideApplication(a.id, r.body, c.get('principal').subject) }));
  });

  app.post('/v1/applications/:applicationId/withdrawals', async (c) => {
    const a = await visibleApplication(c);
    const r = await readJson(c, 'ApplicationWithdrawalRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.withdrawApplication(a.id, r.body, c.get('principal').subject) }));
  });


  // Notices to the customer (ADR 0032). Scope: the caller's markets; a role bound
  // to policies sees only notices on its policies, and a clinic none.
  const communications =
    d.communications ??
    new CommunicationsService({
      store: new InMemoryNoticeStore(),
      settings: new InMemoryNoticeSettingsStore(),
      policies: policySource(policies),
      parties: partySource(parties),
      claims: claimSource(d.service),
      clock: d.clock,
      ids: { next: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}` },
    });
  const seesNotice = (scope: Scope, n: NoticeView) =>
    !scope.clinicId && (scope.markets === '*' || scope.markets.has(n.market)) && (!scope.policyIds || (n.policyId !== undefined && scope.policyIds.has(n.policyId)));
  const visibleNotice = async (c: Context<Env>) => {
    const id = c.req.param('noticeId') ?? '';
    const n = await communications.get(id).catch((e: unknown) => {
      if (e instanceof CommunicationsError && e.code === 'not_found') return null;
      throw e;
    });
    if (!n || !seesNotice(c.get('scope'), n)) throw new CommunicationsError('not_found', `Notice ${id} does not exist`);
    return n;
  };

  app.get('/v1/notices', async (c) => {
    const q = (k: string) => c.req.query(k);
    const status = q('status');
    if (status !== undefined && !['pending', 'sent', 'failed'].includes(status)) return problem(c, 422, 'status is pending, sent or failed');
    const type = q('type');
    if (type !== undefined && !(NOTICE_TYPES as readonly string[]).includes(type)) return problem(c, 422, `type is one of ${NOTICE_TYPES.join(', ')}`);
    const flag = (k: string) => {
      const v = q(k);
      return v === undefined ? undefined : v === 'true';
    };
    const items = await communications.list({
      ...(status ? { status: status as NoticeView['status'] } : {}),
      ...(type ? { type: type as NoticeType } : {}),
      ...(q('market') ? { market: q('market') } : {}),
      ...(q('policyId') ? { policyId: q('policyId') } : {}),
      ...(q('applicationId') ? { applicationId: q('applicationId') } : {}),
      ...(q('invoiceId') ? { invoiceId: q('invoiceId') } : {}),
      ...(q('recipientPartyId') ? { recipientPartyId: q('recipientPartyId') } : {}),
      ...(flag('attention') ? { attention: true } : {}),
      ...(flag('overdue') ? { overdue: true } : {}),
      ...(flag('late') ? { late: true } : {}),
    });
    return sendPage(c, items.filter((n) => seesNotice(c.get('scope'), n)));
  });

  app.get('/v1/notices/:noticeId', async (c) => send(c, await visibleNotice(c)));

  // Billing (ADR 0040). Scope: the caller's markets. A role bound to policies sees
  // only the plans of its policies and no accounts, and a clinic nothing.
  const billing =
    d.billing ??
    new BillingService({
      store: new InMemoryBillingStore(),
      products: billingProductSource(products),
      policies: billingPolicySource(policies),
      clock: d.clock,
      ids: { next: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}` },
    });
  const inBillingMarket = (scope: Scope, market: string) => scope.markets === '*' || scope.markets.has(market);
  const seesAccount = (scope: Scope, market: string) => !scope.clinicId && !scope.policyIds && inBillingMarket(scope, market);
  const seesPlan = (scope: Scope, p: { market: string; policyId: string }) => !scope.clinicId && inBillingMarket(scope, p.market) && (!scope.policyIds || scope.policyIds.has(p.policyId));

  app.get('/v1/payer-accounts', async (c) => {
    const partyId = c.req.query('partyId');
    const market = c.req.query('market');
    const items = await billing.accounts({ ...(partyId ? { partyId } : {}), ...(market ? { market } : {}) });
    return sendPage(c, items.filter((a) => seesAccount(c.get('scope'), a.market)));
  });

  app.get('/v1/payer-accounts/:accountId', async (c) => {
    const id = c.req.param('accountId');
    const a = await billing.account(id);
    if (!seesAccount(c.get('scope'), a.market)) throw new BillingError('not_found', `Payer account ${id} does not exist`);
    return send(c, a);
  });

  // An invoice may hold several of the payer's policies: a role bound to policies sees it only if it holds none but its own.
  const seesInvoice = (scope: Scope, i: { market: string; lines: { policyId: string }[] }) =>
    !scope.clinicId && inBillingMarket(scope, i.market) && (!scope.policyIds || i.lines.every((l) => scope.policyIds!.has(l.policyId)));

  app.get('/v1/invoices', async (c) => {
    const q = (k: string) => c.req.query(k);
    const items = await billing.invoices({ ...(q('accountId') ? { accountId: q('accountId') } : {}), ...(q('policyId') ? { policyId: q('policyId') } : {}), ...(q('market') ? { market: q('market') } : {}) });
    return sendPage(c, items.filter((i) => seesInvoice(c.get('scope'), i)));
  });

  app.get('/v1/invoices/:invoiceId', async (c) => {
    const id = c.req.param('invoiceId');
    const i = await billing.invoice(id);
    if (!seesInvoice(c.get('scope'), i)) throw new BillingError('not_found', `Invoice ${id} does not exist`);
    return send(c, i);
  });

  // A credit note follows its invoice's scope.
  const seesCredit = (scope: Scope, c: { market: string; lines: { policyId: string }[] }) => seesInvoice(scope, c);

  app.get('/v1/credit-notes', async (c) => {
    const q = (k: string) => c.req.query(k);
    const items = await billing.creditNotes({ ...(q('invoiceId') ? { invoiceId: q('invoiceId') } : {}), ...(q('accountId') ? { accountId: q('accountId') } : {}), ...(q('policyId') ? { policyId: q('policyId') } : {}) });
    return sendPage(c, items.filter((x) => seesCredit(c.get('scope'), x)));
  });

  app.get('/v1/credit-notes/:creditNoteId', async (c) => {
    const id = c.req.param('creditNoteId');
    const note = await billing.creditNote(id);
    if (!seesCredit(c.get('scope'), note)) throw new BillingError('not_found', `Credit note ${id} does not exist`);
    return send(c, note);
  });

  app.get('/v1/premium-plans', async (c) => {
    const policyId = c.req.query('policyId');
    const accountId = c.req.query('accountId');
    const items = await billing.plans({ ...(policyId ? { policyId } : {}), ...(accountId ? { accountId } : {}) });
    return sendPage(c, items.filter((p) => seesPlan(c.get('scope'), p)));
  });

  // Payments (ADR 0017, 0040). Scope: the caller's markets; a role bound to a
  // clinic or to policies sees none, since a payment is not yet tied to a policy.
  const payments =
    d.payments ??
    new PaymentsService({ store: new InMemoryPaymentsStore(), providers: [], clock: d.clock, ids: { next: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}` } });
  const seesPayment = (scope: Scope, market: string) => !scope.clinicId && !scope.policyIds && inBillingMarket(scope, market);

  app.get('/v1/payments', async (c) => {
    const market = c.req.query('market');
    const reference = c.req.query('reference');
    const items = await payments.payments({ ...(market ? { market } : {}), ...(reference ? { reference } : {}) });
    return sendPage(c, items.filter((p) => seesPayment(c.get('scope'), p.market)));
  });

  app.get('/v1/payments/:paymentId', async (c) => {
    const id = c.req.param('paymentId');
    const p = await payments.payment(id);
    if (!seesPayment(c.get('scope'), p.market)) throw new PaymentsError('not_found', `Payment ${id} does not exist`);
    return send(c, p);
  });

  // Webhook subscriptions (ADR 0033). A subscription's markets must lie within the caller's;
  // only a caller with every market may subscribe to '*'.
  const webhooks =
    d.webhooks ??
    new WebhookService({
      store: new InMemoryWebhookStore(),
      box: new SecretBox(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')),
      clock: d.clock,
      ids: { next: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}` },
    });
  const coversMarkets = (scope: Scope, markets: string[] | '*') =>
    !scope.clinicId && !scope.policyIds && (scope.markets === '*' || (markets !== '*' && markets.every((m) => (scope.markets as ReadonlySet<string>).has(m))));
  const visibleSubscription = async (c: Context<Env>): Promise<Subscription> => {
    const id = c.req.param('subscriptionId') ?? '';
    const s = await webhooks.get(id).catch((e: unknown) => {
      if (e instanceof WebhookError && e.code === 'not_found') return null;
      throw e;
    });
    if (!s || !coversMarkets(c.get('scope'), s.markets)) throw new WebhookError('not_found', `Webhook subscription ${id} does not exist`);
    return s;
  };
  const marketsAllowed = (c: Context<Env>, markets: string[] | '*') => {
    if (!coversMarkets(c.get('scope'), markets)) throw new WebhookError('forbidden', "The subscription's markets lie outside the caller's");
  };

  app.get('/v1/webhook-subscriptions', async (c) => sendPage(c, (await webhooks.list()).filter((s) => coversMarkets(c.get('scope'), s.markets))));

  app.post('/v1/webhook-subscriptions', async (c) => {
    const r = await readJson(c, 'WebhookSubscriptionRequest');
    if (!r.ok) return r.res;
    marketsAllowed(c, r.body.markets);
    return idempotent(c, r.body, async () => ({ status: 201, body: await webhooks.create(r.body, c.get('principal').subject) }));
  });

  app.get('/v1/webhook-subscriptions/:subscriptionId', async (c) => send(c, await visibleSubscription(c)));

  app.put('/v1/webhook-subscriptions/:subscriptionId', async (c) => {
    const s = await visibleSubscription(c);
    const r = await readJson(c, 'WebhookSubscriptionChange');
    if (!r.ok) return r.res;
    marketsAllowed(c, r.body.markets);
    return send(c, await webhooks.change(s.id, r.body, c.get('principal').subject));
  });

  app.post('/v1/webhook-subscriptions/:subscriptionId/secret-rotations', async (c) => {
    const s = await visibleSubscription(c);
    return idempotent(c, {}, async () => ({ status: 201, body: await webhooks.rotateSecret(s.id, c.get('principal').subject) }));
  });

  app.get('/v1/webhook-subscriptions/:subscriptionId/deliveries', async (c) => {
    const s = await visibleSubscription(c);
    const status = c.req.query('status');
    if (status !== undefined && !['pending', 'delivered', 'dead'].includes(status)) return problem(c, 422, 'status is pending, delivered or dead');
    return sendPage(c, await webhooks.deliveries(s.id, status as 'pending' | 'delivered' | 'dead' | undefined));
  });

  app.post('/v1/webhook-subscriptions/:subscriptionId/deliveries/:deliveryId/retries', async (c) => {
    const s = await visibleSubscription(c);
    return idempotent(c, {}, async () => ({ status: 201, body: await webhooks.retry(s.id, c.req.param('deliveryId') ?? '') }));
  });

  app.post('/v1/webhook-subscriptions/:subscriptionId/delivery-retries', async (c) => {
    const s = await visibleSubscription(c);
    return idempotent(c, {}, async () => ({ status: 201, body: { retried: await webhooks.retryAll(s.id) } }));
  });

  // Deliveries across subscriptions, e.g. every dead one, within the caller's markets.
  app.get('/v1/webhook-deliveries', async (c) => {
    const status = c.req.query('status');
    if (status !== undefined && !['pending', 'delivered', 'dead'].includes(status)) return problem(c, 422, 'status is pending, delivered or dead');
    const subscriptionId = c.req.query('subscriptionId');
    const visible = new Set((await webhooks.list()).filter((s) => coversMarkets(c.get('scope'), s.markets)).map((s) => s.id));
    const items = await webhooks.allDeliveries({ ...(status ? { status: status as 'pending' | 'delivered' | 'dead' } : {}), ...(subscriptionId ? { subscriptionId } : {}) });
    return sendPage(c, items.filter((d) => visible.has(d.subscriptionId)));
  });

  app.get('/v1/settings/notices', async (c) => send(c, await communications.settings()));

  app.get('/v1/settings/notices/versions', async (c) => sendPage(c, await communications.settingsVersions()));

  app.post('/v1/settings/notices/versions', async (c) => {
    const r = await readJson(c, 'ChangeNoticeSettingsRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await communications.changeSettings(r.body, c.get('principal').subject) }));
  });

  app.post('/v1/notices/:noticeId/deliveries', async (c) => {
    const n = await visibleNotice(c);
    const r = await readJson(c, 'DeliveryRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await communications.addDelivery(n.id, r.body, c.get('principal').subject) }));
  });

  // The questions a channel asks before an application (ADR 0031), from the rules in force.
  app.get('/v1/application-questions', async (c) => {
    const productVersion = c.req.query('productVersion') ?? '';
    const species = c.req.query('species') ?? '';
    const [product, version] = productVersion.split('@');
    if (!product || !version || !species) return problem(c, 422, 'Give productVersion, e.g. SE-HUND-BAS@2026.1, and species');
    const v = await products.get(product, version);
    const scope = c.get('scope');
    if (!(scope.markets === '*' || scope.markets.has(v.content.market))) return problem(c, 403, 'Not permitted', 'The market is outside the caller\'s scope');
    const date = c.req.query('date') ?? marketDate(v.content.market, d.clock.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return problem(c, 422, 'date must be YYYY-MM-DD');
    const series = v.content.underwritingSeries;
    if (!series) return problem(c, 409, `${productVersion} has no underwriting rules`);
    const rules = await decisioning.underwritingInForce(series, date);
    if (!rules) return problem(c, 409, `The underwriting series ${series} has no published version in force on ${date}`);
    const lang = c.req.header('accept-language');
    return send(c, {
      productVersion,
      species,
      rules: rules.ref,
      questions: questionsFor(rules.content, species).map((q) => ({ id: q.id, type: q.type, label: labelFor(q.labels, lang), labels: q.labels })),
    });
  });

  app.get('/v1/policies', async (c) => {
    const animalId = c.req.query('animalId');
    const partyId = c.req.query('policyholderPartyId');
    if ((animalId === undefined) === (partyId === undefined)) return problem(c, 422, 'Give exactly one of animalId or policyholderPartyId');
    const found = animalId !== undefined ? await policies.findByAnimal(animalId) : await policies.findByPolicyholder(partyId!);
    return sendPage(c, found.filter((p) => seesPolicy(c.get('scope'), p)));
  });

  app.get('/v1/policies/:policyId', async (c) => send(c, await visiblePolicy(c)));

  app.post('/v1/policies/:policyId/cancellations', async (c) => {
    const p = await visiblePolicy(c);
    const r = await readJson(c, 'CancelPolicyRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.cancel(p.id, r.body, c.get('principal').subject) }));
  });

  // Price indication (ADR 0030). Nothing is stored. A caller bound to a clinic or
  // to policies gives the facts itself: it may not read animals or parties.
  app.post('/v1/quotes', async (c) => {
    const r = await readJson(c, 'QuoteRequest');
    if (!r.ok) return r.res;
    const scope = c.get('scope');
    if (!(scope.markets === '*' || scope.markets.has(r.body.market))) return problem(c, 403, 'Not permitted', 'The market is outside the caller\'s scope');
    if ((scope.clinicId || scope.policyIds) && (r.body.animalId !== undefined || r.body.policyholderPartyId !== undefined || r.body.groupId !== undefined)) {
      return problem(c, 403, 'Not permitted', 'Give the animal and the postal code instead of ids');
    }
    return send(c, await policies.quote(r.body));
  });

  app.post('/v1/policies/:policyId/changes', async (c) => {
    const p = await visiblePolicy(c);
    const r = await readJson(c, 'ChangePolicyRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.change(p.id, r.body, c.get('principal').subject, priceRights(c)) }));
  });

  app.post('/v1/policies/:policyId/renewals', async (c) => {
    const p = await visiblePolicy(c);
    const r = await readJson(c, 'RenewPolicyRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.renew(p.id, r.body, c.get('principal').subject, priceRights(c)) }));
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
    return sendPage(c, items.filter((pr) => inScope(c, pr)));
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
    const holderPartyId = c.req.query('policyholderPartyId');
    const policyId = c.req.query('policyId');
    if ((holderPartyId === undefined) === (policyId === undefined)) return problem(c, 422, 'Give exactly one of policyholderPartyId or policyId');
    const found = await policies.findGroups(holderPartyId !== undefined ? { holderPartyId } : { policyId: policyId! });
    return sendPage(c, found.filter((g) => seesGroup(c, g)));
  });

  app.get('/v1/policy-groups/:groupId', async (c) => send(c, await visibleGroup(c)));

  app.post('/v1/policy-groups/:groupId/members', async (c) => {
    const g = await visibleGroup(c);
    const r = await readJson(c, 'AddGroupMemberRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.addMember(g.id, r.body, c.get('principal').subject) }));
  });

  app.post('/v1/policy-groups/:groupId/members/:policyId/endings', async (c) => {
    const g = await visibleGroup(c);
    const r = await readJson(c, 'EndGroupMemberRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await policies.endMember(g.id, c.req.param('policyId'), r.body, c.get('principal').subject) }));
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

  app.get('/v1/settings/retention', async (c) => send(c, await retention.current()));

  app.get('/v1/settings/retention/versions', async (c) => sendPage(c, await retention.versions()));

  app.post('/v1/settings/retention/versions', async (c) => {
    const r = await readJson(c, 'ChangeRetentionRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await retention.change(r.body, c.get('principal').subject) }));
  });


  app.get('/v1/parties/:partyId/revisions', async (c) => sendPage(c, await parties.revisions((await visibleParty(c)).id)));

  app.post('/v1/parties/:partyId/identifiers', async (c) => {
    const p = await visibleParty(c);
    const r = await readJson(c, 'PartyIdentifierInput');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: publicView(await parties.addIdentifier(p.id, r.body, c.get('principal').subject)) }));
  });

  // The party's life cycle (ADR 0039): numbers removed, restriction set and lifted, ended and reopened.
  app.post('/v1/parties/:partyId/identifiers/:identifierId/removals', async (c) => {
    const p = await visibleParty(c);
    const r = await readJson(c, 'ReasonRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({
      status: 201,
      body: publicView(await parties.removeIdentifier(p.id, c.req.param('identifierId'), r.body, c.get('principal').subject)),
    }));
  });

  app.post('/v1/parties/:partyId/restrictions', async (c) => {
    const p = await visibleParty(c);
    const r = await readJson(c, 'RestrictPartyRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: publicView(await parties.restrict(p.id, r.body, c.get('principal').subject)) }));
  });

  app.post('/v1/parties/:partyId/restriction-liftings', async (c) => {
    const p = await visibleParty(c);
    const r = await readJson(c, 'ReasonRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: publicView(await parties.liftRestriction(p.id, r.body, c.get('principal').subject)) }));
  });

  app.post('/v1/parties/:partyId/endings', async (c) => {
    const p = await visibleParty(c);
    const r = await readJson(c, 'EndPartyRequest');
    if (!r.ok) return r.res;
    // A policyholder of a policy in force is not ended: the policy is cancelled or transferred first.
    const today = marketDate(p.market, d.clock.now());
    const inForce = (await policies.findByPolicyholder(p.id))
      .filter((x) => x.versions.some((v) => v.status === 'active' && v.policyholderPartyId === p.id && v.validTo > today))
      .map((x) => x.id);
    if (inForce.length) return problem(c, 409, 'Conflict', `Party ${p.id} is the policyholder of policies in force: ${inForce.join(', ')}. Cancel or transfer them first.`);
    return idempotent(c, r.body, async () => ({ status: 201, body: publicView(await parties.end(p.id, r.body, c.get('principal').subject)) }));
  });

  app.post('/v1/parties/:partyId/reopenings', async (c) => {
    const p = await visibleParty(c);
    const r = await readJson(c, 'ReasonRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: publicView(await parties.reopen(p.id, r.body, c.get('principal').subject)) }));
  });

  // Who the caller is, for a user interface. Only a valid token is needed (x-permission signed-in).
  app.get('/v1/me', (c) => {
    const p = c.get('principal');
    const roles = c.get('roles');
    const scope = c.get('scope');
    const permissions = permissionsOf(p.roles, roles);
    return send(c, {
      subject: p.subject,
      roles: p.roles.filter((r) => Object.hasOwn(roles, r)),
      ...(p.roles.some((r) => !Object.hasOwn(roles, r)) ? { unknownRoles: p.roles.filter((r) => !Object.hasOwn(roles, r)) } : {}),
      permissions: [...permissions].sort(),
      scope: {
        markets: scope.markets === '*' ? '*' : [...scope.markets].sort(),
        ...(scope.clinicId ? { clinicId: scope.clinicId } : {}),
        ...(scope.policyIds ? { policyIds: [...scope.policyIds].sort() } : {}),
      },
      ...(permissions.has('claims:decide') ? { decisionLimits: amountLimitsOf(p.roles, roles, 'decide') } : {}),
      ...(permissions.has('claims:approve') ? { approvalLimits: amountLimitsOf(p.roles, roles, 'approve') } : {}),
    });
  });

  app.get('/v1/settings/roles', async (c) => send(c, await access.current()));

  app.get('/v1/settings/roles/versions', async (c) => sendPage(c, await access.versions()));

  app.post('/v1/settings/roles/versions', async (c) => {
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
    if (!isOperationPermission(contractPermissions.get(op))) throw new Error(`${op} has no valid x-permission in the contract`);
  }

  // Documents (ADR 0038): files in the archive, opened through links that expire.
  const documents =
    d.documents ??
    new DocumentService({
      store: new InMemoryDocumentStore(),
      blobs: new InMemoryBlobStore(),
      clock: d.clock,
      ids: { next: (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}` },
      signingKey: crypto.getRandomValues(new Uint8Array(32)),
      publicBaseUrl: 'http://localhost',
    });
  const can = (c: Context<Env>, p: Permission) => permissionsOf(c.get('principal').roles, c.get('roles')).has(p);
  /**
   * Whether the caller may see a document: the right to what it belongs to,
   * within the scope (ADR 0038 point 6). A claim's document follows the claim.
   */
  const seesDocument = async (c: Context<Env>, doc: StoredDocument): Promise<boolean> => {
    const scope = c.get('scope');
    // A notice's document follows the notice, also when the notice is about a claim.
    if (doc.owner.noticeId) {
      if (!can(c, 'notices:read')) return false;
      const n = await communications.get(doc.owner.noticeId).catch(() => null);
      return !!n && seesNotice(scope, n);
    }
    if (doc.owner.claimId) {
      if (!can(c, 'claims:read')) return false;
      const claim = await d.service.getClaim(doc.owner.claimId).catch(() => null);
      return !!claim && coversClaim(scope, claim);
    }
    return !!doc.owner.policyId && can(c, 'policies:read') && !scope.clinicId && coversPolicy(scope, doc.market, doc.owner.policyId);
  };
  const visibleDocument = async (c: Context<Env>): Promise<StoredDocument> => {
    const id = c.req.param('documentId') ?? '';
    const doc = await documents.get(id).catch((e: unknown) => {
      if (e instanceof DocumentError && e.code === 'not_found') return null;
      throw e;
    });
    if (!doc || !(await seesDocument(c, doc))) throw new DocumentError('not_found', `Document ${id} does not exist`);
    return doc;
  };

  app.post('/v1/claims/:claimId/documents', async (c) => {
    const claim = await d.service.getClaim(c.req.param('claimId'));
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_UPLOAD_BYTES + 64 * 1024) return problem(c, 422, `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    const form = await c.req.parseBody().catch(() => null);
    const file = form?.file;
    if (!(file instanceof File)) return problem(c, 422, 'The request is multipart/form-data with the file in the part file');
    const bytes = new Uint8Array(await file.arrayBuffer());
    // The policyholder on the first day of treatment: the customer the claim's documents concern.
    const policy = await policies.get(claim.policyId).catch(() => null);
    const known = policy?.versions.filter((v) => !v.sysTo) ?? [];
    const holder = (known.find((v) => v.validFrom <= claim.treatmentFrom && claim.treatmentFrom < v.validTo) ?? known.at(-1))?.policyholderPartyId;
    return idempotent(c, { sha256: sha256(bytes), name: file.name, type: file.type }, async () => ({
      status: 201,
      body: await documents.upload(
        { bytes, mediaType: file.type, filename: file.name, owner: { claimId: claim.id, policyId: claim.policyId }, partyIds: holder ? [holder] : [], market: claim.market },
        c.get('principal').subject,
      ),
    }));
  });

  app.get('/v1/documents', async (c) => {
    const q = (k: string) => c.req.query(k);
    const filter = {
      ...(q('partyId') ? { partyId: q('partyId')! } : {}),
      ...(q('claimId') ? { claimId: q('claimId')! } : {}),
      ...(q('policyId') ? { policyId: q('policyId')! } : {}),
      ...(q('noticeId') ? { noticeId: q('noticeId')! } : {}),
    };
    if (filter.partyId && !can(c, 'parties:read')) return problem(c, 403, 'Not permitted', 'A customer\'s documents need the permission parties:read');
    const found = await documents.list(filter);
    const visible: StoredDocument[] = [];
    for (const doc of found) if (await seesDocument(c, doc)) visible.push(doc);
    return sendPage(c, visible);
  });

  app.get('/v1/documents/:documentId', async (c) => send(c, await visibleDocument(c)));

  /**
   * A notice as a PDF from Petvold's template (ADR 0038 point 3): the notice's
   * content, and the recipient's name and address, the animal's name and the
   * reasons' texts read now. The document belongs to the notice and concerns
   * its recipient. Making it again gives a new document.
   */
  app.post('/v1/notices/:noticeId/documents', async (c) => {
    const n = await visibleNotice(c);
    const r = await readJson(c, 'Empty');
    if (!r.ok) return r.res;
    return idempotent(c, { noticeId: n.id }, async () => ({
      status: 201,
      body: await makeNoticePdf({ documents, communications, parties, animals, clock: d.clock }, n, c.get('principal').subject),
    }));
  });

  /**
   * Every document about a customer in one list (ADR 0038 point 8), wherever
   * the file is: Petvold's archive, notices the insurer's document system sent,
   * and claim attachments in the insurer's archive. Only what the caller may
   * see: each kind needs its own permission, within the scope.
   */
  app.get('/v1/parties/:partyId/documents', async (c) => {
    const party = await visibleParty(c);
    const scope = c.get('scope');
    const out: Record<string, unknown>[] = [];
    // Claims on the party's policies, for their attachments.
    const claimsOf = async () => {
      if (!can(c, 'claims:read')) return [];
      const policyIds = (await policies.findByPolicyholder(party.id)).map((p) => p.id);
      const all = (await Promise.all(policyIds.map((policyId) => d.service.listClaims({ policyId })))).flat();
      return all.filter((x) => coversClaim(scope, x));
    };
    const claims = await claimsOf();
    const attachments = (await Promise.all(claims.map(async (x) => (await d.service.getAttachments(x.id)).map((a) => ({ ...a, claimNo: x.claimNo, policyId: x.policyId }))))).flat();
    const kindOf = new Map(attachments.flatMap((a) => (a.url.startsWith('urn:petvold:doc:') ? [[a.url.slice('urn:petvold:doc:'.length), a.kind] as const] : [])));
    if (can(c, 'documents:read')) {
      for (const doc of await documents.list({ partyId: party.id })) {
        if (!(await seesDocument(c, doc))) continue;
        out.push({
          source: 'petvold',
          type: doc.owner.noticeId ? 'notice' : 'attachment',
          at: doc.createdAt,
          documentId: doc.id,
          mediaType: doc.mediaType,
          size: doc.size,
          sha256: doc.sha256,
          // A notice's PDF names its notice; the template is named after the notice type.
          ...(doc.owner.noticeId ? { noticeId: doc.owner.noticeId, ...(doc.template ? { noticeType: doc.template.name } : {}) } : {}),
          ...(kindOf.get(doc.id) ? { kind: kindOf.get(doc.id) } : {}),
          ...(doc.filename ? { filename: doc.filename } : {}),
          ...(doc.owner.claimId ? { claimId: doc.owner.claimId } : {}),
          ...(doc.owner.policyId ? { policyId: doc.owner.policyId } : {}),
          ...(doc.erasedAt ? { erased: true } : {}),
        });
      }
    }
    for (const a of attachments) {
      if (a.url.startsWith('urn:petvold:doc:')) continue;
      out.push({ source: 'insurer', type: 'attachment', at: a.addedAt, kind: a.kind, mediaType: a.mediaType, size: a.size, sha256: a.sha256, url: a.url, claimId: a.claimId, policyId: a.policyId, attachmentId: a.id });
    }
    if (can(c, 'notices:read')) {
      for (const n of await communications.list({ recipientPartyId: party.id })) {
        if (!seesNotice(scope, n)) continue;
        // A PDF Petvold made is in its archive and in the list already.
        if (n.document) continue;
        const sent = n.deliveries.find((x) => x.outcome === 'sent' && x.documentId);
        if (!sent) continue;
        out.push({
          source: 'insurer',
          type: 'notice',
          at: sent.sentAt,
          noticeType: n.type,
          noticeId: n.id,
          archiveId: sent.documentId,
          sha256: sent.sha256,
          channel: sent.channel,
          ...(n.policyId ? { policyId: n.policyId } : {}),
          ...(typeof n.content.claimId === 'string' ? { claimId: n.content.claimId } : {}),
        });
      }
    }
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return sendPage(c, out);
  });

  app.get('/v1/documents/:documentId/links', async (c) => sendPage(c, await documents.links((await visibleDocument(c)).id)));

  app.post('/v1/documents/:documentId/links', async (c) => {
    const doc = await visibleDocument(c);
    const r = await readJson(c, 'DocumentLinkRequest');
    if (!r.ok) return r.res;
    if (r.body.audience === 'customer' && !can(c, 'documents:share')) return problem(c, 403, 'Not permitted', 'A link for the customer needs the permission documents:share');
    return idempotent(c, r.body, async () => ({ status: 201, body: await documents.createLink(doc.id, r.body, c.get('principal').subject) }));
  });

  app.post('/v1/documents/:documentId/links/:linkId/revocations', async (c) => {
    const doc = await visibleDocument(c);
    const r = await readJson(c, 'Empty');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await documents.revokeLink(doc.id, c.req.param('linkId'), c.get('principal').subject) }));
  });

  // A link opens the file without a token: the signed, expiring address is the
  // permission (ADR 0038 point 5). Outside the contract, like /healthz.
  app.get('/d/:token', async (c) => {
    try {
      const { document, bytes } = await documents.open(c.req.param('token'));
      const ext = document.mediaType === 'application/pdf' ? 'pdf' : document.mediaType.split('/')[1];
      return c.body(new Uint8Array(bytes), 200, {
        'content-type': document.mediaType,
        'content-length': String(bytes.length),
        'content-disposition': `inline; filename="document.${ext}"`,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      });
    } catch (e) {
      if (e instanceof DocumentError && e.code === 'gone') return problem(c, 410, 'The link does not work');
      throw e;
    }
  });

  // A payment service tells Petvold of payments (ADR 0017). Without a token: the
  // adapter checks the service's signature, which is the permission. Outside the
  // contract, like /d/:token, since the body is the service's own format.
  app.post('/provider-notifications/:provider', async (c) => {
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > 1_000_000) return problem(c, 413, 'The notification is too large');
    const body = await c.req.text();
    if (body.length > 1_000_000) return problem(c, 413, 'The notification is too large');
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    try {
      const r = await payments.receive(c.req.param('provider'), { headers, body });
      return c.json({ received: r.received.length, duplicates: r.duplicates.length }, 200);
    } catch (e) {
      if (e instanceof PaymentsError && e.code === 'unknown_provider') return problem(c, 404, 'The resource does not exist');
      if (e instanceof ProviderNotificationError) return problem(c, e.code === 'unauthenticated' ? 401 : 400, e.message);
      throw e;
    }
  });

  app.notFound((c) => problem(c, 404, 'The resource does not exist'));

  app.onError((err, c) => {
    if (err instanceof RuleSetError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 403 : 422;
      return problem(c, status, err.message);
    }
    if (err instanceof PolicyError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 403 : 422;
      return problem(c, status, err.message);
    }
    if (err instanceof WebhookError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 403 : 422;
      return problem(c, status, err.message);
    }
    if (err instanceof BillingError) {
      return problem(c, err.code === 'not_found' ? 404 : 422, err.message);
    }
    if (err instanceof PaymentsError) {
      return problem(c, err.code === 'not_found' ? 404 : 422, err.message);
    }
    if (err instanceof CommunicationsError) {
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
    if (err instanceof JobError) {
      return problem(c, err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 403 : 422, err.message);
    }
    if (err instanceof DocumentError) {
      if (err.code === 'unavailable') return c.body(JSON.stringify({ type: 'https://errors.petvold.dev/503', title: err.message, status: 503 }), 503, { 'content-type': PROBLEM });
      return problem(c, err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'gone' ? 410 : 422, err.message);
    }
    if (err instanceof DomainError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 403 : 422;
      return problem(c, status, err.message);
    }
    console.error(err);
    return problem(c, 500, 'Internal error');
  });

  // Runs (ADR 0037): the jobs, their history, pause and run now, and the relay's
  // dead letters. Scope: a job's markets are those within the caller's markets.
  const scheduler =
    d.scheduler ??
    new Scheduler({
      store: new InMemorySchedulingStore(),
      clock: d.clock,
      jobs: defaultJobs({ policies, retention, claims: d.service, billing }),
      // As the installation does: markets with a product or a retention rule.
      markets: async () =>
        [...new Set([...(await products.allProducts()).flatMap((p) => p.versions.map((v) => v.content.market)), ...Object.keys((await retention.current()).markets)])].sort(),
      holder: 'api',
    });
  const runners = jobRunners({ policies, retention, claims: d.service, billing }) as unknown as Record<string, JobRunner<unknown>>;
  const byName = new Map(Object.values(runners).map((r) => [r.name, r]));
  const controlId = () => `ctl_${crypto.randomUUID().replaceAll('-', '')}`;
  const scopedMarkets = async (c: Context<Env>) => {
    const all = await scheduler.markets();
    const m = c.get('scope').markets;
    return m === '*' ? all : all.filter((x) => m.has(x));
  };
  const jobView = async (job: string, markets: string[]) => {
    const def = scheduler.job(job)!;
    const schedule = await scheduler.schedule(job);
    const paused = (await scheduler.store.pauses()).find((p) => p.job === job);
    const pendingChange = (await scheduler.store.changes(job, 20)).find((x) => x.status === 'pending');
    const now = d.clock.now();
    return {
      id: def.name,
      schedule,
      ...(paused ? { paused } : {}),
      ...(pendingChange ? { pendingChange } : {}),
      markets: await Promise.all(
        markets.map(async (market) => {
          const [lastRun] = await scheduler.store.listRuns({ job, market, limit: 1 });
          const next =
            !paused && schedule.enabled && schedule.kind === 'daily' ? nextDailyRun(schedule.at, market, now, await scheduler.store.lastScheduledRun(job, market)) : undefined;
          return { market, ...(next ? { nextRunAt: next } : {}), ...(lastRun ? { lastRun } : {}) };
        }),
      ),
    };
  };
  const requireJob = (c: Context<Env>) => {
    const name = c.req.param('job')!;
    if (!scheduler.job(name)) throw new JobError('not_found', `Job ${name} does not exist`);
    return name;
  };

  app.get('/v1/jobs', async (c) => {
    const markets = await scopedMarkets(c);
    return sendPage(c, await Promise.all(scheduler.jobs.map((j) => jobView(j.name, markets))));
  });

  app.get('/v1/jobs/:job', async (c) => {
    const job = requireJob(c);
    return send(c, { ...(await jobView(job, await scopedMarkets(c))), controls: await scheduler.store.controls(job, 20) });
  });

  app.get('/v1/jobs/:job/runs', async (c) => {
    const job = requireJob(c);
    const markets = new Set(await scopedMarkets(c));
    const market = c.req.query('market');
    const runs = await scheduler.store.listRuns({ job, ...(market ? { market } : {}), limit: 2000 });
    return sendPage(c, runs.filter((r) => markets.has(r.market)));
  });

  app.post('/v1/jobs/:job/runs', async (c) => {
    const job = requireJob(c);
    const r = await readJson(c, 'RunJobRequest');
    if (!r.ok) return r.res;
    if (!(await scopedMarkets(c)).includes(r.body.market)) return problem(c, 422, `Market ${r.body.market} is not one of this installation's markets within your scope`);
    return idempotent(c, r.body, async () => {
      const run = await scheduler.run(scheduler.job(job)!, r.body.market, { trigger: 'manual', by: c.get('principal').subject, dryRun: r.body.dryRun ?? false });
      if (!run || run.status === 'skipped') throw new JobError('conflict', `${job} is running in ${r.body.market} on another server`);
      return { status: 201, body: run };
    });
  });

  app.post('/v1/jobs/:job/pauses', async (c) => {
    const job = requireJob(c);
    const r = await readJson(c, 'JobControlRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => {
      const by = c.get('principal').subject;
      const at = d.clock.now();
      const reason = r.body.reason.trim();
      const pause = { job, pausedBy: by, pausedAt: at, reason };
      await (scheduler.store.pause(pause, { id: controlId(), job, action: 'pause', by, at, reason }));
      return { status: 201, body: pause };
    });
  });

  app.post('/v1/jobs/:job/resumptions', async (c) => {
    const job = requireJob(c);
    const r = await readJson(c, 'JobControlRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => {
      const control = { id: controlId(), job, action: 'resume' as const, by: c.get('principal').subject, at: d.clock.now(), reason: r.body.reason.trim() };
      await (scheduler.store.resume(job, control));
      return { status: 201, body: control };
    });
  });

  // Schedule changes with four eyes (ADR 0037): one person proposes, another approves.
  app.get('/v1/jobs/:job/schedule-changes', async (c) => sendPage(c, await scheduler.store.changes(requireJob(c), 1000)));

  app.post('/v1/jobs/:job/schedule-changes', async (c) => {
    const job = requireJob(c);
    if (scheduler.job(job)!.schedule.kind !== 'daily') return problem(c, 422, `${job} has no time of day`);
    const r = await readJson(c, 'ProposeScheduleChangeRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => {
      const change = {
        id: `jsc_${crypto.randomUUID().replaceAll('-', '')}`,
        job,
        at: r.body.at,
        enabled: r.body.enabled,
        reason: r.body.reason.trim(),
        proposedBy: c.get('principal').subject,
        proposedAt: d.clock.now(),
        status: 'pending' as const,
      };
      await scheduler.store.proposeChange(change);
      return { status: 201, body: change };
    });
  });

  const requireChange = async (c: Context<Env>, job: string) => {
    const change = await scheduler.store.getChange(c.req.param('changeId')!);
    if (!change || change.job !== job) throw new JobError('not_found', `Change ${c.req.param('changeId')} does not exist`);
    return change;
  };

  app.post('/v1/jobs/:job/schedule-changes/:changeId/approvals', async (c) => {
    const job = requireJob(c);
    const change = await requireChange(c, job);
    return idempotent(c, {}, async () => {
      await scheduler.store.approveChange(change.id, c.get('principal').subject, d.clock.now());
      return { status: 201, body: await scheduler.store.getChange(change.id) };
    });
  });

  app.post('/v1/jobs/:job/schedule-changes/:changeId/rejections', async (c) => {
    const job = requireJob(c);
    const change = await requireChange(c, job);
    const r = await readJson(c, 'JobControlRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => ({ status: 201, body: await scheduler.store.rejectChange(change.id, c.get('principal').subject, d.clock.now(), r.body.reason.trim()) }));
  });

  app.get('/v1/relay-dead-letters', async (c) =>
    sendPage(
      c,
      (await scheduler.store.deadLetters()).map((x) => ({ id: `${x.source}:${x.eventId}`, ...x })),
    ),
  );

  app.post('/v1/relay-dead-letters/:deadLetter/retries', async (c) => {
    const id = c.req.param('deadLetter');
    const at = id.indexOf(':');
    const [source, eventId] = [id.slice(0, at), id.slice(at + 1)];
    return idempotent(c, {}, async () => {
      const had = d.relay ? await d.relay.retryDeadLetter(source, eventId) : await scheduler.store.removeDeadLetter(source, eventId);
      if (!had) throw new JobError('not_found', `Dead letter ${id} does not exist`);
      return { status: 204, body: null };
    });
  });

  /**
   * The old run operations (ADR 0037): the same jobs, one run per market in the
   * caller's scope, kept in the history as 'api', joined into the response they
   * always gave. A domain error from a market is answered as before.
   */
  const runForCaller = async (c: Context<Env>, job: string, dryRun: boolean) => {
    const runner = byName.get(job)!;
    const fulls: unknown[] = [];
    let failure: unknown;
    for (const market of await scopedMarkets(c)) {
      const run = await scheduler.run(scheduler.job(job)!, market, { trigger: 'api', by: c.get('principal').subject, dryRun }, async (ctx) => {
        try {
          const full = await runner.execute(ctx);
          fulls.push(full);
          return runner.summarize(full);
        } catch (e) {
          failure = e;
          throw e;
        }
      });
      if (failure) throw failure;
      if (!run || run.status === 'skipped') throw new JobError('conflict', `${job} is running in ${market} on another server`);
    }
    return runner.join(fulls, { dryRun, onDate: marketDate(undefined, d.clock.now()) });
  };
  const notBound = (c: Context<Env>) => {
    const scope = c.get('scope');
    return !!(scope.clinicId || scope.policyIds);
  };

  app.post('/v1/application-expiry-runs', async (c) => {
    if (notBound(c)) return problem(c, 403, 'Not permitted', 'A role bound to a clinic or to policies cannot run this');
    return send(c, await runForCaller(c, 'policies.application-expiry', false));
  });

  app.post('/v1/policy-proposal-expiry-runs', async (c) => {
    if (notBound(c)) return problem(c, 403, 'Not permitted', 'A role bound to a clinic or to policies cannot run this');
    return send(c, await runForCaller(c, 'policies.proposal-expiry', false));
  });

  app.post('/v1/renewal-runs', async (c) => {
    const r = await readJson(c, 'RenewalRunRequest');
    if (!r.ok) return r.res;
    if (notBound(c)) return problem(c, 403, 'Not permitted', 'A role bound to a clinic or to policies cannot run renewals');
    return send(c, await runForCaller(c, 'policies.renewal', r.body.dryRun ?? false));
  });

  app.post('/v1/retention-runs', async (c) => {
    const r = await readJson(c, 'RetentionRunRequest');
    if (!r.ok) return r.res;
    return send(c, await runForCaller(c, 'parties.retention', r.body.dryRun ?? false));
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
