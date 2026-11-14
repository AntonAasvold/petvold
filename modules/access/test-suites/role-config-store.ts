/**
 * Shared test suite for RoleConfigStore (ADR 0012 layer 4, ADR 0020).
 * Every implementation runs it with its own factory.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { VersionConflictError, type RoleConfig, type RoleConfigStore } from '../src/index.ts';

export type RoleConfigStoreFactory = () => Promise<{ store: RoleConfigStore; cleanup?: () => Promise<void> }>;

const config = (version: number, limit = 100): RoleConfig => ({
  version,
  roles: { handler: { permissions: ['claims:decide'], decisionLimits: { SEK: limit } } as never },
  changedBy: 'admin@example.test',
  changedAt: `2026-11-1${version}T10:00:00.000Z`,
  reason: `Change ${version}`,
});

export function roleConfigStoreSuite(name: string, factory: RoleConfigStoreFactory): void {
  describe(`RoleConfigStore: ${name}`, () => {
    const it = (title: string, fn: (store: RoleConfigStore) => Promise<void>) =>
      test(title, async () => {
        const h = await factory();
        try {
          await fn(h.store);
        } finally {
          await h.cleanup?.();
        }
      });

    it('an empty store has no current version', async (store) => {
      assert.equal(await store.current(), null);
      assert.deepEqual(await store.versions(), []);
    });

    it('versions are read back unchanged, the latest is current', async (store) => {
      await store.append(config(1));
      await store.append(config(2, 200));
      assert.deepEqual(await store.current(), config(2, 200));
      assert.deepEqual(await store.versions(), [config(1), config(2, 200)]);
    });

    it('only the next version can be appended', async (store) => {
      await assert.rejects(store.append(config(2)), VersionConflictError);
      await store.append(config(1));
      await assert.rejects(store.append(config(1, 999)), VersionConflictError);
      await assert.rejects(store.append(config(3)), VersionConflictError);
      assert.deepEqual(await store.versions(), [config(1)]);
    });

    it('two concurrent appends of the same version: exactly one wins', async (store) => {
      await store.append(config(1));
      const results = await Promise.allSettled([store.append(config(2, 200)), store.append(config(2, 300))]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => r.status === 'rejected' && r.reason instanceof VersionConflictError).length, 1);
      assert.equal((await store.versions()).length, 2);
    });
  });
}
