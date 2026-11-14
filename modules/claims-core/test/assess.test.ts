import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '@petvold/claims-core';
import { fixtures } from '@petvold/claims-store-memory';

const { bellaPolicy, cruciateClaim, otitisClaim, RULES_SE_DOG } = fixtures;

test('design example: SEK 18,640 billed gives SEK 12,165 payout', () => {
  const a = assess({
    claim: cruciateClaim(),
    policy: bellaPolicy(),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: null,
    consumedBefore: 840_000,
  });
  const c = a.calculation!;
  assert.equal(c.billed, 1_864_000);
  assert.equal(c.nonReimbursable, 42_000);
  assert.equal(c.base, 1_822_000);
  assert.equal(c.deductibleFixed, 200_000);
  assert.equal(c.deductibleVariable, 405_500);
  assert.equal(c.payout, 1_216_500);
  assert.equal(c.customerShare, 647_500);
  assert.equal(c.remainingBefore, 5_160_000);
  assert.equal(c.cappedByLimit, false);
});

test('design example goes to a handler: rider in the same diagnosis group and above the auto-settle limit', () => {
  const a = assess({
    claim: cruciateClaim(),
    policy: bellaPolicy(),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: null,
    consumedBefore: 840_000,
  });
  const rider = a.rules.find((r) => r.code === 'RIDER')!;
  assert.equal(rider.status, 'review');
  assert.equal(a.mode, 'manual');
  assert.equal(a.proposedOutcome, 'partial'); // food is not reimbursed
});

test('open deductible period: no fixed deductible', () => {
  const a = assess({
    claim: cruciateClaim(),
    policy: bellaPolicy(),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: {
      id: 'dp1',
      animalId: 'ani_bella',
      diagnosisGroup: 'ortopedi-bakben',
      validFrom: '2026-10-01',
      validTo: '2027-02-03',
      openedByClaimId: 'clm_other',
    },
    consumedBefore: 0,
  });
  assert.equal(a.calculation!.deductibleFixed, 0);
  assert.equal(a.calculation!.deductibleVariable, 455_500); // 25 % of SEK 18,220
  assert.equal(a.calculation!.payout, 1_366_500);
});

test('the annual limit caps the payout', () => {
  const a = assess({
    claim: cruciateClaim(),
    policy: bellaPolicy(),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: null,
    consumedBefore: 5_500_000, // SEK 5,000 left
  });
  assert.equal(a.calculation!.payout, 500_000);
  assert.equal(a.calculation!.cappedByLimit, true);
  assert.ok(a.rules.some((r) => r.code === 'LIMIT' && r.status === 'info'));
});

test('an exhausted annual limit gives rejection', () => {
  const a = assess({
    claim: otitisClaim(),
    policy: bellaPolicy(),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: null,
    consumedBefore: 6_000_000,
  });
  assert.equal(a.calculation!.payout, 0);
  assert.equal(a.proposedOutcome, 'rejected');
});

test('treatment within the waiting period is rejected', () => {
  const a = assess({
    claim: otitisClaim({ treatmentFrom: '2024-04-10', treatmentTo: '2024-04-10' }),
    policy: bellaPolicy({ validFrom: '2024-04-01', policyYearStart: '2024-04-01' }),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: null,
    consumedBefore: 0,
  });
  assert.equal(a.rules.find((r) => r.code === 'WAITING_PERIOD')!.status, 'fail');
  assert.equal(a.proposedOutcome, 'rejected');
  assert.equal(a.mode, 'manual');
});

test('a diagnosis that exactly matches a rider is excluded', () => {
  const a = assess({
    claim: cruciateClaim({ diagnosisCode: 'ORT-HALTA-HB-H' }),
    policy: bellaPolicy(),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: null,
    consumedBefore: 0,
  });
  assert.equal(a.rules.find((r) => r.code === 'RIDER')!.status, 'fail');
  assert.equal(a.proposedOutcome, 'rejected');
});

test('a rider not yet in force on the treatment date is ignored', () => {
  const a = assess({
    claim: cruciateClaim({ diagnosisCode: 'ORT-HALTA-HB-H' }),
    policy: bellaPolicy({
      riders: [{ id: 'r', description: 'Lameness', diagnosisCodes: ['ORT-HALTA-HB-H'], validFrom: '2026-12-01' }],
    }),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: null,
    consumedBefore: 0,
  });
  assert.equal(a.rules.find((r) => r.code === 'RIDER')!.status, 'pass');
});

test('no policy in force gives rejection without calculation', () => {
  const a = assess({ claim: otitisClaim(), policy: null, rules: RULES_SE_DOG, openDeductiblePeriod: null, consumedBefore: 0 });
  assert.equal(a.calculation, null);
  assert.equal(a.proposedOutcome, 'rejected');
});

test('a small claim with no remarks is settled automatically', () => {
  const a = assess({ claim: otitisClaim(), policy: bellaPolicy(), rules: RULES_SE_DOG, openDeductiblePeriod: null, consumedBefore: 0 });
  assert.equal(a.mode, 'auto');
  assert.equal(a.proposedOutcome, 'approved');
  assert.equal(a.calculation!.payout, 150_000);
});

test('inputHash is deterministic and changes when the basis changes', () => {
  const input = { claim: otitisClaim(), policy: bellaPolicy(), rules: RULES_SE_DOG, openDeductiblePeriod: null, consumedBefore: 0 };
  assert.equal(assess(input).inputHash, assess(structuredClone(input)).inputHash);
  assert.notEqual(assess(input).inputHash, assess({ ...input, consumedBefore: 1 }).inputHash);
});

test('variable deductible is rounded half up to whole minor units', () => {
  const a = assess({
    claim: otitisClaim({ lines: [{ id: 'l', description: 'x', category: 'examination', amount: 200_002 }] }),
    policy: bellaPolicy(),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: null,
    consumedBefore: 0,
  });
  // 2 minor units after the fixed deductible, 25 % = 0.5, rounded to 1
  assert.equal(a.calculation!.deductibleVariable, 1);
  assert.equal(a.calculation!.payout, 1);
});

test('an invalid claim is stopped', () => {
  assert.throws(() =>
    assess({
      claim: otitisClaim({ lines: [{ id: 'l', description: 'x', category: 'examination', amount: 10.5 }] }),
      policy: bellaPolicy(),
      rules: RULES_SE_DOG,
      openDeductiblePeriod: null,
      consumedBefore: 0,
    }),
  );
});

// ---------------------------------------------------------------------------
// European markets: same engine, different configuration
// ---------------------------------------------------------------------------

const { eurPolicy, eurClaim, RULES_EUR_EXAMPLE } = fixtures;

test('EUR market: deductible per claim, age steps and VAT not reimbursed', () => {
  const a = assess({ claim: eurClaim(), policy: eurPolicy(), rules: RULES_EUR_EXAMPLE, openDeductiblePeriod: null, consumedBefore: 0 });
  const c = a.calculation!;
  assert.equal(c.currency, 'EUR');
  assert.equal(c.billed, 35_700);
  assert.equal(c.vatExcluded, 5_700);
  assert.equal(c.base, 30_000);
  assert.equal(c.deductibleFixed, 5_000);
  assert.equal(c.deductibleVariableBp, 3000); // the animal is 9 years old
  assert.equal(c.deductibleVariable, 7_500);
  assert.equal(c.payout, 17_500);
  assert.equal(a.proposedOutcome, 'partial');
  assert.equal(a.mode, 'auto');
});

test('a per-claim deductible is charged even with an open period', () => {
  const a = assess({
    claim: eurClaim(),
    policy: eurPolicy(),
    rules: RULES_EUR_EXAMPLE,
    openDeductiblePeriod: { id: 'x', animalId: 'ani_rex', diagnosisGroup: 'ora', validFrom: '2026-09-01', validTo: '2027-01-01', openedByClaimId: 'o' },
    consumedBefore: 0,
  });
  assert.equal(a.calculation!.deductibleFixed, 5_000);
  assert.equal(a.calculation!.opensDeductiblePeriod, false);
});

test('younger animals get the base variable deductible', () => {
  const a = assess({
    claim: eurClaim(),
    policy: eurPolicy({ animalBirthDate: '2020-01-01' }),
    rules: RULES_EUR_EXAMPLE,
    openDeductiblePeriod: null,
    consumedBefore: 0,
  });
  assert.equal(a.calculation!.deductibleVariableBp, 2000);
});

test('age is counted in whole years: the day before its birthday the animal is still 7', async () => {
  const { ageInYears } = await import('@petvold/claims-core');
  assert.equal(ageInYears('2018-10-03', '2026-10-02'), 7);
  assert.equal(ageInYears('2018-10-02', '2026-10-02'), 8);
});

test('claim and policy in different markets are stopped', () => {
  const a = assess({ claim: eurClaim({ market: 'SE', currency: 'SEK' }), policy: eurPolicy(), rules: RULES_EUR_EXAMPLE, openDeductiblePeriod: null, consumedBefore: 0 });
  assert.equal(a.rules.find((r) => r.code === 'MARKET_CURRENCY')!.status, 'fail');
  assert.equal(a.calculation, null);
});

test('a currency that does not match the policy is stopped, never converted', () => {
  const a = assess({ claim: eurClaim({ currency: 'SEK' }), policy: eurPolicy(), rules: RULES_EUR_EXAMPLE, openDeductiblePeriod: null, consumedBefore: 0 });
  assert.equal(a.rules.find((r) => r.code === 'MARKET_CURRENCY')!.reason, 'currency.mismatch');
});

test('rule outcomes have keys and parameters, no finished text', () => {
  const a = assess({ claim: cruciateClaim(), policy: bellaPolicy(), rules: RULES_SE_DOG, openDeductiblePeriod: null, consumedBefore: 0 });
  const rider = a.rules.find((r) => r.code === 'RIDER')!;
  assert.equal(rider.reason, 'rider.possible');
  assert.equal(rider.params.description, 'Lameness, right hind leg');
  assert.ok(!('message' in rider));
});
