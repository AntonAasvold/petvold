/**
 * Property tests for the invoicing run (ADR 0040). For any policies, intervals
 * and days the run happens to go, the invoices must keep the law and the books.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { addDays } from '@petvold/common';
import { addMonths } from '@petvold/billing-core';
import { BillingService, InMemoryBillingStore, PAYMENT_INTERVALS, type PaymentInterval } from '../src/index.ts';

const policy = fc.record({
  issuedDay: fc.integer({ min: 0, max: 60 }),
  startAfter: fc.integer({ min: 0, max: 90 }),
  premium: fc.integer({ min: 0, max: 2_000_000 }),
  interval: fc.constantFrom(...PAYMENT_INTERVALS),
  party: fc.constantFrom('pty_a', 'pty_b'),
});

test('invoices: no premium due earlier than the law allows, each installment once, numbers without gaps, totals that add up', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(policy, { minLength: 1, maxLength: 4 }), fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 5, maxLength: 40 }), async (policies, steps) => {
      let n = 0;
      let now = '2026-01-01T09:00:00.000Z';
      const store = new InMemoryBillingStore();
      const service = new BillingService({
        store,
        products: { billing: async (pv) => ({ market: 'SE', currency: 'SEK', paymentIntervals: [...PAYMENT_INTERVALS], defaultPaymentInterval: pv.split('@')[1] as PaymentInterval, installmentFee: 0, invoiceLeadDays: 31 }) },
        policies: { policyholderOn: async () => null },
        clock: { now: () => now },
        ids: { next: (p) => `${p}_${++n}` },
      });
      // The policies are issued on their days; the run goes on the days the steps give, from 1 January.
      // A step of up to 30 days is a run that did not happen for a while, e.g. a server that was down.
      const issueOn = new Map<string, string>();
      const sorted = policies.map((p, i) => ({ ...p, id: `pol_${i + 1}` })).sort((a, b) => a.issuedDay - b.issuedDay);
      let day = '2026-01-01';
      let next = 0;
      const runDays: string[] = [];
      for (const step of [0, ...steps]) {
        day = addDays(day, step);
        while (next < sorted.length && addDays('2026-01-01', sorted[next]!.issuedDay) <= day) {
          const p = sorted[next++]!;
          const issued = addDays('2026-01-01', p.issuedDay);
          const start = addDays(issued, p.startAfter);
          now = `${issued}T09:00:00.000Z`;
          issueOn.set(p.id, issued);
          await service.handlePolicyEvent({
            id: `pev_${p.id}`,
            type: 'policy.issued',
            policyId: p.id,
            occurredAt: now,
            data: { policyholderPartyId: p.party, productVersion: `P@${p.interval}`, startDate: start, endDate: addDays(start, 365), premium: { amount: p.premium, currency: 'SEK' } },
          });
        }
        now = `${day}T03:00:00.000Z`;
        await service.invoicingRun({ market: 'SE', onDate: day, dryRun: false }, 'scheduler');
        runDays.push(day);
      }
      const invoices = await service.invoices({});
      const seen = new Set<string>();
      for (const inv of invoices) {
        assert.equal(inv.total, inv.lines.reduce((s, l) => s + l.amount, 0));
        assert.ok(inv.dueDate >= inv.issueDate);
        for (const l of inv.lines) {
          const key = `${l.planId}#${l.seq}`;
          assert.ok(!seen.has(key), `${key} invoiced twice`);
          seen.add(key);
          // FAL 5 kap. 1 §: a first premium is due at the earliest fourteen days after the invoice, a later one a month after.
          const earliest = l.seq === 1 ? addDays(inv.issueDate, 14) : addMonths(inv.issueDate, 1);
          assert.ok(inv.dueDate >= earliest, `${inv.number} with ${key} due ${inv.dueDate}, issued ${inv.issueDate}`);
        }
      }
      // Unbroken per year, in the order they were made.
      const byYear = new Map<string, number[]>();
      for (const inv of invoices) {
        const [, year, no] = inv.number.split('-');
        byYear.set(year!, [...(byYear.get(year!) ?? []), Number(no)]);
      }
      for (const nos of byYear.values()) assert.deepEqual(nos, nos.map((_, i) => i + 1));
      // Everything due within the lead time of the last run is invoiced.
      const last = runDays.at(-1)!;
      for (const p of await store.plans({ market: 'SE' })) {
        for (const i of p.plan.installments) if (i.dueDate <= addDays(last, 31)) assert.ok(seen.has(`${p.id}#${i.seq}`), `${p.policyId}#${i.seq} due ${i.dueDate} not invoiced by ${last}`);
      }
    }),
    { numRuns: 150 },
  );
});
