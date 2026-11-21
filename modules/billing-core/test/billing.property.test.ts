/**
 * Property tests for the billing arithmetic (ADR 0040). Every property must
 * hold for all terms, intervals, premiums, payments and cancellations.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { PAYMENT_INTERVALS, addDays, allocatePayment, applyBpHalfUp, distributeAdjustment, premiumPlan, settleCancellation, type PlanInput } from '@petvold/billing-core';

const date = fc.integer({ min: 0, max: 3_650 }).map((d) => addDays('2025-01-01', d));
const planInput: fc.Arbitrary<PlanInput> = fc
  .record({
    termStart: date,
    days: fc.integer({ min: 1, max: 500 }),
    termPremium: fc.integer({ min: 0, max: 50_000_000 }),
    interval: fc.constantFrom(...PAYMENT_INTERVALS),
    installmentFee: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
    premiumTaxBp: fc.option(fc.integer({ min: 0, max: 3_000 }), { nil: undefined }),
    notice: fc.option(fc.record({ before: fc.integer({ min: -60, max: 60 }), payWithinDays: fc.integer({ min: 0, max: 30 }) }), { nil: undefined }),
  })
  .map(({ termStart, days, notice, ...rest }) => ({
    currency: 'SEK',
    termStart,
    termEnd: addDays(termStart, days),
    ...rest,
    ...(notice ? { firstPremium: { noticeSentOn: addDays(termStart, notice.before), payWithinDays: notice.payWithinDays } } : {}),
  }));

test('a plan adds up to exactly the term premium, its tax and its fees', () => {
  fc.assert(
    fc.property(planInput, (input) => {
      const p = premiumPlan(input);
      const sum = (f: (i: (typeof p.installments)[number]) => number) => p.installments.reduce((s, i) => s + f(i), 0);
      assert.equal(sum((i) => i.premium), input.termPremium);
      assert.equal(sum((i) => i.tax), applyBpHalfUp(input.termPremium, input.premiumTaxBp ?? 0));
      assert.equal(sum((i) => i.amount), p.total);
      for (const i of p.installments) {
        assert.ok(i.premium >= 0 && i.tax >= 0);
        assert.equal(i.amount, i.premium + i.tax + i.fee);
      }
    }),
  );
});

test('the periods cover the term without gaps or overlap, and no due date is before its period', () => {
  fc.assert(
    fc.property(planInput, (input) => {
      const p = premiumPlan(input);
      assert.equal(p.installments[0]!.periodStart, input.termStart);
      assert.equal(p.installments.at(-1)!.periodEnd, input.termEnd);
      p.installments.forEach((i, k) => {
        assert.equal(i.seq, k + 1);
        assert.ok(i.periodStart < i.periodEnd);
        assert.ok(i.dueDate >= i.periodStart);
        if (k > 0) assert.equal(i.periodStart, p.installments[k - 1]!.periodEnd);
        if (k > 0) assert.equal(i.dueDate, i.periodStart);
      });
    }),
  );
});

test('full periods differ by less than their count, and only the first can be larger', () => {
  fc.assert(
    fc.property(planInput, (input) => {
      const p = premiumPlan(input);
      const n = p.installments.length;
      const lastFull = n > 1 && p.installments.at(-1)!.periodEnd !== addMonthsOf(input, n) ? n - 1 : n;
      const full = p.installments.slice(0, lastFull).map((i) => i.premium);
      const rest = full.slice(1);
      if (rest.length > 0) {
        assert.ok(rest.every((x) => x === rest[0]));
        assert.ok(full[0]! - rest[0]! >= 0 && full[0]! - rest[0]! < full.length);
      }
    }),
  );
});

test('the same input gives the same plan and hash', () => {
  fc.assert(fc.property(planInput, (input) => assert.deepEqual(premiumPlan(structuredClone(input)), premiumPlan(input))));
});

const openItems = fc.uniqueArray(fc.record({ id: fc.string({ minLength: 1, maxLength: 4 }), dueDate: date, open: fc.integer({ min: 0, max: 200_000 }) }), {
  selector: (i) => i.id,
  maxLength: 8,
});

test('a payment is allocated in full, never more than is open, and oldest first', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 1_000_000 }), openItems, (amount, items) => {
      const r = allocatePayment(amount, items);
      assert.equal(r.allocations.reduce((s, a) => s + a.amount, 0) + r.unallocated, amount);
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const a of r.allocations) assert.ok(a.amount > 0 && a.amount <= byId.get(a.id)!.open);
      // An item with an earlier due date is never left open while a later one gets money.
      const got = new Map(r.allocations.map((a) => [a.id, a.amount]));
      for (const later of items) {
        if (!got.has(later.id)) continue;
        for (const earlier of items) {
          if (earlier.dueDate < later.dueDate) assert.equal(got.get(earlier.id) ?? 0, earlier.open);
        }
      }
      if (r.unallocated > 0) assert.ok(items.every((i) => (got.get(i.id) ?? 0) === i.open));
    }),
  );
});

test('an adjustment is never lost or created', () => {
  fc.assert(
    fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.array(fc.integer({ min: 1, max: 12 }), { maxLength: 12 }), (adj, seqs) => {
      const r = distributeAdjustment(adj, seqs);
      const total = r.kind === 'none' ? 0 : r.kind === 'spread' ? r.parts.reduce((s, x) => s + x.amount, 0) : r.kind === 'credit' ? -r.amount : r.amount;
      assert.equal(total, adj);
    }),
  );
});

const cancellation = planInput.chain((input) => {
  const plan = premiumPlan(input);
  const n = plan.installments.length;
  return fc.record({
    plan: fc.constant(plan),
    invoiced: fc.integer({ min: 0, max: n }),
    paidBp: fc.array(fc.integer({ min: 0, max: 10_000 }), { minLength: n, maxLength: n }),
    refund: fc.integer({ min: 0, max: plan.termPremium }),
  });
});

test('cancellation: paid + kept + new charge − credit balance is what the term now costs', () => {
  fc.assert(
    fc.property(cancellation, ({ plan, invoiced, paidBp, refund }) => {
      const states = plan.installments.map((i, k) => ({ seq: i.seq, invoiced: i.seq <= invoiced, paid: i.seq <= invoiced ? Math.floor((i.amount * paidBp[k]!) / 10_000) : 0 }));
      const s = settleCancellation({ plan, states, refund });
      const kept = s.kept.reduce((a, k) => a + k.open, 0);
      const credited = s.credited.reduce((a, c) => a + c.amount, 0);
      assert.equal(s.paid + kept + s.newCharge - s.creditBalance, s.newTotal);
      // Every invoiced, unpaid amount is either kept or credited.
      const open = plan.installments.reduce((a, i, k) => a + (states[k]!.invoiced ? i.amount - states[k]!.paid : 0), 0);
      assert.equal(kept + credited, open);
      // Never both money back and more to pay.
      assert.ok(s.creditBalance === 0 || (kept === 0 && s.newCharge === 0));
      assert.ok(s.newCharge === 0 || credited === 0);
      assert.deepEqual(s.removed, plan.installments.filter((i) => i.seq > invoiced).map((i) => i.seq));
    }),
  );
});

function addMonthsOf(input: PlanInput, periods: number): string {
  const m = { year: 12, 'half-year': 6, quarter: 3, month: 1 }[input.interval] * periods;
  const [y, mo, d] = input.termStart.split('-').map(Number) as [number, number, number];
  const t = y * 12 + mo - 1 + m;
  const last = new Date(Date.UTC(Math.floor(t / 12), (t % 12) + 1, 0)).getUTCDate();
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

test('every OCR and RF reference made is valid, and one changed digit is caught', async () => {
  const { ocrReference, isOcrReference, rfReference, isRfReference } = await import('@petvold/billing-core');
  fc.assert(
    fc.property(fc.stringMatching(/^\d{1,20}$/), fc.nat(), (base, k) => {
      const ocr = ocrReference(base);
      const rf = rfReference(base);
      assert.ok(isOcrReference(ocr) && isRfReference(rf));
      const i = k % ocr.length;
      const changed = ocr.slice(0, i) + String((Number(ocr[i]) + 1 + (k % 9)) % 10) + ocr.slice(i + 1);
      assert.equal(isOcrReference(changed), false);
      const j = 4 + (k % (rf.length - 4));
      const rfChanged = rf.slice(0, j) + String((Number(rf[j]) + 1 + (k % 9)) % 10) + rf.slice(j + 1);
      assert.equal(isRfReference(rfChanged), false);
    }),
  );
});
