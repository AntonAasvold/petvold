import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimalError, AnimalService, InMemoryAnimalStore, normalizeIdentifier, ownerOn, type RegisterInput } from '../src/index.ts';

const refs: Record<string, { active: boolean; parent?: string }> = {
  'species:dog': { active: true },
  'species:cat': { active: true },
  'species:wolf': { active: false },
  'breed:dog-beagle': { active: true, parent: 'dog' },
  'breed:cat-domestic': { active: true, parent: 'cat' },
  'sex:male': { active: true },
  'sex:female': { active: true },
};

function setup() {
  let n = 0;
  return new AnimalService({
    store: new InMemoryAnimalStore(),
    references: { get: async (kind, code) => refs[`${kind}:${code}`] ?? null },
    clock: { now: () => '2026-11-15T10:00:00.000Z' },
    ids: { next: (p) => `${p}_${++n}` },
  });
}
const by = 'registrar@example.test';
const input = (o: Partial<RegisterInput> = {}): RegisterInput => ({
  market: 'SE',
  species: 'dog',
  breed: 'dog-beagle',
  sex: 'male',
  name: ' Rex ',
  birthDate: '2024-03-01',
  identifiers: [{ type: 'microchip', value: '752 0981 0000 0001' }],
  owner: { partyId: 'pty_anna', from: '2024-05-01' },
  ...o,
});
const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof AnimalError && e.code === code && (!msg || msg.test(e.message)));

test('an animal is registered with a normalized chip and its first owner, and found both ways', async () => {
  const s = setup();
  const a = await s.register(input(), by);
  assert.deepEqual([a.id, a.name, a.neutered, a.revision], ['ani_1', 'Rex', false, 1]);
  assert.deepEqual(a.identifiers.map((i) => [i.type, i.value]), [['microchip', '752098100000001']]);
  assert.deepEqual(a.ownerships.map((o) => [o.seq, o.partyId, o.validFrom, o.validTo]), [[1, 'pty_anna', '2024-05-01', undefined]]);
  assert.deepEqual((await s.findByIdentifier({ type: 'microchip', value: '752-098100000001' })).map((x) => x.id), ['ani_1']);
  assert.deepEqual((await s.findByOwner('pty_anna')).map((x) => x.id), ['ani_1']);
  assert.deepEqual(await s.findByOwner('pty_bo'), []);
});

test('a chip belongs to one animal', async () => {
  const s = setup();
  await s.register(input(), by);
  await rejects(s.register(input({ name: 'Copy' }), by), 'conflict', /belongs to another animal/);
  const other = await s.register(input({ identifiers: [] }), by);
  await rejects(s.addIdentifier(other.id, { type: 'microchip', value: '752098100000001' }, by), 'conflict');
  const r = await s.addIdentifier(other.id, { type: 'registration', value: 'se 12345/2024' }, by);
  assert.deepEqual(r.identifiers.map((i) => i.value), ['SE 12345/2024']);
  assert.equal((await s.addIdentifier(other.id, { type: 'registration', value: 'SE 12345/2024' }, by)).identifiers.length, 1); // a retry
});

test('details are corrected with the current revision and a reason; species never changes', async () => {
  const s = setup();
  const a = await s.register(input(), by);
  const base = { sex: 'male', neutered: true, name: 'Rex', birthDate: '2024-03-01', breed: 'dog-beagle', allowLookup: false };
  await rejects(s.correct(a.id, { ...base, basedOnRevision: 1, reason: '' }, by), 'validation', /reason/);
  const c = await s.correct(a.id, { ...base, basedOnRevision: 1, reason: 'Neutered at the clinic' }, by);
  assert.deepEqual([c.revision, c.neutered, c.reason], [2, true, 'Neutered at the clinic']);
  await rejects(s.correct(a.id, { ...base, basedOnRevision: 1, reason: 'x' }, by), 'conflict', /revision 2/);
  await rejects(s.correct(a.id, { ...base, breed: 'cat-domestic', basedOnRevision: 2, reason: 'x' }, by), 'validation', /not a dog breed/);
  await rejects(s.correct(a.id, { ...base, birthDate: '2024-06-01', basedOnRevision: 2, reason: 'x' }, by), 'validation', /first owner/);
  const dead = await s.correct(a.id, { ...base, deceasedOn: '2026-11-10', basedOnRevision: 2, reason: 'Died' }, by);
  assert.equal(dead.deceasedOn, '2026-11-10');
  await rejects(s.correct(a.id, { ...base, deceasedOn: '2026-12-01', basedOnRevision: 3, reason: 'x' }, by), 'validation', /deceasedOn/);
  assert.deepEqual((await s.revisions(a.id)).map((r) => r.revision), [1, 2, 3]);
});

test('a change of owner ends the previous ownership the same day', async () => {
  const s = setup();
  const a = await s.register(input(), by);
  await rejects(s.transfer(a.id, { partyId: 'pty_anna', from: '2026-06-01' }, by), 'conflict', /already owns/);
  await rejects(s.transfer(a.id, { partyId: 'pty_bo', from: '2024-05-01' }, by), 'validation', /after 2024-05-01/);
  const t = await s.transfer(a.id, { partyId: 'pty_bo', from: '2026-06-01', reason: 'Sold' }, by);
  assert.deepEqual(t.ownerships.map((o) => [o.partyId, o.validFrom, o.validTo ?? null]), [['pty_anna', '2024-05-01', '2026-06-01'], ['pty_bo', '2026-06-01', null]]);
  assert.equal(ownerOn(t.ownerships, '2026-05-31')!.partyId, 'pty_anna');
  assert.equal(ownerOn(t.ownerships, '2026-06-01')!.partyId, 'pty_bo');
  assert.equal(ownerOn(t.ownerships, '2024-04-30'), null);
  const base = { sex: 'male', neutered: false, name: 'Rex', birthDate: '2024-03-01', breed: 'dog-beagle', allowLookup: false };
  await s.correct(a.id, { ...base, deceasedOn: '2026-11-01', basedOnRevision: 1, reason: 'Died' }, by);
  await rejects(s.transfer(a.id, { partyId: 'pty_cy', from: '2026-11-02' }, by), 'validation', /died/);
});

test('a lookup finds only animals open for lookup, and shows no owners or history', async () => {
  const s = setup();
  const a = await s.register(input(), by);
  assert.equal(a.allowLookup, false);
  const chip = { type: 'microchip' as const, value: '752098100000001' };
  assert.deepEqual(await s.lookup(chip), []);
  const base = { sex: 'male', neutered: false, name: 'Rex', birthDate: '2024-03-01', breed: 'dog-beagle' };
  await s.correct(a.id, { ...base, allowLookup: true, basedOnRevision: 1, reason: 'The owner allows lookup' }, by);
  assert.deepEqual(await s.lookup(chip), [
    { id: a.id, market: 'SE', species: 'dog', breed: 'dog-beagle', sex: 'male', neutered: false, name: 'Rex', birthDate: '2024-03-01', identifiers: [chip] },
  ]);
  await s.correct(a.id, { ...base, allowLookup: false, basedOnRevision: 2, reason: 'The owner withdrew it' }, by);
  assert.deepEqual(await s.lookup(chip), []);
  assert.deepEqual((await s.revisions(a.id)).map((r) => r.allowLookup), [false, true, false]);
  const open = await s.register(input({ identifiers: [{ type: 'passport', value: 'se 1' }], allowLookup: true }), by);
  assert.deepEqual((await s.lookup({ type: 'passport', value: 'SE 1' })).map((x) => x.id), [open.id]);
  await rejects(s.register(input({ identifiers: [], allowLookup: 'yes' as never }), by), 'validation', /allowLookup/);
});

test('with a party port, the owner must exist in the animal\'s market', async () => {
  const markets: Record<string, string> = { pty_anna: 'SE', pty_bo: 'SE', pty_dag: 'DE' };
  let n = 0;
  const s = new AnimalService({
    store: new InMemoryAnimalStore(),
    references: { get: async (kind, code) => refs[`${kind}:${code}`] ?? null },
    parties: { marketOf: async (id) => markets[id] ?? null },
    clock: { now: () => '2026-11-15T10:00:00.000Z' },
    ids: { next: (p) => `${p}_${++n}` },
  });
  await rejects(s.register(input({ owner: { partyId: 'pty_nobody', from: '2024-05-01' } }), by), 'validation', /does not exist in market SE/);
  await rejects(s.register(input({ owner: { partyId: 'pty_dag', from: '2024-05-01' } }), by), 'validation', /does not exist in market SE/);
  const a = await s.register(input(), by);
  await rejects(s.transfer(a.id, { partyId: 'pty_dag', from: '2026-06-01' }, by), 'validation', /does not exist/);
  assert.equal((await s.transfer(a.id, { partyId: 'pty_bo', from: '2026-06-01' }, by)).ownerships.length, 2);
});

test('invalid registrations are refused', async () => {
  const s = setup();
  await rejects(s.register(input({ market: 'se' }), by), 'validation', /market/);
  await rejects(s.register(input({ species: 'wolf' }), by), 'validation', /species 'wolf'/);
  await rejects(s.register(input({ breed: 'cat-domestic' }), by), 'validation', /not a dog breed/);
  await rejects(s.register(input({ sex: 'unknown' }), by), 'validation', /sex/);
  await rejects(s.register(input({ name: ' ' }), by), 'validation', /name/);
  await rejects(s.register(input({ birthDate: '2026-12-01' }), by), 'validation', /birthDate/);
  await rejects(s.register(input({ owner: { partyId: 'anna', from: '2024-05-01' } }), by), 'validation', /party id/);
  await rejects(s.register(input({ owner: { partyId: 'pty_anna', from: '2024-01-01' } }), by), 'validation', /birth date/);
  await rejects(s.register(input({ identifiers: [{ type: 'microchip', value: '123' }] }), by), 'validation', /15 digits/);
  const twice = { type: 'microchip' as const, value: '752098100000009' };
  await rejects(s.register(input({ identifiers: [twice, twice] }), by), 'validation', /twice/);
  await rejects(s.get('ani_none'), 'not_found');
  await rejects(s.findByOwner('anna'), 'validation');
});

test('identifiers are normalized', () => {
  assert.deepEqual(normalizeIdentifier({ type: 'microchip', value: ' 752-0981-0000-0001 ' }), { type: 'microchip', value: '752098100000001' });
  assert.deepEqual(normalizeIdentifier({ type: 'passport', value: 'se  52 1234' }), { type: 'passport', value: 'SE 52 1234' });
  assert.throws(() => normalizeIdentifier({ type: 'tattoo' as never, value: 'x' }), /Unknown identifier type/);
});
