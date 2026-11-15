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
  return async (method: string, path: string, token: string, body?: unknown) => {
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

  const found = await call('POST', '/v1/party-searches', 'handler', { ...PNR, value: '209901011230' });
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
  assert.deepEqual((await call('POST', '/v1/party-searches', 'registrarDe', PNR)).body.items, []);
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
  assert.equal((await call('POST', '/v1/party-searches', 'handler', { type: 'personal-number', value: '1' })).status, 422);
  assert.equal((await call('GET', '/v1/parties/pty_none', 'handler')).status, 404);
  assert.equal((await call('PUT', '/v1/parties/pty_none', 'registrar', { basedOnRevision: 1, reason: 'x', givenName: 'A', familyName: 'B' })).status, 404);
});
