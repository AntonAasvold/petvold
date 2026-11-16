import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UnderwritingError, questionsFor, underwrite, underwritingCoverage, validateUnderwriting, type Answer, type UnderwritingInput } from '../src/index.ts';
import { UNDERWRITING } from '../src/fixtures.ts';

const ref = { series: 'SE-HUND-UW', version: 1, checksum: 'abc' };
const rules = { content: UNDERWRITING, ref };
const noes: Answer[] = [
  { question: 'previous-illness', value: false },
  { question: 'ongoing-symptoms', value: false },
  { question: 'lameness', value: false },
];
const doris: UnderwritingInput = { market: 'SE', species: 'dog', breed: 'dog-golden-retriever', birthDate: '2023-05-02', startDate: '2026-11-15', answers: noes };
const answer = (q: string, a: Partial<Answer>) => noes.map((x) => (x.question === q ? { ...x, ...a } : x));

test('a healthy young dog is accepted, with every check listed', () => {
  const r = underwrite(rules, doris);
  assert.equal(r.outcome, 'accept');
  assert.deepEqual(r.riders, []);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.checks.map((c) => [c.code, c.result, c.basis]), [
    ['species', 'pass', 'dog'],
    ['min-age', 'pass', 1293],
    ['max-age', 'pass', 3],
    ['answer', 'pass', 'previous-illness'],
    ['answer', 'pass', 'ongoing-symptoms'],
    ['answer', 'pass', 'lameness'],
  ]);
  assert.deepEqual(r.facts, { ageDays: 1293, ageYears: 3 });
  assert.deepEqual(r.rules, ref);
});

test('a declared illness becomes a rider for the declared diagnoses', () => {
  const r = underwrite(rules, { ...doris, answers: answer('previous-illness', { value: true, diagnosisCodes: ['ORA-OTIT', 'DER-ALLERGI'] }) });
  assert.equal(r.outcome, 'accept-with-riders');
  assert.deepEqual(r.riders, [{ diagnosisCodes: ['DER-ALLERGI', 'ORA-OTIT'], description: 'Declared at application', question: 'previous-illness', reason: 'previous-illness' }]);
});

test('a yes-or-no question gives a rider for its fixed diagnoses', () => {
  const r = underwrite(rules, { ...doris, answers: answer('lameness', { value: true }) });
  assert.equal(r.outcome, 'accept-with-riders');
  assert.deepEqual(r.riders[0]!.diagnosisCodes, ['ORT-HALTA-HB-H', 'ORT-HALTA-HB-V']);
});

test('the strictest outcome wins: a heart disease is declined, even with a rider', () => {
  const r = underwrite(rules, { ...doris, answers: answer('previous-illness', { value: true, diagnosisCodes: ['CAR-MITRAL'] }) });
  assert.equal(r.outcome, 'decline');
  assert.deepEqual(r.reasons, ['heart-disease']);
});

test('symptoms not examined go to a person', () => {
  const r = underwrite(rules, { ...doris, answers: answer('ongoing-symptoms', { value: true }) });
  assert.deepEqual([r.outcome, r.reasons], ['refer', ['ongoing-symptoms']]);
});

test('age limits on the start date: from 42 days, up to 9 whole years', () => {
  assert.equal(underwrite(rules, { ...doris, birthDate: '2026-10-04' }).outcome, 'accept'); // 42 days
  const young = underwrite(rules, { ...doris, birthDate: '2026-10-05' });
  assert.deepEqual([young.outcome, young.reasons], ['decline', ['too-young']]);
  assert.equal(underwrite(rules, { ...doris, birthDate: '2016-11-16' }).outcome, 'accept'); // 9 years, the day before 10
  const old = underwrite(rules, { ...doris, birthDate: '2016-11-15' });
  assert.deepEqual([old.outcome, old.reasons], ['decline', ['too-old']]);
});

test('a species without age limits and a listed breed are declined with reasons', () => {
  const cat = underwrite(rules, { ...doris, species: 'cat', breed: 'cat-domestic', answers: noes.filter((a) => a.question !== 'lameness') });
  assert.deepEqual([cat.outcome, cat.reasons], ['decline', ['species-not-covered']]);
  const hybrid = underwrite(rules, { ...doris, breed: 'dog-wolfhybrid' });
  assert.deepEqual([hybrid.outcome, hybrid.reasons], ['decline', ['breed-not-covered']]);
});

test('questions per species: the lameness question is only for dogs', () => {
  assert.deepEqual(questionsFor(UNDERWRITING, 'dog').map((q) => q.id), ['previous-illness', 'ongoing-symptoms', 'lameness']);
  assert.deepEqual(questionsFor(UNDERWRITING, 'cat').map((q) => q.id), ['previous-illness', 'ongoing-symptoms']);
});

test('answers must fit the questions', () => {
  const bad = (answers: Answer[], re: RegExp) => assert.throws(() => underwrite(rules, { ...doris, answers }), (e: unknown) => e instanceof UnderwritingError && re.test(e.message));
  bad(noes.slice(1), /Unanswered questions: previous-illness/);
  bad([...noes, { question: 'smoker', value: false }], /not a question/);
  bad([...noes, noes[0]!], /answered twice/);
  bad(answer('previous-illness', { value: true }), /needs the diagnosis codes/);
  bad(answer('lameness', { value: true, diagnosisCodes: ['X'] }), /takes no diagnosis codes/);
  bad(answer('previous-illness', { value: false, diagnosisCodes: ['X'] }), /answered no/);
  assert.throws(() => underwrite(rules, { ...doris, market: 'DE' }), /for SE, not DE/);
  assert.throws(() => underwrite(rules, { ...doris, birthDate: '2027-01-01' }), /born after/);
});

test('the same application gives the same hash, whatever the order of answers and codes', () => {
  const a = underwrite(rules, { ...doris, answers: answer('previous-illness', { value: true, diagnosisCodes: ['ORA-OTIT', 'DER-ALLERGI'] }) });
  const b = underwrite(rules, { ...doris, answers: [...answer('previous-illness', { value: true, diagnosisCodes: ['DER-ALLERGI', 'ORA-OTIT'] })].reverse() });
  assert.equal(a.inputHash, b.inputHash);
  assert.notEqual(a.inputHash, underwrite(rules, doris).inputHash);
  // Another rule set version: another hash for the same answers.
  assert.notEqual(underwrite(rules, doris).inputHash, underwrite({ content: UNDERWRITING, ref: { ...ref, version: 2 } }, doris).inputHash);
});

test('property: more yes answers never make the outcome milder', () => {
  const severity = { accept: 0, 'accept-with-riders': 1, refer: 2, decline: 3 };
  const options: Answer[][] = [
    [{ question: 'previous-illness', value: false }, { question: 'previous-illness', value: true, diagnosisCodes: ['ORA-OTIT'] }, { question: 'previous-illness', value: true, diagnosisCodes: ['CAR-DCM'] }],
    [{ question: 'ongoing-symptoms', value: false }, { question: 'ongoing-symptoms', value: true }],
    [{ question: 'lameness', value: false }, { question: 'lameness', value: true }],
  ];
  for (const a of options[0]!) for (const b of options[1]!) for (const c of options[2]!) {
    const base = severity[underwrite(rules, { ...doris, answers: [a, b, c] }).outcome];
    for (const [i, yes] of [[1, { question: 'ongoing-symptoms', value: true }], [2, { question: 'lameness', value: true }]] as const) {
      const answers = [a, b, c];
      answers[i] = yes;
      assert.ok(severity[underwrite(rules, { ...doris, answers }).outcome] >= base);
    }
  }
});

test('validation names what is wrong', () => {
  assert.deepEqual(validateUnderwriting(UNDERWRITING), []);
  const errors = validateUnderwriting({
    market: 'se',
    ageLimits: [{ species: 'dog', minAgeDays: -1 }],
    questions: [{ id: 'Q1', type: 'scale' as never, labels: {} }],
    answerRules: [
      { question: 'nope', outcome: 'refer', reason: 'x' },
      { question: 'Q1', outcome: 'rider', reason: 'ok-reason' },
      { question: 'Q1', outcome: 'refer', reason: 'other', riderDescription: 'x' },
    ],
    breedRules: [{ breed: 'b', outcome: 'rider' as never, reason: 'r' }],
    extra: 1,
  } as never);
  for (const re of [/Invalid market/, /minAgeDays/, /Invalid question id/, /unknown type/, /text per language/, /unknown question 'nope'/, /needs a reason code/, /needs riderDescription/, /only for a rider/, /unknown outcome 'rider'/, /needs a reason code/, /Unknown field 'extra'/]) {
    assert.ok(errors.some((e) => re.test(e)), `${re} in ${errors.join(' | ')}`);
  }
});

test('coverage: every species of the product needs age limits in the same market', () => {
  assert.deepEqual(underwritingCoverage(UNDERWRITING, { market: 'SE', species: ['dog'] }), []);
  assert.deepEqual(underwritingCoverage(UNDERWRITING, { market: 'DE', species: ['dog', 'cat'] }), ['The underwriting rules are for SE, the product for DE', 'No age limits for cat']);
});
