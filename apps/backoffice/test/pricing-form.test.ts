import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICE_TERMS, TARIFF } from '../../../modules/pricing-core/src/fixtures.ts';
import {
  factorOf,
  isPriceTerms,
  isTariff,
  priceTermsContentFrom,
  priceTermsFormFrom,
  priceTermsFormProblems,
  tariffContentFrom,
  tariffFormFrom,
  tariffFormProblems,
} from '../src/pricing-form.ts';

test('a tariff becomes a form and the same content again', () => {
  const f = tariffFormFrom(TARIFF);
  assert.equal(f.basePremiums, 'dog; 30000; 2400\ndog; 60000; 3000');
  assert.equal(f.ageBands.split('\n')[2], 'dog; 7; 1.3');
  assert.equal(f.zoneFactors, 'city = 1.15\ncentre = 1.2\nrural = 0.95');
  assert.equal(f.roundTo, '1');
  assert.deepEqual(tariffFormProblems(f), []);
  assert.deepEqual(tariffContentFrom(f, TARIFF), TARIFF);
  assert.ok(isTariff(TARIFF) && !isTariff(PRICE_TERMS));
});

test('the tariff form says what is wrong', () => {
  const f = tariffFormFrom(TARIFF);
  assert.deepEqual(tariffFormProblems({ ...f, basePremiums: 'dog; 30000' }), ['tariff.badBase']);
  assert.deepEqual(tariffFormProblems({ ...f, ageBands: 'dog; 3; 0' }), ['tariff.badAgeBands']);
  assert.deepEqual(tariffFormProblems({ ...f, ageBands: 'dog; 3; 1' }), ['tariff.needAgeZero']);
  assert.deepEqual(tariffFormProblems({ ...f, defaultBreedGroup: 'D' }), ['tariff.groupWithoutFactor']);
  assert.deepEqual(tariffFormProblems({ ...f, zones: '41 = suburb' }), ['tariff.zoneWithoutFactor']);
  assert.deepEqual(tariffFormProblems({ ...f, zones: 'abc = city' }), ['tariff.badZones']);
  assert.deepEqual(tariffFormProblems({ ...f, deductibleFactors: '' }), ['tariff.badDeductibleFactors']);
  assert.deepEqual(tariffFormProblems({ ...f, roundTo: '0' }), ['tariff.badRoundTo']);
  assert.deepEqual(tariffFormProblems({ ...f, currency: 'kr' }), ['product.badCurrency']);
  assert.equal(factorOf('1,15'), 11_500);
  assert.equal(factorOf('0'), null);
});

test('price terms become a form and the same content again', () => {
  const f = priceTermsFormFrom(PRICE_TERMS);
  assert.equal(f.groupDiscounts, 'any; 2; 10\nlitter; 2; 15');
  assert.equal(f.campaigns, 'PUPPY2026; 2026-01-01; 2027-01-01; 20; new');
  assert.equal(f.maxTotalDiscount, '30');
  assert.deepEqual(priceTermsFormProblems(f), []);
  assert.deepEqual(priceTermsContentFrom(f, PRICE_TERMS), PRICE_TERMS);
  assert.ok(isPriceTerms(PRICE_TERMS) && !isPriceTerms(TARIFF));
});

test('the price terms form says what is wrong; a campaign may run without an end', () => {
  const f = priceTermsFormFrom(PRICE_TERMS);
  assert.deepEqual(priceTermsContentFrom({ ...f, campaigns: 'SPRING; 2026-03-01; ; 5; all' }).campaigns, [{ code: 'SPRING', validFrom: '2026-03-01', bp: 500, newPoliciesOnly: false }]);
  assert.deepEqual(priceTermsFormProblems({ ...f, groupDiscounts: 'family; 2; 10' }), ['terms.badGroupDiscounts']);
  assert.deepEqual(priceTermsFormProblems({ ...f, campaigns: 'puppy; 2026-01-01; ; 20; new' }), ['terms.badCampaigns']);
  assert.deepEqual(priceTermsFormProblems({ ...f, campaigns: 'A1; 2026-02-01; 2026-01-01; 20; new' }), ['terms.badCampaigns']);
  assert.deepEqual(priceTermsFormProblems({ ...f, maxTotalDiscount: '120' }), ['terms.badMax']);
});
