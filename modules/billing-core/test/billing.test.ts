import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillingError, addMonths, allocatePayment, distributeAdjustment, premiumPlan, replayPlan, settleCancellation, type PlanInput } from '@petvold/billing-core';

const bella: PlanInput = { currency: 'SEK', termStart: '2026-04-01', termEnd: '2027-04-01', termPremium: 493_400, interval: 'month' };

test('Bella monthly: 4 934 kr over 12 months is 411.16 kr, and the 8 left over go on the first', () => {
  const plan = premiumPlan(bella);
  assert.equal(plan.installments.length, 12);
  assert.deepEqual(plan.installments.map((i) => i.premium), [41_124, ...Array(11).fill(41_116)]);
  assert.deepEqual(plan.installments[0], { seq: 1, periodStart: '2026-04-01', periodEnd: '2026-05-01', dueDate: '2026-04-01', premium: 41_124, tax: 0, fee: 0, amount: 41_124 });
  assert.deepEqual(plan.installments[11]!.periodEnd, '2027-04-01');
  assert.equal(plan.total, 493_400);
  assert.equal(plan.model, 'premium-plan.v1');
  assert.match(plan.inputHash, /^[0-9a-f]{64}$/);
});

test('yearly is one installment, and the installment fee is not taken', () => {
  const plan = premiumPlan({ ...bella, interval: 'year', installmentFee: 2_900 });
  assert.deepEqual(plan.installments.map((i) => [i.periodStart, i.periodEnd, i.amount]), [['2026-04-01', '2027-04-01', 493_400]]);
  assert.equal(plan.fees, 0);
});

test('quarterly with a fee and a premium tax: the tax is rounded once and split like the premium', () => {
  // 493 400 × 2.5 % = 12 335; quarters 123 350 each; tax 12 335 / 4 = 3 083 each, and the 3 left go on the first.
  const plan = premiumPlan({ ...bella, interval: 'quarter', installmentFee: 2_900, premiumTaxBp: 250 });
  assert.equal(plan.tax, 12_335);
  assert.deepEqual(plan.installments.map((i) => [i.periodStart, i.premium, i.tax, i.fee, i.amount]), [
    ['2026-04-01', 123_350, 3_086, 2_900, 129_336],
    ['2026-07-01', 123_350, 3_083, 2_900, 129_333],
    ['2026-10-01', 123_350, 3_083, 2_900, 129_333],
    ['2027-01-01', 123_350, 3_083, 2_900, 129_333],
  ]);
  assert.equal(plan.total, 493_400 + 12_335 + 4 * 2_900);
});

test('a term from the 31st steps to the last day of shorter months without drifting', () => {
  const plan = premiumPlan({ ...bella, termStart: '2026-01-31', termEnd: '2027-01-31' });
  assert.deepEqual(plan.installments.slice(0, 4).map((i) => i.periodStart), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
});

test('a term that does not end on a boundary: the short last period gets its share per day', () => {
  // A transfer: the new owner's plan runs from the sale day to the term end, 2026-06-15 to 2027-04-01 (290 days).
  const plan = premiumPlan({ ...bella, termStart: '2026-06-15', termEnd: '2027-04-01', termPremium: 392_000, interval: 'quarter' });
  assert.deepEqual(plan.installments.map((i) => [i.periodStart, i.periodEnd]), [
    ['2026-06-15', '2026-09-15'],
    ['2026-09-15', '2026-12-15'],
    ['2026-12-15', '2027-03-15'],
    ['2027-03-15', '2027-04-01'],
  ]);
  // 17 of 290 days: floor(392 000 × 17 / 290) = 22 979; the rest 369 021 over three quarters.
  assert.deepEqual(plan.installments.map((i) => i.premium), [123_007, 123_007, 123_007, 22_979]);
});

test('a term shorter than one interval is one installment', () => {
  const plan = premiumPlan({ ...bella, termEnd: '2026-06-01', termPremium: 80_000, interval: 'year' });
  assert.deepEqual(plan.installments.map((i) => [i.periodEnd, i.amount]), [['2026-06-01', 80_000]]);
});

test('the first premium: fourteen days after the notice, never before the term starts', () => {
  const late = premiumPlan({ ...bella, firstPremium: { noticeSentOn: '2026-03-28', payWithinDays: 14 } });
  assert.deepEqual(late.installments.slice(0, 2).map((i) => i.dueDate), ['2026-04-11', '2026-05-01']);
  const early = premiumPlan({ ...bella, firstPremium: { noticeSentOn: '2026-03-01', payWithinDays: 14 } });
  assert.equal(early.installments[0]!.dueDate, '2026-04-01');
  assert.notEqual(late.inputHash, early.inputHash);
});

test('a saved plan recomputes to the same result', () => {
  const saved = premiumPlan(bella);
  assert.equal(replayPlan(bella, saved).same, true);
  assert.equal(replayPlan(bella, { ...saved, total: saved.total + 1 }).same, false);
  assert.throws(() => replayPlan(bella, { ...saved, model: 'premium-plan.v0' as never }), BillingError);
});

test('invalid input is refused', () => {
  assert.throws(() => premiumPlan({ ...bella, termEnd: '2026-04-01' }), /termEnd: must be after termStart/);
  assert.throws(() => premiumPlan({ ...bella, termPremium: 10.5 }), /termPremium/);
  assert.throws(() => premiumPlan({ ...bella, termStart: '2026-02-30' }), /termStart: invalid date/);
  assert.throws(() => premiumPlan({ ...bella, interval: 'week' as never }), /interval/);
  assert.throws(() => premiumPlan({ ...bella, currency: 'sek' }), /currency/);
});

test('a payment goes to the oldest due first, and what is over is unallocated', () => {
  const items = [
    { id: 'inv_2', dueDate: '2026-05-01', open: 41_117 },
    { id: 'inv_1', dueDate: '2026-04-01', open: 41_124 },
  ];
  assert.deepEqual(allocatePayment(50_000, items), { allocations: [{ id: 'inv_1', amount: 41_124 }, { id: 'inv_2', amount: 8_876 }], unallocated: 0 });
  assert.deepEqual(allocatePayment(100_000, items), { allocations: [{ id: 'inv_1', amount: 41_124 }, { id: 'inv_2', amount: 41_117 }], unallocated: 17_759 });
  assert.deepEqual(allocatePayment(500, []), { allocations: [], unallocated: 500 });
  assert.throws(() => allocatePayment(-1, items), /amount/);
  assert.throws(() => allocatePayment(1, [...items, items[0]!]), /unique/);
});

test('a premium change: spread on what is not invoiced, its own invoice, or a credit', () => {
  assert.deepEqual(distributeAdjustment(10_000, [12, 10, 11]), { kind: 'spread', parts: [{ seq: 10, amount: 3_334 }, { seq: 11, amount: 3_333 }, { seq: 12, amount: 3_333 }] });
  assert.deepEqual(distributeAdjustment(10_000, []), { kind: 'separate', amount: 10_000 });
  assert.deepEqual(distributeAdjustment(-2_500, [3]), { kind: 'credit', amount: 2_500 });
  assert.deepEqual(distributeAdjustment(0, [3]), { kind: 'none' });
});

const quarterly = premiumPlan({ ...bella, termPremium: 400_000, interval: 'quarter' });
const states = (invoiced: number, paid: number[]) => quarterly.installments.map((i) => ({ seq: i.seq, invoiced: i.seq <= invoiced, paid: paid[i.seq - 1] ?? 0 }));

test('cancellation with more paid than the term now costs: a credit balance', () => {
  // Two quarters invoiced and paid (200 000), refund 250 000: the term now costs 150 000.
  const s = settleCancellation({ plan: quarterly, states: states(2, [100_000, 100_000]), refund: 250_000 });
  assert.deepEqual(
    { removed: s.removed, kept: s.kept, credited: s.credited, newCharge: s.newCharge, creditBalance: s.creditBalance, newTotal: s.newTotal },
    { removed: [3, 4], kept: [], credited: [], newCharge: 0, creditBalance: 50_000, newTotal: 150_000 },
  );
});

test('cancellation with an invoiced quarter unpaid: what is owed stays, the rest is credited', () => {
  // Q1 paid, Q2 invoiced not paid; refund 220 000: the term costs 180 000, so 80 000 of Q2 stays owed.
  const s = settleCancellation({ plan: quarterly, states: states(2, [100_000]), refund: 220_000 });
  assert.deepEqual([s.kept, s.credited, s.removed, s.newCharge, s.creditBalance], [[{ seq: 2, open: 80_000 }], [{ seq: 2, amount: 20_000 }], [3, 4], 0, 0]);
});

test('cancellation where the invoiced installments are not enough: a new charge', () => {
  // Only Q1 invoiced and paid; refund 120 000: the term costs 280 000.
  const s = settleCancellation({ plan: quarterly, states: states(1, [100_000]), refund: 120_000 });
  assert.deepEqual([s.kept, s.credited, s.removed, s.newCharge, s.creditBalance], [[], [], [2, 3, 4], 180_000, 0]);
});

test('cancellation: fees on invoiced installments stay, the tax is recomputed on what is left', () => {
  const plan = premiumPlan({ ...bella, termPremium: 400_000, interval: 'quarter', installmentFee: 2_900, premiumTaxBp: 250 });
  const s = settleCancellation({ plan, states: plan.installments.map((i) => ({ seq: i.seq, invoiced: i.seq === 1, paid: i.seq === 1 ? i.amount : 0 })), refund: 300_000 });
  assert.deepEqual([s.newPremium, s.newTax, s.fees, s.newTotal], [100_000, 2_500, 2_900, 105_400]);
  assert.equal(s.paid + s.newCharge - s.creditBalance, s.newTotal);
});

test('cancellation input is checked', () => {
  assert.throws(() => settleCancellation({ plan: quarterly, states: states(2, []), refund: 400_001 }), /refund/);
  assert.throws(() => settleCancellation({ plan: quarterly, states: states(2, []).slice(1), refund: 0 }), /one state per installment/);
  assert.throws(() => settleCancellation({ plan: quarterly, states: states(1, [0, 5]), refund: 0 }), /cannot be paid/);
  assert.throws(() => settleCancellation({ plan: quarterly, states: states(1, [100_001]), refund: 0 }), /more than the installment/);
});
