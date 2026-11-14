import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '@petvold/claims-core';
import { fixtures } from '@petvold/claims-store-memory';

const { bellaPolicy, cruciateClaim, otitisClaim, RULES_SE_DOG } = fixtures;

test('designexemplet: 18 640 kr fakturerat ger 12 165 kr i ersättning', () => {
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

test('designexemplet går till handläggare: förbehåll i samma diagnosgrupp och över gränsen för automatik', () => {
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
  assert.equal(a.proposedOutcome, 'partial'); // foder ersätts inte
});

test('öppen självriskperiod: ingen fast självrisk', () => {
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
  assert.equal(a.calculation!.deductibleVariable, 455_500); // 25 % av 18 220 kr
  assert.equal(a.calculation!.payout, 1_366_500);
});

test('försäkringsbeloppet sätter tak', () => {
  const a = assess({
    claim: cruciateClaim(),
    policy: bellaPolicy(),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: null,
    consumedBefore: 5_500_000, // 5 000 kr kvar
  });
  assert.equal(a.calculation!.payout, 500_000);
  assert.equal(a.calculation!.cappedByLimit, true);
  assert.ok(a.rules.some((r) => r.code === 'LIMIT' && r.status === 'info'));
});

test('slut på försäkringsbelopp ger avslag', () => {
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

test('behandling inom karenstiden avslås', () => {
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

test('diagnos som exakt matchar ett förbehåll undantas', () => {
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

test('förbehåll som ännu inte gällde på behandlingsdatumet ignoreras', () => {
  const a = assess({
    claim: cruciateClaim({ diagnosisCode: 'ORT-HALTA-HB-H' }),
    policy: bellaPolicy({
      riders: [{ id: 'r', description: 'Hälta', diagnosisCodes: ['ORT-HALTA-HB-H'], validFrom: '2026-12-01' }],
    }),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: null,
    consumedBefore: 0,
  });
  assert.equal(a.rules.find((r) => r.code === 'RIDER')!.status, 'pass');
});

test('ingen gällande försäkring ger avslag utan beräkning', () => {
  const a = assess({ claim: otitisClaim(), policy: null, rules: RULES_SE_DOG, openDeductiblePeriod: null, consumedBefore: 0 });
  assert.equal(a.calculation, null);
  assert.equal(a.proposedOutcome, 'rejected');
});

test('liten skada utan anmärkning regleras automatiskt', () => {
  const a = assess({ claim: otitisClaim(), policy: bellaPolicy(), rules: RULES_SE_DOG, openDeductiblePeriod: null, consumedBefore: 0 });
  assert.equal(a.mode, 'auto');
  assert.equal(a.proposedOutcome, 'approved');
  assert.equal(a.calculation!.payout, 150_000);
});

test('inputHash är deterministisk och ändras när underlaget ändras', () => {
  const input = { claim: otitisClaim(), policy: bellaPolicy(), rules: RULES_SE_DOG, openDeductiblePeriod: null, consumedBefore: 0 };
  assert.equal(assess(input).inputHash, assess(structuredClone(input)).inputHash);
  assert.notEqual(assess(input).inputHash, assess({ ...input, consumedBefore: 1 }).inputHash);
});

test('avrundning av rörlig självrisk sker halvt uppåt till hela ören', () => {
  const a = assess({
    claim: otitisClaim({ lines: [{ id: 'l', description: 'x', category: 'examination', amount: 200_002 }] }),
    policy: bellaPolicy(),
    rules: RULES_SE_DOG,
    openDeductiblePeriod: null,
    consumedBefore: 0,
  });
  // 2 öre efter fast självrisk, 25 % = 0,5 öre, avrundas till 1
  assert.equal(a.calculation!.deductibleVariable, 1);
  assert.equal(a.calculation!.payout, 1);
});

test('ogiltigt ärende stoppas', () => {
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
// Europeiska marknader: samma motor, annan konfiguration
// ---------------------------------------------------------------------------

const { eurPolicy, eurClaim, RULES_EUR_EXAMPLE } = fixtures;

test('EUR-marknad: självrisk per skada, ålderstrappa och moms som inte ersätts', () => {
  const a = assess({ claim: eurClaim(), policy: eurPolicy(), rules: RULES_EUR_EXAMPLE, openDeductiblePeriod: null, consumedBefore: 0 });
  const c = a.calculation!;
  assert.equal(c.currency, 'EUR');
  assert.equal(c.billed, 35_700);
  assert.equal(c.vatExcluded, 5_700);
  assert.equal(c.base, 30_000);
  assert.equal(c.deductibleFixed, 5_000);
  assert.equal(c.deductibleVariableBp, 3000); // djuret är 9 år
  assert.equal(c.deductibleVariable, 7_500);
  assert.equal(c.payout, 17_500);
  assert.equal(a.proposedOutcome, 'partial');
  assert.equal(a.mode, 'auto');
});

test('självrisk per skada tas även om det finns en öppen period', () => {
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

test('yngre djur får grundnivån på rörlig självrisk', () => {
  const a = assess({
    claim: eurClaim(),
    policy: eurPolicy({ animalBirthDate: '2020-01-01' }),
    rules: RULES_EUR_EXAMPLE,
    openDeductiblePeriod: null,
    consumedBefore: 0,
  });
  assert.equal(a.calculation!.deductibleVariableBp, 2000);
});

test('ålder räknas i hela år: dagen före födelsedagen är djuret fortfarande 7', async () => {
  const { ageInYears } = await import('@petvold/claims-core');
  assert.equal(ageInYears('2018-10-03', '2026-10-02'), 7);
  assert.equal(ageInYears('2018-10-02', '2026-10-02'), 8);
});

test('ärende och försäkring på olika marknader stoppas', () => {
  const a = assess({ claim: eurClaim({ market: 'SE', currency: 'SEK' }), policy: eurPolicy(), rules: RULES_EUR_EXAMPLE, openDeductiblePeriod: null, consumedBefore: 0 });
  assert.equal(a.rules.find((r) => r.code === 'MARKET_CURRENCY')!.status, 'fail');
  assert.equal(a.calculation, null);
});

test('valuta som inte matchar försäkringen stoppas, aldrig växling', () => {
  const a = assess({ claim: eurClaim({ currency: 'SEK' }), policy: eurPolicy(), rules: RULES_EUR_EXAMPLE, openDeductiblePeriod: null, consumedBefore: 0 });
  assert.equal(a.rules.find((r) => r.code === 'MARKET_CURRENCY')!.reason, 'currency.mismatch');
});

test('regelutfall har nycklar och parametrar, ingen färdig text', () => {
  const a = assess({ claim: cruciateClaim(), policy: bellaPolicy(), rules: RULES_SE_DOG, openDeductiblePeriod: null, consumedBefore: 0 });
  const rider = a.rules.find((r) => r.code === 'RIDER')!;
  assert.equal(rider.reason, 'rider.possible');
  assert.equal(rider.params.description, 'Hälta, höger bakben');
  assert.ok(!('message' in rider));
});
