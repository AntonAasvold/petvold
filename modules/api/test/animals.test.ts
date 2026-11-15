/** The animal register through the API (ADR 0024). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';
import { createApp, InMemoryIdempotencyStore, validatorFor, type Principal } from '@petvold/api';

const tokens: Record<string, Principal> = {
  registrar: { subject: 'registrar@example.test', roles: ['animal-registrar'], markets: ['SE'] },
  registrarDe: { subject: 'registrar-de@example.test', roles: ['animal-registrar'], markets: ['DE'] },
  handler: { subject: 'h@example.test', roles: ['handler'], markets: '*' },
  catalog: { subject: 'catalog@example.test', roles: ['catalog-manager'] },
  clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  boundRegistrar: { subject: 'portal', roles: ['animal-registrar', 'customer-channel'], markets: ['SE'], policyIds: ['pol_bella'] },
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
  return (method: string, path: string, token: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `key-ani-${String(++n).padStart(4, '0')}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
}

async function references(call: ReturnType<typeof setup>) {
  await call('PUT', '/v1/reference-data/species/dog', 'catalog', { labels: { en: 'Dog' } });
  await call('PUT', '/v1/reference-data/breed/dog-beagle', 'catalog', { parent: 'dog', labels: { en: 'Beagle' } });
  await call('PUT', '/v1/reference-data/sex/male', 'catalog', { labels: { en: 'Male' } });
}
const rex = {
  market: 'SE',
  species: 'dog',
  breed: 'dog-beagle',
  sex: 'male',
  name: 'Rex',
  birthDate: '2024-03-01',
  identifiers: [{ type: 'microchip', value: '752098100000042' }],
  owner: { partyId: 'pty_anna', from: '2024-05-01' },
};
const record = validatorFor('AnimalRecord');
const valid = (x: unknown) => assert.ok(record(structuredClone(x)), JSON.stringify(record.errors));

test('an animal is registered, found by chip and owner, corrected and sold', async () => {
  const call = setup();
  await references(call);
  const res = await call('POST', '/v1/animals', 'registrar', rex);
  assert.equal(res.status, 201);
  const a = (await res.json()) as any;
  valid(a);

  const byChip = (await (await call('GET', '/v1/animals?microchip=752 098 100 000 042', 'handler')).json()) as any;
  assert.deepEqual(byChip.items.map((x: any) => x.id), [a.id]);
  const byOwner = (await (await call('GET', '/v1/animals?ownerPartyId=pty_anna', 'registrar')).json()) as any;
  assert.deepEqual(byOwner.items.map((x: any) => x.id), [a.id]);

  const fix = { basedOnRevision: 1, reason: 'Neutered', sex: 'male', neutered: true, name: 'Rex', birthDate: '2024-03-01', breed: 'dog-beagle' };
  assert.equal((await call('PUT', `/v1/animals/${a.id}`, 'registrar', fix)).status, 200);
  assert.equal((await call('PUT', `/v1/animals/${a.id}`, 'registrar', fix)).status, 409);
  const revs = (await (await call('GET', `/v1/animals/${a.id}/revisions`, 'handler')).json()) as any;
  assert.deepEqual(revs.items.map((r: any) => [r.revision, r.neutered]), [[1, false], [2, true]]);

  const sold = await call('POST', `/v1/animals/${a.id}/ownerships`, 'registrar', { partyId: 'pty_bo', from: '2026-06-01', reason: 'Sold' });
  assert.equal(sold.status, 201);
  const s = (await sold.json()) as any;
  valid(s);
  assert.deepEqual(s.ownerships.map((o: any) => [o.partyId, o.validTo ?? null]), [['pty_anna', '2026-06-01'], ['pty_bo', null]]);
  assert.equal(((await (await call('GET', '/v1/animals?ownerPartyId=pty_anna', 'registrar')).json()) as any).items.length, 0);

  const added = await call('POST', `/v1/animals/${a.id}/identifiers`, 'registrar', { type: 'registration', value: 'SE12345/2024' });
  assert.equal(added.status, 201);
  assert.equal(((await added.json()) as any).identifiers.length, 2);
});

test('scope: markets, bound roles and permissions', async () => {
  const call = setup();
  await references(call);
  const a = (await (await call('POST', '/v1/animals', 'registrar', rex)).json()) as any;
  assert.equal((await call('GET', `/v1/animals/${a.id}`, 'registrarDe')).status, 404);
  assert.deepEqual(((await (await call('GET', '/v1/animals?microchip=752098100000042', 'registrarDe')).json()) as any).items, []);
  assert.equal((await call('POST', '/v1/animals', 'registrarDe', { ...rex, identifiers: [] })).status, 403);
  assert.equal((await call('GET', `/v1/animals/${a.id}`, 'boundRegistrar')).status, 404);
  assert.equal((await call('POST', '/v1/animals', 'boundRegistrar', { ...rex, identifiers: [] })).status, 403);
  assert.equal((await call('GET', `/v1/animals/${a.id}`, 'clinic')).status, 403); // no animals:read
  assert.equal((await call('POST', '/v1/animals', 'handler', rex)).status, 403); // no animals:write
  assert.equal((await call('GET', `/v1/animals/${a.id}`, 'handler')).status, 200);
});

test('errors: duplicate chip, bad filters, unknown animals', async () => {
  const call = setup();
  await references(call);
  await call('POST', '/v1/animals', 'registrar', rex);
  assert.equal((await call('POST', '/v1/animals', 'registrar', { ...rex, name: 'Copy' })).status, 409);
  assert.equal((await call('POST', '/v1/animals', 'registrar', { ...rex, breed: 'dog-pug', identifiers: [] })).status, 422);
  assert.equal((await call('GET', '/v1/animals', 'handler')).status, 422);
  assert.equal((await call('GET', '/v1/animals?microchip=1&ownerPartyId=pty_anna', 'handler')).status, 422);
  assert.equal((await call('GET', '/v1/animals?microchip=123', 'handler')).status, 422);
  assert.equal((await call('GET', '/v1/animals/ani_none', 'handler')).status, 404);
  assert.equal((await call('POST', '/v1/animals/ani_none/ownerships', 'registrar', { partyId: 'pty_bo', from: '2026-06-01' })).status, 404);
});
