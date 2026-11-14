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
  type Principal,
} from '@petvold/claims-api';
import { docsPage, SCALAR_VERSION } from '../src/docs.ts';

const { bellaPolicy, cruciateClaim, otitisClaim, eurPolicy, eurClaim, RULES_SE_DOG, RULES_EUR_EXAMPLE, PRODUCT, PRODUCT_EUR } = fixtures;

function setup() {
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
  };
  const app = createApp({
    service,
    clock,
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

/** Ärende utan receivedAt, som klienter skickar det. */
function input(c: ReturnType<typeof cruciateClaim>) {
  const { receivedAt: _r, ...rest } = c;
  return rest;
}

function assertSchema(name: string, body: unknown) {
  const v = validatorFor(name);
  assert.ok(v(body), `${name}: ${JSON.stringify(v.errors, null, 2)}`);
}

test('kontraktet och implementationen innehåller exakt samma operationer', () => {
  const { app } = setup();
  assert.deepEqual(new Set(implementedOperations(app)), new Set(contractOperations()));
});

test('alla språk har texter för samma regelnycklar', () => {
  const [first, ...rest] = supportedLocales;
  for (const l of rest) assert.deepEqual(messageKeys(l).sort(), messageKeys(first!).sort());
});

test('utan token: 401 som problem+json', async () => {
  const { call } = setup();
  const res = await call('GET', '/v1/claims/x', { token: '' });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');
  assertSchema('Problem', await res.json());
});

test('begäran som bryter mot kontraktet ger 422 med fältfel', async () => {
  const { call } = setup();
  const res = await call('POST', '/v1/claims', { key: 'key-00000001', body: { ...input(otitisClaim()), market: 'sverige', extra: 1 } });
  assert.equal(res.status, 422);
  const body = (await res.json()) as { errors: Array<{ path: string; message: string }> };
  assert.ok(body.errors.some((e) => e.path === '/market'));
  assert.ok(body.errors.some((e) => e.message.includes("'extra'")));
});

test('Idempotency-Key krävs för skapande anrop', async () => {
  const { call } = setup();
  const res = await call('POST', '/v1/claims', { body: input(otitisClaim()) });
  assert.equal(res.status, 422);
});

test('registrera: 201 enligt kontraktet, och samma nyckel ger samma svar', async () => {
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

test('handläggarflöde: bedömning, beslut med inputHash, beslutslista', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { key: 'key-00000003', body: input(cruciateClaim()), token: 'clinic' });

  const aRes = await call('GET', '/v1/claims/clm_048213/assessment', { lang: 'sv-SE,sv;q=0.9' });
  const assessment = (await aRes.json()) as any;
  assertSchema('Assessment', assessment);
  assert.equal(aRes.headers.get('content-language'), 'sv');
  assert.equal(assessment.mode, 'manual');
  const rider = assessment.rules.find((r: any) => r.code === 'RIDER');
  assert.equal(rider.reason, 'rider.possible');
  assert.match(rider.message, /Möjlig koppling till förbehåll: Hälta, höger bakben/);

  const dRes = await call('POST', '/v1/claims/clm_048213/decisions', {
    key: 'key-00000004',
    body: { action: 'accept', reason: 'Vänster ben, ej kopplat', expectedInputHash: assessment.inputHash },
  });
  assert.equal(dRes.status, 201);
  const decision = (await dRes.json()) as any;
  assertSchema('Decision', decision);
  assert.equal(decision.payout, 1_216_500);
  assert.equal(decision.decidedBy, 'handlaggare@example.test');

  const list = (await (await call('GET', '/v1/claims/clm_048213/decisions')).json()) as any;
  assert.equal(list.items.length, 1);
});

test('klinik får inte fatta beslut', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { key: 'key-00000005', body: input(cruciateClaim()), token: 'clinic' });
  const res = await call('POST', '/v1/claims/clm_048213/decisions', { token: 'clinic', key: 'key-00000006', body: { action: 'accept' } });
  assert.equal(res.status, 403);
});

test('inaktuell inputHash ger 409', async () => {
  const { call } = setup();
  await call('POST', '/v1/claims', { key: 'key-00000007', body: input(cruciateClaim()) });
  const res = await call('POST', '/v1/claims/clm_048213/decisions', { key: 'key-00000008', body: { action: 'accept', expectedInputHash: 'gammal' } });
  assert.equal(res.status, 409);
  assertSchema('Problem', await res.json());
});

test('förhandsbesked för kliniken på engelska, med belopp formaterat i rätt valuta', async () => {
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

test('EUR-ärende: belopp och texter följer marknaden', async () => {
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

test('okänt ärende ger 404 som problem+json', async () => {
  const { call } = setup();
  const res = await call('GET', '/v1/claims/finns-inte');
  assert.equal(res.status, 404);
  assertSchema('Problem', await res.json());
});

test('kontraktet serveras', async () => {
  const { app } = setup();
  const res = await app.request('/openapi.yaml');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /^openapi: 3\.1\.0/);
});

// Exempel i kontraktet ---------------------------------------------------------
// Exemplen visas på /docs och används i examples/*.http. De ska följa
// kontraktet och ge det utfall som deras beskrivning lovar.

type Example = { value: unknown };
const doc = openapi as unknown as {
  paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: { $ref: string }; examples?: Record<string, { $ref: string }> }> } }>>;
  components: { examples: Record<string, Example> };
};
const exampleValue = (ref: string) => doc.components.examples[ref.split('/').pop()!]!.value;

test('alla exempel i kontraktet följer sitt schema', () => {
  let checked = 0;
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      for (const media of Object.values(op.requestBody?.content ?? {})) {
        const schema = media.schema.$ref.split('/').pop()!;
        for (const [name, ex] of Object.entries(media.examples ?? {})) {
          const v = validatorFor(schema);
          assert.ok(v(exampleValue(ex.$ref)), `${method.toUpperCase()} ${path} exempel '${name}': ${JSON.stringify(v.errors)}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 9, `förväntade minst 9 exempel, hittade ${checked}`);
});

test('exemplen ger det utfall de beskriver', async () => {
  const { call } = setup();
  const register = async (name: string) => {
    const res = await call('POST', '/v1/claims', { token: 'clinic', key: `exempel-${name}`, body: exampleValue(`#/components/examples/${name}`) });
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

test('API-sidan pekar på kontraktet och har en låst Scalar-version', () => {
  const html = docsPage({ specUrl: '/openapi.yaml', defaultToken: 'dev-handler' });
  assert.match(html, /"url":"\/openapi\.yaml"/);
  assert.match(html, /"token":"dev-handler"/);
  assert.match(html, new RegExp(`@scalar/api-reference@${SCALAR_VERSION.replace(/\./g, '\\.')}"`));
  assert.match(SCALAR_VERSION, /^\d+\.\d+\.\d+$/);
});
