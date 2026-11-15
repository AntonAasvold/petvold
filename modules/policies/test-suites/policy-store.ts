/** Shared PolicyStore tests, run against every implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyConflictError, type Policy, type PolicyStore, type PolicyTransaction, type PolicyVersion, type Term } from '../src/index.ts';

export type PolicyStoreFactory = () => Promise<{ store: PolicyStore; cleanup?: () => Promise<void> }>;

const at = '2026-11-15T10:00:00.000Z';
export function issued(n = 1, o: { animalId?: string; validFrom?: string; validTo?: string; holder?: string } = {}) {
  const id = `pol_t${n}`;
  const tx = `ptx_t${n}`;
  const validFrom = o.validFrom ?? '2026-12-01';
  const validTo = o.validTo ?? '2027-12-01';
  const policy: Policy = { id, market: 'SE', animalId: o.animalId ?? 'ani_rex', inceptionDate: validFrom, createdBy: 'seller', createdAt: at };
  const term: Term = {
    policyId: id,
    termNo: 1,
    startDate: validFrom,
    endDate: validTo,
    productVersion: 'SE-TEST@1',
    currency: 'SEK',
    vetCare: { code: 'vet_care', annualLimit: 6_000_000, deductible: { fixed: 200_000, fixedPer: 'period', periodDays: 125, variableBp: 2500 }, waitingPeriodDays: 30 },
    deductibleOption: 'standard',
    premium: 480_000,
    riders: [],
    transactionId: tx,
  };
  const version: PolicyVersion = {
    id: `pv_t${n}`,
    policyId: id,
    validFrom,
    validTo,
    sysFrom: at,
    policyholderPartyId: o.holder ?? 'pty_anna',
    status: 'active',
    termNo: 1,
    transactionId: tx,
  };
  const transaction: PolicyTransaction = { id: tx, policyId: id, type: 'issue', steps: [{ step: 'draft', at }, { step: 'issued', at }], requestedBy: 'seller', requestedAt: at };
  return { policy, term, version, transaction };
}

export function policyStoreSuite(name: string, factory: PolicyStoreFactory): void {
  describe(`PolicyStore: ${name}`, () => {
    const it = (title: string, fn: (store: PolicyStore) => Promise<void>) =>
      test(title, async () => {
        const h = await factory();
        try {
          await fn(h.store);
        } finally {
          await h.cleanup?.();
        }
      });

    it('a policy is read back with its term, version and transaction', async (store) => {
      const t = issued();
      await store.issue(t.policy, t.term, t.version, t.transaction);
      assert.deepEqual(await store.get('pol_t1'), { ...t.policy, terms: [t.term], versions: [t.version] });
      assert.deepEqual(await store.history('pol_t1'), [t.version]);
      assert.deepEqual(await store.transactions('pol_t1'), [t.transaction]);
      assert.deepEqual(await store.findByAnimal('ani_rex'), ['pol_t1']);
      assert.deepEqual(await store.findByPolicyholder('pty_anna'), ['pol_t1']);
      assert.deepEqual(await store.findByPolicyholder('pty_bo'), []);
      assert.equal(await store.get('pol_none'), null);
    });

    it('the version on a date, as known at a time', async (store) => {
      const t = issued();
      await store.issue(t.policy, t.term, t.version, t.transaction);
      assert.equal((await store.versionAt('pol_t1', '2026-12-01'))?.id, 'pv_t1');
      assert.equal((await store.versionAt('pol_t1', '2027-11-30'))?.id, 'pv_t1');
      assert.equal(await store.versionAt('pol_t1', '2027-12-01'), null); // end exclusive
      assert.equal(await store.versionAt('pol_t1', '2026-11-30'), null);
      assert.equal((await store.versionAt('pol_t1', '2027-01-01', '2026-11-15T10:00:00.000Z'))?.id, 'pv_t1');
      assert.equal(await store.versionAt('pol_t1', '2027-01-01', '2026-11-15T09:59:59.000Z'), null); // not known yet
    });

    it('an animal is never insured twice for the same day', async (store) => {
      const a = issued(1);
      await store.issue(a.policy, a.term, a.version, a.transaction);
      const b = issued(2, { validFrom: '2027-06-01', validTo: '2028-06-01' });
      await assert.rejects(store.issue(b.policy, b.term, b.version, b.transaction), PolicyConflictError);
      assert.equal(await store.get('pol_t2'), null);
      const c = issued(3, { validFrom: '2027-12-01', validTo: '2028-12-01' }); // starts the day the first ends
      await store.issue(c.policy, c.term, c.version, c.transaction);
      const d = issued(4, { animalId: 'ani_bella' });
      await store.issue(d.policy, d.term, d.version, d.transaction);
      assert.deepEqual(await store.findByAnimal('ani_rex'), ['pol_t1', 'pol_t3']);
    });
  });
}
