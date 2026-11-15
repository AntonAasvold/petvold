import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_TIME_ZONES, dateInTimeZone, marketDate } from '../src/index.ts';

test("a market's date follows its time zone, not UTC", () => {
  // 00:30 in Stockholm on 15 November (winter, UTC+1) is still 14 November in UTC.
  assert.equal(marketDate('SE', '2026-11-14T23:30:00.000Z'), '2026-11-15');
  assert.equal(new Date('2026-11-14T23:30:00.000Z').toISOString().slice(0, 10), '2026-11-14');
  // Summer time (UTC+2): 01:30 in Stockholm on 1 July.
  assert.equal(marketDate('SE', '2026-06-30T23:30:00.000Z'), '2026-07-01');
  assert.equal(marketDate('SE', '2026-06-30T21:59:00.000Z'), '2026-06-30');
  // London is UTC in winter.
  assert.equal(marketDate('GB', '2026-11-14T23:30:00.000Z'), '2026-11-14');
  assert.equal(dateInTimeZone('2026-11-14T23:30:00.000Z', 'Europe/Helsinki'), '2026-11-15');
});

test('a market without a known time zone, or none, counts in UTC', () => {
  assert.equal(marketDate('XX', '2026-11-14T23:30:00.000Z'), '2026-11-14');
  assert.equal(marketDate(undefined, '2026-11-14T23:30:00.000Z'), '2026-11-14');
  assert.equal(MARKET_TIME_ZONES.SE, 'Europe/Stockholm');
});
