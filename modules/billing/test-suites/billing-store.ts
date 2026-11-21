/** The BillingStore contract, run against every implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { premiumPlan } from '@petvold/billing-core';
import type { BillingStore, PayerAccount, PlanInput, PlanRecord } from '../src/index.ts';

export function payer(n = 1, o: Partial<PayerAccount> = {}): PayerAccount {
  return { id: `bac_${n}`, partyId: 'pty_anna', market: 'SE', currency: 'SEK', paymentMethod: 'invoice', createdAt: `2026-11-21T10:00:0${n}.000Z`, ...o };
}

const input: PlanInput = { currency: 'SEK', termStart: '2026-12-01', termEnd: '2027-12-01', termPremium: 480_000, interval: 'month', firstPremium: { noticeSentOn: '2026-11-21', payWithinDays: 14 } };

export function planRecord(n = 1, o: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: `ppl_${n}`,
    accountId: 'bac_1',
    policyId: `pol_${n}`,
    termNo: 1,
    market: 'SE',
    productVersion: 'SE-HUND-BAS@2026.1',
    source: { eventId: `pev_${n}`, eventType: 'policy.issued', occurredAt: '2026-11-21T10:00:00.000Z' },
    input,
    plan: premiumPlan(input),
    createdAt: `2026-11-21T10:00:0${n}.000Z`,
    ...o,
  };
}

export function billingStoreSuite(name: string, make: () => Promise<{ store: BillingStore }>) {
  describe(name, () => {
    test('a plan is stored once per event, with the account, and read back as it was', async () => {
      const { store } = await make();
      assert.equal(await store.addPlan(payer(), planRecord()), true);
      assert.equal(await store.addPlan(payer(9, { partyId: 'pty_other' }), planRecord(2, { source: planRecord().source })), false, 'the same event again');
      assert.equal(await store.accountFor('pty_other', 'SE', 'SEK'), null, 'no account from a repeated event');
      assert.deepEqual(await store.account('bac_1'), payer());
      assert.deepEqual(await store.plans({ policyId: 'pol_1' }), [planRecord()]);
    });

    test('one account per party, market and currency: a second plan joins it', async () => {
      const { store } = await make();
      await store.addPlan(payer(), planRecord());
      await store.addPlan(payer(2), planRecord(2, { accountId: 'bac_2' }));
      await store.addPlan(payer(3, { currency: 'EUR', market: 'FI' }), planRecord(3, { accountId: 'bac_3', market: 'FI' }));
      assert.deepEqual((await store.accounts({ partyId: 'pty_anna' })).map((a) => a.id), ['bac_1', 'bac_3']);
      assert.deepEqual((await store.accounts({ market: 'FI' })).map((a) => a.id), ['bac_3']);
      assert.deepEqual((await store.plans({ accountId: 'bac_1' })).map((p) => p.id), ['ppl_1', 'ppl_2']);
      assert.equal((await store.plans({ policyId: 'pol_2' }))[0]!.accountId, 'bac_1');
      assert.deepEqual(await store.accountFor('pty_anna', 'FI', 'EUR'), payer(3, { currency: 'EUR', market: 'FI' }));
      assert.equal(await store.account('bac_2'), null);
    });

    test('plans come oldest first', async () => {
      const { store } = await make();
      await store.addPlan(payer(), planRecord(2, { policyId: 'pol_1', termNo: 2, createdAt: '2026-11-21T10:00:05.000Z' }));
      await store.addPlan(payer(), planRecord(1, { createdAt: '2026-11-21T10:00:01.000Z' }));
      assert.deepEqual((await store.plans({ policyId: 'pol_1' })).map((p) => p.termNo), [1, 2]);
    });
  });
}
