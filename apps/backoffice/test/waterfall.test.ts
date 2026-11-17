import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waterfallSteps } from '../src/waterfall.ts';
import { claimHistory } from '../src/history.ts';
import { formatLogTime } from '../src/format.ts';

// Bella's cruciate claim from the sample data: SEK 18,640 billed, SEK 12,165 paid.
const bella = {
  billed: 1_864_000,
  nonReimbursable: 42_000,
  vatExcluded: 0,
  deductibleFixed: 200_000,
  deductibleVariable: 405_500,
  deductibleVariableBp: 2_500,
  opensDeductiblePeriod: true,
  payableBeforeLimit: 1_216_500,
  remainingBefore: 5_743_500,
  payout: 1_216_500,
  cappedByLimit: false,
};

test('the waterfall: billed, each deduction where it falls, and the payout, in percent of billed', () => {
  const steps = waterfallSteps(bella);
  assert.deepEqual(
    steps.map((s) => [s.key, s.kind, s.amount, s.from, s.to]),
    [
      ['billed', 'total', 1_864_000, 0, 100],
      ['nonReimbursable', 'minus', 42_000, 97.75, 100],
      ['deductibleFixed', 'minus', 200_000, 87.02, 97.75],
      ['deductibleVariable', 'minus', 405_500, 65.26, 87.02],
      ['payout', 'result', 1_216_500, 0, 65.26],
    ],
  );
  assert.deepEqual(steps[3]!.params, { percent: 25 });
  assert.deepEqual(steps[2]!.params, { opensPeriod: true });
});

test('a payout capped by the annual limit shows the cap as a deduction', () => {
  const steps = waterfallSteps({ ...bella, remainingBefore: 1_000_000, payout: 1_000_000, cappedByLimit: true });
  const limit = steps.find((s) => s.key === 'limit')!;
  assert.equal(limit.amount, 216_500);
  assert.deepEqual(limit.params, { remaining: 1_000_000 });
  assert.equal(steps.at(-1)!.to, limit.from);
});

test('nothing billed gives empty bars, not NaN', () => {
  const steps = waterfallSteps({ ...bella, billed: 0, nonReimbursable: 0, deductibleFixed: 0, deductibleVariable: 0, payableBeforeLimit: 0, payout: 0 });
  assert.deepEqual(steps.map((s) => [s.key, s.to]), [['billed', 0], ['payout', 0]]);
});

test('the history is newest first, and a decision comes after its proposal at the same moment', () => {
  const events = claimHistory({
    claim: { receivedAt: '2026-11-13T14:32:00Z', channel: 'clinic_direct' },
    decisions: [{ seq: 1, outcome: 'approved', payout: 100, decidedBy: 'a', decidedAt: '2026-11-14T10:00:00Z', automated: false }],
    proposals: [
      { id: 'p1', outcome: 'approved', payout: 100, proposedBy: 'h', proposedAt: '2026-11-13T15:00:00Z', status: 'returned', closedBy: 'a', closedAt: '2026-11-13T16:00:00Z', returnReason: 'Check the invoice' },
      { id: 'p2', outcome: 'approved', payout: 100, proposedBy: 'h', proposedAt: '2026-11-14T10:00:00Z', status: 'approved' },
    ],
    reviews: [],
  });
  assert.deepEqual(
    events.map((e) => e.type),
    ['claim.decided', 'proposal.created', 'proposal.returned', 'proposal.created', 'claim.received'],
  );
  assert.equal(events.find((e) => e.type === 'proposal.returned' && e.reason === 'Check the invoice')?.type, 'proposal.returned');
});

test('a log time is in ISO order', () => {
  assert.match(formatLogTime('2026-11-13T14:32:00Z'), /^2026-11-1\d \d\d:\d\d$/);
});
