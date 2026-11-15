/** Shared PolicyStore tests, run against every implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyConflictError, type Policy, type PolicyEvent, type PolicyStore, type PolicyTransaction, type PolicyVersion, type Term } from '../src/index.ts';

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
      await store.issue(t.policy, t.term, t.version, t.transaction, []);
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
      await store.issue(t.policy, t.term, t.version, t.transaction, []);
      assert.equal((await store.versionAt('pol_t1', '2026-12-01'))?.id, 'pv_t1');
      assert.equal((await store.versionAt('pol_t1', '2027-11-30'))?.id, 'pv_t1');
      assert.equal(await store.versionAt('pol_t1', '2027-12-01'), null); // end exclusive
      assert.equal(await store.versionAt('pol_t1', '2026-11-30'), null);
      assert.equal((await store.versionAt('pol_t1', '2027-01-01', '2026-11-15T10:00:00.000Z'))?.id, 'pv_t1');
      assert.equal(await store.versionAt('pol_t1', '2027-01-01', '2026-11-15T09:59:59.000Z'), null); // not known yet
    });

    it('a change supersedes versions and adds new ones, all or nothing, with its events', async (store) => {
      const t = issued();
      const ev = (id: string, type: PolicyEvent['type']): PolicyEvent => ({ id, type, policyId: 'pol_t1', occurredAt: at, data: { n: 1 } });
      await store.issue(t.policy, t.term, t.version, t.transaction, [ev('pev_1', 'policy.issued')]);
      const later = '2027-03-01T10:00:00.000Z';
      const tx: PolicyTransaction = {
        id: 'ptx_c1',
        policyId: 'pol_t1',
        type: 'cancel',
        steps: [{ step: 'issued', at: later }],
        requestedBy: 'cs',
        requestedAt: later,
        supersedes: ['pv_t1'],
        cancellation: { reason: 'customer-immediate', receivedOn: '2027-03-01', effectiveDate: '2027-03-02', refund: { amount: 274_000, currency: 'SEK' } },
      };
      const cut: PolicyVersion = { ...t.version, id: 'pv_c1', validTo: '2027-03-02', sysFrom: later, transactionId: 'ptx_c1' };
      const gone: PolicyVersion = { ...t.version, id: 'pv_c2', validFrom: '2027-03-02', status: 'cancelled', sysFrom: later, transactionId: 'ptx_c1' };
      await store.apply('pol_t1', ['pv_t1'], [cut, gone], tx, [ev('pev_2', 'policy.cancelled')]);
      await assert.rejects(store.apply('pol_t1', ['pv_t1'], [], { ...tx, id: 'ptx_c2' }, []), PolicyConflictError);
      assert.deepEqual((await store.get('pol_t1'))!.versions, [cut, gone]);
      assert.deepEqual(await store.history('pol_t1'), [{ ...t.version, sysTo: later }, cut, gone]);
      assert.deepEqual((await store.transactions('pol_t1')).at(-1), tx);
      assert.equal((await store.versionAt('pol_t1', '2027-06-01'))?.status, 'cancelled');
      assert.equal((await store.versionAt('pol_t1', '2027-06-01', '2027-02-01T00:00:00.000Z'))?.status, 'active');
      // A cancelled policy does not stop a new one for the animal.
      const next = issued(5, { validFrom: '2027-04-01', validTo: '2028-04-01' });
      await store.issue(next.policy, next.term, next.version, next.transaction, []);

      const pending = await store.pendingEvents(10);
      assert.deepEqual(pending.map((e) => e.id), ['pev_1', 'pev_2']);
      await store.markPublished(['pev_1'], later);
      assert.deepEqual((await store.pendingEvents(10)).map((e) => e.id), ['pev_2']);
    });

    it('a renewal adds the next term and version, and the policy is no longer up for renewal', async (store) => {
      const t = issued();
      await store.issue(t.policy, t.term, t.version, t.transaction, []);
      assert.deepEqual(await store.endingBetween('2027-11-01', '2027-12-31'), ['pol_t1']);
      assert.deepEqual(await store.endingBetween('2028-01-01', '2028-12-31'), []);
      const later = '2027-10-17T03:00:00.000Z';
      const term2: Term = { ...t.term, termNo: 2, startDate: '2027-12-01', endDate: '2028-12-01', productVersion: 'SE-TEST@2', transactionId: 'ptx_r1' };
      const v2: PolicyVersion = { ...t.version, id: 'pv_r1', validFrom: '2027-12-01', validTo: '2028-12-01', sysFrom: later, termNo: 2, transactionId: 'ptx_r1' };
      const tx: PolicyTransaction = {
        id: 'ptx_r1',
        policyId: 'pol_t1',
        type: 'renew',
        steps: [{ step: 'issued', at: later }],
        requestedBy: 'renewal-job',
        requestedAt: later,
        supersedes: [],
        renewal: { termNo: 2, productVersion: 'SE-TEST@2', premium: { amount: 480_000, currency: 'SEK' } },
      };
      await store.apply('pol_t1', [], [v2], tx, [], [term2]);
      await assert.rejects(store.apply('pol_t1', [], [], { ...tx, id: 'ptx_r2' }, [], [term2]), PolicyConflictError);
      const p = (await store.get('pol_t1'))!;
      assert.deepEqual(p.terms, [t.term, term2]);
      assert.deepEqual(p.versions, [t.version, v2]);
      assert.deepEqual((await store.transactions('pol_t1')).at(-1), tx);
      assert.deepEqual(await store.endingBetween('2027-11-01', '2027-12-31'), []);
      assert.deepEqual(await store.endingBetween('2028-11-01', '2028-12-31'), ['pol_t1']);
    });

    it('an animal is never insured twice for the same day', async (store) => {
      const a = issued(1);
      await store.issue(a.policy, a.term, a.version, a.transaction, []);
      const b = issued(2, { validFrom: '2027-06-01', validTo: '2028-06-01' });
      await assert.rejects(store.issue(b.policy, b.term, b.version, b.transaction, []), PolicyConflictError);
      assert.equal(await store.get('pol_t2'), null);
      const c = issued(3, { validFrom: '2027-12-01', validTo: '2028-12-01' }); // starts the day the first ends
      await store.issue(c.policy, c.term, c.version, c.transaction, []);
      const d = issued(4, { animalId: 'ani_bella' });
      await store.issue(d.policy, d.term, d.version, d.transaction, []);
      assert.deepEqual(await store.findByAnimal('ani_rex'), ['pol_t1', 'pol_t3']);
    });
  });
}
