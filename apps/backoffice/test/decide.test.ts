import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdempotencyKeys, decisionProblems, deviates, mayApprove, mayDecide, mayRequestReview } from '../src/decide.ts';

const me = (permissions: string[], subject = 'h@example.test') => ({ subject, roles: [], permissions, scope: { markets: '*' as const } });

test('a decision against the proposal needs claims:override, a reason code and a reason', () => {
  assert.equal(deviates('accept', 'approved'), false);
  assert.equal(deviates('accept', 'partial'), false);
  assert.equal(deviates('reject', 'partial'), true);
  assert.equal(deviates('accept', 'rejected'), true);
  const handler = me(['claims:decide', 'claims:override']);
  assert.deepEqual(decisionProblems({ action: 'accept' }, 'approved', handler), []);
  assert.deepEqual(decisionProblems({ action: 'reject' }, 'approved', handler), ['decide.needCode', 'decide.needReason']);
  assert.deepEqual(decisionProblems({ action: 'reject', reasonCode: 'not_covered', reason: ' ' }, 'approved', handler), ['decide.needReason']);
  assert.deepEqual(decisionProblems({ action: 'reject', reasonCode: 'not_covered', reason: 'Excluded breed condition' }, 'approved', handler), []);
  // A rejection always needs a reason, also when the proposal is to reject.
  assert.deepEqual(decisionProblems({ action: 'reject' }, 'rejected', handler), ['decide.needReason']);
  assert.deepEqual(decisionProblems({ action: 'reject', reason: 'Within the waiting period' }, 'rejected', handler), []);
  assert.deepEqual(decisionProblems({ action: 'reject', reasonCode: 'other', reason: 'x' }, 'approved', me(['claims:decide'])), ['decide.noOverride']);
});

test('who may decide, approve and ask for a review', () => {
  const handler = me(['claims:decide']);
  assert.deepEqual(['awaiting-decision', 'review-requested', 'awaiting-approval', 'decided'].map((s) => mayDecide(handler, s)), [true, true, false, false]);
  const approver = me(['claims:approve'], 'a@example.test');
  assert.equal(mayApprove(approver, { status: 'open', proposedBy: 'h@example.test' }), true);
  assert.equal(mayApprove(approver, { status: 'open', proposedBy: 'a@example.test' }), false, 'four eyes');
  assert.equal(mayApprove(approver, { status: 'returned', proposedBy: 'h@example.test' }), false);
  assert.equal(mayApprove(handler, { status: 'open', proposedBy: 'x' }), false);
  const channel = me(['claims:request-review']);
  assert.equal(mayRequestReview(channel, { automated: true }, false), true);
  assert.equal(mayRequestReview(channel, { automated: false }, false), false);
  assert.equal(mayRequestReview(channel, { automated: true }, true), false);
});

test('one idempotency key per action until it went through', () => {
  let n = 0;
  const keys = new IdempotencyKeys(() => `k${++n}`);
  assert.equal(keys.for('decide'), 'k1');
  assert.equal(keys.for('decide'), 'k1', 'a retry sends the same key');
  assert.equal(keys.for('approve'), 'k2');
  keys.done('decide');
  assert.equal(keys.for('decide'), 'k3');
});

test('the claim view works out the status as the queue does', async () => {
  const { claimStatus } = await import('../src/decide.ts');
  assert.equal(claimStatus({ openProposals: 1, openReviews: 1, decisions: 1 }), 'awaiting-approval');
  assert.equal(claimStatus({ openProposals: 0, openReviews: 1, decisions: 1 }), 'review-requested');
  assert.equal(claimStatus({ openProposals: 0, openReviews: 0, decisions: 2 }), 'decided');
  assert.equal(claimStatus({ openProposals: 0, openReviews: 0, decisions: 0 }), 'awaiting-decision');
});

test('why a claims handler: the routing reason, with the text of the rule that sent it', async () => {
  const { routingLines } = await import('../src/decide.ts');
  assert.deepEqual(
    routingLines(
      [
        { reason: 'routing.rule_review', params: { code: 'RIDER' }, message: 'The rule RIDER asks for a claims handler to review' },
        { reason: 'routing.above_auto_limit', params: { payout: 1, limit: 0 }, message: 'The payout is above the limit' },
      ],
      [{ code: 'RIDER', message: 'Possibly related to a rider: lameness' }],
    ),
    ['The rule RIDER asks for a claims handler to review: Possibly related to a rider: lameness', 'The payout is above the limit'],
  );
});
