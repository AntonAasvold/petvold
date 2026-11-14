/** Shared test suite for RuleSetStore (ADR 0012 layer 4, ADR 0021). */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleSetConflictError, type RuleSetStore, type RuleSetVersion } from '../src/index.ts';

export type RuleSetStoreFactory = () => Promise<{ store: RuleSetStore; cleanup?: () => Promise<void> }>;

export const draft = (version: number, overrides: Partial<RuleSetVersion> = {}): RuleSetVersion => ({
  series: 'SE-HUND-VV',
  version,
  status: 'draft',
  content: { market: 'SE', vatReimbursable: true, nonReimbursableCategories: ['food'], diagnosisGroups: { 'ORA-OTIT': 'ora' }, autoSettleMax: 1_000_000 },
  calculationModel: 'vet-care.v1',
  effectiveFrom: '2026-01-01',
  revision: 1,
  createdBy: 'author@example.test',
  createdAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
});

const reviewed = { checksum: 'abc', submittedBy: 'author@example.test', submittedAt: '2026-11-02T10:00:00.000Z' };
const published = { ...reviewed, status: 'published' as const, publishedBy: 'publisher@example.test', publishedAt: '2026-11-03T10:00:00.000Z' };

export function ruleSetStoreSuite(name: string, factory: RuleSetStoreFactory): void {
  describe(`RuleSetStore: ${name}`, () => {
    const it = (title: string, fn: (store: RuleSetStore) => Promise<void>) =>
      test(title, async () => {
        const h = await factory();
        try {
          await fn(h.store);
        } finally {
          await h.cleanup?.();
        }
      });

    it('versions are read back unchanged, per series and in order', async (store) => {
      await store.create(draft(1));
      await store.create(draft(2, { effectiveFrom: '2026-07-01' }));
      await store.create(draft(1, { series: 'XX-DOG' }));
      assert.deepEqual(await store.list('SE-HUND-VV'), [draft(1), draft(2, { effectiveFrom: '2026-07-01' })]);
      assert.deepEqual(await store.get('SE-HUND-VV', 2), draft(2, { effectiveFrom: '2026-07-01' }));
      assert.equal(await store.get('SE-HUND-VV', 3), null);
      assert.deepEqual(await store.list('NONE'), []);
    });

    it('only the next version number can be created', async (store) => {
      await assert.rejects(store.create(draft(2)), RuleSetConflictError);
      await store.create(draft(1));
      await assert.rejects(store.create(draft(1)), RuleSetConflictError);
    });

    it('an update needs the next revision', async (store) => {
      await store.create(draft(1));
      const changed = draft(1, { revision: 2, content: { ...draft(1).content, autoSettleMax: 5 } });
      await store.update(changed);
      assert.deepEqual(await store.get('SE-HUND-VV', 1), changed);
      await assert.rejects(store.update({ ...changed, content: { ...changed.content, autoSettleMax: 6 } }), RuleSetConflictError);
    });

    it('the whole lifecycle is stored', async (store) => {
      await store.create(draft(1));
      await store.update(draft(1, { ...reviewed, status: 'in_review', revision: 2 }));
      await store.update(draft(1, { ...published, revision: 3 }));
      const retired = draft(1, { ...published, status: 'retired', retiredBy: 'publisher@example.test', retiredAt: '2026-11-04T10:00:00.000Z', note: 'Wrong group', revision: 4 });
      await store.update(retired);
      assert.deepEqual(await store.get('SE-HUND-VV', 1), retired);
    });

    it('a published version cannot change its content', async (store) => {
      await store.create(draft(1));
      await store.update(draft(1, { ...reviewed, status: 'in_review', revision: 2 }));
      await store.update(draft(1, { ...published, revision: 3 }));
      await assert.rejects(store.update(draft(1, { ...published, revision: 4, content: { ...draft(1).content, autoSettleMax: 0 } })));
      assert.equal((await store.get('SE-HUND-VV', 1))!.revision, 3);
    });

    it('two published versions in a series cannot apply from the same date', async (store) => {
      await store.create(draft(1));
      await store.update(draft(1, { ...published, revision: 2 }));
      await store.create(draft(2));
      await assert.rejects(store.update(draft(2, { ...published, revision: 2 })), RuleSetConflictError);
      await store.update(draft(2, { ...published, revision: 2, effectiveFrom: '2026-07-01' }));
    });
  });
}
