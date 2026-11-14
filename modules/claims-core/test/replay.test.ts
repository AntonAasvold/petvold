import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALCULATION_MODEL, assess, diff, replay, type DecisionEvidence } from '@petvold/claims-core';
import { fixtures } from '@petvold/claims-store-memory';

const { bellaPolicy, otitisClaim, RULES_SE_DOG } = fixtures;

function evidence(overrides: Partial<DecisionEvidence> = {}): DecisionEvidence {
  return {
    decisionId: 'dec_1',
    input: { claim: otitisClaim(), policy: bellaPolicy(), rules: RULES_SE_DOG, openDeductiblePeriod: null, consumedBefore: 0 },
    calculationModel: CALCULATION_MODEL,
    engineVersion: '0.1.0+old',
    ...overrides,
  };
}

test('a stored decision replays as identical', () => {
  const e = evidence();
  const r = replay(e, assess(e.input), '0.1.0+new');
  assert.equal(r.status, 'identical');
  assert.equal(r.inputHashMatches, true);
  assert.deepEqual(r.differences, []);
  assert.equal(r.engineVersion, '0.1.0+old');
  assert.equal(r.replayedWith.engineVersion, '0.1.0+new');
});

test('a changed result is reported with the path, the stored and the replayed value', () => {
  const e = evidence();
  const stored = assess(e.input);
  stored.calculation!.payout = 140_000; // as if the code had calculated differently back then
  const r = replay(e, stored, 'now');
  assert.equal(r.status, 'different');
  assert.deepEqual(r.differences, [{ path: '/calculation/payout', stored: 140_000, replayed: 150_000 }]);
});

test('changed evidence is detected by the input hash', () => {
  const e = evidence();
  const stored = assess(e.input);
  const tampered = evidence({ input: { ...e.input, consumedBefore: 1 } });
  const r = replay(tampered, stored, 'now');
  assert.equal(r.inputHashMatches, false);
  assert.equal(r.status, 'different');
});

test('an unknown calculation model is reported, not guessed', () => {
  const e = evidence({ calculationModel: 'vet-care.v0' });
  const r = replay(e, assess(e.input), 'now');
  assert.equal(r.status, 'model_unavailable');
});

test('diff treats undefined as missing and escapes JSON pointer keys', () => {
  assert.deepEqual(diff({ a: 1, b: undefined }, { a: 1 }), []);
  assert.deepEqual(diff({ 'x/y': 1 }, { 'x/y': 2 }), [{ path: '/x~1y', stored: 1, replayed: 2 }]);
  assert.deepEqual(diff([1, 2], [1]), [{ path: '/1', stored: 2 }]);
  assert.deepEqual(diff(1, 1), []);
});
