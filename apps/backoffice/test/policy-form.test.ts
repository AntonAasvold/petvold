import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelBody,
  cancelProblems,
  changeBody,
  changeProblems,
  emptyIssue,
  issueBody,
  issueProblems,
  needsApplication,
  reversibleCancellation,
  withProductDefaults,
  type ProductLike,
} from '../src/policy-form.ts';

const today = '2026-11-19';
const now = '2026-11-19T10:00';
const priced: ProductLike = {
  id: 'SE-HUND-BAS@2026.1',
  content: {
    market: 'SE',
    currency: 'SEK',
    species: ['dog'],
    tariffSeries: 'SE-HUND-TARIFF',
    vetCare: { annualLimits: [3_000_000, 6_000_000], defaultAnnualLimit: 6_000_000, deductibles: [{ code: 'standard' }, { code: 'high' }], defaultDeductible: 'standard' },
  },
};
const manual: ProductLike = { ...priced, id: 'SE-HUND-VV-LIV@2026.2', content: { ...priced.content, tariffSeries: undefined } };
const withDocs: ProductLike = {
  ...priced,
  id: 'SE-HUND-PLUS@2026.1',
  content: { ...priced.content, underwritingSeries: 'SE-HUND-UW', documents: [{ type: 'terms', language: 'sv', sha256: 'a' }, { type: 'pre-contract', language: 'sv', sha256: 'b' }] },
};

test('issuing needs animal, policyholder, product and acceptance; a product without a tariff needs a premium', () => {
  const f = withProductDefaults(emptyIssue(today, now, { animalId: 'ani_bosse', holder: 'pty_owner001' }), priced);
  assert.deepEqual([f.annualLimit, f.deductible], [6_000_000, 'standard']);
  assert.deepEqual(issueProblems(f, priced, today, now), []);
  assert.deepEqual(issueProblems({ ...f, productVersion: manual.id }, manual, today, now), ['policy.needPremium']);
  assert.deepEqual(issueProblems({ ...emptyIssue(today, now), startDate: '2026-11-01', channel: ' ' }, null, today, now), [
    'policy.needAnimal',
    'policy.needHolder',
    'policy.needProduct',
    'application.startInPast',
    'policy.needChannel',
  ]);
});

test('a product with underwriting takes an application, and one with documents needs terms and pre-contract shown', () => {
  assert.equal(needsApplication(withDocs), true);
  const f = withProductDefaults(emptyIssue(today, now, { animalId: 'ani_bosse', holder: 'pty_owner001' }), withDocs);
  assert.deepEqual(issueProblems(f, withDocs, today, now), ['policy.needDocuments']);
  assert.deepEqual(issueProblems({ ...f, documents: ['terms:sv', 'pre-contract:sv'] }, withDocs, today, now), []);
});

test('the issue body has the choices, the premium without a tariff and the documents shown', () => {
  const f = { ...withProductDefaults(emptyIssue(today, now, { animalId: 'ani_bosse', holder: 'pty_owner001' }), manual), premium: '3 600', campaignCode: ' puppy2026 ' };
  const body = issueBody(f, manual);
  assert.deepEqual(
    { premium: body.premium, vetCare: body.vetCare, campaignCode: body.campaignCode, channel: body.acceptance.channel },
    { premium: { amount: 360_000, currency: 'SEK' }, vetCare: { annualLimit: 6_000_000, deductible: 'standard' }, campaignCode: 'PUPPY2026', channel: 'phone' },
  );
  const docs = issueBody({ ...withProductDefaults(f, withDocs), documents: ['terms:sv'] }, withDocs).acceptance.documents;
  assert.deepEqual(docs, [{ type: 'terms', language: 'sv', sha256: 'a' }]);
});

test('cancelling: need-ceased needs the day and a note; the body keeps only what the reason uses', () => {
  assert.deepEqual(cancelProblems({ reason: 'need-ceased', receivedOn: '', effectiveDate: '', note: '' }, today), ['policy.needEffective', 'policy.needNote']);
  assert.deepEqual(cancelProblems({ reason: '', receivedOn: '2026-12-01', effectiveDate: '', note: '' }, today), ['policy.needCancelReason', 'policy.futureReceived']);
  assert.deepEqual(cancelBody({ reason: 'customer-term-end', receivedOn: today, effectiveDate: '2026-12-01', note: '' }), { reason: 'customer-term-end', receivedOn: today });
});

test('a change starts today or later with a reason; only the latest cancellation may be reversed', () => {
  const f = { from: '2026-11-01', annualLimit: 3_000_000, deductible: 'high', premium: '', reason: '' };
  assert.deepEqual(changeProblems(f, today, false, 'SEK'), ['policy.changeFrom', 'policy.needPremium', 'settings.needReason']);
  assert.deepEqual(changeBody({ ...f, from: today, reason: ' Higher deductible ' }, true, 'SEK'), { from: today, vetCare: { annualLimit: 3_000_000, deductible: 'high' }, reason: 'Higher deductible' });
  const t = [
    { id: 'ptx_1', type: 'issue', requestedAt: '2026-01-01T00:00:00Z' },
    { id: 'ptx_2', type: 'cancel', requestedAt: '2026-11-01T00:00:00Z' },
  ];
  assert.equal(reversibleCancellation(t)?.id, 'ptx_2');
  assert.equal(reversibleCancellation([...t, { id: 'ptx_3', type: 'change', requestedAt: '2026-11-02T00:00:00Z' }]), undefined);
});

test('an application answers every question, names declared diagnoses, and sends them with the policy', async () => {
  const { answersFor, answerProblems, applicationBody } = await import('../src/policy-form.ts');
  const a = answersFor([
    { id: 'treated-last-12-months', type: 'boolean' },
    { id: 'known-diagnoses', type: 'diagnoses' },
  ]);
  assert.deepEqual(answerProblems(a), ['policy.needAnswers']);
  const answered = [{ ...a[0]!, value: false }, { ...a[1]!, value: true }];
  assert.deepEqual(answerProblems(answered), ['policy.needDiagnoses']);
  answered[1]!.diagnoses = 'ora-otit, hud-allergi';
  assert.deepEqual(answerProblems(answered), []);
  const f = { ...withProductDefaults(emptyIssue(today, now, { animalId: 'ani_rocky', holder: 'pty_owner004' }), withDocs), documents: ['terms:sv', 'pre-contract:sv'] };
  assert.deepEqual(applicationBody(f, withDocs, answered).answers, [
    { question: 'treated-last-12-months', value: false },
    { question: 'known-diagnoses', value: true, diagnosisCodes: ['ORA-OTIT', 'HUD-ALLERGI'] },
  ]);
});
