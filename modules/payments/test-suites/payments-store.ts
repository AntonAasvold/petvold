/** The PaymentsStore contract, run against every implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PayoutConflictError, succeeded, type PayeeAccount, type Payment, type PaymentsStore, type Payout } from '../src/index.ts';

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

    test('payee accounts are added, never changed, and read oldest first', async () => {
      const { store } = await make();
      await store.addPayeeAccount(payeeAccountOf(1));
      await store.addPayeeAccount(payeeAccountOf(2, { method: 'iban', details: { iban: 'SE4550000000058398257466' } }));
      assert.deepEqual((await store.payeeAccounts({ partyId: 'pty_anna' })).map((a) => a.id), ['pya_1', 'pya_2']);
      assert.deepEqual(await store.payeeAccount('pya_2'), payeeAccountOf(2, { method: 'iban', details: { iban: 'SE4550000000058398257466' } }));
      assert.deepEqual(await store.payeeAccounts({ partyId: 'pty_x' }), []);
    });

    test('a payout is stored once per order, moves step by step, and its events go out', async () => {
      const { store } = await make();
      await store.addPayeeAccount(payeeAccountOf(1));
      assert.equal(await store.addPayout(payoutOf(1), { status: 'awaiting-details', at: '2026-12-01T10:00:00.000Z', by: 'payments' }, []), true);
      assert.equal(await store.addPayout(payoutOf(2, { orderId: 'ord_1' }), { status: 'pending', at: '2026-12-01T10:00:00.000Z', by: 'payments' }, []), false, 'one per order');
      await store.addPayoutStep('pyo_1', 2, { status: 'pending', at: '2026-12-01T11:00:00.000Z', by: 'payments', payeeAccountId: 'pya_1' }, []);
      await assert.rejects(store.addPayoutStep('pyo_1', 2, { status: 'held', at: '2026-12-01T11:00:00.000Z', by: 'payments' }, []), (e) => e instanceof PayoutConflictError);
      await assert.rejects(store.addPayoutStep('pyo_1', 4, { status: 'paid', at: '2026-12-01T11:00:00.000Z', by: 'fake' }, []), (e) => e instanceof PayoutConflictError, 'no gaps');
      const event = { id: 'evt_pyo', type: 'payout.paid' as const, payoutId: 'pyo_1', market: 'SE', occurredAt: '2026-12-01T11:00:01.000Z', data: { amount: 100 } };
      await store.addPayoutStep('pyo_1', 3, { status: 'paid', at: '2026-12-01T11:00:01.000Z', by: 'fake', payeeAccountId: 'pya_1', providerRef: 'fake-pyo_1', note: 'ok' }, [event]);
      const p = await store.payout('pyo_1');
      assert.equal(p?.status, 'paid');
      assert.deepEqual(p?.steps.map((x) => x.status), ['awaiting-details', 'pending', 'paid']);
      assert.deepEqual(p?.steps[2], { status: 'paid', at: '2026-12-01T11:00:01.000Z', by: 'fake', payeeAccountId: 'pya_1', providerRef: 'fake-pyo_1', note: 'ok' });
      const pending = await store.pendingEvents(10);
      assert.deepEqual(pending.map((e) => [e.type, e.payoutId, e.paymentId]), [['payout.paid', 'pyo_1', undefined]]);
      await store.addPayout(payoutOf(3, { claimId: 'clm_2', createdAt: '2026-12-02T10:00:00.000Z' }), { status: 'held', at: '2026-12-02T10:00:00.000Z', by: 'payments' }, []);
      assert.deepEqual((await store.payouts({ status: 'held' })).map((x) => x.id), ['pyo_3']);
      assert.deepEqual((await store.payouts({ claimId: 'clm_1' })).map((x) => x.id), ['pyo_1']);
      assert.deepEqual((await store.payouts({ partyId: 'pty_anna' })).map((x) => x.id), ['pyo_1', 'pyo_3']);
      assert.equal(await store.payout('pyo_x'), null);
    });

    test('clinic accounts and payouts are kept apart from the parties\'', async () => {
      const { store } = await make();
      await store.addPayeeAccount(payeeAccountOf(1));
      await store.addPayeeAccount(payeeAccountOf(2, { partyId: undefined, clinicId: 'clinic_001' } as never));
      assert.deepEqual((await store.payeeAccounts({ clinicId: 'clinic_001' })).map((a) => [a.id, a.clinicId, a.partyId]), [['pya_2', 'clinic_001', undefined]]);
      assert.deepEqual((await store.payeeAccounts({ partyId: 'pty_anna' })).map((a) => a.id), ['pya_1']);
      await store.addPayout({ ...payoutOf(1), partyId: undefined, clinicId: 'clinic_001' } as never, { status: 'awaiting-details', at: '2026-12-01T10:00:00.000Z', by: 'payments' }, []);
      const [p] = await store.payouts({ clinicId: 'clinic_001' });
      assert.deepEqual([p?.clinicId, p?.partyId], ['clinic_001', undefined]);
      assert.deepEqual(await store.payouts({ partyId: 'pty_anna' }), []);
    });

    test('an agreement is stored, ended once, and read back', async () => {
      const { store } = await make();
      const a = { id: 'cag_1', clinicId: 'clinic_001', market: 'SE', validFrom: '2026-01-01', createdBy: 'x', createdAt: '2026-01-01T10:00:00.000Z' };
      await store.addAgreement(a);
      await store.addAgreement({ ...a, id: 'cag_2', clinicId: 'clinic_002', validTo: '2027-01-01', createdAt: '2026-01-01T10:00:01.000Z' });
      assert.deepEqual(await store.agreement('cag_1'), a);
      const ended = { validTo: '2026-06-01', by: 'y', at: '2026-05-01T10:00:00.000Z', reason: 'Left' };
      await store.endAgreement('cag_1', ended);
      await assert.rejects(store.endAgreement('cag_1', ended), (e) => e instanceof PayoutConflictError);
      assert.deepEqual((await store.agreement('cag_1'))?.ended, ended);
      assert.deepEqual((await store.agreements({ clinicId: 'clinic_002' })).map((x) => [x.id, x.validTo]), [['cag_2', '2027-01-01']]);
      assert.deepEqual((await store.agreements({})).map((x) => x.id), ['cag_1', 'cag_2']);
    });
  });
}

export function payeeAccountOf(n: number, o: Partial<PayeeAccount> = {}): PayeeAccount {
  return { id: `pya_${n}`, partyId: 'pty_anna', market: 'SE', method: 'se-bank', details: { clearing: '8327', account: '9412345678' }, createdAt: `2026-11-30T10:00:0${n}.000Z`, createdBy: 'kundservice@example.test', ...o } as PayeeAccount;
}

export function payoutOf(n: number, o: Partial<Payout> = {}): Payout {
  return {
    id: `pyo_${n}`,
    orderId: `ord_${n}`,
    claimId: 'clm_1',
    decisionId: 'dec_1',
    policyId: 'pol_1',
    market: 'SE',
    currency: 'SEK',
    amount: 1_234_500,
    partyId: 'pty_anna',
    provider: 'fake',
    sourceEventId: `cev_${n}`,
    createdAt: `2026-12-01T10:00:0${n}.000Z`,
    ...o,
  } as Payout;
}
