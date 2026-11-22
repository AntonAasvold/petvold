/** The PaymentsStore contract, run against every implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { succeeded, type Payment, type PaymentsStore } from '../src/index.ts';

export function paymentOf(n = 1, o: Partial<Payment> = {}): Payment {
  return {
    id: `pay_${n}`,
    direction: 'incoming',
    status: 'succeeded',
    provider: 'fake',
    providerRef: `fb_${n}`,
    market: 'SE',
    currency: 'SEK',
    amount: 41_200,
    reference: '202600000121',
    bookedOn: '2026-12-01',
    receivedAt: `2026-12-01T10:00:0${n}.000Z`,
    ...o,
  };
}

export function paymentsStoreSuite(name: string, make: () => Promise<{ store: PaymentsStore }>): void {
  describe(name, () => {
    test('a payment is stored with its event, and read back', async () => {
      const { store } = await make();
      const p = paymentOf(1);
      assert.equal(await store.addPayment(p, succeeded('evt_1', p)), true);
      assert.deepEqual(await store.payment('pay_1'), p);
      assert.deepEqual(await store.byProviderRef('fake', 'fb_1'), p);
      assert.equal(await store.payment('pay_x'), null);
      const [e] = await store.pendingEvents(10);
      assert.equal(e?.type, 'payment.succeeded');
      assert.equal(e?.paymentId, 'pay_1');
      assert.deepEqual(e?.data, { direction: 'incoming', provider: 'fake', amount: 41_200, currency: 'SEK', reference: '202600000121', bookedOn: '2026-12-01' });
      assert.equal(typeof e?.sequence, 'number');
    });

    test('the same payment from the provider is stored once, with one event', async () => {
      const { store } = await make();
      await store.addPayment(paymentOf(1), succeeded('evt_1', paymentOf(1)));
      const again = paymentOf(2, { providerRef: 'fb_1' });
      assert.equal(await store.addPayment(again, succeeded('evt_2', again)), false);
      assert.equal((await store.payments({})).length, 1);
      assert.equal((await store.pendingEvents(10)).length, 1);
      // Another provider may use the same id.
      const other = paymentOf(3, { provider: 'bankfile', providerRef: 'fb_1' });
      assert.equal(await store.addPayment(other, succeeded('evt_3', other)), true);
    });

    test('payments are filtered and come oldest first', async () => {
      const { store } = await make();
      for (const p of [paymentOf(3, { market: 'FI', currency: 'EUR', reference: null }), paymentOf(1), paymentOf(2, { reference: '202600000220' })]) {
        await store.addPayment(p, succeeded(`evt_${p.id}`, p));
      }
      assert.deepEqual((await store.payments({})).map((p) => p.id), ['pay_1', 'pay_2', 'pay_3']);
      assert.deepEqual((await store.payments({ market: 'SE' })).map((p) => p.id), ['pay_1', 'pay_2']);
      assert.deepEqual((await store.payments({ reference: '202600000220' })).map((p) => p.id), ['pay_2']);
      assert.equal((await store.payment('pay_3'))?.reference, null);
    });

    test('published events are not pending', async () => {
      const { store } = await make();
      for (const n of [1, 2]) await store.addPayment(paymentOf(n), succeeded(`evt_${n}`, paymentOf(n)));
      await store.markPublished(['evt_1'], '2026-12-01T11:00:00.000Z');
      assert.deepEqual((await store.pendingEvents(10)).map((e) => e.id), ['evt_2']);
    });
  });
}
