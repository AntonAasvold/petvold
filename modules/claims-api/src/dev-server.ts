/**
 * Local development server with sample data for Bella.
 *
 * Storage: Postgres when CLAIMS_DATABASE_URL is set (in .env after
 * `npm run dev:up`), so claims, decisions and the ledger survive restarts.
 * Without it everything lives in memory. Policies and rules are always the
 * in-memory sample data until the policy and product modules exist.
 *
 * Tokens: 'dev-handler' (claims handler), 'dev-clinic' (clinic), 'dev-job'
 * (reassessment job). Roles map to permissions with DEFAULT_ROLES (ADR 0016).
 * The API page is at /docs and example requests are in examples/claims.http.
 */
import { randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import { ClaimsService, relayOutbox, type ClaimsEvent, type ClaimsOutbox, type ClaimsStore } from '@petvold/claims-core';
import { InMemoryClaimsStore, InMemoryPolicyPort, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';
import { createPool, PostgresClaimsStore, PostgresIdempotencyStore } from '@petvold/claims-store-postgres';
import { createApp, InMemoryIdempotencyStore, type IdempotencyStore, type Principal } from './index.ts';
import { docsPage } from './docs.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env: run in memory.
}

const clock = { now: () => new Date().toISOString() };
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

const service = new ClaimsService({
  policies: new InMemoryPolicyPort([{ snapshot: fixtures.bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]),
  rules: new StaticRulesPort({ [fixtures.PRODUCT]: fixtures.RULES_SE_DOG }, fixtures.RULES_SE_DOG),
  store,
  clock,
  ids,
});

// The relay publishes events from the outbox. Here it just logs them.
const logSink = {
  publish: async (e: ClaimsEvent) =>
    console.log(`[event] ${e.type} ${e.type === 'claim.registered' ? e.claim.id : `${e.decision.claimId}#${e.decision.seq}`}`),
};
setInterval(() => void relayOutbox(store, logSink, clock).catch((err) => console.error('[relay]', err)), 1_000).unref();

const tokens: Record<string, Principal> = {
  'dev-handler': { subject: 'handlaggare@example.test', roles: ['handler', 'approver'] },
  'dev-clinic': { subject: 'klinik-001', roles: ['clinic'] },
  'dev-job': { subject: 'reassessment-job', roles: ['reassessment-job'] },
};

const app = createApp({
  service,
  clock,
  idempotency,
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
console.log(`Claims engine listening on http://localhost:${port}`);
console.log(`  Storage:   ${storage}`);
console.log(`  API page:  http://localhost:${port}/docs`);
console.log(`  Contract:  http://localhost:${port}/openapi.yaml`);
console.log(`  Tokens:    dev-handler (claims handler), dev-clinic (clinic), dev-job (reassessment job)`);
