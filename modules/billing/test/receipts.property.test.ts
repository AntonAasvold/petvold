/**
 * Properties of allocating payments (ADR 0040, punkt 6): whatever the payments,
 * their order and the credit notes between them, money is neither made nor lost.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { accountBalance, allocate, invoiceBalances, type Allocation, type CreditNote, type Invoice } from '../src/index.ts';

const invoice = (n: number, total: number, dueDay: number): Invoice => ({
  id: `inv_${n}`,
  number: `SE-2026-${n}`,
  accountId: 'bac_1',
  partyId: 'pty_1',
  market: 'SE',
  currency: 'SEK',
  issueDate: '2026-01-01',
  dueDate: `2026-02-${String(dueDay).padStart(2, '0')}`,
  reference: { type: 'ocr', value: String(n) },
  lines: [],
  total,
  createdBy: 'scheduler',
  createdAt: '2026-01-01T00:00:00.000Z',
});

const step = fc.oneof(
  fc.record({ kind: fc.constant('pay' as const), amount: fc.integer({ min: 1, max: 300_000 }), first: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }) }),
  fc.record({ kind: fc.constant('credit' as const), invoice: fc.integer({ min: 0, max: 5 }), share: fc.double({ min: 0, max: 1, noNaN: true }) }),
);

test('every payment is allocated or credit, no invoice is overpaid, and the balance adds up', () => {
  fc.assert(
    fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 200_000 }), fc.integer({ min: 1, max: 28 })), { minLength: 1, maxLength: 6 }), fc.array(step, { maxLength: 15 }), (specs, steps) => {
      const invoices = specs.map(([total, day], n) => invoice(n, total, day));
      const creditNotes: CreditNote[] = [];
      const allocations: Allocation[] = [];
      let received = 0;
      let unallocatedSum = 0;
      for (const [k, s] of steps.entries()) {
        if (s.kind === 'credit') {
          const i = invoices[s.invoice % invoices.length]!;
          const already = creditNotes.filter((c) => c.invoiceId === i.id).reduce((a, c) => a + c.total, 0);
          const amount = Math.floor((i.total - already) * s.share);
          if (amount > 0) creditNotes.push({ id: `crn_${k}`, number: `C${k}`, invoiceId: i.id, accountId: 'bac_1', partyId: 'pty_1', market: 'SE', currency: 'SEK', issueDate: '2026-01-02', lines: [], total: amount, source: { eventId: `e${k}`, eventType: 'policy.changed' }, createdAt: '2026-01-02T00:00:00.000Z' });
          continue;
        }
        const before = invoiceBalances(invoices, creditNotes, allocations);
        const first = s.first === undefined ? undefined : invoices[s.first % invoices.length]!.id;
        const r = allocate(s.amount, { invoices, creditNotes, allocations }, first);
        assert.equal(r.allocations.reduce((a, x) => a + x.amount, 0) + r.unallocated, s.amount, 'all of the payment is somewhere');
        for (const a of r.allocations) {
          assert.ok(a.amount > 0 && a.amount <= before.get(a.invoiceId)!.open, 'never more than is open');
          allocations.push({ paymentId: `pay_${k}`, invoiceId: a.invoiceId, accountId: 'bac_1', amount: a.amount });
        }
        // The named invoice is paid first.
        if (first && before.get(first)!.open > 0) assert.equal(r.allocations[0]?.invoiceId, first);
        // Credit only when every invoice is paid.
        const after = invoiceBalances(invoices, creditNotes, allocations);
        if (r.unallocated > 0) for (const b of after.values()) assert.equal(b.open, 0);
        for (const id of r.settled) assert.ok(before.get(id)!.open > 0 && after.get(id)!.open === 0, 'settled means it was open and now is not');
        received += s.amount;
        unallocatedSum += r.unallocated;
      }
      const balances = invoiceBalances(invoices, creditNotes, allocations);
      let paid = 0;
      for (const i of invoices) {
        const b = balances.get(i.id)!;
        assert.equal(b.credited + b.paid + b.open, i.total, 'credited, paid and open make the total');
        assert.ok(b.open >= 0 && b.paid >= 0);
        paid += b.paid;
      }
      const balance = accountBalance({ invoices, creditNotes, allocations, received });
      assert.equal(balance.credit, received - paid);
      assert.ok(balance.credit >= unallocatedSum, 'credit notes only add to the credit');
    }),
    { numRuns: 300 },
  );
});
