import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysLeftToPay,
  decidedLate,
  emptyInformation,
  informationBody,
  informationProblems,
  mayAnswer,
  mayCancel,
  mayRequestInformation,
  toggleItem,
} from '../src/information-logic.ts';
import { claimStatus } from '../src/decide.ts';
import { claimHistory } from '../src/history.ts';

const me = (permissions: string[]) => ({ subject: 'h@example.test', roles: [], permissions, scope: { markets: '*' as const } });

test('a handler asks for information on an open claim without a proposal; the clinic answers but does not ask', () => {
  const handler = me(['claims:request-information', 'claims:register']);
  const clinic = me(['claims:register']);
  assert.equal(mayRequestInformation(handler, 'awaiting-decision'), true);
  assert.equal(mayRequestInformation(handler, 'decided'), true);
  assert.equal(mayRequestInformation(handler, 'awaiting-approval'), false);
  assert.equal(mayRequestInformation(handler, 'withdrawn'), false);
  assert.equal(mayRequestInformation(clinic, 'awaiting-decision'), false);
  assert.equal(mayAnswer(clinic, { status: 'expired' }), true);
  assert.equal(mayAnswer(clinic, { status: 'cancelled' }), false);
  assert.equal(mayCancel(clinic, { status: 'open' }), false);
  assert.equal(mayCancel(handler, { status: 'expired' }), false);
});

test('a request needs what is missing and a note, and a due date after today; the body leaves out an empty date', () => {
  const f = emptyInformation();
  assert.deepEqual(informationProblems(f, '2026-11-20'), ['info.needItems', 'info.needNote']);
  const items = toggleItem(toggleItem([], 'other', true), 'itemised-invoice', true);
  assert.deepEqual(items, ['itemised-invoice', 'other'], 'in the order of the list');
  assert.deepEqual(toggleItem(items, 'other', false), ['itemised-invoice']);
  const filled = { ...f, items, note: ' The invoice ', dueDate: '2026-11-20' };
  assert.deepEqual(informationProblems(filled, '2026-11-20'), ['info.dueAfterToday']);
  assert.deepEqual(informationBody({ ...filled, dueDate: '' }), { recipient: 'customer', items, note: 'The invoice' });
  assert.deepEqual(informationBody({ ...filled, dueDate: '2026-12-01' }).dueDate, '2026-12-01');
});

test('the month in FAL 7 kap. 1 §: days left, and a decision more than 30 days after a complete basis is late', () => {
  assert.equal(daysLeftToPay(undefined, '2026-11-20T00:00:00Z'), null);
  assert.equal(daysLeftToPay('2026-11-01T10:00:00Z', '2026-11-20T09:00:00Z'), 12);
  assert.equal(daysLeftToPay('2026-10-01T10:00:00Z', '2026-11-20T09:00:00Z'), -19);
  assert.equal(decidedLate('2026-11-30T10:00:00Z', '2026-11-01T10:00:00Z'), false);
  assert.equal(decidedLate('2026-12-02T10:00:00Z', '2026-11-01T10:00:00Z'), true);
  assert.equal(decidedLate('2026-11-02T10:00:00Z', '2026-12-01T10:00:00Z'), false, 'a basis completed after the decision says nothing about it');
});

test('an open request puts the claim in awaiting-information after a proposal, and the history shows each step', () => {
  assert.equal(claimStatus({ openProposals: 0, openInformation: 1, openReviews: 1, decisions: 1 }), 'awaiting-information');
  assert.equal(claimStatus({ openProposals: 1, openInformation: 1, openReviews: 0, decisions: 0 }), 'awaiting-approval');
  const history = claimHistory({
    claim: { receivedAt: '2026-11-01T08:00:00Z', channel: 'customer' },
    decisions: [],
    proposals: [],
    reviews: [],
    information: [
      {
        id: 'inf_1',
        recipient: 'clinic',
        items: ['medical-record'],
        requestedBy: 'h',
        requestedAt: '2026-11-02T08:00:00Z',
        status: 'answered',
        remindedAt: '2026-11-16T05:00:00Z',
        receivedAt: '2026-11-17T08:00:00Z',
        closedBy: 'h2',
        closedAt: '2026-11-17T09:00:00Z',
        closingNote: 'By mail',
      },
      { id: 'inf_2', recipient: 'customer', items: ['other'], requestedBy: 'h', requestedAt: '2026-11-18T08:00:00Z', status: 'open' },
    ],
  });
  assert.deepEqual(
    history.map((e) => e.type),
    ['claim.information_requested', 'claim.information_received', 'claim.information_reminded', 'claim.information_requested', 'claim.received'],
  );
  const received = history[1]!;
  assert.ok(received.type === 'claim.information_received' && received.note === 'By mail' && received.by === 'h2');
  assert.ok(history[0]!.type === 'claim.information_requested' && history[0]!.open);
});
