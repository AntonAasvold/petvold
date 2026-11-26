import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNDERWRITING } from '../../../modules/underwriting-core/src/fixtures.ts';
import { validateUnderwriting } from '../../../modules/underwriting-core/src/index.ts';
import { emptyAnswerRule, emptyQuestion, isUnderwriting, underwritingContentFrom, underwritingFormFrom, underwritingFormProblems } from '../src/underwriting-form.ts';

test('underwriting rules become a form and the same content again', () => {
  const f = underwritingFormFrom(UNDERWRITING);
  assert.equal(f.ageLimits, 'dog; 42; 9');
  assert.equal(f.breedRules, 'dog-wolfhybrid; decline; breed-not-covered');
  assert.equal(f.questions[2]!.species, 'dog');
  assert.equal(f.answerRules[0]!.onlyFor, 'CAR-MITRAL, CAR-DCM');
  assert.deepEqual(underwritingFormProblems(f), []);
  const back = underwritingContentFrom(f, UNDERWRITING);
  assert.deepEqual(back, UNDERWRITING);
  assert.deepEqual(validateUnderwriting(back as never), []);
  assert.ok(isUnderwriting(UNDERWRITING));
});

test('an age limit without an oldest age, a new question in two languages, and a new rule', () => {
  const f = underwritingFormFrom(UNDERWRITING);
  const q = { ...emptyQuestion(), id: 'allergy', labels: { sv: 'Har djuret allergi?', en: 'Does the animal have an allergy?' } };
  const r = { ...emptyAnswerRule('allergy'), reason: 'allergy' };
  const c = underwritingContentFrom({ ...f, ageLimits: 'dog; 42; 9\ncat; 56;', questions: [...f.questions, q], answerRules: [...f.answerRules, r] });
  assert.deepEqual(c.ageLimits[1], { species: 'cat', minAgeDays: 56 });
  assert.deepEqual(c.questions[3], { id: 'allergy', type: 'boolean', labels: { sv: 'Har djuret allergi?', en: 'Does the animal have an allergy?' } });
  assert.deepEqual(c.answerRules[4], { question: 'allergy', outcome: 'refer', reason: 'allergy' });
  assert.deepEqual(validateUnderwriting(c as never), []);
});

test('the form says what the engine would refuse', () => {
  const f = underwritingFormFrom(UNDERWRITING);
  const rules = (patch: object, i = 3) => ({ ...f, answerRules: f.answerRules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  assert.deepEqual(underwritingFormProblems({ ...f, ageLimits: 'dog; six weeks' }), ['uwform.badAgeLimits']);
  assert.deepEqual(underwritingFormProblems({ ...f, ageLimits: 'dog; 42\ndog; 50' }), ['uwform.badAgeLimits']);
  assert.deepEqual(underwritingFormProblems({ ...f, questions: [...f.questions, { ...emptyQuestion(), id: 'lameness', labels: { en: 'Again' } }] }), ['uwform.duplicateQuestion']);
  assert.deepEqual(underwritingFormProblems({ ...f, questions: [...f.questions, emptyQuestion()] }), ['uwform.badQuestion']);
  assert.deepEqual(underwritingFormProblems(rules({ question: 'unknown' })), ['uwform.badAnswerRule']);
  assert.deepEqual(underwritingFormProblems(rules({ diagnosisCodes: '' })), ['uwform.badRider'], 'a rider on a yes-or-no question needs codes');
  assert.deepEqual(underwritingFormProblems(rules({ onlyFor: 'X' }, 2)), ['uwform.onlyForNeedsDiagnoses']);
  assert.deepEqual(underwritingFormProblems({ ...f, breedRules: 'dog-wolfhybrid; accept; ok' }), ['uwform.badBreedRules']);
});

test('a rule that is no rider loses its codes and description', () => {
  const f = underwritingFormFrom(UNDERWRITING);
  const c = underwritingContentFrom({ ...f, answerRules: f.answerRules.map((r, j) => (j === 3 ? { ...r, outcome: 'refer' as const } : r)) });
  assert.deepEqual(c.answerRules[3], { question: 'lameness', outcome: 'refer', reason: 'previous-lameness' });
});
