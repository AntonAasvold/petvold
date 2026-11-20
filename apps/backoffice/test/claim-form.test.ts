import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimFormProblems, emptyLine, linesTotal, toClaimInput, type ClaimForm } from '../src/claim-form.ts';

const policy = { id: 'pol_bella', market: 'SE', animalId: 'ani_bella', currency: 'SEK' };
const form = (o: Partial<ClaimForm> = {}): ClaimForm => ({
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
  const body = toClaimInput(form(), policy);
  // No id or claim number: the server gives both (ADR 0036).
  assert.equal('id' in body || 'claimNo' in body, false);
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
  assert.deepEqual(claimFormProblems(form({ diagnosisCode: '', lines: [] }), null, '2026-11-17'), [
    'register.needPolicy',
    'register.needDiagnosis',
    'register.needLine',
  ]);
  assert.deepEqual(claimFormProblems(form({ treatmentTo: '2026-11-01' }), policy, '2026-11-17'), ['register.datesOrder']);
  assert.deepEqual(claimFormProblems(form({ treatmentFrom: '2026-11-20', treatmentTo: '2026-11-21' }), policy, '2026-11-17'), ['register.future']);
  const bad = [emptyLine(), { ...emptyLine(), description: 'X', amount: 'abc' }, { ...emptyLine(), description: 'Y', amount: '10', vat: '20' }];
  assert.deepEqual(claimFormProblems(form({ lines: bad }), policy, '2026-11-17'), ['register.badLine']);
});

test('a correction starts from the claim, keeps line ids and line diagnoses, and new lines get new ids (ADR 0036)', async () => {
  const { formFromClaim, correctionBody, newLineId, toMajorText } = await import('../src/claim-form.ts');
  assert.deepEqual([toMajorText(85_000, 'SEK'), toMajorText(12_345, 'SEK'), toMajorText(500, 'JPY')], ['850', '123.45', '500']);
  const f = formFromClaim({
    channel: 'customer',
    treatmentFrom: '2026-11-10',
    treatmentTo: '2026-11-12',
    diagnosisCode: 'ORT-KORSBAND-V',
    currency: 'SEK',
    lines: [
      { id: 'l1', description: 'Examination', category: 'examination', amount: 85_000 },
      { id: 'l4', description: 'Surgery', category: 'surgery', diagnosisCode: 'ORT-KORSBAND-V', amount: 1_240_000, vat: 0 },
    ],
  });
  assert.deepEqual(f.lines.map((l) => [l.id, l.amount, l.vat]), [['l1', '850', ''], ['l4', '12400', '']]);
  assert.equal(newLineId(f.lines), 'l3');
  assert.equal(newLineId([...f.lines, { ...emptyLine(), id: 'l3' }]), 'l5');
  const body = correctionBody(f, policy, ' Wrong amount ', 1);
  assert.deepEqual(body.lines, [
    { id: 'l1', description: 'Examination', category: 'examination', amount: 85_000 },
    { id: 'l4', diagnosisCode: 'ORT-KORSBAND-V', description: 'Surgery', category: 'surgery', amount: 1_240_000 },
  ]);
  assert.deepEqual([body.reason, body.expectedRevision, 'policyId' in body], ['Wrong amount', 1, false]);
});

test('a reopened claim waits for a decision, and a correction needs an open claim without a proposal', async () => {
  const { claimStatus, mayCorrect } = await import('../src/decide.ts');
  assert.equal(claimStatus({ openProposals: 0, openReviews: 0, decisions: 1, reopened: true }), 'awaiting-decision');
  assert.equal(claimStatus({ openProposals: 0, openReviews: 0, decisions: 1 }), 'decided');
  const me = { subject: 'h', roles: [], permissions: ['claims:register'], scope: { markets: '*' as const } };
  assert.equal(mayCorrect(me, 'decided'), true);
  assert.equal(mayCorrect(me, 'awaiting-approval'), false);
  assert.equal(mayCorrect(me, 'withdrawn'), false);
  assert.equal(mayCorrect({ ...me, permissions: [] }, 'decided'), false);
});
