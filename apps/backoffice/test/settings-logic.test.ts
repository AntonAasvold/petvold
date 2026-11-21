import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeMarketSettings, noticeSettingsProblems, retentionProblems, toMinorUnits, withLimit } from '../src/settings-logic.ts';

test('amounts in major units become minor units', () => {
  assert.equal(toMinorUnits('25 000', 'SEK'), 2_500_000);
  assert.equal(toMinorUnits('2500,50', 'EUR'), 250_050);
  assert.equal(toMinorUnits('1500', 'JPY'), 1500);
  assert.equal(toMinorUnits('-5', 'SEK'), null);
  assert.equal(toMinorUnits('abc', 'SEK'), null);
});

test('a limit is set, changed or removed; no limits left means no limit', () => {
  const roles = { handler: { permissions: ['claims:decide'], decisionLimits: { SEK: 2_500_000, EUR: 250_000 } } };
  assert.deepEqual(withLimit(roles, 'handler', 'decisionLimits', 'SEK', 3_000_000).handler!.decisionLimits, { SEK: 3_000_000, EUR: 250_000 });
  const noEur = withLimit(roles, 'handler', 'decisionLimits', 'EUR', null);
  assert.deepEqual(noEur.handler!.decisionLimits, { SEK: 2_500_000 });
  assert.equal('decisionLimits' in withLimit(noEur, 'handler', 'decisionLimits', 'SEK', null).handler!, false);
  assert.deepEqual(withLimit(roles, 'approver', 'approvalLimits', 'SEK', 1), roles, 'an unknown role changes nothing');
  assert.equal(roles.handler.decisionLimits.SEK, 2_500_000, 'the input is not changed');
});

test('retention needs markets, whole years and a reason', () => {
  assert.deepEqual(retentionProblems([{ market: 'SE', years: '10' }], 'Board decision'), []);
  assert.deepEqual(retentionProblems([{ market: 'se', years: '0' }], ' '), ['settings.badMarket', 'settings.badYears', 'settings.needReason']);
  assert.deepEqual(retentionProblems([{ market: 'SE', years: '10' }, { market: 'SE', years: '7' }], 'x'), ['settings.repeatedMarket']);
});

test('notice settings: days 1-30, a reason, and empty fields left out', () => {
  const f = { promptlyDays: '5', disabledTypes: ['transfer-offer'], texts: { sv: { sender: ' Exempelbolaget ', review: '' }, en: { sender: '', review: '' } } };
  assert.deepEqual(noticeSettingsProblems(f, 'Texts'), []);
  assert.deepEqual(noticeSettingsProblems({ ...f, promptlyDays: '31' }, ''), ['settings.badPromptly', 'settings.needReason']);
  assert.deepEqual(noticeMarketSettings(f), { promptlyDays: 5, disabledTypes: ['transfer-offer'], texts: { sv: { sender: 'Exempelbolaget' } } });
  assert.deepEqual(noticeMarketSettings({ promptlyDays: '', disabledTypes: [], texts: {} }), {});
  // The insurer's document system is the default and is left out (ADR 0038).
  assert.deepEqual(noticeMarketSettings({ documentMaker: 'insurer', promptlyDays: '', disabledTypes: [], texts: {} }), {});
  assert.deepEqual(noticeMarketSettings({ documentMaker: 'petvold', promptlyDays: '', disabledTypes: [], texts: {} }), { documentMaker: 'petvold' });
});
