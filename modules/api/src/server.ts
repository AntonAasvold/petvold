/**
 * Petvold in production (granskningen A1): the composition root with every
 * module in its own database, no sample data, the relay for every outbox, a
 * health check, and an orderly shutdown.
 *
 * Configuration from the environment (never a .env file):
 * - CLAIMS_DATABASE_URL, ACCESS_DATABASE_URL, DECISIONING_DATABASE_URL,
 *   CATALOG_DATABASE_URL, ANIMALS_DATABASE_URL, PARTIES_DATABASE_URL,
 *   POLICIES_DATABASE_URL, COMMUNICATIONS_DATABASE_URL, WEBHOOKS_DATABASE_URL,
 *   SCHEDULING_DATABASE_URL, DOCUMENTS_DATABASE_URL, BILLING_DATABASE_URL, PAYMENTS_DATABASE_URL and ACCOUNTING_DATABASE_URL:
 *   every one is required, each with the module's own role.
 * - PETVOLD_WEBHOOK_KEY: 32 bytes in base64 that seal the webhook secrets (ADR 0033). Required.
 * - PETVOLD_DOCUMENT_KEY: at least 32 bytes in base64 that sign the documents' links (ADR 0038). Required.
 * - PETVOLD_PUBLIC_URL: where the documents' links are opened, e.g. https://petvold.insurer.example. Required.
 * - PETVOLD_DOCUMENTS_BUCKET: the archive's bucket. Required. With PETVOLD_DOCUMENTS_S3_ENDPOINT,
 *   _S3_REGION, _S3_ACCESS_KEY and _S3_SECRET_KEY, else the AWS SDK's usual credentials.
 * - PETVOLD_GOTENBERG_URL: Gotenberg on the internal network, which makes PDFs from the templates. Optional.
 * - PETVOLD_WEBHOOK_ALLOW_HOSTS: hosts a webhook may name although local or http, comma-separated. Default none.
 * - PETVOLD_VERSION: stored with every decision (ADR 0018). Required.
 * - PETVOLD_CLAIM_NUMBER_PREFIX: the claim number's prefix per market, e.g. SE=S,NO=N (ADR 0036). Default S.
 * - PETVOLD_FAKE_BANK_SECRET and PETVOLD_FAKE_BANK_MARKETS: the fake bank, for a demo (ADR 0017). Never with real money.
 * - PETVOLD_BANK_FILE_ACCOUNTS: the accounts the bank's camt.054 files are read for, e.g. SE:SEK:5050-1055 (ADR 0040).
 * - PETVOLD_NEW_PAYEE_HOLD_DAYS: days that new payee details hold a payout for a person (ADR 0040). Default 0.
 * - PORT: default 8080.
 * - PETVOLD_CORS_ORIGINS: browser applications allowed to call the API, comma-separated. Default none.
 * - Authentication: see auth.ts. Without it the server does not start.
 * - PETVOLD_AUTH=demo: the dev server's fixed tokens instead, for the demo behind
 *   its password (ADR 0041). Logged at start and shown by /healthz. Never with real data.
 *
 * Migrations run before the server starts (dbmate, as the owner role); the
 * server's roles cannot change the schema.
 */
import { serve } from '@hono/node-server';
import { bankFileFromEnv } from '@petvold/payments/bank-file';
import { claimNumberPrefixFromEnv, compose, fakeBankFromEnv, newPayeeHoldDaysFromEnv, DATABASE_ENV, DATABASES, databasesFromEnv, documentsFromEnv, webhooksFromEnv } from './composition.ts';
import { authenticatorFromEnv } from './auth.ts';
import { demoAuthenticator } from './demo-tokens.ts';
import { docsPage } from './docs.ts';
import { corsOriginsFromEnv, createApp } from './index.ts';

const log = (line: string) => console.log(line);

const missing = [
  ...DATABASES.filter((d) => !process.env[DATABASE_ENV[d]]).map((d) => DATABASE_ENV[d]),
  ...['PETVOLD_VERSION', 'PETVOLD_WEBHOOK_KEY', 'PETVOLD_DOCUMENT_KEY', 'PETVOLD_PUBLIC_URL', 'PETVOLD_DOCUMENTS_BUCKET'].filter((k) => !process.env[k]),
];
if (missing.length) {
  console.error(`Missing configuration: ${missing.join(', ')}`);
  process.exit(1);
}
const authMode = process.env.PETVOLD_AUTH ?? 'jwt';
if (authMode !== 'jwt' && authMode !== 'demo') {
  console.error(`PETVOLD_AUTH must be jwt or demo, not '${authMode}'`);
  process.exit(1);
}
const demo = authMode === 'demo';
const auth = demo ? demoAuthenticator() : await authenticatorFromEnv(process.env).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});

let claimNumberPrefix: Record<string, string>;
let fake: ReturnType<typeof fakeBankFromEnv>;
let bankFile: ReturnType<typeof bankFileFromEnv>;
let holdDays: number;
try {
  claimNumberPrefix = claimNumberPrefixFromEnv(process.env);
  fake = fakeBankFromEnv(process.env);
  bankFile = bankFileFromEnv(process.env);
  holdDays = newPayeeHoldDaysFromEnv(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const inst = await compose({
  databases: databasesFromEnv(process.env),
  engineVersion: process.env.PETVOLD_VERSION!,
  log,
  webhooks: webhooksFromEnv(process.env),
  documents: documentsFromEnv(process.env),
  claimNumberPrefix,
  payments: { ...(fake ? { fake } : {}), ...(bankFile ? { bankFile } : {}), newPayeeHoldDays: holdDays },
});
if (bankFile) log(`Bank files (camt.054) are read for ${bankFile.accounts.map((a) => `${a.market}:${a.currency}`).join(', ')} at POST /v1/payment-files.`);
if (fake) log(`The fake bank takes payments in ${fake.markets.map((m) => `${m.market}:${m.currency}`).join(', ')} at POST /provider-notifications/fake. Not for real money.`);
await inst.ping().catch((err: Error) => {
  console.error(`A database does not answer: ${err.message}`);
  process.exit(1);
});
inst.relay.start(1_000);
inst.webhookWorker.start(1_000);
inst.scheduler.start();

const app = createApp({ ...inst.deps, auth, corsOrigins: corsOriginsFromEnv(process.env) });

/** Liveness and readiness, outside the contract: databases answer, and dead letters in the relay. */
async function health(): Promise<Response> {
  const dead = inst.relay.deadLetters();
  try {
    await inst.ping();
    // Runs that failed, are more than an hour late, or are paused make it degraded (ADR 0037).
    const jobs = await inst.scheduler.health();
    const degraded = dead.length || jobs.failed.length || jobs.late.length || jobs.paused.length;
    // relay: 'leading' on the one server that delivers events, 'standby' on the others.
    return Response.json(
      { status: degraded ? 'degraded' : 'ok', deadLetters: dead.length, relay: inst.relay.isLeading() ? 'leading' : 'standby', jobs, ...(demo ? { auth: 'demo' } : {}) },
      { status: 200 },
    );
  } catch (err) {
    return Response.json({ status: 'down', error: (err as Error).message }, { status: 503 });
  }
}

const port = Number(process.env.PORT ?? 8080);
// The demo has the API page, signed in with a demo token (ADR 0041).
const docs = demo ? docsPage({ specUrl: '/openapi.yaml', defaultToken: 'dev-handler' }) : null;
const server = serve({
  port,
  fetch: (req) => {
    const path = new URL(req.url).pathname;
    if (path === '/healthz') return health();
    if (docs && path === '/docs') return new Response(docs, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    return app.fetch(req);
  },
});
log(`Petvold ${process.env.PETVOLD_VERSION} listening on port ${port}`);
if (demo) log('DEMO: signing in with the fixed demo tokens (PETVOLD_AUTH=demo). Anyone who has read the repository can sign in. Keep it behind a password, and never use it with real data.');

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: stopping`);
  server.close();
  await inst.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
