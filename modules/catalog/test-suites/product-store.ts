/** Shared test suite for ProductStore (ADR 0012 layer 4, ADR 0023). */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ProductConflictError, type ProductContent, type ProductStore, type ProductVersion } from '../src/index.ts';

export type ProductStoreFactory = () => Promise<{ store: ProductStore; cleanup?: () => Promise<void> }>;

export const content = (overrides: Partial<ProductContent> = {}): ProductContent => ({
  market: 'XX',
  currency: 'EUR',
  species: ['dog'],
  names: { en: 'Dog vet care' },
  ruleSeries: 'XX-DOG',
  vetCare: {
    annualLimits: [300_000, 600_000],
    defaultAnnualLimit: 300_000,
    deductibles: [
      { code: 'standard', labels: { en: 'Standard' }, terms: { fixed: 5_000, fixedPer: 'claim', variableBp: 2000 } },
      { code: 'period', labels: { en: 'Per period' }, terms: { fixed: 10_000, fixedPer: 'period', periodDays: 120, variableBp: 2000 } },
    ],
    defaultDeductible: 'standard',
    waitingPeriodDays: 30,
  },
  ...overrides,
});

export const version = (v: string, overrides: Partial<ProductVersion> = {}): ProductVersion => ({
  product: 'XX-DOG-VC',
  version: v,
  status: 'draft',
  content: content(),
  salesFrom: '2026-01-01',
  revision: 1,
  createdBy: 'author@example.test',
  createdAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
});

const published = {
  status: 'published' as const,
  checksum: 'abc',
  submittedBy: 'author@example.test',
  submittedAt: '2026-11-02T10:00:00.000Z',
  publishedBy: 'publisher@example.test',
  publishedAt: '2026-11-03T10:00:00.000Z',
};

export function productStoreSuite(name: string, factory: ProductStoreFactory): void {
  describe(`ProductStore: ${name}`, () => {
    const it = (title: string, fn: (store: ProductStore) => Promise<void>) =>
      test(title, async () => {
        const h = await factory();
        try {
          await fn(h.store);
        } finally {
          await h.cleanup?.();
        }
      });

    it('versions are read back unchanged, ordered by sales start', async (store) => {
      const later = version('2026.2', { salesFrom: '2026-07-01', salesTo: '2027-01-01' });
      await store.create(later);
      await store.create(version('2026.1'));
      await store.create(version('2026.1', { product: 'XX-CAT-VC' }));
      assert.deepEqual(await store.list('XX-DOG-VC'), [version('2026.1'), later]);
      assert.deepEqual(await store.get('XX-DOG-VC', '2026.2'), later);
      assert.equal(await store.get('XX-DOG-VC', '2026.3'), null);
      await assert.rejects(store.create(version('2026.1')), ProductConflictError);
    });

    it('updates need the next revision, and only published versions are listed as published', async (store) => {
      await store.create(version('2026.1'));
      await store.create(version('2026.1', { product: 'XX-CAT-VC' }));
      const p = version('2026.1', { ...published, revision: 2 });
      await store.update(p);
      await assert.rejects(store.update(p), ProductConflictError);
      assert.deepEqual(await store.published(), [p]);
    });

    it('a published version can only have its sales brought forward', async (store) => {
      await store.create(version('2026.1', { salesTo: '2027-01-01' }));
      const p = version('2026.1', { ...published, salesTo: '2027-01-01', revision: 2 });
      await store.update(p);
      await assert.rejects(store.update({ ...p, revision: 3, content: content({ market: 'YY' }) }));
      await assert.rejects(store.update({ ...p, revision: 3, salesTo: '2027-06-01' }));
      const ended = { ...p, revision: 3, salesTo: '2026-12-01', salesEndedBy: 'publisher@example.test', salesEndedAt: '2026-11-15T10:00:00.000Z', note: 'Replaced' };
      await store.update(ended);
      assert.deepEqual(await store.get('XX-DOG-VC', '2026.1'), ended);
    });
  });
}
