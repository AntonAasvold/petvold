/** The AccountingStore contract, run against every implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ChartConflictError, type AccountingStore, type DayClose, type Verification } from '../src/index.ts';

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

/** Stores a verification with its event's day; the store picks the booking date and number. */
export const addOf = (store: AccountingStore, n: number, eventDate: string, o: Partial<Verification> = {}) =>
  store.add(o.market ?? 'SE', eventDate, (bookingDate, no) => {
    const v = verificationOf(n, { ...o, bookingDate, number: `V-${o.market ?? 'SE'}-${bookingDate.slice(0, 4)}-${String(no).padStart(6, '0')}` });
    return bookingDate === eventDate ? v : { ...v, eventDate };
  });

const closeOf = (market: string, day: string, vs: Verification[]): DayClose => ({
  market,
  day,
  closedAt: `${day}T23:59:00.000Z`,
  closedBy: 'scheduler',
  verificationCount: vs.length,
  totals: [{ currency: 'SEK', debit: vs.length * 40_500, credit: vs.length * 40_500 }],
  chartVersion: 0,
  unmapped: ['premium-receivable'],
  csvSha256: 'a'.repeat(64),
});

export function accountingStoreSuite(name: string, make: () => Promise<{ store: AccountingStore }>) {
  describe(name, () => {
    test('a verification is stored with the next number, once per event, and read back as it was', async () => {
      const { store } = await make();
      const a = await addOf(store, 1, '2026-12-01');
      assert.deepEqual(a, verificationOf(1));
      assert.deepEqual(await store.verification('ver_1'), verificationOf(1));
      assert.deepEqual(await store.bySourceEvent('e_1'), verificationOf(1));
      assert.equal(await addOf(store, 9, '2026-12-01', { id: 'ver_dup', source: verificationOf(1).source }), null, 'the same event again');
      assert.equal((await addOf(store, 2, '2026-12-01'))?.number, 'V-SE-2026-000002', 'the repeat used no number');
      assert.equal((await addOf(store, 3, '2027-01-02'))?.number, 'V-SE-2027-000001');
      assert.equal(await store.verification('ver_x'), null);
    });

    test('verifications are filtered by market, booking date and object, by number', async () => {
      const { store } = await make();
      await addOf(store, 1, '2026-12-02');
      await addOf(store, 2, '2026-12-01');
      await addOf(store, 5, '2026-12-01', { id: 'ver_fi', market: 'FI', currency: 'EUR', source: { ...verificationOf(5).source, eventId: 'e_fi' } });
      assert.deepEqual((await store.verifications({ market: 'SE' })).map((v) => v.number), ['V-SE-2026-000001', 'V-SE-2026-000002']);
      assert.deepEqual((await store.verifications({ market: 'SE', from: '2026-12-02', to: '2026-12-02' })).map((v) => v.id), ['ver_1']);
      assert.deepEqual((await store.verifications({ objectId: 'inv_2' })).map((v) => v.id), ['ver_2']);
      assert.deepEqual((await store.verifications({ market: 'FI' })).map((v) => v.currency), ['EUR']);
    });

    test('days close in order, once; a verification for a closed day is booked on the first open day', async () => {
      const { store } = await make();
      await addOf(store, 1, '2026-12-01');
      await addOf(store, 2, '2026-12-02');
      assert.equal(await store.closeDay('SE', '2026-12-02', (vs) => ({ close: closeOf('SE', '2026-12-02', vs), events: [] })), null, 'not before the first day');
      let seen: Verification[] = [];
      const first = await store.closeDay('SE', '2026-12-01', (vs) => {
        seen = vs;
        return { close: closeOf('SE', '2026-12-01', vs), events: [{ id: 'aev_1', type: 'accounting.day_closed', market: 'SE', day: '2026-12-01', occurredAt: '2026-12-01T23:59:00.000Z', data: { verificationCount: vs.length } }] };
      });
      assert.deepEqual(seen.map((v) => v.id), ['ver_1']);
      assert.deepEqual(first, closeOf('SE', '2026-12-01', seen));
      assert.equal(await store.closeDay('SE', '2026-12-01', (vs) => ({ close: closeOf('SE', '2026-12-01', vs), events: [] })), null, 'once');
      assert.equal(await store.closeDay('SE', '2026-12-03', (vs) => ({ close: closeOf('SE', '2026-12-03', vs), events: [] })), null, 'not past an open day');
      assert.equal(await store.closedThrough('SE'), '2026-12-01');
      assert.equal(await store.closedThrough('FI'), null);
      // A payment booked on 1 December comes after the close: it goes on 2 December.
      const late = await addOf(store, 3, '2026-12-01');
      assert.deepEqual([late?.bookingDate, late?.eventDate], ['2026-12-02', '2026-12-01']);
      const second = await store.closeDay('SE', '2026-12-02', (vs) => ({ close: closeOf('SE', '2026-12-02', vs), events: [] }));
      assert.equal(second?.verificationCount, 2);
      assert.deepEqual((await store.dayCloses({ market: 'SE' })).map((c) => c.day), ['2026-12-01', '2026-12-02']);
      assert.deepEqual(await store.dayClose('SE', '2026-12-01'), first);
      assert.deepEqual((await store.pendingEvents(10)).map((e) => [e.type, e.day]), [['accounting.day_closed', '2026-12-01']]);
      await store.markPublished(['aev_1'], '2026-12-02T00:00:00.000Z');
      assert.deepEqual(await store.pendingEvents(10), []);
    });

    test('the chart of accounts gets versions that never change', async () => {
      const { store } = await make();
      assert.equal(await store.chart(), null);
      const v1 = { version: 1, markets: { SE: { bank: { number: '1930', name: 'Bank' } } }, changedBy: 'a', changedAt: '2026-12-01T10:00:00.000Z', reason: 'First' };
      await store.addChart(v1);
      await assert.rejects(store.addChart({ ...v1, reason: 'Again' }), (e) => e instanceof ChartConflictError);
      await store.addChart({ ...v1, version: 2, markets: { SE: { bank: { number: '1931' } } }, reason: 'Second' });
      assert.equal((await store.chart())?.version, 2);
      assert.deepEqual((await store.chartVersions()).map((c) => c.version), [1, 2]);
      assert.deepEqual((await store.chartVersions())[0], v1);
    });
  });
}
