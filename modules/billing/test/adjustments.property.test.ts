/**
 * Property test for changes and cancellations (ADR 0040, punkt 4): whatever
 * was invoiced before, what the customer is billed for the term in all (on
 * invoices, less credit notes, plus what is left to invoice) is always what
 * the term costs after the events.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { addDays } from '@petvold/common';
import { BillingService, InMemoryBillingStore, type PaymentInterval } from '../src/index.ts';

async function billed(store: InMemoryBillingStore): Promise<number> {
  const all = await store.plans({ policyId: 'pol_1' });
  const current = all.filter((p) => !all.some((q) => q.replaces === p.id));
  const invoiced = (await store.invoices({ policyId: 'pol_1' })).reduce((s, i) => s + i.total, 0);
  const credited = (await store.creditNotes({ policyId: 'pol_1' })).reduce((s, c) => s + c.total, 0);
  let left = 0;
  for (const p of current) {
    const done = (await store.invoicedSeqs([p.id])).get(p.id) ?? new Set<number>();
    left += p.plan.installments.filter((i) => !done.has(i.seq)).reduce((s, i) => s + i.amount, 0);
  }
  return invoiced - credited + left;
}

test('changes and a cancellation: the term is billed exactly what it costs', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom<PaymentInterval>('year', 'quarter', 'month'),
      fc.integer({ min: 12_000, max: 2_000_000 }),
      fc.integer({ min: 0, max: 360 }),
      fc.array(fc.integer({ min: -300_000, max: 300_000 }), { maxLength: 3 }),
      fc.option(fc.record({ day: fc.integer({ min: 0, max: 365 }), bp: fc.integer({ min: 0, max: 10_000 }) }), { nil: undefined }),
      async (interval, premium, invoicedUpTo, changes, cancel) => {
        let n = 0;
        const store = new InMemoryBillingStore();
        const service = new BillingService({
          store,
          products: { billing: async () => ({ market: 'SE', currency: 'SEK', paymentIntervals: [interval], defaultPaymentInterval: interval, installmentFee: 0, invoiceLeadDays: 31 }) },
          policies: { policyholderOn: async () => 'pty_a' },
          clock: { now: () => '2026-01-01T09:00:00.000Z' },
          ids: { next: (p) => `${p}_${++n}` },
        });
        await service.handlePolicyEvent({ id: 'pev_0', type: 'policy.issued', policyId: 'pol_1', occurredAt: '2026-01-01T09:00:00.000Z', data: { transactionId: 'ptx_0', policyholderPartyId: 'pty_a', productVersion: 'P@1', startDate: '2026-01-01', endDate: '2027-01-01', premium: { amount: premium, currency: 'SEK' } } });
        const day = addDays('2026-01-01', invoicedUpTo);
        await service.invoicingRun({ market: 'SE', onDate: day, dryRun: false }, 'scheduler');
        let cost = premium;
        for (const [k, adj] of changes.entries()) {
          const a = Math.max(adj, -cost); // the policy module never takes the premium below zero
          cost += a;
          await service.handlePolicyEvent({ id: `pev_c${k}`, type: 'policy.changed', policyId: 'pol_1', occurredAt: `${day}T10:00:00.000Z`, data: { transactionId: `ptx_c${k}`, termNo: 1, from: day, premiumAdjustment: a } });
          assert.equal(await billed(store), cost, `after change ${k} of ${a}`);
        }
        if (cancel) {
          const refund = Math.floor((cost * cancel.bp) / 10_000);
          await service.handlePolicyEvent({ id: 'pev_x', type: 'policy.cancelled', policyId: 'pol_1', occurredAt: `${day}T11:00:00.000Z`, data: { transactionId: 'ptx_x', effectiveDate: addDays('2026-01-01', cancel.day), refund: { amount: refund, currency: 'SEK' } } });
          const affected = addDays('2026-01-01', cancel.day) < '2027-01-01';
          assert.equal(await billed(store), affected ? cost - refund : cost, 'after the cancellation');
        }
      },
    ),
    { numRuns: 150 },
  );
});
