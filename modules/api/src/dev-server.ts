/**
 * Local development server: the composition root (composition.ts) with sample
 * data for Bella, dev tokens and the API page. Not for production; use
 * server.ts there.
 *
 * Storage: each module in Postgres when its database URL is in .env (after
 * `npm run dev:up`), else in memory.
 *
 * Tokens: 'dev-handler' (claims handler), 'dev-approver' (approver), 'dev-admin'
 * (roles and limits), 'dev-author' and 'dev-publisher' (rule sets), 'dev-catalog' and 'dev-catalog-publisher' (reference data and products), 'dev-registrar' (animals and parties), 'dev-privacy' and 'dev-privacy-2' (erasure), 'dev-retention-job' (retention run), 'dev-seller' (policies), 'dev-underwriter' (manual prices), 'dev-renewal-job' (renewal run), 'dev-clinic'
 * (clinic), 'dev-job' (reassessment job), 'dev-customer' (customer channel). Roles map to
 * permissions with DEFAULT_ROLES (ADR 0016).
 * The API page is at /docs and example requests are in examples/claims.http.
 */
import { execFileSync } from 'node:child_process';
import { serve } from '@hono/node-server';
import { compose, databasesFromEnv } from './composition.ts';
import { seedSampleData, SAMPLE_RULE_SERIES } from './seed.ts';
import { corsOriginsFromEnv, createApp, type Principal } from './index.ts';
import { docsPage } from './docs.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env: run in memory.
}

/** Stored with every decision (ADR 0018). PETVOLD_VERSION if set, else the git commit. */
function engineVersion(): string {
  if (process.env.PETVOLD_VERSION) return process.env.PETVOLD_VERSION;
  try {
    return `dev+${execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()}`;
  } catch {
    return 'dev+unknown';
  }
}

const clock = { now: () => new Date().toISOString() };
const inst = await compose({ databases: databasesFromEnv(process.env), engineVersion: engineVersion(), clock, log: (l) => console.log(l) });
await inst.ping().catch((err: Error) => {
  console.error(`Cannot reach Postgres (${err.message}). Run npm run dev:up, or remove the database URLs from .env to run in memory.`);
  process.exit(1);
});
await seedSampleData(inst, clock);
inst.relay.start(1_000);

const DEV_TOKENS: Record<string, Principal> = {
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
  'dev-underwriter': { subject: 'underwriter@example.test', roles: ['underwriter'], markets: ['SE'] },
  'dev-renewal-job': { subject: 'renewal-job', roles: ['renewal-job'], markets: '*' },
  'dev-retention-job': { subject: 'retention-job', roles: ['retention-job'], markets: '*' },
  'dev-clinic': { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  'dev-job': { subject: 'reassessment-job', roles: ['reassessment-job'], markets: '*' },
  // Acts for the customer who owns Bella's policy in the sample data.
  'dev-customer': { subject: 'customer-portal', roles: ['customer-channel'], markets: ['SE'], policyIds: ['pol_bella'] },
};

// A user interface on a local dev server (Vite on 5173, others on 3000) may call the API.
const corsOrigins = corsOriginsFromEnv(process.env, ['http://localhost:5173', 'http://localhost:3000']);
const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (DEV_TOKENS[t] ?? null) : null) }, corsOrigins });

const port = Number(process.env.PORT ?? 8787);
const docs = docsPage({ specUrl: '/openapi.yaml', defaultToken: 'dev-handler' });

serve({
  port,
  fetch: (req) =>
    new URL(req.url).pathname === '/docs'
      ? new Response(docs, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      : app.fetch(req),
});

const where = (m: keyof typeof inst.storage) => (inst.storage[m] === 'postgres' ? 'Postgres' : 'memory');
console.log(`Petvold listening on http://localhost:${port}`);
console.log(`  Claims:    ${where('claims')}`);
console.log(`  Rules:     ${where('decisioning')}, series ${SAMPLE_RULE_SERIES} (GET /v1/rule-sets/${SAMPLE_RULE_SERIES}/versions)`);
console.log(`  Catalog:   ${where('catalog')} (GET /v1/products/on-sale?date=2026-11-15)`);
console.log(`  Animals:   ${where('animals')} (GET /v1/animals/ani_bella)`);
console.log(`  Parties:   ${where('parties')} (GET /v1/parties/pty_owner001)`);
console.log(`  Policies:  ${where('policies')} (GET /v1/policies/pol_bella)`);
console.log(`  Roles:     ${where('access')}, versioned (GET /v1/access/roles)`);
console.log(`  API page:  http://localhost:${port}/docs`);
console.log(`  Contract:  http://localhost:${port}/openapi.yaml`);
console.log(`  Tokens:    ${Object.keys(DEV_TOKENS).join(', ')}`);
console.log(`  CORS:      ${corsOrigins.join(', ') || 'none'} (PETVOLD_CORS_ORIGINS)`);
