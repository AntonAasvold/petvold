import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_KINDS, accountingTabs, balanced, chartProblems, dayFileName, unmappedKinds, withAccount } from '../src/accounting-logic.ts';

const me = (permissions: string[]) => ({ subject: 's', roles: [], permissions, scope: { markets: '*' as const } });

test('the tabs need accounting:read', () => {
  assert.deepEqual(accountingTabs(me(['accounting:read'])), ['days', 'balances', 'verifications', 'chart']);
  assert.deepEqual(accountingTabs(me(['billing:read'])), []);
});

test('an account is set, changed and removed in a new map', () => {
  const start = { SE: { bank: { number: '1930', name: 'Bank' } } };
  const set = withAccount(start, 'SE', 'premium-income', ' 3010 ', ' Premium income ');
  assert.deepEqual(set.SE, { bank: { number: '1930', name: 'Bank' }, 'premium-income': { number: '3010', name: 'Premium income' } });
  assert.deepEqual(withAccount(set, 'SE', 'bank', '', '').SE, { 'premium-income': { number: '3010', name: 'Premium income' } });
  assert.deepEqual(withAccount(start, 'FI', 'bank', '1910', '').FI, { bank: { number: '1910' } });
  assert.deepEqual(start, { SE: { bank: { number: '1930', name: 'Bank' } } }, 'the input is not changed');
});

test('a chart is checked before it is sent', () => {
  assert.deepEqual(chartProblems({ SE: { bank: { number: '1930' } } }, 'New chart'), []);
  assert.deepEqual(chartProblems({ SE: { bank: { number: '19 30' } } }, ''), [{ kind: 'number', market: 'SE', account: 'bank' }, { kind: 'reason' }]);
  assert.deepEqual(chartProblems({ se: {} }, 'x'), [{ kind: 'market', market: 'se' }]);
});

test('unmapped kinds, balanced totals and the file name', () => {
  assert.equal(unmappedKinds({}, 'SE').length, ACCOUNT_KINDS.length);
  assert.deepEqual(unmappedKinds({ SE: Object.fromEntries(ACCOUNT_KINDS.filter((k) => k !== 'bank').map((k) => [k, { number: '1' }])) }, 'SE'), ['bank']);
  assert.equal(balanced([{ debit: 100, credit: 100 }]), true);
  assert.equal(balanced([{ debit: 100, credit: 99 }]), false);
  assert.equal(dayFileName('SE', '2026-11-23'), 'petvold-verifications-SE-2026-11-23.csv');
});
