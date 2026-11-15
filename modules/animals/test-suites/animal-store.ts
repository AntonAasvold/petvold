/** Shared test suite for AnimalStore (ADR 0012 layer 4, ADR 0024). */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimalConflictError, IdentifierTakenError, type Animal, type AnimalIdentifier, type AnimalStore, type Ownership } from '../src/index.ts';

export type AnimalStoreFactory = () => Promise<{ store: AnimalStore; cleanup?: () => Promise<void> }>;

const at = '2026-11-15T10:00:00.000Z';
export const animal = (overrides: Partial<Animal> = {}): Animal => ({
  id: 'ani_rex',
  revision: 1,
  market: 'XX',
  species: 'dog',
  breed: 'dog-beagle',
  sex: 'male',
  neutered: false,
  allowLookup: false,
  name: 'Rex',
  birthDate: '2024-03-01',
  changedBy: 'registrar@example.test',
  changedAt: at,
  ...overrides,
});
export const chip = (value = '752098100000001'): AnimalIdentifier => ({ type: 'microchip', value, addedBy: 'registrar@example.test', addedAt: at });
export const owner = (overrides: Partial<Ownership> = {}): Ownership => ({
  seq: 1,
  partyId: 'pty_anna',
  validFrom: '2024-05-01',
  recordedBy: 'registrar@example.test',
  recordedAt: at,
  ...overrides,
});

export function animalStoreSuite(name: string, factory: AnimalStoreFactory): void {
  describe(`AnimalStore: ${name}`, () => {
    const it = (title: string, fn: (store: AnimalStore) => Promise<void>) =>
      test(title, async () => {
        const h = await factory();
        try {
          await fn(h.store);
        } finally {
          await h.cleanup?.();
        }
      });

    it('an animal is read back with identifiers and owners', async (store) => {
      await store.register(animal(), [chip()], owner());
      assert.deepEqual(await store.get('ani_rex'), { ...animal(), identifiers: [chip()], ownerships: [owner()] });
      assert.equal(await store.findByIdentifier('microchip', '752098100000001'), 'ani_rex');
      assert.equal(await store.findByIdentifier('microchip', '752098100000002'), null);
      assert.deepEqual(await store.findByOwner('pty_anna', '2026-01-01'), ['ani_rex']);
      assert.deepEqual(await store.findByOwner('pty_anna', '2024-04-30'), []);
      assert.equal(await store.get('ani_none'), null);
    });

    it('registering is all or nothing, and an identifier belongs to one animal', async (store) => {
      await store.register(animal(), [chip()], owner());
      await assert.rejects(store.register(animal({ id: 'ani_bella' }), [chip()], owner()), IdentifierTakenError);
      assert.equal(await store.get('ani_bella'), null);
      await assert.rejects(store.addIdentifier('ani_rex', chip()), IdentifierTakenError);
      const reg: AnimalIdentifier = { type: 'registration', value: 'SE12345/2024', addedBy: 'x@example.test', addedAt: '2026-11-15T11:00:00.000Z' };
      await store.addIdentifier('ani_rex', reg);
      assert.deepEqual((await store.get('ani_rex'))!.identifiers, [chip(), reg]);
    });

    it('revisions follow each other and keep the history', async (store) => {
      await store.register(animal(), [], owner());
      const neutered = animal({ revision: 2, neutered: true, allowLookup: true, reason: 'Neutered', changedAt: '2026-11-16T10:00:00.000Z' });
      await store.appendRevision(neutered);
      await assert.rejects(store.appendRevision(neutered), AnimalConflictError);
      await assert.rejects(store.appendRevision(animal({ revision: 4, reason: 'x' })), AnimalConflictError);
      assert.deepEqual(await store.revisions('ani_rex'), [animal(), neutered]);
      assert.equal((await store.get('ani_rex'))!.allowLookup, true);
      assert.equal((await store.get('ani_rex'))!.neutered, true);
    });

    it('a litter is stored with all its animals, all or nothing', async (store) => {
      const pup = (n: number, chipValue?: string) => ({
        animal: animal({ id: `ani_pup${n}`, name: `Pup ${n}`, birthDate: '2026-09-01' }),
        identifiers: chipValue ? [chip(chipValue)] : [],
        owner: owner({ partyId: 'pty_kennel', validFrom: '2026-09-01' }),
      });
      const litter = {
        id: 'lit_1',
        market: 'XX',
        species: 'dog',
        birthDate: '2026-09-01',
        damId: 'ani_rex',
        breederPartyId: 'pty_kennel',
        animalIds: ['ani_pup1', 'ani_pup2'],
        registeredBy: 'registrar@example.test',
        registeredAt: at,
      };
      await store.register(animal(), [chip()], owner());
      await assert.rejects(store.registerLitter({ ...litter, id: 'lit_0' }, [pup(1), pup(2, '752098100000001')]), IdentifierTakenError);
      assert.equal(await store.get('ani_pup1'), null);
      assert.equal(await store.getLitter('lit_0'), null);
      await store.registerLitter(litter, [pup(1, '752098100000011'), pup(2)]);
      assert.deepEqual(await store.getLitter('lit_1'), litter);
      const p1 = (await store.get('ani_pup1'))!;
      assert.deepEqual([p1.litterId, p1.ownerships[0]!.partyId, p1.identifiers.length], ['lit_1', 'pty_kennel', 1]);
      assert.equal((await store.get('ani_rex'))!.litterId, undefined);
      assert.equal(await store.getLitter('lit_none'), null);
    });

    it('a transfer closes the open ownership the day the new one starts', async (store) => {
      await store.register(animal(), [], owner());
      const next = owner({ seq: 2, partyId: 'pty_bo', validFrom: '2026-06-01', reason: 'Sold' });
      await store.transfer('ani_rex', 1, next);
      await assert.rejects(store.transfer('ani_rex', 1, owner({ seq: 3, partyId: 'pty_cy', validFrom: '2026-07-01' })), AnimalConflictError);
      assert.deepEqual((await store.get('ani_rex'))!.ownerships, [owner({ validTo: '2026-06-01' }), next]);
      assert.deepEqual(await store.findByOwner('pty_anna', '2026-05-31'), ['ani_rex']);
      assert.deepEqual(await store.findByOwner('pty_anna', '2026-06-01'), []);
      assert.deepEqual(await store.findByOwner('pty_bo', '2026-06-01'), ['ani_rex']);
    });
  });
}
