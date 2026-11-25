import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldSince, matchBody, matchProblems, mayDecideProposal, mayRelease, moneyTabs, returnReasonOk } from '../src/money-logic.ts';

const me = (permissions: string[], subject = 'clerk-1') => ({ subject, roles: [], permissions, scope: { markets: '*' as const } });

test('the tabs follow the permissions', () => {
  assert.deepEqual(moneyTabs(me(['billing:read'])), ['unmatched', 'proposals']);
  assert.deepEqual(moneyTabs(me(['payments:read'])), ['held', 'awaiting', 'clinics', 'files']);
  assert.deepEqual(moneyTabs(me(['billing:read', 'payments:read'])), ['unmatched', 'held', 'awaiting', 'proposals', 'clinics', 'files']);
  assert.deepEqual(moneyTabs(null), []);
});

test('a payment is matched to an account or an invoice', () => {
  assert.deepEqual(matchProblems({ target: 'bac_7Hq2', note: '' }), []);
  assert.deepEqual(matchProblems({ target: ' inv_9x ', note: 'Named the policy' }), []);
  assert.deepEqual(matchProblems({ target: 'pol_1', note: '' }), ['target']);
  assert.deepEqual(matchProblems({ target: '', note: 'x'.repeat(2001) }), ['target', 'note']);
  assert.deepEqual(matchBody({ target: 'bac_7Hq2', note: ' ' }), { accountId: 'bac_7Hq2' });
  assert.deepEqual(matchBody({ target: ' inv_9x', note: ' Named the policy ' }), { invoiceId: 'inv_9x', note: 'Named the policy' });
});

test('a held payout is released by someone with the permission', () => {
  assert.equal(mayRelease({ status: 'held' }, me(['payments:release'])), true);
  assert.equal(mayRelease({ status: 'pending' }, me(['payments:release'])), false);
  assert.equal(mayRelease({ status: 'held' }, me(['payments:read'])), false);
  const steps = [
    { status: 'held', at: '2026-11-20T08:00:00Z' },
    { status: 'held', at: '2026-11-22T08:00:00Z' },
    { status: 'pending', at: '2026-11-23T08:00:00Z' },
  ];
  assert.equal(heldSince({ steps }), '2026-11-22T08:00:00Z', 'held again on new details');
  assert.equal(heldSince({ steps: [{ status: 'pending', at: 'x' }] }), undefined);
});

test('four eyes: the proposer never decides their own proposal', () => {
  const p = { status: 'proposed', proposedBy: 'clerk-1' };
  assert.equal(mayDecideProposal(p, me(['billing:credit'], 'manager-1')), true);
  assert.equal(mayDecideProposal(p, me(['billing:credit'], 'clerk-1')), false);
  assert.equal(mayDecideProposal(p, me(['billing:read'], 'manager-1')), false);
  assert.equal(mayDecideProposal({ ...p, status: 'approved' }, me(['billing:credit'], 'manager-1')), false);
  assert.equal(returnReasonOk('  '), false);
  assert.equal(returnReasonOk('The customer paid'), true);
});
