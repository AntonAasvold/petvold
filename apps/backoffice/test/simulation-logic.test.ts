import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changes, defaultDays, simulationRange } from '../src/simulation-logic.ts';

test('the period: whole days, the last one included', () => {
  assert.deepEqual(simulationRange('2026-09-01', '2026-11-30'), { from: '2026-09-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' });
  assert.deepEqual(simulationRange('2026-11-26', '2026-11-26'), { from: '2026-11-26T00:00:00.000Z', to: '2026-11-27T00:00:00.000Z' });
  assert.equal(simulationRange('1 sep', '2026-11-30'), 'from');
  assert.equal(simulationRange('2026-11-30', '2026-11-01'), 'to');
  assert.deepEqual(defaultDays('2026-11-26'), { from: '2026-08-28', to: '2026-11-26' });
});

test('what changed in a decision', () => {
  const a = { proposedOutcome: 'approved', mode: 'auto', payout: 150_000 };
  assert.deepEqual(changes(a, a), []);
  assert.deepEqual(changes(a, { ...a, mode: 'manual', payout: 120_000 }), ['mode', 'payout']);
  assert.deepEqual(changes(a, { proposedOutcome: 'rejected', mode: 'auto', payout: 0 }), ['outcome', 'payout']);
});
