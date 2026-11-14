import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService } from '@petvold/claims-core';
import {
  FixedClock,
  InMemoryClaimsStore,
  InMemoryPolicyPort,
  SequentialIds,
  StaticRulesPort,
  fixtures,
} from '@petvold/claims-store-memory';
import {
  createApp,
  implementedOperations,
  contractOperations,
  InMemoryIdempotencyStore,
  validatorFor,
  messageKeys,
  supportedLocales,
  openapi,
  operationPermissions,
  isPermission,
  DEFAULT_ROLES,
  type Principal,
  type RolePermissions,
} from '@petvold/claims-api';
import { docsPage, SCALAR_VERSION } from '../src/docs.ts';

const { bellaPolicy, cruciateClaim, otitisClaim, eurPolicy, eurClaim, RULES_SE_DOG, RULES_EUR_EXAMPLE, PRODUCT, PRODUCT_EUR } = fixtures;

function setup(opts: { roles?: RolePermissions } = {}) {
  const clock = new FixedClock('2026-11-13T14:00:00Z');
  const service = new ClaimsService({
    policies: new InMemoryPolicyPort([
      { snapshot: bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' },
      { snapshot: eurPolicy(), sysFrom: '2025-12-01T00:00:00Z' },
    ]),
    rules: new StaticRulesPort({ [PRODUCT]: RULES_SE_DOG, [PRODUCT_EUR]: RULES_EUR_EXAMPLE }, RULES_SE_DOG),
    store: new InMemoryClaimsStore(),
    clock,
    ids: new SequentialIds(),
  });
  const tokens: Record<string, Principal> = {
    handler: { subject: 'handlaggare@example.test', roles: ['handler', 'approver'] },
    clinic: { subject: 'klinik-001', roles: ['clinic'] },
    system: { subject: 'batch', roles: ['system'] },
    job: { subject: 'reassessment-job', roles: ['reassessment-job'] },
    team: { subject: 'team@example.test', roles: ['claims-team'] },
  };
  const app = createApp({
    service,
    clock,
    ...(opts.roles ? { roles: opts.roles } : {}),
    idempotency: new InMemoryIdempotencyStore(),
    auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) },
  });
  const call = (method: string, path: string, opts: { token?: string; body?: unknown; key?: string; lang?: string } = {}) =>
    app.request(path, {
      method,
      headers: {
        ...(opts.token !== undefined ? { authorization: `Bearer ${opts.token}` } : { authorization: 'Bearer handler' }),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.key ? { 'idempotency-key': opts.key } : {}),
        ...(opts.lang ? { 'accept-language': opts.lang } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  return { app, call };
}

/** Claim without receivedAt, as clients send it. */
function input(c: ReturnType<typeof cruciateClaim>) {
  const { receivedAt: _r, ...rest } = c;
  return rest;
}

function assertSchema(name: string, body: unknown) {
  const v = validatorFor(name);
  assert.ok(v(body), `${name}: ${JSON.stringify(v.errors, null, 2)}`);
}

test('the contract and the implementation have exactly the same operations', () => {
  const { app } = setup();
  assert.deepEqual(new Set(implementedOperations(app)), new Set(contractOperations()));
});

test('every language has texts for the same rule keys', () => {
  const [first, ...rest] = supportedLocales;
  for (const l of rest) assert.deepEqual(messageKeys(l).sort(), messageKeys(first!).sort());
});

test('without a token: 401 as problem+json', async () => {
  const { call } = setup();
  const res = await call('GET', '/v1/claims/x', { token: '' });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
  assertSchema('Problem', await res.json());
});

test('a request that breaks the contract gives 422 with field errors', async () => {
  const { call } = setup();
  const res = await call('POST', '/v1/claims', { key: 'key-00000001', body: { ...input(otitisClaim()), market: 'sverige', extra: 1 } });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { errors: Array<{ path: string; message: string }> };
  assert.ok(body.errors.some((e) => e.path === '/market'));
  assert.ok(body.errors.some((e) => e.message.includes("'extra'")));
});

test('Idempotency-Key is required for creating calls', async () => {
  const { call } = setup();
  const res = await call('POST', '/v1/claims', { body: input(otitisClaim()) });
  assert.equal(res.status, 422);
});

test('register: 201 per the contract, and the same key gives the same response', async () => {
  const { call } = setup();
  const res = await call('POST', '/v1/claims', { key: 'key-00000002', body: input(otitisClaim()) });
  assert.equal(res.status, 201);
  const body = await res.json();
  assertSchema('RegisterClaimResult', body);
  assert.equal((body as any).decision.payout, 150_000);

  const replay = await call('POST', '/v1/claims', { key: 'key-00000002', body: input(otitisClaim()) });
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), body);

  const misuse = await call('POST', '/v1/claims', { key: 'key-00000002', body: input(otitisClaim({ claimNo: 'annat' })) });
  assert.equal(misuse.status, 422);
});

test('handler flow: assessment, decision with inputHash, list of decisions', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { key: 'key-00000003', body: input(cruciateClaim()), token: 'clinic' });

  const aRes = await call('GET', '/v1/claims/clm_048213/assessment', { lang: 'sv-SE,sv;q=0.9' });
  const assessment = (await aRes.json()) as any;
  assertSchema('Assessment', assessment);
  assert.equal(aRes.headers.get('content-language'), 'sv');
  assert.equal(assessment.mode, 'manual');
  const rider = assessment.rules.find((r: any) => r.code === 'RIDER');
  assert.equal(rider.reason, 'rider.possible');
  // Swedish text from the sv catalogue, with the rider's description filled in.
  assert.match(rider.message, /Lameness, right hind leg/);
  assert.doesNotMatch(rider.message, /Possibly related/);

  const dRes = await call('POST', '/v1/claims/clm_048213/decisions', {
    key: 'key-00000004',
    body: { action: 'accept', reason: 'Left leg, not related', expectedInputHash: assessment.inputHash },
  });
  assert.equal(dRes.status, 201);
  const decision = (await dRes.json()) as any;
  assertSchema('Decision', decision);
  assert.equal(decision.payout, 1_216_500);
  assert.equal(decision.decidedBy, 'handlaggare@example.test');

  const list = (await (await call('GET', '/v1/claims/clm_048213/decisions')).json()) as any;
  assert.equal(list.items.length, 1);
});

test('a clinic may not make decisions', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { key: 'key-00000005', body: input(cruciateClaim()), token: 'clinic' });
  const res = await call('POST', '/v1/claims/clm_048213/decisions', { token: 'clinic', key: 'key-00000006', body: { action: 'accept' } });
  assert.equal(res.status, 403);
});

test('a clinic may not read limits, and the problem names the permission', async () => {
  const { call } = setup();
  const res = await call('GET', '/v1/policies/pol_bella/animals/ani_bella/limits?onDate=2026-11-13', { token: 'clinic' });
  assert.equal(res.status, 403);
  const body = (await res.json()) as any;
  assertSchema('Problem', body);
  assert.match(body.detail, /limits:read/);
});

test('no role grants everything: system and unknown roles get nothing', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { key: 'key-00000101', body: input(otitisClaim()) });
  for (const path of ['/v1/claims/clm_021877', '/v1/claims/clm_021877/decisions']) {
    assert.equal((await call('GET', path, { token: 'system' })).status, 403);
    assert.equal((await call('GET', path, { token: 'team' })).status, 403);
  }
});

test('the reassessment job may reassess but not decide', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { key: 'key-00000102', body: input(otitisClaim()) });
  const re = await call('POST', '/v1/claims/clm_021877/reassessments', { token: 'job', key: 'key-00000103', body: { reason: 'Nightly run' } });
  assert.equal(re.status, 204);
  const dec = await call('POST', '/v1/claims/clm_021877/decisions', { token: 'job', key: 'key-00000104', body: { action: 'reject' } });
  assert.equal(dec.status, 403);
});

test('an installation maps its own role names to permissions', async () => {
  const { call } = setup({ roles: { ...DEFAULT_ROLES, 'claims-team': ['claims:read'] } });
  await call('POST', '/v1/claims', { key: 'key-00000105', body: input(otitisClaim()) });
  assert.equal((await call('GET', '/v1/claims/clm_021877', { token: 'team' })).status, 200);
  const dec = await call('POST', '/v1/claims/clm_021877/decisions', { token: 'team', key: 'key-00000106', body: { action: 'reject' } });
  assert.equal(dec.status, 403);
});

test('roles with an unknown permission are rejected at start-up', () => {
  assert.throws(() => setup({ roles: { handler: ['claims:everything' as never] } }), /unknown permission 'claims:everything'/);
});

test('every operation in the contract names a known permission', () => {
  for (const [op, permission] of operationPermissions()) {
    assert.ok(isPermission(permission), `${op} has x-permission ${String(permission)}`);
  }
});

test('an unknown path still gives 404, not 403', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/v1/nothing-here', { token: 'clinic' })).status, 404);
});

test('a stale inputHash gives 409', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { key: 'key-00000007', body: input(cruciateClaim()) });
  const res = await call('POST', '/v1/claims/clm_048213/decisions', { key: 'key-00000008', body: { action: 'accept', expectedInputHash: 'stale' } });
  assert.equal(res.status, 409);
  assertSchema('Problem', await res.json());
});

test('pre-approval for the clinic in English, with amounts formatted in the right currency', async () => {
  const { call } = setup();
  const res = await call('POST', '/v1/claim-previews', {
    token: 'clinic',
    lang: 'en',
    body: input(cruciateClaim({ id: 'draft', claimNo: 'draft' })),
  });
  assert.equal(res.status, 200);
  const a = (await res.json()) as any;
  assertSchema('Assessment', a);
  assert.equal(a.calculation.customerShare, 647_500);
  assert.match(a.rules.find((r: any) => r.code === 'RIDER').message, /Possibly related to exclusion/);
});

test('EUR claim: amounts and texts follow the market', async () => {
  const { call } = setup();
  const res = await call('POST', '/v1/claims', { key: 'key-00000009', body: input(eurClaim()), lang: 'en' });
  const body = (await res.json()) as any;
  assertSchema('RegisterClaimResult', body);
  assert.equal(body.assessment.currency, 'EUR');
  assert.equal(body.assessment.calculation.vatExcluded, 5_700);
  assert.equal(body.decision.payout, 17_500);

  const limits = (await (await call('GET', '/v1/policies/pol_rex/animals/ani_rex/limits?onDate=2026-10-02')).json()) as any;
  assertSchema('Limits', limits);
  assert.equal(limits.currency, 'EUR');
  assert.equal(limits.remaining, 500_000 - 17_500);
});

test('an unknown claim gives 404 as problem+json', async () => {
  const { call } = setup();
  const res = await call('GET', '/v1/claims/does-not-exist');
  assert.equal(res.status, 404);
  assertSchema('Problem', await res.json());
});

test('the contract is served', async () => {
  const { app } = setup();
  const res = await app.request('/openapi.yaml');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /^openapi: 3\.1\.0/);
});

// Examples in the contract ---------------------------------------------------
// The examples are shown on /docs and used in examples/*.http. They must
// follow the contract and give the outcome their description promises.

type Example = { value: unknown };
const doc = openapi as unknown as {
  paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: { $ref: string }; examples?: Record<string, { $ref: string }> }> } }>>;
  components: { examples: Record<string, Example> };
};
const exampleValue = (ref: string) => doc.components.examples[ref.split('/').pop()!]!.value;

test('every example in the contract follows its schema', () => {
  let checked = 0;
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      for (const media of Object.values(op.requestBody?.content ?? {})) {
        const schema = media.schema.$ref.split('/').pop()!;
        for (const [name, ex] of Object.entries(media.examples ?? {})) {
          const v = validatorFor(schema);
          assert.ok(v(exampleValue(ex.$ref)), `${method.toUpperCase()} ${path} example '${name}': ${JSON.stringify(v.errors)}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 9, `expected at least 9 examples, found ${checked}`);
});

test('the examples give the outcome they describe', async () => {
  const { call } = setup();
  const register = async (name: string) => {
    const res = await call('POST', '/v1/claims', { token: 'clinic', key: `example-${name}`, body: exampleValue(`#/components/examples/${name}`) });
    assert.equal(res.status, 201, name);
    return (await res.json()) as { assessment: { mode: string; proposedOutcome: string }; decision: { outcome: string; payout: number } | null };
  };

  const otit = await register('ClaimOtitAuto');
  assert.equal(otit.decision?.outcome, 'approved');
  assert.equal(otit.decision?.payout, 150_000);

  const korsband = await register('ClaimKorsbandManual');
  assert.equal(korsband.decision, null);
  assert.equal(korsband.assessment.mode, 'manual');
  assert.equal(korsband.assessment.proposedOutcome, 'partial');

  const beforePolicy = await register('ClaimBeforePolicy');
  assert.equal(beforePolicy.assessment.proposedOutcome, 'rejected');
});

test('the API page points to the contract and pins the Scalar version', () => {
  const html = docsPage({ specUrl: '/openapi.yaml', defaultToken: 'dev-handler' });
  assert.match(html, /"url":"\/openapi\.yaml"/);
  assert.match(html, /"token":"dev-handler"/);
  assert.match(html, new RegExp(`@scalar/api-reference@${SCALAR_VERSION.replace(/\./g, '\\.')}"`));
  assert.match(SCALAR_VERSION, /^\d+\.\d+\.\d+$/);
});
