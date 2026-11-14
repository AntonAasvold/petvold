/**
 * Egenskapstester för ersättningsberäkningen. Varje egenskap ska gälla för
 * alla fakturor, självriskmodeller, försäkringsbelopp och åldrar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { calculate, type Claim, type ClaimLine, type ClaimsRules, type DeductiblePeriod, type VetCareTerms } from '@petvold/claims-core';
import { fixtures } from '@petvold/claims-store-memory';

const { bellaPolicy, cruciateClaim, RULES_SE_DOG } = fixtures;

const line: fc.Arbitrary<ClaimLine> = fc
  .record({
    amount: fc.integer({ min: 0, max: 5_000_000 }),
    vatPart: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: undefined }),
    category: fc.constantFrom('examination', 'surgery', 'medicine', 'food'),
  })
  .map(({ amount, vatPart, category }) => ({
    id: 'l',
    description: category,
    category,
    amount,
    ...(vatPart === undefined ? {} : { vat: Math.floor((amount * vatPart) / 10_000) }),
  }));

const terms: fc.Arbitrary<VetCareTerms> = fc.record({
  code: fc.constant('vet_care' as const),
  annualLimit: fc.integer({ min: 0, max: 20_000_000 }),
  waitingPeriodDays: fc.constant(20),
  deductible: fc.record({
    fixed: fc.integer({ min: 0, max: 500_000 }),
    fixedPer: fc.constantFrom('period' as const, 'claim' as const, 'policy_year' as const),
    periodDays: fc.constant(125),
    variableBp: fc.integer({ min: 0, max: 5_000 }),
    variableBpByAge: fc.option(
      fc.array(fc.record({ fromAgeYears: fc.integer({ min: 0, max: 15 }), bp: fc.integer({ min: 0, max: 10_000 }) }), { maxLength: 3 }),
      { nil: undefined },
    ),
  }),
});

const input = fc.record({
  lines: fc.array(line, { minLength: 1, maxLength: 8 }),
  terms,
  vatReimbursable: fc.boolean(),
  hasOpenPeriod: fc.boolean(),
  consumedBefore: fc.integer({ min: 0, max: 25_000_000 }),
  birthYear: fc.integer({ min: 2008, max: 2026 }),
});

type Input = typeof input extends fc.Arbitrary<infer T> ? T : never;

function run(i: Input) {
  const claim: Claim = { ...cruciateClaim(), lines: i.lines.map((l, n) => ({ ...l, id: `l${n}` })) };
  const policy = bellaPolicy({ animalBirthDate: `${i.birthYear}-01-15`, vetCare: i.terms });
  const rules: ClaimsRules = { ...RULES_SE_DOG, vatReimbursable: i.vatReimbursable };
  const period: DeductiblePeriod | null = i.hasOpenPeriod
    ? { id: 'dp', animalId: claim.animalId, diagnosisGroup: 'ortopedi-bakben', validFrom: '2026-10-01', validTo: '2027-02-03', openedByClaimId: 'clm_x' }
    : null;
  return calculate(claim, policy, i.terms, rules, period, i.consumedBefore);
}

test('egenskap: ersättning och kundens andel summerar till fakturerat', () => {
  fc.assert(
    fc.property(input, (i) => {
      const c = run(i);
      assert.equal(c.payout + c.customerShare, c.billed);
    }),
  );
});

test('egenskap: beloppen krymper steg för steg och blir aldrig negativa', () => {
  fc.assert(
    fc.property(input, (i) => {
      const c = run(i);
      assert.ok(c.billed >= c.base, 'underlag ≤ fakturerat');
      assert.ok(c.base >= c.payableBeforeLimit, 'före tak ≤ underlag');
      assert.ok(c.payableBeforeLimit >= c.payout, 'ersättning ≤ före tak');
      assert.ok(c.payout >= 0 && c.base >= 0 && c.deductibleVariable >= 0);
    }),
  );
});

test('egenskap: ersättningen överstiger aldrig återstående försäkringsbelopp', () => {
  fc.assert(
    fc.property(input, (i) => {
      const c = run(i);
      assert.ok(c.payout <= Math.max(0, i.terms.annualLimit - i.consumedBefore));
      assert.equal(c.cappedByLimit, c.payout < c.payableBeforeLimit);
    }),
  );
});

test('egenskap: fast självrisk tas högst en gång och aldrig inom öppen period', () => {
  fc.assert(
    fc.property(input, (i) => {
      const c = run(i);
      assert.ok(c.deductibleFixed <= i.terms.deductible.fixed);
      if (i.hasOpenPeriod && i.terms.deductible.fixedPer !== 'claim') assert.equal(c.deductibleFixed, 0);
    }),
  );
});

test('egenskap: mer förbrukat belopp ger aldrig högre ersättning', () => {
  fc.assert(
    fc.property(input, fc.integer({ min: 0, max: 5_000_000 }), (i, extra) => {
      assert.ok(run({ ...i, consumedBefore: i.consumedBefore + extra }).payout <= run(i).payout);
    }),
  );
});

test('egenskap: en rad som inte ersätts ändrar inte ersättningen', () => {
  fc.assert(
    fc.property(input, fc.integer({ min: 0, max: 1_000_000 }), (i, food) => {
      const withFood = { ...i, lines: [...i.lines, { id: 'x', description: 'foder', category: 'food', amount: food }] };
      assert.equal(run(withFood).payout, run(i).payout);
    }),
  );
});
