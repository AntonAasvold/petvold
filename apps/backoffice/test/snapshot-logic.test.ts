import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deductibleParts, knownAtIso, snapshotQuery } from '../src/snapshot-logic.ts';

test('the query: a day, and optionally a time it was known at', () => {
  assert.deepEqual(snapshotQuery('2026-11-20', ''), { date: '2026-11-20' });
  const q = snapshotQuery('2026-11-20', '2026-11-20T14:30');
  assert.ok(typeof q === 'object' && /^2026-11-20T\d{2}:30:00\.000Z$/.test(q.knownAt!), 'local time as UTC');
  assert.equal(snapshotQuery('20 nov', ''), 'date');
  assert.equal(snapshotQuery('2026-11-20', 'yesterday'), 'knownAt');
  assert.equal(knownAtIso(' '), null);
});

test('the deductible in parts', () => {
  assert.deepEqual(deductibleParts({ fixed: 200_000, fixedPer: 'period', periodDays: 125, variableBp: 2500 }), { fixed: 200_000, per: 'period', periodDays: 125, variablePercent: 25 });
  assert.deepEqual(deductibleParts({ fixed: 0, fixedPer: 'claim', variableBp: 0 }), { fixed: 0, per: 'claim', variablePercent: 0 });
});
