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
  amountLimitsOf,
  DEFAULT_ROLES,
  type Principal,
  type RoleDefinitions,
} from '@petvold/claims-api';
import { docsPage, SCALAR_VERSION } from '../src/docs.ts';

const { bellaPolicy, cruciateClaim, otitisClaim, eurPolicy, eurClaim, RULES_SE_DOG, RULES_EUR_EXAMPLE, PRODUCT, PRODUCT_EUR } = fixtures;

function setup(opts: { roles?: RoleDefinitions } = {}) {
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
    handler: { subject: 'handlaggare@example.test', roles: ['handler', 'approver'], markets: ['SE', 'DE'] },
    clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE', 'DE'], clinicId: 'clinic_001' },
    system: { subject: 'batch', roles: ['system'], markets: '*' },
    job: { subject: 'reassessment-job', roles: ['reassessment-job'], markets: '*' },
    team: { subject: 'team@example.test', roles: ['claims-team'], markets: '*' },
    customer: { subject: 'customer-portal', roles: ['customer-channel'], markets: ['SE'], policyIds: ['pol_bella'] },
    approver: { subject: 'attestant@example.test', roles: ['approver'], markets: ['SE', 'DE'] },
    admin: { subject: 'admin@example.test', roles: ['admin'] },
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
  /** A caller with its own principal, against the same app and data. */
  const as = (principal: Principal) => {
    const token = `tok-${Object.keys(tokens).length}`;
    tokens[token] = principal;
    return { call: (method: string, path: string, o: Parameters<typeof call>[2] = {}) => call(method, path, { ...o, token }) };
  };
  return { app, call, as };
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
  const { call } = setup({ roles: { ...DEFAULT_ROLES, 'claims-team': { permissions: ['claims:read'] } } });
  await call('POST', '/v1/claims', { key: 'key-00000105', body: input(otitisClaim()) });
  assert.equal((await call('GET', '/v1/claims/clm_021877', { token: 'team' })).status, 200);
  const dec = await call('POST', '/v1/claims/clm_021877/decisions', { token: 'team', key: 'key-00000106', body: { action: 'reject' } });
  assert.equal(dec.status, 403);
});

test('roles with an unknown permission are rejected at start-up', () => {
  assert.throws(() => setup({ roles: { handler: { permissions: ['claims:everything' as never] } } }), /unknown permission 'claims:everything'/);
  assert.throws(() => setup({ roles: { clinic: { permissions: [], bindsTo: 'vet' as never } } }), /unknown binding 'vet'/);
  assert.throws(() => setup({ roles: { handler: ['claims:read'] as never } }), /no permissions list/);
});

// Scope (ADR 0016, part 2) --------------------------------------------------------

test('a clinic sees only the claims it submitted; others answer exactly like a missing claim', async () => {
  const { call } = setup();
  const own = await call('POST', '/v1/claims', { token: 'clinic', key: 'key-00000401', body: input(otitisClaim()) });
  assert.equal(own.status, 201);
  assert.equal(((await own.json()) as any).claim.clinicId, 'clinic_001', 'the clinic id comes from the token');
  await call('POST', '/v1/claims', { key: 'key-00000402', body: input(cruciateClaim()) }); // by a handler

  assert.equal((await call('GET', '/v1/claims/clm_021877', { token: 'clinic' })).status, 200);
  const hidden = await call('GET', '/v1/claims/clm_048213', { token: 'clinic' });
  const missing = await call('GET', '/v1/claims/clm_none', { token: 'clinic' });
  assert.equal(hidden.status, 404);
  assert.equal(missing.status, 404);
  const strip = (b: any) => ({ ...b, title: b.title.replace(/clm_\w+/, 'X') });
  assert.deepEqual(strip(await hidden.json()), strip(await missing.json()));
  assert.equal((await call('GET', '/v1/claims/clm_048213/decisions', { token: 'clinic' })).status, 404);
  assert.equal((await call('GET', '/v1/claims/clm_048213/assessment', { token: 'clinic' })).status, 404);
});

test('a clinic cannot set another clinic id in the body', async () => {
  const { call } = setup();
  const res = await call('POST', '/v1/claims', { token: 'clinic', key: 'key-00000411', body: { ...input(otitisClaim()), clinicId: 'clinic_999' } });
  assert.equal(res.status, 422);
});

test('a token without the clinic id its role requires is refused', async () => {
  const { as } = setup();
  const res = await as({ subject: 'k2', roles: ['clinic'], markets: ['SE'] }).call('GET', '/v1/claims/clm_021877');
  assert.equal(res.status, 403);
  assert.match(((await res.json()) as any).detail, /clinic id/);
});

test('a handler sees only claims in its markets, and cannot register outside them', async () => {
  const { call, as } = setup();
  await call('POST', '/v1/claims', { key: 'key-00000421', body: input(eurClaim()) }); // DE
  const se = as({ subject: 'h-se', roles: ['handler'], markets: ['SE'] });
  assert.equal((await se.call('GET', `/v1/claims/${eurClaim().id}`)).status, 404);
  assert.equal((await call('GET', `/v1/claims/${eurClaim().id}`)).status, 200);
  const outside = await se.call('POST', '/v1/claims', { key: 'key-00000422', body: { ...input(eurClaim()), id: 'clm_de2', claimNo: 'DE-2' } });
  assert.equal(outside.status, 403);
});

test('a caller without markets sees nothing', async () => {
  const { call, as } = setup();
  await call('POST', '/v1/claims', { key: 'key-00000431', body: input(otitisClaim()) });
  const none = as({ subject: 'h0', roles: ['handler'] });
  assert.equal((await none.call('GET', '/v1/claims/clm_021877')).status, 404);
});

test('the customer channel sees only claims on the customer\'s policies, and limits only for them', async () => {
  const { call, as } = setup();
  await call('POST', '/v1/claims', { token: 'clinic', key: 'key-00000441', body: input(otitisClaim()) }); // pol_bella
  assert.equal((await call('GET', '/v1/claims/clm_021877', { token: 'customer' })).status, 200);
  const other = as({ subject: 'portal', roles: ['customer-channel'], markets: ['SE'], policyIds: ['pol_other'] });
  assert.equal((await other.call('GET', '/v1/claims/clm_021877')).status, 404);
  assert.equal((await other.call('POST', '/v1/claims/clm_021877/decisions/1/review-requests', { key: 'key-00000442', body: {} })).status, 404);
  assert.equal((await other.call('GET', '/v1/claims/clm_021877/decisions/1/explanation')).status, 404);
});

test('limits: within the markets for a handler, never by policy id for a clinic', async () => {
  const roles = { ...DEFAULT_ROLES, clinic: { ...DEFAULT_ROLES.clinic!, permissions: [...DEFAULT_ROLES.clinic!.permissions, 'limits:read' as const] } };
  const { call, as } = setup({ roles });
  const path = '/v1/policies/pol_bella/animals/ani_bella/limits?onDate=2026-11-13';
  assert.equal((await call('GET', path)).status, 200);
  assert.equal((await call('GET', path, { token: 'clinic' })).status, 404);
  const de = as({ subject: 'h-de', roles: ['handler'], markets: ['DE'] });
  assert.equal((await de.call('GET', path)).status, 404);
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

test('rejecting against the proposal: 403 without claims:override, 422 without motivation, 201 with both', async () => {
  const { call } = setup({ roles: { ...DEFAULT_ROLES, 'claims-team': { permissions: ['claims:read', 'claims:decide'] } } });
  await call('POST', '/v1/claims', { key: 'key-00000201', body: input(cruciateClaim()) });
  const body = { action: 'reject', reasonCode: 'pre_existing_condition', reason: 'Lameness before the policy started' };

  const forbidden = await call('POST', '/v1/claims/clm_048213/decisions', { token: 'team', key: 'key-00000202', body });
  assert.equal(forbidden.status, 403);
  const unmotivated = await call('POST', '/v1/claims/clm_048213/decisions', { key: 'key-00000203', body: { action: 'reject' } });
  assert.equal(unmotivated.status, 422);

  const ok = await call('POST', '/v1/claims/clm_048213/decisions', { key: 'key-00000204', body });
  assert.equal(ok.status, 201);
  const decision = (await ok.json()) as any;
  assertSchema('Decision', decision);
  assert.equal(decision.deviatesFromProposal, true);
  assert.equal(decision.reasonCode, 'pre_existing_condition');
});

test('a stored decision can be replayed through the API', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { key: 'key-00000301', body: input(otitisClaim()) });
  const res = await call('POST', '/v1/claims/clm_021877/decisions/1/replays');
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assertSchema('ReplayResult', body);
  assert.equal(body.status, 'identical');
  assert.equal((await call('POST', '/v1/claims/clm_021877/decisions/2/replays')).status, 404);
  assert.equal((await call('POST', '/v1/claims/clm_021877/decisions/0/replays')).status, 422);
});

test('the explanation of an automatic decision in Swedish: main reason, steps and the right to review', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { token: 'clinic', key: 'key-00000301', body: input(otitisClaim()) });
  const res = await call('GET', '/v1/claims/clm_021877/decisions/1/explanation', { lang: 'sv', token: 'customer' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-language'), 'sv');
  const body = (await res.json()) as any;
  assertSchema('DecisionExplanation', body);
  assert.equal(body.automated, true);
  assert.match(body.mainReason.message, /1\s?500,00\s?kr/);
  assert.match(body.steps.at(-1).message, /^Ers/, 'Swedish text for the payout step');
  assert.ok(body.rules.every((r: { message?: string }) => typeof r.message === 'string'));
  assert.deepEqual(body.humanReview, { available: true });
  assert.equal((await call('GET', '/v1/claims/clm_021877/decisions/2/explanation')).status, 404);
  assert.equal((await call('GET', '/v1/claims/clm_021877/decisions/x/explanation')).status, 422);
});

test('human review: the customer channel requests it, a handler answers, and the request is closed', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { token: 'clinic', key: 'key-00000311', body: input(otitisClaim()) });
  const path = '/v1/claims/clm_021877/decisions/1/review-requests';
  const body = { statement: 'The ear infection started after the waiting period.' };

  assert.equal((await call('POST', path, { token: 'clinic', key: 'key-00000312', body })).status, 403);
  assert.equal((await call('POST', path, { token: 'customer', body })).status, 422, 'Idempotency-Key is required');
  assert.equal((await call('POST', path, { token: 'customer', key: 'key-00000313', body: { note: 'x' } })).status, 422);

  const res = await call('POST', path, { token: 'customer', key: 'key-00000314', body });
  assert.equal(res.status, 201);
  const req = (await res.json()) as any;
  assertSchema('ReviewRequest', req);
  assert.equal(req.requestedBy, 'customer-portal');

  const again = await call('POST', path, { token: 'customer', key: 'key-00000315', body });
  assert.equal(again.status, 409);
  assertSchema('Problem', await again.json());

  const dec = await call('POST', '/v1/claims/clm_021877/decisions', { key: 'key-00000316', body: { action: 'accept' } });
  const review = (await dec.json()) as any;
  assertSchema('Decision', review);
  assert.equal(review.automated, false);
  assert.equal(review.reviewRequestId, req.id);

  const list = (await (await call('GET', '/v1/claims/clm_021877/review-requests', { token: 'customer' })).json()) as any;
  assert.equal(list.items.length, 1);
  assertSchema('ReviewRequest', list.items[0]);
  assert.equal(list.items[0].closedByDecisionId, review.id);
  assert.equal((await call('POST', '/v1/claims/clm_021877/decisions/2/review-requests', { token: 'customer', key: 'key-00000317', body: {} })).status, 409);
});

test('the explanation of a deviation names the reason code in the reader\'s language', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { token: 'clinic', key: 'key-00000321', body: input(cruciateClaim()) });
  await call('POST', '/v1/claims/clm_048213/decisions', {
    key: 'key-00000322',
    body: { action: 'reject', reasonCode: 'incorrect_invoice', reason: 'The invoice is for another animal' },
  });
  const body = (await (await call('GET', '/v1/claims/clm_048213/decisions/1/explanation', { lang: 'en' })).json()) as any;
  assertSchema('DecisionExplanation', body);
  assert.equal(body.mainReason.reason, 'deviation.incorrect_invoice');
  assert.match(body.deviation.message, /invoice is incorrect/);
  assert.equal(body.deviation.reason, 'The invoice is for another animal');
  assert.equal(body.humanReview.available, false);
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

test('a claim registered by a clinic follows the contract, with its clinic id', async () => {
  const { call } = setup();
  const res = await call('POST', '/v1/claims', { token: 'clinic', key: 'key-00000451', body: input(otitisClaim()) });
  const body = (await res.json()) as any;
  assertSchema('RegisterClaimResult', body);
  assertSchema('Claim', (await (await call('GET', '/v1/claims/clm_021877', { token: 'clinic' })).json()) as any);
});

// Approval chain (ADR 0019) ---------------------------------------------------------

const lowHandler = { ...DEFAULT_ROLES, handler: { ...DEFAULT_ROLES.handler!, decisionLimits: { SEK: 1_000_000 } } };

test('above the limit: 202 with a proposal, approval by someone else gives 201 with the decision', async () => {
  const { call } = setup({ roles: lowHandler });
  await call('POST', '/v1/claims', { token: 'clinic', key: 'key-00000501', body: input(cruciateClaim()) });
  const res = await call('POST', '/v1/claims/clm_048213/decisions', { key: 'key-00000502', body: { action: 'accept' } });
  assert.equal(res.status, 202);
  const proposal = (await res.json()) as any;
  assertSchema('DecisionProposal', proposal);
  assert.equal(proposal.status, 'open');

  const busy = await call('POST', '/v1/claims/clm_048213/decisions', { key: 'key-00000503', body: { action: 'accept' } });
  assert.equal(busy.status, 409);

  const approvals = `/v1/claims/clm_048213/proposals/${proposal.id}/approvals`;
  assert.equal((await call('POST', approvals, { token: 'clinic', key: 'key-00000504', body: {} })).status, 403, 'clinic lacks claims:approve');
  const own = await call('POST', approvals, { key: 'key-00000505', body: {} });
  assert.equal(own.status, 403, 'four eyes');
  assert.match(((await own.json()) as any).title, /four eyes/);

  const ok = await call('POST', approvals, { token: 'approver', key: 'key-00000506', body: {} });
  assert.equal(ok.status, 201);
  const decision = (await ok.json()) as any;
  assertSchema('Decision', decision);
  assert.equal(decision.decidedBy, 'handlaggare@example.test');
  assert.equal(decision.approvedBy, 'attestant@example.test');

  const list = (await (await call('GET', '/v1/claims/clm_048213/proposals')).json()) as any;
  assertSchema('DecisionProposal', list.items[0]);
  assert.equal(list.items[0].status, 'approved');
  assert.equal((await call('POST', approvals, { token: 'approver', key: 'key-00000507', body: {} })).status, 409);
});

test('a proposal can be returned with a reason, and then decided anew', async () => {
  const { call } = setup({ roles: lowHandler });
  await call('POST', '/v1/claims', { token: 'clinic', key: 'key-00000511', body: input(cruciateClaim()) });
  const proposal = (await (await call('POST', '/v1/claims/clm_048213/decisions', { key: 'key-00000512', body: { action: 'accept' } })).json()) as any;
  const returns = `/v1/claims/clm_048213/proposals/${proposal.id}/returns`;
  assert.equal((await call('POST', returns, { token: 'approver', key: 'key-00000513', body: {} })).status, 422);
  const res = await call('POST', returns, { token: 'approver', key: 'key-00000514', body: { reason: 'Check the food line' } });
  assert.equal(res.status, 200);
  const returned = (await res.json()) as any;
  assertSchema('DecisionProposal', returned);
  assert.equal(returned.status, 'returned');
  assert.equal((await call('POST', '/v1/claims/clm_048213/decisions', { key: 'key-00000515', body: { action: 'accept' } })).status, 202);
});

test('within the default limit a handler decides at once', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { token: 'clinic', key: 'key-00000521', body: input(cruciateClaim()) });
  assert.equal((await call('POST', '/v1/claims/clm_048213/decisions', { key: 'key-00000522', body: { action: 'accept' } })).status, 201);
});

test('limits in the role settings are checked at start-up', () => {
  assert.throws(() => setup({ roles: { handler: { permissions: ['claims:decide'], decisionLimits: { SEK: -1 } } } }), /not a non-negative integer/);
  assert.throws(() => setup({ roles: { handler: { permissions: ['claims:decide'], decisionLimits: { sek: 1 } } } }), /invalid currency/);
});

test('the amount limit of several roles: only roles with the permission count, and the highest wins', () => {
  const roles = {
    a: { permissions: ['claims:decide' as const], decisionLimits: { SEK: 100, EUR: 5 } },
    b: { permissions: ['claims:decide' as const], decisionLimits: { SEK: 300 } },
    c: { permissions: ['claims:read' as const] },
    d: { permissions: ['claims:decide' as const] },
  };
  assert.deepEqual(amountLimitsOf(['a', 'b', 'c'], roles, 'decide'), { SEK: 300, EUR: 5 });
  assert.equal(amountLimitsOf(['a', 'd'], roles, 'decide'), null, 'a role without limits has no limit');
});

// Role settings through the API (ADR 0020) -------------------------------------------

test('an admin lowers the handler limit through the API, and the next decision needs approval at once', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { token: 'clinic', key: 'key-00000601', body: input(cruciateClaim()) });
  assert.equal((await call('GET', '/v1/access/roles')).status, 403, 'a handler cannot read the role settings');

  const current = (await (await call('GET', '/v1/access/roles', { token: 'admin' })).json()) as any;
  assertSchema('RoleConfig', current);
  assert.equal(current.version, 1);
  assert.equal(current.roles.handler.decisionLimits.SEK, 2_500_000);

  const roles = { ...current.roles, handler: { ...current.roles.handler, decisionLimits: { SEK: 1_000_000, EUR: 100_000 } } };
  const res = await call('POST', '/v1/access/roles/versions', {
    token: 'admin',
    key: 'key-00000602',
    body: { basedOnVersion: 1, roles, reason: 'Lower limit for new handlers' },
  });
  assert.equal(res.status, 201);
  const v2 = (await res.json()) as any;
  assertSchema('RoleConfig', v2);
  assert.equal(v2.version, 2);
  assert.equal(v2.changedBy, 'admin@example.test');

  const decided = await call('POST', '/v1/claims/clm_048213/decisions', { key: 'key-00000603', body: { action: 'accept' } });
  assert.equal(decided.status, 202, 'SEK 12,165 is now above the limit');

  const history = (await (await call('GET', '/v1/access/roles/versions', { token: 'admin' })).json()) as any;
  assert.deepEqual(history.items.map((v: { version: number }) => v.version), [1, 2]);
});

test('role settings: an old version gives 409, own roles 403, an invalid set 422', async () => {
  const { call } = setup();
  const current = (await (await call('GET', '/v1/access/roles', { token: 'admin' })).json()) as any;
  const change = (key: string, body: unknown) => call('POST', '/v1/access/roles/versions', { token: 'admin', key, body });

  const ownRole = { ...current.roles, admin: { permissions: ['access:read', 'access:manage', 'claims:approve'] } };
  assert.equal((await change('key-00000611', { basedOnVersion: 1, roles: ownRole, reason: 'More power' })).status, 403);

  const bad = { ...current.roles, viewer: { permissions: ['claims:everything'] } };
  assert.equal((await change('key-00000612', { basedOnVersion: 1, roles: bad, reason: 'Viewer' })).status, 422);

  const viewer = { ...current.roles, viewer: { permissions: ['claims:read'] } };
  assert.equal((await change('key-00000613', { basedOnVersion: 1, roles: viewer, reason: 'Viewer' })).status, 201);
  assert.equal((await change('key-00000614', { basedOnVersion: 1, roles: viewer, reason: 'Again' })).status, 409);
  assert.equal((await change('key-00000615', { basedOnVersion: 2, roles: viewer })).status, 422, 'a reason is required');
});
