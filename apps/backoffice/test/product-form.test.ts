import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyDeductible,
  isClaimsRules,
  labelLanguages,
  productContentFrom,
  productFormFrom,
  productFormProblems,
  rulesContentFrom,
  rulesFormFrom,
  rulesFormProblems,
} from '../src/product-form.ts';

const product = {
  market: 'SE',
  currency: 'SEK',
  species: ['dog'],
  names: { sv: 'Dog insurance (sv)', en: 'Dog insurance Life' },
  ruleSeries: 'SE-HUND-VV',
  tariffSeries: 'SE-HUND-TARIFF',
  vetCare: {
    annualLimits: [3_000_000, 6_000_000],
    defaultAnnualLimit: 6_000_000,
    deductibles: [
      { code: 'standard', labels: { sv: 'Standard' }, terms: { fixed: 200_000, fixedPer: 'period', periodDays: 125, variableBp: 2500, variableBpByAge: [{ fromAgeYears: 8, bp: 3550 }] } },
      { code: 'per-claim', labels: { sv: 'Per skada' }, terms: { fixed: 150_050, fixedPer: 'claim', variableBp: 0 } },
    ],
    defaultDeductible: 'standard',
    waitingPeriodDays: 30,
  },
  policy: { termMonths: 12, maxStartAheadDays: 60 },
  documents: [{ type: 'terms', language: 'sv', url: 'https://docs.example.test/t.pdf', sha256: 'a'.repeat(64) }],
};

test('a product goes through the form and back unchanged, with what the form does not show kept', () => {
  const f = productFormFrom(product);
  assert.equal(f.annualLimits, '30000; 60000');
  assert.equal(f.deductibles[0]!.byAge, '8: 35.5');
  assert.equal(f.deductibles[1]!.fixed, '1500.50');
  assert.deepEqual(productFormProblems(f), []);
  assert.deepEqual(productContentFrom(f, product), product);
});

test('a changed form gives the change, and empty settings and series are left out', () => {
  const f = productFormFrom(product);
  f.annualLimits = '30 000; 60 000; 90 000';
  f.policy.maxStartAheadDays = '';
  f.policy.termMonths = '';
  f.tariffSeries = '';
  f.deductibles[1] = { ...f.deductibles[1]!, fixedPer: 'policy_year', byAge: '10: 40; 12: 50' };
  const c = productContentFrom(f, product);
  assert.deepEqual(c.vetCare.annualLimits, [3_000_000, 6_000_000, 9_000_000]);
  assert.equal('policy' in c, false);
  assert.equal('tariffSeries' in c, false);
  assert.deepEqual(c.vetCare.deductibles[1].terms, { fixed: 150_050, fixedPer: 'policy_year', variableBp: 0, variableBpByAge: [{ fromAgeYears: 10, bp: 4000 }, { fromAgeYears: 12, bp: 5000 }] });
});

test('the form says what is missing or wrong before anything is sent', () => {
  const f = productFormFrom(product);
  f.market = 'se';
  f.species = [];
  f.annualLimits = '30 000; lots';
  f.deductibles.push(emptyDeductible());
  f.waitingPeriodDays = '-1';
  f.policy.renewalLeadDays = 'soon';
  f.priceTermsSeries = 'SE-HUND-PRICE';
  f.tariffSeries = '';
  assert.deepEqual(productFormProblems(f).sort(), [
    'product.badDeductible',
    'product.badLimits',
    'product.badMarket',
    'product.badSetting',
    'product.badWaiting',
    'product.needPeriodDays',
    'product.needSpecies',
    'product.priceTermsNeedTariff',
  ]);
  const g = productFormFrom(product);
  g.defaultAnnualLimit = '10000';
  g.defaultDeductible = 'none';
  g.deductibles[1]!.code = 'standard';
  assert.deepEqual(productFormProblems(g).sort(), ['product.badDefaultDeductible', 'product.badDefaultLimit', 'product.duplicateDeductible'].sort());
  assert.deepEqual(labelLanguages({ de: 'x' }), ['de', 'sv', 'en']);
});

test('claims rules go through the form and back, with the days for information requests', () => {
  const rules = { market: 'SE', vatReimbursable: false, nonReimbursableCategories: ['food'], diagnosisGroups: { 'ORA-OTIT': 'ora', 'ORT-KORSBAND-V': 'ortopedi-bakben' }, autoSettleMax: 1_000_000 };
  assert.equal(isClaimsRules(rules), true);
  assert.equal(isClaimsRules({ zones: [] }), false);
  const f = rulesFormFrom(rules);
  assert.equal(f.diagnosisGroups, 'ORA-OTIT = ora\nORT-KORSBAND-V = ortopedi-bakben');
  assert.deepEqual(rulesFormProblems(f), []);
  assert.deepEqual(rulesContentFrom(f, rules), rules);
  const withDays = rulesContentFrom({ ...f, reminderAfterDays: '10', expiresAfterDays: '21' }, rules);
  assert.deepEqual(withDays.informationRequest, { reminderAfterDays: 10, expiresAfterDays: 21 });
  assert.deepEqual(rulesFormProblems({ ...f, reminderAfterDays: '10', diagnosisGroups: 'ORA-OTIT ora', autoSettleMax: 'x' }).sort(), ['rules.badAutoSettle', 'rules.badGroups', 'rules.badInformationDays']);
});
