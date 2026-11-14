/**
 * Local development server with in-memory data and sample data for Bella.
 * Tokens: 'dev-handler' (claims handler), 'dev-clinic' (clinic).
 * The API page is at /docs and example requests are in examples/claims.http.
 */
import { serve } from '@hono/node-server';
import { ClaimsService, relayOutbox, type ClaimsEvent } from '@petvold/claims-core';
import {
  InMemoryClaimsStore,
  InMemoryPolicyPort,
  SequentialIds,
  StaticRulesPort,
  fixtures,
} from '@petvold/claims-store-memory';
import { createApp, InMemoryIdempotencyStore, type Principal } from './index.ts';
import { docsPage } from './docs.ts';

const clock = { now: () => new Date().toISOString() };
const policies = new InMemoryPolicyPort([{ snapshot: fixtures.bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]);
const store = new InMemoryClaimsStore();
const service = new ClaimsService({
  policies,
  rules: new StaticRulesPort({ [fixtures.PRODUCT]: fixtures.RULES_SE_DOG }, fixtures.RULES_SE_DOG),
  store,
  clock,
  ids: new SequentialIds(),
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
};

const app = createApp({
  service,
  clock,
  idempotency: new InMemoryIdempotencyStore(),
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
console.log(`  API page:  http://localhost:${port}/docs`);
console.log(`  Contract:  http://localhost:${port}/openapi.yaml`);
console.log(`  Tokens:    dev-handler (claims handler), dev-clinic (clinic)`);
