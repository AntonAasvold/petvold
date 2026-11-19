/**
 * Petvold in production (granskningen A1): the composition root with every
 * module in its own database, no sample data, the relay for every outbox, a
 * health check, and an orderly shutdown.
 *
 * Configuration from the environment (never a .env file):
 * - CLAIMS_DATABASE_URL, ACCESS_DATABASE_URL, DECISIONING_DATABASE_URL,
 *   CATALOG_DATABASE_URL, ANIMALS_DATABASE_URL, PARTIES_DATABASE_URL,
 *   POLICIES_DATABASE_URL, COMMUNICATIONS_DATABASE_URL, WEBHOOKS_DATABASE_URL
 *   and SCHEDULING_DATABASE_URL:
 *   every one is required, each with the module's own role.
 * - PETVOLD_WEBHOOK_KEY: 32 bytes in base64 that seal the webhook secrets (ADR 0033). Required.
 * - PETVOLD_WEBHOOK_ALLOW_HOSTS: hosts a webhook may name although local or http, comma-separated. Default none.
 * - PETVOLD_VERSION: stored with every decision (ADR 0018). Required.
 * - PETVOLD_CLAIM_NUMBER_PREFIX: the claim number's prefix per market, e.g. SE=S,NO=N (ADR 0036). Default S.
 * - PORT: default 8080.
 * - PETVOLD_CORS_ORIGINS: browser applications allowed to call the API, comma-separated. Default none.
 * - Authentication: see auth.ts. Without it the server does not start.
 *
 * Migrations run before the server starts (dbmate, as the owner role); the
 * server's roles cannot change the schema.
 */
import { serve } from '@hono/node-server';
import { claimNumberPrefixFromEnv, compose, DATABASE_ENV, DATABASES, databasesFromEnv, webhooksFromEnv } from './composition.ts';
import { authenticatorFromEnv } from './auth.ts';
import { corsOriginsFromEnv, createApp } from './index.ts';

const log = (line: string) => console.log(line);

const missing = [
  ...DATABASES.filter((d) => !process.env[DATABASE_ENV[d]]).map((d) => DATABASE_ENV[d]),
  ...['PETVOLD_VERSION', 'PETVOLD_WEBHOOK_KEY'].filter((k) => !process.env[k]),
];
if (missing.length) {
  console.error(`Missing configuration: ${missing.join(', ')}`);
  process.exit(1);
}
const auth = await authenticatorFromEnv(process.env).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});

let claimNumberPrefix: Record<string, string>;
try {
  claimNumberPrefix = claimNumberPrefixFromEnv(process.env);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const inst = await compose({ databases: databasesFromEnv(process.env), engineVersion: process.env.PETVOLD_VERSION!, log, webhooks: webhooksFromEnv(process.env), claimNumberPrefix });
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
      { status: degraded ? 'degraded' : 'ok', deadLetters: dead.length, relay: inst.relay.isLeading() ? 'leading' : 'standby', jobs },
      { status: 200 },
    );
  } catch (err) {
    return Response.json({ status: 'down', error: (err as Error).message }, { status: 503 });
  }
}

const port = Number(process.env.PORT ?? 8080);
const server = serve({ port, fetch: (req) => (new URL(req.url).pathname === '/healthz' ? health() : app.fetch(req)) });
log(`Petvold ${process.env.PETVOLD_VERSION} listening on port ${port}`);

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
