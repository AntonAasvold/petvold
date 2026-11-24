/** The AccountingStore contract, run against every implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountingStore, Verification } from '../src/index.ts';

export function verificationOf(n: number, o: Partial<Verification> = {}): Verification {
  return {
    id: `ver_${n}`,
    number: `V-SE-2026-${String(n).padStart(6, '0')}`,
    market: 'SE',
    currency: 'SEK',
    bookingDate: '2026-12-01',
    text: `Invoice ${n}`,
    source: { eventId: `e_${n}`, eventType: 'invoice.issued', objectType: 'invoice', objectId: `inv_${n}` },
    lines: [
      { account: 'premium-receivable', debit: 40_500, credit: 0, payerAccountId: 'bac_1' },
      { account: 'premium-income', debit: 0, credit: 40_000, policyId: 'pol_1', period: { from: '2026-12-01', to: '2027-01-01' } },
      { account: 'installment-fees', debit: 0, credit: 500, policyId: 'pol_1', period: { from: '2026-12-01', to: '2027-01-01' } },
    ],
    createdAt: '2026-12-01T10:00:00.000Z',
    ...o,
  };
}

export function accountingStoreSuite(name: string, make: () => Promise<{ store: AccountingStore }>) {
  describe(name, () => {
    test('a verification is stored with the next number, once per event, and read back as it was', async () => {
      const { store } = await make();
      const a = await store.add('SE', 2026, (no) => verificationOf(no));
      assert.deepEqual(a, verificationOf(1));
      assert.deepEqual(await store.verification('ver_1'), verificationOf(1));
      assert.deepEqual(await store.bySourceEvent('e_1'), verificationOf(1));
      assert.equal(await store.add('SE', 2026, (no) => verificationOf(no, { id: 'ver_dup', source: verificationOf(1).source })), null, 'the same event again');
      // The number taken by the repeat is not used up.
      assert.equal((await store.add('SE', 2026, (no) => verificationOf(no)))?.number, 'V-SE-2026-000002');
      assert.equal((await store.add('SE', 2027, (no) => verificationOf(no, { id: 'ver_y', number: `V-SE-2027-${String(no).padStart(6, '0')}`, source: { ...verificationOf(9).source, eventId: 'e_y' } })))?.number, 'V-SE-2027-000001');
      assert.equal(await store.verification('ver_x'), null);
    });

    test('verifications are filtered by market, booking date and object, by number', async () => {
      const { store } = await make();
      await store.add('SE', 2026, (no) => verificationOf(no, { bookingDate: '2026-12-02' }));
      await store.add('SE', 2026, (no) => verificationOf(no, { bookingDate: '2026-12-01' }));
      await store.add('FI', 2026, (no) => verificationOf(no, { id: 'ver_fi', number: `V-FI-2026-${String(no).padStart(6, '0')}`, market: 'FI', currency: 'EUR', source: { ...verificationOf(5).source, eventId: 'e_fi' } }));
      assert.deepEqual((await store.verifications({ market: 'SE' })).map((v) => v.number), ['V-SE-2026-000001', 'V-SE-2026-000002']);
      assert.deepEqual((await store.verifications({ market: 'SE', from: '2026-12-02', to: '2026-12-02' })).map((v) => v.id), ['ver_1']);
      assert.deepEqual((await store.verifications({ objectId: 'inv_2' })).map((v) => v.id), ['ver_2']);
      assert.deepEqual((await store.verifications({ market: 'FI' })).map((v) => v.currency), ['EUR']);
    });
  });
}
