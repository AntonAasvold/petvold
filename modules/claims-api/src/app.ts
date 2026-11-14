import { Hono, type Context } from 'hono';
import type { Claim, ClaimsService, Clock } from '@petvold/claims-core';
import { DomainError } from '@petvold/claims-core';
import { formatErrors, openapiText, operationPermissions, validatorFor, type FieldError } from './contract.ts';
import { routePath } from 'hono/route';
import { assertRolePermissions, DEFAULT_ROLES, isPermission, permissionsOf, type RolePermissions } from './permissions.ts';
import { localizeDeep, pickLocale } from './messages.ts';

/** Who is calling. Comes from a JWT in production (e.g. the insurer's identity provider, or OAuth for clinics). */
export interface Principal {
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
  /** Role -> permissions for this installation (ADR 0016). Defaults to DEFAULT_ROLES. */
  roles?: RolePermissions;
}

type Env = { Variables: { principal: Principal } };

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
  const roles = d.roles ?? DEFAULT_ROLES;
  assertRolePermissions(roles);
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
      const permission = contractPermissions.get(operationKey(c.req.method, route));
      if (!isPermission(permission) || !permissionsOf(principal.roles, roles).has(permission)) {
        return problem(c, 403, 'Not permitted', isPermission(permission) ? `Requires the permission ${permission}` : undefined);
      }
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
    return idempotent(c, r.body, async () => {
      const claim: Claim = { ...r.body, receivedAt: d.clock.now() };
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
      const decision = await d.service.decide(c.req.param('claimId'), { ...r.body, decidedBy: p.subject });
      return { status: 201, body: decision };
    });
  });

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
    const draft: Claim = { ...r.body, receivedAt: d.clock.now() };
    return send(c, await d.service.preview(draft));
  });

  app.get('/v1/policies/:policyId/animals/:animalId/limits', async (c) => {
    const onDate = c.req.query('onDate');
    if (!onDate) return problem(c, 422, 'onDate is required');
    return send(c, await d.service.getLimits(c.req.param('policyId'), c.req.param('animalId'), onDate));
  });

  // Every operation must have a valid permission in the contract, so a new
  // operation is closed until someone has decided who may call it.
  for (const op of implementedOperations(app)) {
    if (!isPermission(contractPermissions.get(op))) throw new Error(`${op} has no valid x-permission in the contract`);
  }

  app.notFound((c) => problem(c, 404, 'The resource does not exist'));

  app.onError((err, c) => {
    if (err instanceof DomainError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 422;
      return problem(c, status, err.message);
    }
    console.error(err);
    return problem(c, 500, 'Internal error');
  });

  return app;
}

/** A Hono route as 'METHOD /path' in OpenAPI format. */
function operationKey(method: string, honoPath: string): string {
  return `${method} ${honoPath.replace(/:([A-Za-z]+)/g, '{$1}')}`;
}

/** Hono routes as 'METHOD /path' in OpenAPI format, for the contract check. */
export function implementedOperations(app: Hono<any>): string[] {
  return app.routes.filter((r) => r.path.startsWith('/v1/') && r.method !== 'ALL').map((r) => operationKey(r.method, r.path));
}
