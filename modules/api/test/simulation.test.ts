/**
 * Simulation through the API (ADR 0018): the claims engine reads its rules from
 * the decisioning module, decisions are made, and a draft is simulated against them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALCULATION_MODELS, ClaimsService } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, fixtures } from '@petvold/claims-store-memory';
import { DecisioningRulesPort, DecisioningService, InMemoryRuleSetStore } from '@petvold/decisioning';
import { createApp, InMemoryIdempotencyStore, validatorFor, type Principal } from '@petvold/api';

const tokens: Record<string, Principal> = {
  author: { subject: 'author@example.test', roles: ['rules-author'], markets: ['SE'] },
  publisher: { subject: 'publisher@example.test', roles: ['rules-publisher'], markets: ['SE'] },
  clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  handler: { subject: 'h@example.test', roles: ['handler'], markets: ['SE'] },
  outsider: { subject: 'author-de@example.test', roles: ['rules-author'], markets: ['DE'] },
};

function setup() {
  const clock = new FixedClock('2026-11-13T14:00:00.000Z');
  const decisioning = new DecisioningService({ store: new InMemoryRuleSetStore(), clock, calculationModels: Object.keys(CALCULATION_MODELS) });
  const service = new ClaimsService({
    policies: new InMemoryPolicyPort([{ snapshot: fixtures.bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]),
    rules: new DecisioningRulesPort(decisioning, () => 'SE-HUND-VV'),
    store: new InMemoryClaimsStore(),
    clock,
    ids: new SequentialIds(),
  });
  const app = createApp({
    service,
    decisioning,
    clock,
    idempotency: new InMemoryIdempotencyStore(),
    auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) },
  });
  let n = 0;
  const call = (method: string, path: string, token: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `key-sim-${String(++n).padStart(4, '0')}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return { call };
}

const { rulesVersion: _v, ...content } = fixtures.RULES_SE_DOG;
const base = '/v1/rule-sets/SE-HUND-VV/versions';
const input = (c: ReturnType<typeof fixtures.otitisClaim>) => {
  const { receivedAt: _r, ...rest } = c;
  return rest;
};

test('a draft with a lower auto limit is simulated against decided claims before it is published', async () => {
  const { call } = setup();
  await call('POST', base, 'author', { content, calculationModel: 'vet-care.v1', effectiveFrom: '2026-01-01' });
  await call('POST', `${base}/1/submissions`, 'author', {});
  assert.equal((await call('POST', `${base}/1/publications`, 'publisher', {})).status, 200);

  assert.equal((await call('POST', '/v1/claims', 'clinic', input(fixtures.otitisClaim()))).status, 201); // auto
  await call('POST', '/v1/claims', 'clinic', input(fixtures.cruciateClaim()));
  assert.equal((await call('POST', '/v1/claims/clm_048213/decisions', 'handler', { action: 'accept' })).status, 201);

  await call('POST', base, 'author', { content: { ...content, autoSettleMax: 100_000 }, calculationModel: 'vet-care.v1', effectiveFrom: '2026-12-01' });
  const window = { from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' };
  assert.equal((await call('POST', `${base}/2/simulations`, 'clinic', window)).status, 403);

  const res = await call('POST', `${base}/2/simulations`, 'author', window);
  assert.equal(res.status, 200);
  const r = (await res.json()) as any;
  const v = validatorFor('SimulationResult');
  assert.ok(v(structuredClone(r)), JSON.stringify(v.errors)); // a copy: the validator is a type guard
  assert.equal(r.rulesVersion, 'SE-HUND-VV@2');
  assert.deepEqual([r.decisions, r.changed], [2, 1]);
  assert.deepEqual(r.modeChanged, { autoToManual: 1, manualToAuto: 0 });
  assert.equal(r.items[0].claimId, 'clm_021877');

  const outside = (await (await call('POST', `${base}/2/simulations`, 'outsider', window)).json()) as any;
  assert.equal(outside.decisions, 0, 'claims outside the caller\'s markets are not simulated');
  assert.equal((await call('POST', `${base}/2/simulations`, 'author', { from: window.to, to: window.from })).status, 422);
  assert.equal((await call('POST', `${base}/9/simulations`, 'author', window)).status, 404);
});
