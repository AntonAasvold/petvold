/** The animal register through the API (ADR 0024). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';
import { createApp, InMemoryIdempotencyStore, validatorFor, type Principal } from '@petvold/api';
import { InMemoryPartyStore, PartyService } from '@petvold/parties';

/** Owners as parties (ADR 0026): Anna and Bo in Sweden, Dag in Germany. */
async function partiesWithOwners(clock: { now(): string }) {
  const store = new InMemoryPartyStore();
  const at = clock.now();
  for (const [id, givenName, market] of [['pty_anna', 'Anna', 'SE'], ['pty_bo', 'Bo', 'SE'], ['pty_dag', 'Dag', 'DE']] as const) {
    await store.register({ id, revision: 1, kind: 'person', market, givenName, familyName: 'Example', changedBy: 'test', changedAt: at }, []);
  }
  return new PartyService({ store, clock, ids: { next: (p) => `${p}_x` } });
}

const tokens: Record<string, Principal> = {
  registrar: { subject: 'registrar@example.test', roles: ['animal-registrar'], markets: ['SE'] },
  registrarDe: { subject: 'registrar-de@example.test', roles: ['animal-registrar'], markets: ['DE'] },
  handler: { subject: 'h@example.test', roles: ['handler'], markets: '*' },
  catalog: { subject: 'catalog@example.test', roles: ['catalog-manager'] },
  clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  clinicDe: { subject: 'klinik-de', roles: ['clinic'], markets: ['DE'], clinicId: 'clinic_de' },
  boundRegistrar: { subject: 'portal', roles: ['animal-registrar', 'customer-channel'], markets: ['SE'], policyIds: ['pol_bella'] },
};

async function setup() {
  const clock = new FixedClock('2026-11-15T10:00:00.000Z');
  const service = new ClaimsService({
    policies: new InMemoryPolicyPort([]),
    rules: new StaticRulesPort({}, fixtures.RULES_SE_DOG),
    store: new InMemoryClaimsStore(),
    clock,
    ids: new SequentialIds(),
  });
  const app = createApp({
    service,
    clock,
    parties: await partiesWithOwners(clock),
    idempotency: new InMemoryIdempotencyStore(),
    auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) },
  });
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

async function references(call: Awaited<ReturnType<typeof setup>>) {
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
  const call = await setup();
  await references(call);
  const res = await call('POST', '/v1/animals', 'registrar', rex);
  assert.equal(res.status, 201);
  const a = (await res.json()) as any;
  valid(a);

  const byChip = (await (await call('GET', '/v1/animals?microchip=752 098 100 000 042', 'handler')).json()) as any;
  assert.deepEqual(byChip.items.map((x: any) => x.id), [a.id]);
  const byOwner = (await (await call('GET', '/v1/animals?ownerPartyId=pty_anna', 'registrar')).json()) as any;
  assert.deepEqual(byOwner.items.map((x: any) => x.id), [a.id]);

  const fix = { basedOnRevision: 1, reason: 'Neutered', sex: 'male', neutered: true, name: 'Rex', birthDate: '2024-03-01', breed: 'dog-beagle', allowLookup: false };
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
  const call = await setup();
  await references(call);
  const a = (await (await call('POST', '/v1/animals', 'registrar', rex)).json()) as any;
  assert.equal((await call('GET', `/v1/animals/${a.id}`, 'registrarDe')).status, 404);
  assert.deepEqual(((await (await call('GET', '/v1/animals?microchip=752098100000042', 'registrarDe')).json()) as any).items, []);
  assert.equal((await call('POST', '/v1/animals', 'registrarDe', { ...rex, identifiers: [] })).status, 403);
  assert.equal((await call('GET', `/v1/animals/${a.id}`, 'boundRegistrar')).status, 404);
  assert.equal((await call('POST', '/v1/animals', 'boundRegistrar', { ...rex, identifiers: [] })).status, 403);
  assert.equal((await call('GET', `/v1/animals/${a.id}`, 'clinic')).status, 403); // no animals:read
  assert.equal((await call('GET', '/v1/animal-summaries?microchip=752098100000042', 'handler')).status, 403); // no animals:lookup
  assert.equal((await call('POST', '/v1/animals', 'handler', rex)).status, 403); // no animals:write
  assert.equal((await call('GET', `/v1/animals/${a.id}`, 'handler')).status, 200);
});

test('errors: duplicate chip, bad filters, unknown animals', async () => {
  const call = await setup();
  await references(call);
  await call('POST', '/v1/animals', 'registrar', rex);
  assert.equal((await call('POST', '/v1/animals', 'registrar', { ...rex, name: 'Copy' })).status, 409);
  assert.equal((await call('POST', '/v1/animals', 'registrar', { ...rex, breed: 'dog-pug', identifiers: [] })).status, 422);
  assert.equal((await call('GET', '/v1/animals', 'handler')).status, 422);
  assert.equal((await call('GET', '/v1/animals?microchip=1&ownerPartyId=pty_anna', 'handler')).status, 422);
  assert.equal((await call('GET', '/v1/animals?microchip=123', 'handler')).status, 422);
  assert.equal((await call('GET', '/v1/animals/ani_none', 'handler')).status, 404);
  assert.equal((await call('POST', '/v1/animals/ani_none/ownerships', 'registrar', { partyId: 'pty_bo', from: '2026-06-01' })).status, 404);
  // The owner must exist, in the animal's market.
  assert.equal((await call('POST', '/v1/animals', 'registrar', { ...rex, identifiers: [], owner: { partyId: 'pty_nobody', from: '2024-05-01' } })).status, 422);
  assert.equal((await call('POST', '/v1/animals', 'registrar', { ...rex, identifiers: [], owner: { partyId: 'pty_dag', from: '2024-05-01' } })).status, 422);
  const a = (await (await call('GET', '/v1/animals?microchip=752098100000042', 'handler')).json()) as any;
  const toDag = await call('POST', `/v1/animals/${a.items[0].id}/ownerships`, 'registrar', { partyId: 'pty_dag', from: '2026-06-01' });
  assert.equal(toDag.status, 422);
});

test('a clinic looks up an animal by chip only when the animal is open for lookup', async () => {
  const call = await setup();
  await references(call);
  const a = (await (await call('POST', '/v1/animals', 'registrar', rex)).json()) as any;
  assert.equal(a.allowLookup, false);
  const lookup = async (token: string, q = 'microchip=752 098 100 000 042') => {
    const res = await call('GET', `/v1/animal-summaries?${q}`, token);
    assert.equal(res.status, 200);
    return ((await res.json()) as any).items;
  };
  assert.deepEqual(await lookup('clinic'), []);

  const open = { basedOnRevision: 1, reason: 'The owner allows lookup', sex: 'male', neutered: false, name: 'Rex', birthDate: '2024-03-01', breed: 'dog-beagle', allowLookup: true };
  assert.equal((await call('PUT', `/v1/animals/${a.id}`, 'registrar', open)).status, 200);
  const items = await lookup('clinic');
  assert.ok(validatorFor('AnimalSummary')(items[0]));
  assert.deepEqual(items, [
    { id: a.id, market: 'SE', species: 'dog', breed: 'dog-beagle', sex: 'male', neutered: false, name: 'Rex', birthDate: '2024-03-01', identifiers: [{ type: 'microchip', value: '752098100000042' }] },
  ]);
  assert.deepEqual(await lookup('clinicDe'), []); // another market
  assert.deepEqual(await lookup('clinic', 'microchip=752098100000099'), []);

  // Still no owners, history or search by owner for a clinic.
  assert.equal((await call('GET', `/v1/animals/${a.id}`, 'clinic')).status, 403);
  assert.equal((await call('GET', '/v1/animals?ownerPartyId=pty_anna', 'clinic')).status, 403);
  assert.equal((await call('GET', '/v1/animal-summaries', 'clinic')).status, 422);
  assert.equal((await call('GET', '/v1/animal-summaries?microchip=1&passport=x', 'clinic')).status, 422);
  assert.equal((await call('GET', '/v1/animal-summaries?microchip=123', 'clinic')).status, 422);

  assert.equal((await call('PUT', `/v1/animals/${a.id}`, 'registrar', { ...open, basedOnRevision: 2, allowLookup: false, reason: 'Withdrawn' })).status, 200);
  assert.deepEqual(await lookup('clinic'), []);
  const { allowLookup: _a, ...missing } = open;
  assert.equal((await call('PUT', `/v1/animals/${a.id}`, 'registrar', { ...missing, basedOnRevision: 3 })).status, 422);
});

test('a litter is registered with its animals, found by id, and its animals sold one by one', async () => {
  const call = await setup();
  await references(call);
  await call('PUT', '/v1/reference-data/sex/female', 'catalog', { labels: { en: 'Female' } });
  const dam = (await (await call('POST', '/v1/animals', 'registrar', { ...rex, sex: 'female', name: 'Dam', owner: { partyId: 'pty_bo', from: '2024-05-01' } })).json()) as any;
  const body = {
    market: 'SE',
    species: 'dog',
    birthDate: '2026-09-01',
    damId: dam.id,
    breederPartyId: 'pty_bo',
    animals: [
      { name: 'Pup A', sex: 'female', breed: 'dog-beagle' },
      { name: 'Pup B', sex: 'male', identifiers: [{ type: 'microchip', value: '752098100000043' }] },
    ],
  };
  const res = await call('POST', '/v1/litters', 'registrar', body);
  assert.equal(res.status, 201);
  const l = (await res.json()) as any;
  assert.ok(validatorFor('Litter')(structuredClone(l)));
  assert.deepEqual([l.damId, l.breederPartyId, l.animalIds.length], [dam.id, 'pty_bo', 2]);
  assert.deepEqual(await (await call('GET', `/v1/litters/${l.id}`, 'handler')).json(), l);

  const pup = (await (await call('GET', `/v1/animals/${l.animalIds[1]}`, 'handler')).json()) as any;
  valid(pup);
  assert.deepEqual([pup.litterId, pup.breed, pup.ownerships[0].partyId, pup.ownerships[0].validFrom], [l.id, undefined, 'pty_bo', '2026-09-01']);
  assert.equal((await call('POST', `/v1/animals/${pup.id}/ownerships`, 'registrar', { partyId: 'pty_anna', from: '2026-11-01', reason: 'Sold' })).status, 201);

  assert.equal((await call('GET', `/v1/litters/${l.id}`, 'registrarDe')).status, 404);
  assert.equal((await call('GET', '/v1/litters/lit_none', 'handler')).status, 404);
  assert.equal((await call('POST', '/v1/litters', 'registrarDe', body)).status, 403);
  assert.equal((await call('POST', '/v1/litters', 'handler', body)).status, 403);
  assert.equal((await call('POST', '/v1/litters', 'registrar', { ...body, animals: [] })).status, 422);
  assert.equal((await call('POST', '/v1/litters', 'registrar', { ...body, breederPartyId: 'pty_dag' })).status, 422);
  assert.equal((await call('POST', '/v1/litters', 'registrar', { ...body, damId: undefined, animals: [body.animals[1]] })).status, 409); // chip taken
});
