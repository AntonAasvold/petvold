import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  addMoney,
  applyBp,
  assertDate,
  assertDateRange,
  CurrencyMismatchError,
  isCurrencyCode,
  isISODate,
  isMarketCode,
  money,
  rangeContains,
  rangesOverlap,
  subtractMoney,
  sumMoney,
} from '../src/index.ts';

test('money requires an integer and a valid currency', () => {
  assert.deepEqual(money(1_216_500, 'SEK'), { amount: 1_216_500, currency: 'SEK' });
  assert.throws(() => money(12.5, 'SEK'), /integer/);
  assert.throws(() => money(Number.MAX_SAFE_INTEGER + 1, 'SEK'), /integer/);
  assert.throws(() => money(100, 'sek'), /ISO 4217/);
});

test('addition and subtraction in the same currency', () => {
  assert.deepEqual(addMoney(money(100, 'EUR'), money(250, 'EUR')), money(350, 'EUR'));
  assert.deepEqual(subtractMoney(money(100, 'EUR'), money(250, 'EUR')), money(-150, 'EUR'));
});

test('different currencies are never converted', () => {
  assert.throws(() => addMoney(money(100, 'SEK'), money(100, 'NOK')), CurrencyMismatchError);
  assert.throws(() => sumMoney([money(1, 'SEK'), money(1, 'EUR')], 'SEK'), CurrencyMismatchError);
});

test('sumMoney of an empty list is zero in the given currency', () => {
  assert.deepEqual(sumMoney([], 'DKK'), money(0, 'DKK'));
  assert.deepEqual(sumMoney([money(1, 'DKK'), money(2, 'DKK')], 'DKK'), money(3, 'DKK'));
});

test('applyBp rounds half up', () => {
  assert.equal(applyBp(1_822_000, 2_500), 455_500); // 25 % of 18 220.00
  assert.equal(applyBp(2, 2_500), 1); // 0.5 -> 1
  assert.equal(applyBp(1, 2_500), 0); // 0.25 -> 0
  assert.equal(applyBp(0, 2_500), 0);
});

test('applyBp rejects negative amounts and invalid basis points', () => {
  assert.throws(() => applyBp(-1, 2_500), /non-negative/);
  assert.throws(() => applyBp(100, -1), /basis points/);
  assert.throws(() => applyBp(100, 12.5), /basis points/);
});

test('market and currency', () => {
  assert.ok(isMarketCode('SE'));
  assert.ok(!isMarketCode('SWE'));
  assert.ok(isCurrencyCode('EUR'));
  assert.ok(!isCurrencyCode('eur'));
});

test('dates that do not exist in the calendar are rejected', () => {
  assert.ok(isISODate('2028-02-29'));
  assert.ok(!isISODate('2026-02-29'));
  assert.ok(!isISODate('2026-02-30'));
  assert.ok(!isISODate('2026-13-01'));
  assert.ok(!isISODate('2026-1-01'));
  assert.throws(() => assertDate('2026-04-31', 'treatmentFrom'), /treatmentFrom/);
});

test('addDays across month and year boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('DateRange is half-open', () => {
  const r = { from: '2026-01-01', to: '2026-02-01' };
  assert.ok(rangeContains(r, '2026-01-01'));
  assert.ok(rangeContains(r, '2026-01-31'));
  assert.ok(!rangeContains(r, '2026-02-01'));
  assert.ok(rangeContains({ from: '2026-01-01' }, '2099-01-01'));
});

test('ranges that meet at a boundary do not overlap', () => {
  const jan = { from: '2026-01-01', to: '2026-02-01' };
  assert.ok(!rangesOverlap(jan, { from: '2026-02-01', to: '2026-03-01' }));
  assert.ok(rangesOverlap(jan, { from: '2026-01-31', to: '2026-03-01' }));
  assert.ok(rangesOverlap(jan, { from: '2025-01-01' }));
  assert.ok(!rangesOverlap({ from: '2026-03-01' }, jan));
});

test('assertDateRange requires from before to', () => {
  assert.doesNotThrow(() => assertDateRange({ from: '2026-01-01' }, 'period'));
  assert.throws(() => assertDateRange({ from: '2026-01-01', to: '2026-01-01' }, 'period'), /before/);
});
