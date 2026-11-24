import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditBody, creditMax, creditProblems, dunningState, refundBody, refundProblems } from '../src/account-logic.ts';

const paid = { total: 40_000, credited: 0, open: 0 };
const half = { total: 40_000, credited: 10_000, open: 15_000 };

test('a credit note takes at most what is left; a write-off at most what is unpaid', () => {
  assert.equal(creditMax(paid, 'credit'), 40_000, 'also of a paid invoice (KRED-06)');
  assert.equal(creditMax(paid, 'write-off'), 0, 'nothing unpaid to give up (KRED-07)');
  assert.equal(creditMax(half, 'credit'), 30_000);
  assert.equal(creditMax(half, 'write-off'), 15_000);
});

test('the credit form is checked before it is sent', () => {
  assert.deepEqual(creditProblems({ kind: 'credit', amount: '195,07', reason: 'Animal died' }, half, 'SEK'), []);
  assert.deepEqual(creditBody({ kind: 'credit', amount: '195,07', reason: ' Animal died ' }, 'SEK'), { kind: 'credit', amount: 19_507, reason: 'Animal died' });
  assert.deepEqual(creditProblems({ kind: 'write-off', amount: '150,01', reason: 'x' }, half, 'SEK'), ['too-much']);
  assert.deepEqual(creditProblems({ kind: 'write-off', amount: '150', reason: 'x' }, half, 'SEK'), []);
  assert.deepEqual(creditProblems({ kind: 'credit', amount: '0', reason: '' }, half, 'SEK'), ['amount', 'reason']);
  assert.deepEqual(creditProblems({ kind: 'credit', amount: 'abc', reason: 'x' }, half, 'SEK'), ['amount']);
});

test('a refund is all of the credit or a part, never more', () => {
  assert.deepEqual(refundProblems({ amount: '', note: '' }, 10_000, 'SEK'), []);
  assert.deepEqual(refundProblems({ amount: '100', note: '' }, 10_000, 'SEK'), []);
  assert.deepEqual(refundProblems({ amount: '100,01', note: '' }, 10_000, 'SEK'), ['too-much']);
  assert.deepEqual(refundProblems({ amount: '-1', note: '' }, 10_000, 'SEK'), ['amount']);
  assert.deepEqual(refundProblems({ amount: '', note: '' }, 0, 'SEK'), ['nothing']);
  assert.deepEqual(refundBody({ amount: '', note: ' ' }, 'SEK'), {});
  assert.deepEqual(refundBody({ amount: '50', note: 'Called' }, 'SEK'), { amount: 5_000, note: 'Called' });
});

test('the last dunning step', () => {
  assert.equal(dunningState({ dunning: [] }), null);
  assert.equal(dunningState({ dunning: [{ step: 'reminded' }, { step: 'cancellation-noticed' }] }), 'cancellation-noticed');
});
