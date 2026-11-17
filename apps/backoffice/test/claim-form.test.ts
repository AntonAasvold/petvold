import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimFormProblems, emptyLine, linesTotal, newClaimId, toClaimInput, type ClaimForm } from '../src/claim-form.ts';

const policy = { id: 'pol_bella', market: 'SE', animalId: 'ani_bella', currency: 'SEK' };
const form = (o: Partial<ClaimForm> = {}): ClaimForm => ({
  claimNo: 'S-2026-060001',
  channel: 'customer',
  treatmentFrom: '2026-11-10',
  treatmentTo: '2026-11-12',
  diagnosisCode: 'ort-korsband-v',
  lines: [
    { description: 'Examination', category: 'examination', amount: '850', vat: '' },
    { description: 'Surgery', category: 'surgery', amount: '12 400,50', vat: '2 480' },
  ],
  ...o,
});

test('a complete claim has no problems, and the body takes market, currency and animal from the policy', () => {
  assert.deepEqual(claimFormProblems(form(), policy, '2026-11-17'), []);
  const body = toClaimInput(form(), policy, 'clm_x');
  assert.deepEqual(
    { market: body.market, currency: body.currency, animalId: body.animalId, diagnosisCode: body.diagnosisCode },
    { market: 'SE', currency: 'SEK', animalId: 'ani_bella', diagnosisCode: 'ORT-KORSBAND-V' },
  );
  assert.deepEqual(body.lines, [
    { id: '1', description: 'Examination', category: 'examination', amount: 85_000 },
    { id: '2', description: 'Surgery', category: 'surgery', amount: 1_240_050, vat: 248_000 },
  ]);
  assert.equal(linesTotal(form().lines, 'SEK'), 1_325_050);
});

test('what is missing is said, each once', () => {
  assert.deepEqual(claimFormProblems(form({ claimNo: ' ', diagnosisCode: '', lines: [] }), null, '2026-11-17'), [
    'register.needPolicy',
    'register.needClaimNo',
    'register.needDiagnosis',
    'register.needLine',
  ]);
  assert.deepEqual(claimFormProblems(form({ treatmentTo: '2026-11-01' }), policy, '2026-11-17'), ['register.datesOrder']);
  assert.deepEqual(claimFormProblems(form({ treatmentFrom: '2026-11-20', treatmentTo: '2026-11-21' }), policy, '2026-11-17'), ['register.future']);
  const bad = [emptyLine(), { ...emptyLine(), description: 'X', amount: 'abc' }, { ...emptyLine(), description: 'Y', amount: '10', vat: '20' }];
  assert.deepEqual(claimFormProblems(form({ lines: bad }), policy, '2026-11-17'), ['register.badLine']);
});

test('a new claim id has the contract form', () => {
  assert.match(newClaimId(), /^clm_[a-z0-9]{12}$/);
});

test('a suggested claim number has the year and six digits', async () => {
  const { suggestClaimNo } = await import('../src/claim-form.ts');
  assert.equal(suggestClaimNo('2026-11-17', () => 0), 'S-2026-100000');
  assert.match(suggestClaimNo('2026-11-17'), /^S-2026-\d{6}$/);
});
