import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routingOf, type Assessment } from '../src/index.ts';

const base = (o: Partial<Assessment>): Assessment =>
  ({
    claimId: 'clm_1',
    market: 'SE',
    currency: 'SEK',
    policyVersionId: 'pv_1',
    productVersion: 'SE-HUND@1',
    rulesVersion: 'SE-HUND-VV@1',
    rules: [{ code: 'POLICY_FOUND', status: 'pass', reason: 'policy.found', params: {} }],
    calculation: { payout: 1_500_000 },
    proposedOutcome: 'approved',
    mode: 'manual',
    diagnosisGroup: 'ortho',
    inputHash: 'h',
    ...o,
  }) as unknown as Assessment;

test('an automatic claim has no reasons', () => {
  assert.deepEqual(routingOf(base({ mode: 'auto' }), 2_000_000), { mode: 'auto', reasons: [] });
});

test('a payout above the limit for automatic settlement is a reason, with the amounts', () => {
  assert.deepEqual(routingOf(base({}), 1_000_000).reasons, [{ reason: 'routing.above_auto_limit', params: { payout: 1_500_000, limit: 1_000_000, currency: 'SEK' } }]);
});

test('rules to review or that fail are reasons, and a proposal to reject is one only without them', () => {
  const rules = [
    { code: 'RIDER', status: 'review', reason: 'rider.possible', params: {} },
    { code: 'WAITING_PERIOD', status: 'fail', reason: 'waiting.within', params: {} },
  ];
  assert.deepEqual(
    routingOf(base({ rules: rules as never, proposedOutcome: 'rejected' }), 2_000_000).reasons.map((r) => [r.reason, r.params.code]),
    [
      ['routing.rule_review', 'RIDER'],
      ['routing.rule_fail', 'WAITING_PERIOD'],
    ],
  );
  assert.deepEqual(routingOf(base({ proposedOutcome: 'rejected', calculation: null }), 2_000_000).reasons, [{ reason: 'routing.proposal_rejected', params: {} }]);
});
