/** Shared test suite for ReferenceDataStore (ADR 0012 layer 4, ADR 0022). */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ReferenceConflictError, type ReferenceDataStore, type ReferenceItem } from '../src/index.ts';

export type ReferenceDataStoreFactory = () => Promise<{ store: ReferenceDataStore; cleanup?: () => Promise<void> }>;

export const item = (overrides: Partial<ReferenceItem> = {}): ReferenceItem => ({
  kind: 'species',
  code: 'dog',
  labels: { en: 'Dog', de: 'Hund' },
  active: true,
  revision: 1,
  changedBy: 'catalog@example.test',
  changedAt: '2026-11-15T10:00:00.000Z',
  ...overrides,
});

export function referenceDataStoreSuite(name: string, factory: ReferenceDataStoreFactory): void {
  describe(`ReferenceDataStore: ${name}`, () => {
    const it = (title: string, fn: (store: ReferenceDataStore) => Promise<void>) =>
      test(title, async () => {
        const h = await factory();
        try {
          await fn(h.store);
        } finally {
          await h.cleanup?.();
        }
      });

    it('items are read back unchanged, latest revision per code, ordered by code', async (store) => {
      await store.append(item());
      await store.append(item({ code: 'cat', labels: { en: 'Cat' } }));
      const renamed = item({ revision: 2, labels: { en: 'Dog', de: 'Hunde' }, reason: 'Spelling' });
      await store.append(renamed);
      await store.append(item({ kind: 'sex', code: 'female', labels: { en: 'Female' } }));
      assert.deepEqual(await store.list('species'), [item({ code: 'cat', labels: { en: 'Cat' } }), renamed]);
      assert.deepEqual(await store.get('species', 'dog'), renamed);
      assert.deepEqual(await store.history('species', 'dog'), [item(), renamed]);
      assert.equal(await store.get('species', 'horse'), null);
      assert.deepEqual(await store.list('breed'), []);
    });

    it('a breed keeps its species', async (store) => {
      await store.append(item());
      const breed = item({ kind: 'breed', code: 'dog-labrador-retriever', parent: 'dog', labels: { en: 'Labrador Retriever' } });
      await store.append(breed);
      assert.deepEqual(await store.list('breed'), [breed]);
    });

    it('only the next revision can be stored', async (store) => {
      await assert.rejects(store.append(item({ revision: 2, reason: 'x' })), ReferenceConflictError);
      await store.append(item());
      await assert.rejects(store.append(item()), ReferenceConflictError);
      await assert.rejects(store.append(item({ revision: 3, reason: 'x' })), ReferenceConflictError);
      assert.equal((await store.history('species', 'dog')).length, 1);
    });
  });
}
