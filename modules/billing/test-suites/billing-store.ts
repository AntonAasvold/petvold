/** The BillingStore contract, run against every implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { premiumPlan } from '@petvold/billing-core';
import { InvoiceConflictError, type BillingEvent, type BillingStore, type CreditNote, type Invoice, type PayerAccount, type PlanInput, type PlanRecord } from '../src/index.ts';

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
    invoiceLeadDays: 20,
    createdAt: `2026-11-21T10:00:0${n}.000Z`,
    ...o,
  };
}

/** An invoice with the plan's first installment, or the given seqs. */
export function invoiceOf(id: string, no: number, plan: PlanRecord, seqs = [1], year = 2026): Invoice {
  const lines = plan.plan.installments
    .filter((i) => seqs.includes(i.seq))
    .map((i) => ({ planId: plan.id, policyId: plan.policyId, termNo: plan.termNo, seq: i.seq, periodStart: i.periodStart, periodEnd: i.periodEnd, premium: i.premium, tax: i.tax, fee: i.fee, amount: i.amount }));
  return {
    id,
    number: `SE-${year}-${String(no).padStart(6, '0')}`,
    accountId: plan.accountId,
    partyId: 'pty_anna',
    market: 'SE',
    currency: 'SEK',
    issueDate: '2026-11-21',
    dueDate: '2026-12-05',
    reference: { type: 'ocr', value: `${year}${String(no).padStart(6, '0')}${no % 10}` },
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
    createdBy: 'scheduler',
    createdAt: `2026-11-21T11:00:${String((no % 30) + (year - 2026) * 30).padStart(2, '0')}.000Z`,
  };
}

const issued = (i: Invoice): BillingEvent[] => [{ id: `bev_${i.id}`, type: 'invoice.issued', invoiceId: i.id, market: i.market, occurredAt: i.createdAt, data: { invoiceNo: i.number } }];

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

    test('invoices: numbers in an unbroken series per market and year, each installment once, events with them', async () => {
      const { store } = await make();
      await store.addPlan(payer(), planRecord());
      await store.addPlan(payer(), planRecord(2));
      const p1 = planRecord();
      const p2 = { ...planRecord(2), accountId: 'bac_1' };
      const a = await store.addInvoice('SE', 2026, (no) => invoiceOf('inv_a', no, p1, [1, 2]), issued);
      const b = await store.addInvoice('SE', 2026, (no) => invoiceOf('inv_b', no, p2), issued);
      assert.deepEqual([a.number, b.number], ['SE-2026-000001', 'SE-2026-000002']);
      assert.deepEqual(await store.invoice('inv_a'), invoiceOf('inv_a', 1, p1, [1, 2]));
      await assert.rejects(store.addInvoice('SE', 2026, (no) => invoiceOf('inv_c', no, p1, [2, 3]), issued), InvoiceConflictError);
      assert.equal(await store.invoice('inv_c'), null);
      // The refused invoice took no number.
      assert.equal((await store.addInvoice('SE', 2026, (no) => invoiceOf('inv_d', no, p1, [3]), issued)).number, 'SE-2026-000003');
      let no2027 = 0;
      await store.addInvoice('SE', 2027, (no) => ((no2027 = no), invoiceOf('inv_e', no, p1, [4], 2027)), issued);
      assert.equal(no2027, 1, 'a new year starts over');
      const seqs = await store.invoicedSeqs(['ppl_1', 'ppl_2', 'ppl_x']);
      assert.deepEqual([[...seqs.get('ppl_1')!].sort(), [...seqs.get('ppl_2')!], seqs.has('ppl_x')], [[1, 2, 3, 4], [1], false]);
      assert.deepEqual((await store.invoices({ policyId: 'pol_2' })).map((i) => i.id), ['inv_b']);
      assert.deepEqual((await store.invoices({ accountId: 'bac_1' })).map((i) => i.id), ['inv_a', 'inv_b', 'inv_d', 'inv_e']);
      const events = await store.pendingEvents(10);
      assert.deepEqual(events.map((e) => [e.type, e.invoiceId]), [['invoice.issued', 'inv_a'], ['invoice.issued', 'inv_b'], ['invoice.issued', 'inv_d'], ['invoice.issued', 'inv_e']]);
      assert.ok(events.every((e, i) => i === 0 || e.sequence! > events[i - 1]!.sequence!));
      await store.markPublished(['bev_inv_a'], '2026-11-21T12:00:00.000Z');
      assert.deepEqual((await store.pendingEvents(10)).map((e) => e.invoiceId), ['inv_b', 'inv_d', 'inv_e']);
    });

    test('an adjustment: plans that replace others, a new account, credit notes from the invoice series, once per event', async () => {
      const { store } = await make();
      await store.addPlan(payer(), planRecord());
      const p1 = planRecord();
      await store.addInvoice('SE', 2026, (no) => invoiceOf('inv_a', no, p1, [1, 2]), issued);
      const replacing: PlanRecord = { ...planRecord(5, { policyId: 'pol_1' }), source: { eventId: 'pev_x', eventType: 'policy.transferred', occurredAt: '2027-05-20T10:00:00.000Z' }, replaces: 'ppl_1', adjustment: { kind: 'transfer-from', transactionId: 'ptx_x', from: '2027-06-01', premium: -240_000, tax: 0 }, plan: { ...p1.plan, installments: [] } };
      const bo = payer(6, { partyId: 'pty_bo' });
      const theirs: PlanRecord = { ...planRecord(6, { policyId: 'pol_1', accountId: 'bac_6' }), source: replacing.source, adjustment: { kind: 'transfer-to', transactionId: 'ptx_x', from: '2027-06-01', premium: 240_000, tax: 0 } };
      const credit = { id: 'crn_1', invoiceId: 'inv_a', accountId: 'bac_1', partyId: 'pty_anna', market: 'SE', currency: 'SEK', issueDate: '2027-05-20', lines: [{ planId: 'ppl_1', policyId: 'pol_1', seq: 2, amount: 10_000 }], total: 10_000, source: { eventId: 'pev_x', eventType: 'policy.transferred' }, createdAt: '2027-05-20T10:00:01.000Z' };
      const numbered = (c: typeof credit, no: number) => ({ ...c, number: `SE-2027-${String(no).padStart(6, '0')}` });
      const credited = (cs: CreditNote[]): BillingEvent[] => cs.map((c) => ({ id: `bev_${c.id}`, type: 'invoice.credited', invoiceId: c.invoiceId, market: 'SE', occurredAt: c.createdAt, data: { creditNoteNo: c.number } }));
      assert.equal(await store.addAdjustment({ market: 'SE', year: 2027, accounts: [bo], plans: [replacing, theirs], credits: [credit] }, numbered, credited), true);
      assert.equal(await store.addAdjustment({ market: 'SE', year: 2027, accounts: [bo], plans: [replacing, theirs], credits: [credit] }, numbered, credited), false, 'the same event again');
      assert.deepEqual((await store.plans({ policyId: 'pol_1' })).map((p) => [p.id, p.replaces ?? null, p.adjustment?.kind ?? null]), [['ppl_1', null, null], ['ppl_5', 'ppl_1', 'transfer-from'], ['ppl_6', null, 'transfer-to']]);
      assert.deepEqual(await store.account('bac_6'), bo);
      assert.deepEqual(await store.creditNotes({ invoiceId: 'inv_a' }), [numbered(credit, 1)]);
      assert.deepEqual(await store.creditNote('crn_1'), numbered(credit, 1));
      assert.deepEqual((await store.creditNotes({ policyId: 'pol_1' })).map((c) => c.id), ['crn_1']);
      assert.deepEqual((await store.pendingEvents(10)).map((e) => e.type), ['invoice.issued', 'invoice.credited']);
      const again = { ...replacing, id: 'ppl_7', source: { ...replacing.source, eventId: 'pev_y' } };
      await assert.rejects(store.addAdjustment({ market: 'SE', year: 2027, accounts: [], plans: [again], credits: [] }, numbered, credited), InvoiceConflictError, 'a plan is replaced once');
    });

    test('plans come oldest first', async () => {
      const { store } = await make();
      await store.addPlan(payer(), planRecord(2, { policyId: 'pol_1', termNo: 2, createdAt: '2026-11-21T10:00:05.000Z' }));
      await store.addPlan(payer(), planRecord(1, { createdAt: '2026-11-21T10:00:01.000Z' }));
      assert.deepEqual((await store.plans({ policyId: 'pol_1' })).map((p) => p.termNo), [1, 2]);
    });
  });
}
