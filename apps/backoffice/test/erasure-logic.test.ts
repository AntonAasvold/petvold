import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayApprove, mayReject, rejectionBody, rejectionProblems } from '../src/erasure-logic.ts';

const officer = (subject: string) => ({ subject, roles: ['privacy-officer'], permissions: ['parties:read', 'parties:privacy', 'parties:erase'] }) as never;

test('four eyes: the one who asked never approves, and a decided request is closed', () => {
  const r = { basis: 'subject-request' as const, requestedBy: 'a@example.test' };
  assert.equal(mayApprove(officer('a@example.test'), r), false);
  assert.equal(mayApprove(officer('b@example.test'), r), true);
  assert.equal(mayApprove(officer('b@example.test'), { ...r, decision: { outcome: 'approved' } }), false);
  assert.equal(mayReject(officer('a@example.test'), r), true, 'the one who asked may reject');
});

test("rejecting the data subject's own request restricts the data until a later date", () => {
  assert.deepEqual(rejectionProblems({ reason: ' ', restrictUntil: '' }, 'subject-request', '2026-11-19'), ['settings.needReason', 'erasure.needRestriction']);
  assert.deepEqual(rejectionProblems({ reason: 'Claim in progress', restrictUntil: '2026-11-19' }, 'subject-request', '2026-11-19'), ['erasure.needRestriction']);
  assert.deepEqual(rejectionProblems({ reason: 'Claim in progress', restrictUntil: '' }, 'retention-expired', '2026-11-19'), []);
  assert.deepEqual(rejectionBody({ reason: ' Claim in progress ', restrictUntil: '2027-06-01' }, 'subject-request'), { reason: 'Claim in progress', restrictUntil: '2027-06-01' });
  assert.deepEqual(rejectionBody({ reason: 'Kept', restrictUntil: '2027-06-01' }, 'retention-expired'), { reason: 'Kept' });
});
