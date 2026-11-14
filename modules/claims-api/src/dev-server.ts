/**
 * Lokal utvecklingsserver med data i minnet och exempeldata för Bella.
 * Tokens: 'dev-handler' (handläggare), 'dev-clinic' (klinik).
 */
import { serve } from '@hono/node-server';
import { ClaimsService } from '@petvold/claims-core';
import {
  InMemoryClaimsStore,
  InMemoryPolicyPort,
  SequentialIds,
  StaticRulesPort,
  fixtures,
} from '@petvold/claims-store-memory';
import { createApp, InMemoryIdempotencyStore, type Principal } from './index.ts';

const clock = { now: () => new Date().toISOString() };
const policies = new InMemoryPolicyPort([{ snapshot: fixtures.bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]);
const service = new ClaimsService({
  policies,
  rules: new StaticRulesPort({ [fixtures.PRODUCT]: fixtures.RULES_SE_DOG }, fixtures.RULES_SE_DOG),
  store: new InMemoryClaimsStore(),
  clock,
  ids: new SequentialIds(),
  events: { publish: async (e) => console.log(`[event] ${e.type}`) },
});

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
serve({ fetch: app.fetch, port });
console.log(`Skademotor lyssnar på http://localhost:${port} – kontrakt på /openapi.yaml`);
