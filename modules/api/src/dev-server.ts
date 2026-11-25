/**
 * Local development server: the composition root (composition.ts) with sample
 * data for Bella, dev tokens and the API page. Not for production; use
 * server.ts there.
 *
 * Storage: each module in Postgres when its database URL is in .env (after
 * `npm run dev:up`), else in memory. Documents' files in SeaweedFS when
 * PETVOLD_DOCUMENTS_BUCKET is set (ADR 0038), else in memory.
 *
 * Tokens: 'dev-handler' (claims handler), 'dev-approver' (approver), 'dev-admin'
 * (roles and limits), 'dev-author' and 'dev-publisher' (rule sets), 'dev-catalog' and 'dev-catalog-publisher' (reference data and products), 'dev-registrar' (animals and parties), 'dev-privacy' and 'dev-privacy-2' (erasure), 'dev-retention-job' (retention run), 'dev-seller' (policies), 'dev-underwriter' (manual prices), 'dev-documents' (the document system), 'dev-communications' (notice settings), 'dev-integration' (webhooks), 'dev-operations' and 'dev-operations-2' (runs, four eyes), 'dev-all' and 'dev-all-2' (every role in the back office, two people for four eyes), 'dev-renewal-job' (renewal run), 'dev-clinic'
 * (clinic), 'dev-job' (reassessment job), 'dev-customer' (customer channel), all in
 * demo-tokens.ts. Roles map to permissions with DEFAULT_ROLES (ADR 0016).
 * The API page is at /docs and example requests are in examples/claims.http.
 */
import { bankFileFromEnv } from '@petvold/payments/bank-file';
import { stripeFromEnv } from '@petvold/payments/stripe';
import { execFileSync } from 'node:child_process';
import { serve } from '@hono/node-server';
import { compose, databasesFromEnv, documentsFromEnv, fakeBankFromEnv, webhooksFromEnv } from './composition.ts';
import { seedSampleData, SAMPLE_RULE_SERIES } from './seed.ts';
import { corsOriginsFromEnv, createApp } from './index.ts';
import { DEMO_TOKENS, demoAuthenticator } from './demo-tokens.ts';
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
// A fixed key for development only, so stored webhook secrets survive a restart. Never use it in production.
const DEV_WEBHOOK_KEY = Buffer.alloc(32, 'petvold-dev').toString('base64');
const webhookEnv = webhooksFromEnv(process.env);
// The same for the documents' links: a link made before a restart still opens.
const DEV_DOCUMENT_KEY = Buffer.alloc(32, 'petvold-dev-documents').toString('base64');
const documentEnv = documentsFromEnv(process.env);
// The fake bank (ADR 0017) with a fixed secret for development, so a demo bank can sign its notifications.
const DEV_FAKE_BANK_SECRET = `whsec_${Buffer.alloc(32, 'petvold-dev-fake-bank').toString('base64')}`;
const fakeBank = fakeBankFromEnv(process.env) ?? { secret: DEV_FAKE_BANK_SECRET, markets: [{ market: 'SE', currency: 'SEK' }] };
const inst = await compose({
  databases: databasesFromEnv(process.env),
  engineVersion: engineVersion(),
  clock,
  log: (l) => console.log(l),
  webhooks: { key: webhookEnv.key ?? DEV_WEBHOOK_KEY, allowHosts: webhookEnv.allowHosts.length ? webhookEnv.allowHosts : ['localhost', '127.0.0.1'] },
  documents: { ...documentEnv, key: documentEnv.key ?? DEV_DOCUMENT_KEY, publicBaseUrl: documentEnv.publicBaseUrl ?? `http://localhost:${process.env.PORT ?? 8787}` },
  // Bank files for a made-up bankgiro, as in the tests' camt.054 files (ADR 0040, punkt 12).
  payments: { fake: fakeBank, bankFile: bankFileFromEnv(process.env) ?? { accounts: [{ market: 'SE', currency: 'SEK', id: '5050-1055' }] }, ...(stripeFromEnv(process.env) ? { stripe: stripeFromEnv(process.env)! } : {}) },
});
await inst.ping().catch((err: Error) => {
  console.error(`Cannot reach Postgres or the document archive (${err.message}). Run npm run dev:up, or remove the database URLs and PETVOLD_DOCUMENTS_BUCKET from .env to run in memory.`);
  process.exit(1);
});
await seedSampleData(inst, clock);
inst.relay.start(1_000);
inst.webhookWorker.start(1_000);
// Not by default: with no history, the first round would at once renew and
// expire the sample data that the flow tests count on (ADR 0037).
if (process.env.PETVOLD_SCHEDULER === 'on') inst.scheduler.start();


// A user interface on a local dev server may call the API: the back office on 5180 (ADR 0035), Vite's usual 5173, others on 3000.
const corsOrigins = corsOriginsFromEnv(process.env, ['http://localhost:5180', 'http://localhost:5173', 'http://localhost:3000']);
const app = createApp({ ...inst.deps, auth: demoAuthenticator(), corsOrigins });

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
console.log(`  Catalog:   ${where('catalog')} (GET /v1/product-versions?onSale=2026-11-15)`);
console.log(`  Animals:   ${where('animals')} (GET /v1/animals/ani_bella)`);
console.log(`  Parties:   ${where('parties')} (GET /v1/parties/pty_owner001)`);
console.log(`  Policies:  ${where('policies')} (GET /v1/policies/pol_bella)`);
console.log(`  Notices:   ${where('communications')} (GET /v1/notices?status=pending, token dev-documents)`);
console.log(`  Billing:   ${where('billing')} (GET /v1/premium-plans?policyId=pol_bella)`);
console.log(`  Payments:  ${where('payments')} (POST /provider-notifications/fake, signed with PETVOLD_FAKE_BANK_SECRET or the dev secret; camt.054 files for bankgiro 5050-1055 at POST /v1/payment-files)`);
console.log(`  Webhooks:  ${where('webhooks')} (POST /v1/webhook-subscriptions, token dev-integration; http://localhost is allowed)`);
console.log(`  Roles:     ${where('access')}, versioned (GET /v1/settings/roles)`);
console.log(`  API page:  http://localhost:${port}/docs`);
console.log(`  Contract:  http://localhost:${port}/openapi.yaml`);
console.log(`  Tokens:    ${Object.keys(DEMO_TOKENS).join(', ')}`);
console.log(`  CORS:      ${corsOrigins.join(', ') || 'none'} (PETVOLD_CORS_ORIGINS)`);
