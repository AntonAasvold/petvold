/** Parties through the API (ADR 0026). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';
import { createApp, InMemoryIdempotencyStore, validatorFor, type Principal } from '@petvold/api';

const tokens: Record<string, Principal> = {
  registrar: { subject: 'cs@example.test', roles: ['party-registrar'], markets: ['SE'] },
  registrarDe: { subject: 'cs-de@example.test', roles: ['party-registrar'], markets: ['DE'] },
  handler: { subject: 'h@example.test', roles: ['handler'], markets: '*' },
  clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  bound: { subject: 'portal', roles: ['party-registrar', 'customer-channel'], markets: ['SE'], policyIds: ['pol_bella'] },
  officerA: { subject: 'officer-a@example.test', roles: ['privacy-officer'], markets: ['SE'] },
  officerB: { subject: 'officer-b@example.test', roles: ['privacy-officer'], markets: ['SE'] },
  officerDe: { subject: 'officer-de@example.test', roles: ['privacy-officer'], markets: ['DE'] },
  job: { subject: 'retention-job', roles: ['retention-job'], markets: '*' },
};

function setup() {
  const clock = new FixedClock('2026-11-15T10:00:00.000Z');
  const service = new ClaimsService({
    policies: new InMemoryPolicyPort([]),
    rules: new StaticRulesPort({}, fixtures.RULES_SE_DOG),
    store: new InMemoryClaimsStore(),
    clock,
    ids: new SequentialIds(),
  });
  const app = createApp({ service, clock, idempotency: new InMemoryIdempotencyStore(), auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let n = 0;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `key-pty-${String(++n).padStart(4, '0')}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return Object.assign(call, { clock });
}

// Born 2099: valid in form, but no living person can have this number.
const PNR = { type: 'personal-number', country: 'SE', value: '20990101-1230' };
const anna = {
  kind: 'person',
  market: 'SE',
  givenName: 'Anna',
  familyName: 'Example',
  email: 'anna@example.test',
  address: { street: 'Example Street 1', postalCode: '11122', city: 'Example City', country: 'SE' },
  identifiers: [PNR],
};
const record = validatorFor('PartyRecord');
const valid = (x: unknown) => assert.ok(record(structuredClone(x)), JSON.stringify(record.errors));

test('a person is registered, found by personal number and changed, and the number is never shown', async () => {
  const call = setup();
  const res = await call('POST', '/v1/parties', 'registrar', anna);
  assert.equal(res.status, 201);
  valid(res.body);
  assert.deepEqual(res.body.identifiers.map((i: any) => [i.value, i.masked]), [['20990101-****', true]]);
  assert.ok(!JSON.stringify(res.body).includes('209901011230'));

  const found = await call('POST', '/v1/parties/searches', 'handler', { ...PNR, value: '209901011230' });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.items.map((p: any) => p.id), [res.body.id]);
  assert.ok(!JSON.stringify(found.body).includes('209901011230'));

  const changed = await call('PUT', `/v1/parties/${res.body.id}`, 'registrar', {
    basedOnRevision: 1,
    reason: 'Moved',
    givenName: 'Anna',
    familyName: 'Example',
    address: { street: 'New Road 2', postalCode: '22233', city: 'Other City', country: 'SE' },
  });
  assert.equal(changed.status, 200);
  assert.deepEqual([changed.body.revision, changed.body.address.city, changed.body.email], [2, 'Other City', undefined]);
  const revs = await call('GET', `/v1/parties/${res.body.id}/revisions`, 'handler');
  assert.deepEqual(revs.body.items.map((r: any) => [r.revision, r.reason ?? null]), [[1, null], [2, 'Moved']]);

  const org = await call('POST', '/v1/parties', 'registrar', { kind: 'organization', market: 'SE', name: 'Example Kennel' });
  const added = await call('POST', `/v1/parties/${org.body.id}/identifiers`, 'registrar', { type: 'organization-number', country: 'SE', value: '202100-5448' });
  assert.equal(added.status, 201);
  assert.deepEqual(added.body.identifiers.map((i: any) => [i.value, i.masked]), [['2021005448', false]]);
});

test('scope: markets, bound roles and permissions', async () => {
  const call = setup();
  const p = (await call('POST', '/v1/parties', 'registrar', anna)).body;
  assert.equal((await call('GET', `/v1/parties/${p.id}`, 'registrarDe')).status, 404);
  assert.deepEqual((await call('POST', '/v1/parties/searches', 'registrarDe', PNR)).body.items, []);
  assert.equal((await call('POST', '/v1/parties', 'registrarDe', { ...anna, identifiers: [] })).status, 403);
  assert.equal((await call('GET', `/v1/parties/${p.id}`, 'bound')).status, 404);
  assert.equal((await call('POST', '/v1/parties', 'bound', { ...anna, identifiers: [] })).status, 403);
  assert.equal((await call('GET', `/v1/parties/${p.id}`, 'clinic')).status, 403); // no parties:read
  assert.equal((await call('POST', '/v1/parties', 'handler', anna)).status, 403); // no parties:write
  assert.equal((await call('GET', `/v1/parties/${p.id}`, 'handler')).status, 200);
});

test('errors: duplicate numbers, invalid numbers and details, unknown parties', async () => {
  const call = setup();
  await call('POST', '/v1/parties', 'registrar', anna);
  assert.equal((await call('POST', '/v1/parties', 'registrar', { ...anna, givenName: 'Copy' })).status, 409);
  assert.equal((await call('POST', '/v1/parties', 'registrar', { ...anna, identifiers: [{ ...PNR, value: '20990101-1231' }] })).status, 422);
  assert.equal((await call('POST', '/v1/parties', 'registrar', { ...anna, name: 'Anna AB', identifiers: [] })).status, 422);
  assert.equal((await call('POST', '/v1/parties', 'registrar', { ...anna, ssn: 'x' })).status, 422);
  assert.equal((await call('POST', '/v1/parties/searches', 'handler', { type: 'personal-number', value: '1' })).status, 422);
  assert.equal((await call('GET', '/v1/parties/pty_none', 'handler')).status, 404);
  assert.equal((await call('PUT', '/v1/parties/pty_none', 'registrar', { basedOnRevision: 1, reason: 'x', givenName: 'A', familyName: 'B' })).status, 404);
});

test('erasure: requested by one officer, approved by another, and the party is anonymized', async () => {
  const call = setup();
  const p = (await call('POST', '/v1/parties', 'registrar', anna)).body;
  assert.equal((await call('POST', `/v1/parties/${p.id}/erasure-requests`, 'registrar', { basis: 'subject-request', reason: 'x' })).status, 403);
  const req = await call('POST', `/v1/parties/${p.id}/erasure-requests`, 'officerA', { basis: 'subject-request', reason: 'The customer asked by phone' });
  assert.equal(req.status, 201);
  assert.ok(validatorFor('ErasureRequest')(structuredClone(req.body)));
  assert.equal((await call('POST', `/v1/parties/${p.id}/erasure-requests`, 'officerA', { basis: 'subject-request', reason: 'Again' })).status, 409);
  assert.deepEqual((await call('GET', '/v1/erasure-requests?status=pending', 'officerB')).body.items.map((r: any) => r.id), [req.body.id]);
  assert.deepEqual((await call('GET', '/v1/erasure-requests?status=pending', 'officerDe')).body.items, []);
  assert.equal((await call('GET', `/v1/erasure-requests/${req.body.id}`, 'officerDe')).status, 404);

  assert.equal((await call('POST', `/v1/erasure-requests/${req.body.id}/approvals`, 'officerA', {})).status, 403); // four eyes
  const ok = await call('POST', `/v1/erasure-requests/${req.body.id}/approvals`, 'officerB', { reason: 'No policy or claim left' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.decision.outcome, 'approved');

  const gone = (await call('GET', `/v1/parties/${p.id}`, 'handler')).body;
  valid(gone);
  assert.deepEqual([gone.anonymized, gone.givenName, gone.email, gone.identifiers], [true, undefined, undefined, []]);
  const revs = (await call('GET', `/v1/parties/${p.id}/revisions`, 'handler')).body.items;
  assert.ok(!JSON.stringify(revs).includes('Anna'));
  assert.deepEqual((await call('POST', '/v1/parties/searches', 'handler', PNR)).body.items, []);
  assert.equal((await call('PUT', `/v1/parties/${p.id}`, 'registrar', { basedOnRevision: 1, reason: 'x', givenName: 'A', familyName: 'B' })).status, 409);
});

test('erasure: a rejected request from the data subject hides the party from everyone without parties:privacy', async () => {
  const call = setup();
  const p = (await call('POST', '/v1/parties', 'registrar', anna)).body;
  const req = (await call('POST', `/v1/parties/${p.id}/erasure-requests`, 'officerA', { basis: 'subject-request', reason: 'Asked' })).body;
  assert.equal((await call('POST', `/v1/erasure-requests/${req.id}/rejections`, 'officerA', { reason: 'Open claim' })).status, 422);
  const no = await call('POST', `/v1/erasure-requests/${req.id}/rejections`, 'officerA', { reason: 'Claim within the ten-year limit', restrictUntil: '2036-11-15' });
  assert.equal(no.status, 201);
  assert.equal((await call('GET', `/v1/parties/${p.id}`, 'handler')).status, 404);
  assert.deepEqual((await call('POST', '/v1/parties/searches', 'handler', PNR)).body.items, []);
  const seen = await call('GET', `/v1/parties/${p.id}`, 'officerB');
  assert.deepEqual([seen.status, seen.body.restrictedUntil, seen.body.givenName], [200, '2036-11-15', 'Anna']);
  assert.equal((await call('POST', `/v1/erasure-requests/${req.id}/approvals`, 'officerB', {})).status, 409); // already decided
  assert.equal((await call('GET', '/v1/erasure-requests?status=done', 'officerA')).status, 422);
});

test('retention: settings as versions, and a run asks for anonymization of parties past their retention', async () => {
  const call = setup();
  const v1 = await call('GET', '/v1/settings/retention', 'officerA');
  assert.deepEqual([v1.status, v1.body.version, v1.body.markets], [200, 1, { SE: { years: 10 } }]);
  assert.equal((await call('GET', '/v1/settings/retention', 'handler')).status, 403);
  assert.equal((await call('POST', '/v1/settings/retention/versions', 'job', { basedOnVersion: 1, markets: {}, reason: 'x' })).status, 403);
  assert.equal((await call('POST', '/v1/settings/retention/versions', 'officerA', { basedOnVersion: 1, markets: { SE: { years: 0 } }, reason: 'x' })).status, 422);
  const v2 = await call('POST', '/v1/settings/retention/versions', 'officerA', { basedOnVersion: 1, markets: { SE: { years: 10 }, DE: { years: 10 } }, reason: 'Germany added' });
  assert.equal(v2.status, 201);
  assert.equal((await call('POST', '/v1/settings/retention/versions', 'officerA', { basedOnVersion: 1, markets: {}, reason: 'x' })).status, 409);
  assert.deepEqual((await call('GET', '/v1/settings/retention/versions', 'officerB')).body.items.map((v: any) => v.version), [1, 2]);

  call.clock.set('2014-03-01T10:00:00.000Z');
  const old = (await call('POST', '/v1/parties', 'registrar', { ...anna, identifiers: [] })).body;
  call.clock.set('2026-11-15T10:00:00.000Z');
  await call('POST', '/v1/parties', 'registrar', { ...anna, givenName: 'New', identifiers: [] });

  const dry = await call('POST', '/v1/retention-runs', 'job', { dryRun: true });
  assert.equal(dry.status, 200);
  assert.ok(validatorFor('RetentionRunResult')(structuredClone(dry.body)));
  assert.deepEqual(dry.body.due.map((d: any) => [d.partyId, d.retainedUntil]), [[old.id, '2024-03-01']]);
  assert.equal((await call('GET', '/v1/erasure-requests?status=pending', 'officerA')).body.items.length, 0);

  const run = await call('POST', '/v1/retention-runs', 'job', {});
  const requestId = run.body.due[0].requestId;
  const pending = (await call('GET', '/v1/erasure-requests?status=pending', 'officerA')).body.items;
  assert.deepEqual(pending.map((r: any) => [r.id, r.basis, r.requestedBy]), [[requestId, 'retention-expired', 'retention-job']]);
  assert.equal((await call('POST', `/v1/erasure-requests/${requestId}/approvals`, 'officerA', {})).status, 201);
  assert.equal((await call('GET', `/v1/parties/${old.id}`, 'handler')).body.anonymized, true);
  assert.equal((await call('POST', '/v1/retention-runs', 'handler', {})).status, 403);
});

test('a party is found by name or email in the body, within the markets; a restricted one only with parties:privacy (ADR 0039)', async () => {
  const call = setup();
  const a = (await call('POST', '/v1/parties', 'registrar', anna)).body;
  await call('POST', '/v1/parties', 'registrarDe', { ...anna, market: 'DE', identifiers: [], email: 'anna@example.de' });
  const found = await call('POST', '/v1/parties/searches', 'registrar', { text: 'anna' });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.items.map((p: any) => p.id), [a.id], 'only the caller\'s markets');
  found.body.items.forEach(valid);
  assert.equal((await call('POST', '/v1/parties/searches', 'registrar', { text: 'a' })).status, 422);
  assert.equal((await call('POST', '/v1/parties/searches', 'registrar', { text: 'anna', type: 'personal-number' })).status, 422, 'a text or a number');

  assert.equal((await call('POST', `/v1/parties/${a.id}/restrictions`, 'registrar', { until: '2027-01-31', reason: 'x' })).status, 403);
  const r = await call('POST', `/v1/parties/${a.id}/restrictions`, 'officerA', { until: '2027-01-31', reason: 'The customer contests the details' });
  assert.equal(r.status, 201);
  valid(r.body);
  assert.equal(r.body.restrictedUntil, '2027-01-31');
  assert.deepEqual((await call('POST', '/v1/parties/searches', 'registrar', { text: 'anna' })).body.items, [], 'hidden while restricted');
  assert.equal((await call('POST', '/v1/parties/searches', 'officerA', { text: 'anna' })).body.items.length, 1);
  const l = await call('POST', `/v1/parties/${a.id}/restriction-liftings`, 'officerB', { reason: 'Checked' });
  assert.deepEqual([l.status, l.body.restrictedUntil], [201, undefined]);
  assert.equal((await call('POST', `/v1/parties/${a.id}/restriction-liftings`, 'officerB', { reason: 'Again' })).status, 409);
});

test('a number is removed by its id with a reason and may then be added to another party (ADR 0039)', async () => {
  const call = setup();
  const a = (await call('POST', '/v1/parties', 'registrar', anna)).body;
  const bo = (await call('POST', '/v1/parties', 'registrar', { ...anna, givenName: 'Bo', identifiers: [] })).body;
  assert.equal((await call('POST', `/v1/parties/${bo.id}/identifiers`, 'registrar', PNR)).status, 409, 'Anna has it');
  const pid = a.identifiers[0].id;
  assert.equal((await call('POST', `/v1/parties/${a.id}/identifiers/${pid}/removals`, 'handler', { reason: 'x' })).status, 403);
  const removed = await call('POST', `/v1/parties/${a.id}/identifiers/${pid}/removals`, 'registrar', { reason: 'Added to the wrong party' });
  assert.equal(removed.status, 201);
  valid(removed.body);
  assert.deepEqual([removed.body.identifiers, removed.body.removedIdentifiers[0].masked, removed.body.removedIdentifiers[0].removalReason], [[], true, 'Added to the wrong party']);
  assert.ok(!JSON.stringify(removed.body).includes('209901011230'), 'never the whole number');
  assert.equal((await call('POST', `/v1/parties/${bo.id}/identifiers`, 'registrar', PNR)).status, 201);
  assert.equal((await call('POST', `/v1/parties/${a.id}/identifiers/pid_none/removals`, 'registrar', { reason: 'x' })).status, 404);
});

test('a party without policies in force is ended and reopened (ADR 0039)', async () => {
  const call = setup();
  const a = (await call('POST', '/v1/parties', 'registrar', anna)).body;
  assert.equal((await call('POST', `/v1/parties/${a.id}/endings`, 'registrar', { cause: 'deceased', on: '2026-11-16', reason: 'x' })).status, 422, 'not after today');
  const e = await call('POST', `/v1/parties/${a.id}/endings`, 'registrar', { cause: 'deceased', on: '2026-11-10', reason: 'Death certificate received' });
  assert.equal(e.status, 201);
  valid(e.body);
  assert.deepEqual([e.body.ended.cause, e.body.ended.on, e.body.ended.endedBy], ['deceased', '2026-11-10', 'cs@example.test']);
  assert.equal((await call('POST', `/v1/parties/${a.id}/endings`, 'registrar', { cause: 'deceased', on: '2026-11-10', reason: 'y' })).status, 409);
  const o = await call('POST', `/v1/parties/${a.id}/reopenings`, 'registrar', { reason: 'Ended by mistake' });
  assert.deepEqual([o.status, o.body.ended], [201, undefined]);
});

test('the policyholder of a policy in force is not ended: the answer names the policy (ADR 0039)', async () => {
  const { compose } = await import('../src/composition.ts');
  const { seedSampleData } = await import('../src/seed.ts');
  const clock = { now: () => '2026-11-20T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  const res = await app.request('/v1/parties/pty_owner001/endings', {
    method: 'POST',
    headers: { authorization: 'Bearer registrar', 'content-type': 'application/json', 'idempotency-key': 'end-anna' },
    body: JSON.stringify({ cause: 'deceased', on: '2026-11-19', reason: 'Death certificate received' }),
  });
  assert.equal(res.status, 409);
  assert.match(((await res.json()) as any).detail, /pol_bella/);
});
