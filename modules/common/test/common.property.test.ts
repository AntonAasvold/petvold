/** Property tests: invariants that must hold for all inputs, not just chosen examples. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { addDays, addMoney, applyBp, isISODate, money, rangesOverlap, subtractMoney, sumMoney, type DateRange } from '../src/index.ts';

const amount = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });
const nonNegative = fc.integer({ min: 0, max: 1_000_000_000 });
const bp = fc.integer({ min: 0, max: 10_000 });
const date = fc
  .date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));
const range: fc.Arbitrary<DateRange> = fc
  .tuple(date, fc.option(fc.integer({ min: 1, max: 800 }), { nil: undefined }))
  .map(([from, days]) => (days === undefined ? { from } : { from, to: addDays(from, days) }));

test('property: subtraction undoes addition', () => {
  fc.assert(
    fc.property(amount, amount, (a, b) => {
      assert.deepEqual(subtractMoney(addMoney(money(a, 'SEK'), money(b, 'SEK')), money(b, 'SEK')), money(a, 'SEK'));
    }),
  );
});

test('property: the sum does not depend on order', () => {
  fc.assert(
    fc.property(fc.array(amount, { maxLength: 20 }), (xs) => {
      const items = xs.map((x) => money(x, 'EUR'));
      assert.deepEqual(sumMoney(items, 'EUR'), sumMoney([...items].reverse(), 'EUR'));
    }),
  );
});

test('property: applyBp lies between 0 and the amount and is off by at most half a unit', () => {
  fc.assert(
    fc.property(nonNegative, bp, (a, p) => {
      const r = applyBp(a, p);
      assert.ok(r >= 0 && r <= a);
      assert.ok(Math.abs(r * 10_000 - a * p) <= 5_000);
    }),
  );
});

test('property: applyBp is monotonic in amount and basis points', () => {
  fc.assert(
    fc.property(nonNegative, nonNegative, bp, bp, (a, b, p, q) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const [plo, phi] = p <= q ? [p, q] : [q, p];
      assert.ok(applyBp(lo, plo) <= applyBp(hi, plo));
      assert.ok(applyBp(lo, plo) <= applyBp(lo, phi));
    }),
  );
});

test('property: addDays gives valid dates and can be reversed', () => {
  fc.assert(
    fc.property(date, fc.integer({ min: -3_000, max: 3_000 }), (d, n) => {
      const moved = addDays(d, n);
      assert.ok(isISODate(moved));
      assert.equal(addDays(moved, -n), d);
    }),
  );
});

test('property: overlap is symmetric and a range overlaps itself', () => {
  fc.assert(
    fc.property(range, range, (a, b) => {
      assert.equal(rangesOverlap(a, b), rangesOverlap(b, a));
      assert.ok(rangesOverlap(a, a));
    }),
  );
});

test('property: two back-to-back periods never overlap', () => {
  fc.assert(
    fc.property(date, fc.integer({ min: 1, max: 800 }), fc.integer({ min: 1, max: 800 }), (from, d1, d2) => {
      const first = { from, to: addDays(from, d1) };
      const next = { from: first.to, to: addDays(first.to, d2) };
      assert.ok(!rangesOverlap(first, next));
    }),
  );
});
