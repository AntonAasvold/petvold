import { Hono, type Context } from 'hono';
import type { Claim, ClaimsService, Clock } from '@petvold/claims-core';
import { DomainError } from '@petvold/claims-core';
import { formatErrors, openapiText, validatorFor, type FieldError } from './contract.ts';
import { localizeDeep, pickLocale } from './messages.ts';

/** Vem som anropar. Kommer från JWT i drift (t.ex. Supabase Auth eller OAuth för kliniker). */
export interface Principal {
  subject: string;
  roles: Array<'handler' | 'approver' | 'clinic' | 'system'>;
}

export interface Authenticator {
  authenticate(bearerToken: string | undefined): Promise<Principal | null>;
}

/** Sparar svar per idempotensnyckel. Postgres-tabell i drift. */
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
    return { ok: false, res: problem(c, 422, 'Ogiltig JSON') };
  }
  const v = validatorFor(schema);
  if (!v(body)) return { ok: false, res: problem(c, 422, 'Begäran följer inte kontraktet', undefined, formatErrors(v.errors)) };
  return { ok: true, body };
}

/** JSON-svar med regeltexter på det språk anroparen bett om. */
function send(c: Context, body: unknown, status = 200) {
  const locale = pickLocale(c.req.header('accept-language'));
  return c.body(JSON.stringify(localizeDeep(body, locale)), status as 200, {
    'content-type': 'application/json',
    'content-language': locale,
    vary: 'Accept-Language',
  });
}

function requireRole(p: Principal, ...roles: Principal['roles']): boolean {
  return p.roles.some((r) => roles.includes(r) || r === 'system');
}

/**
 * HTTP-lagret. Tunt med avsikt: validera mot kontraktet, autentisera,
 * hantera idempotens, anropa tjänsten och översätt domänfel till problem+json.
 */
export function createApp(d: AppDeps) {
  const app = new Hono<Env>();

  app.get('/openapi.yaml', (c) => c.body(openapiText, 200, { 'content-type': 'application/yaml' }));
  app.get('/health', (c) => c.json({ ok: true }));

  app.use('/v1/*', async (c, next) => {
    const header = c.req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const principal = await d.auth.authenticate(token);
    if (!principal) return problem(c, 401, 'Inte autentiserad');
    c.set('principal', principal);
    await next();
  });

  /** Kör en skapande operation exakt en gång per Idempotency-Key. */
  async function idempotent(c: Context<Env>, body: unknown, run: () => Promise<{ status: number; body: unknown }>) {
    const key = c.req.header('idempotency-key');
    if (!key || key.length < 8 || key.length > 128) {
      return problem(c, 422, 'Idempotency-Key saknas eller har fel längd (8–128 tecken)');
    }
    const scoped = `${c.get('principal').subject}:${c.req.method}:${c.req.path}:${key}`;
    const fingerprint = JSON.stringify(body);
    const prior = await d.idempotency.get(scoped);
    if (prior) {
      if (prior.fingerprint !== fingerprint) return problem(c, 422, 'Idempotency-Key återanvänd med annan begäran');
      return prior.status === 204 ? c.body(null, 204) : send(c, prior.body, prior.status);
    }
    const result = await run();
    await d.idempotency.put(scoped, { fingerprint, ...result });
    return result.status === 204 ? c.body(null, 204) : send(c, result.body, result.status);
  }

  app.post('/v1/claims', async (c) => {
    if (!requireRole(c.get('principal'), 'handler', 'clinic')) return problem(c, 403, 'Saknar behörighet');
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
    if (knownAt !== undefined && Number.isNaN(Date.parse(knownAt))) return problem(c, 422, 'knownAt är inte en giltig tidpunkt');
    return send(c, await d.service.assessClaim(c.req.param('claimId'), knownAt));
  });

  app.get('/v1/claims/:claimId/decisions', async (c) => send(c, { items: await d.service.getDecisions(c.req.param('claimId')) }));

  app.post('/v1/claims/:claimId/decisions', async (c) => {
    const p = c.get('principal');
    if (!requireRole(p, 'handler', 'approver')) return problem(c, 403, 'Saknar behörighet');
    const r = await readJson(c, 'DecideRequest');
    if (!r.ok) return r.res;
    return idempotent(c, r.body, async () => {
      const decision = await d.service.decide(c.req.param('claimId'), { ...r.body, decidedBy: p.subject });
      return { status: 201, body: decision };
    });
  });

  app.post('/v1/claims/:claimId/reassessments', async (c) => {
    const p = c.get('principal');
    if (!requireRole(p, 'handler', 'approver')) return problem(c, 403, 'Saknar behörighet');
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
    if (!onDate) return problem(c, 422, 'onDate krävs');
    return send(c, await d.service.getLimits(c.req.param('policyId'), c.req.param('animalId'), onDate));
  });

  app.notFound((c) => problem(c, 404, 'Resursen finns inte'));

  app.onError((err, c) => {
    if (err instanceof DomainError) {
      const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 422;
      return problem(c, status, err.message);
    }
    console.error(err);
    return problem(c, 500, 'Internt fel');
  });

  return app;
}

/** Hono-routes som 'METHOD /path' i OpenAPI-format, för kontraktskontrollen. */
export function implementedOperations(app: Hono<any>): string[] {
  return app.routes
    .filter((r) => r.path.startsWith('/v1/') && r.method !== 'ALL')
    .map((r) => `${r.method} ${r.path.replace(/:([A-Za-z]+)/g, '{$1}')}`);
}
