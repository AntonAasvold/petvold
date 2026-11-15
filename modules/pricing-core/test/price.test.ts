import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PricingError, ageInYears, price, tariffCoverage, validatePriceTerms, validateTariff, zoneFor, type PriceInput, type TariffContent } from '../src/index.ts';
import { PRICE_TERMS, TARIFF } from '../src/fixtures.ts';

const ref = { series: 'SE-HUND-TARIFF', version: 1, checksum: 'abc' };
const bella: PriceInput = {
  market: 'SE',
  species: 'dog',
  breed: 'dog-labrador-retriever',
  birthDate: '2019-03-14',
  startDate: '2026-04-01',
  endDate: '2027-04-01',
  annualLimit: 6_000_000,
  deductibleOption: 'standard',
  postalCode: '111 22',
};

test('Bella: 3 000 kr × 1.3 (age 7) × 1.1 (breed group B) × 1.0 × 1.15 (city) = 4 933.50, rounded to 4 934 kr', () => {
  const r = price({ content: TARIFF, ref }, bella);
  assert.deepEqual(r.breakdown.map((s) => [s.code, s.value, s.basis ?? null, s.amount]), [
    ['base', 300_000, null, 300_000],
    ['age', 13_000, 7, 390_000],
    ['breed-group', 11_000, 'B', 429_000],
    ['deductible', 10_000, 'standard', 429_000],
    ['zone', 11_500, 'city', 493_350],
    ['rounding', 100, null, 493_400],
    ['term', 365, 365, 493_400],
  ]);
  assert.deepEqual([r.annualPremium, r.termPremium, r.currency, r.tariff], [493_400, 493_400, 'SEK', ref]);
  assert.deepEqual(r.facts, { ageYears: 7, breedGroup: 'B', zone: 'city', termDays: 365, yearDays: 365, discountBp: 0 });
  assert.match(r.inputHash, /^[0-9a-f]{64}$/);
});

test('the same facts give the same hash; the postal code itself is not part of it', () => {
  const a = price({ content: TARIFF, ref }, bella);
  assert.equal(price({ content: TARIFF, ref }, { ...bella, postalCode: '11199' }).inputHash, a.inputHash); // same zone
  assert.notEqual(price({ content: TARIFF, ref }, { ...bella, postalCode: '41110' }).inputHash, a.inputHash);
  assert.notEqual(price({ content: TARIFF, ref: { ...ref, version: 2 } }, bella).inputHash, a.inputHash);
});

test('factors: unknown breed, the longest postal prefix, no postal code, higher deductible, a short term', () => {
  const unknown = price({ content: TARIFF }, { ...bella, breed: undefined, postalCode: undefined, deductibleOption: 'high' });
  assert.deepEqual([unknown.facts.breedGroup, unknown.facts.zone], ['A', 'rural']);
  // 300 000 × 1.3 × 1.0 × 0.85 × 0.95 = 314 925 -> 314 900
  assert.equal(unknown.annualPremium, 314_900);
  assert.equal(zoneFor(TARIFF, '411 05'), 'centre');
  assert.equal(zoneFor(TARIFF, '412 05'), 'city');
  // Half a year: 182 of 365 days.
  assert.equal(price({ content: TARIFF }, { ...bella, endDate: '2026-09-30' }).termPremium, Math.round((493_400 * 182) / 365));
});

test('the minimum premium, ages and refusals', () => {
  const puppy = price({ content: { ...TARIFF, minimumAnnual: 250_000 } }, { ...bella, annualLimit: 3_000_000, breed: undefined, birthDate: '2026-01-10', postalCode: '90000' });
  // 240 000 × 0.9 × 1.0 × 1.0 × 0.95 = 205 200, below the minimum 250 000.
  assert.deepEqual(puppy.breakdown.slice(-2).map((s) => [s.code, s.amount]), [['minimum', 250_000], ['term', 250_000]]);
  assert.equal(ageInYears('2019-03-14', '2026-03-13'), 6);
  assert.equal(ageInYears('2019-03-14', '2026-03-14'), 7);
  assert.throws(() => price({ content: TARIFF }, { ...bella, market: 'NO' }), PricingError);
  assert.throws(() => price({ content: TARIFF }, { ...bella, annualLimit: 1 }), /no base premium/);
  assert.throws(() => price({ content: TARIFF }, { ...bella, species: 'cat' }), /no base premium/);
  assert.throws(() => price({ content: TARIFF }, { ...bella, deductibleOption: 'low' }), /deductible low/);
  assert.throws(() => price({ content: TARIFF }, { ...bella, birthDate: '2027-01-01' }), /not born/);
  assert.throws(() => price({ content: TARIFF }, { ...bella, endDate: '2026-04-01' }), /end after/);
});

test('a tariff is checked before it is used', () => {
  assert.deepEqual(validateTariff(TARIFF), []);
  const broken = {
    ...TARIFF,
    market: 'se',
    ageBands: [{ species: 'dog', fromYears: 3, bp: 10_000 }],
    breedGroups: { x: 'Z' },
    zones: { 'a-b': 'city' },
    defaultZone: 'nowhere',
    roundTo: 0,
    extra: 1,
  } as unknown as TariffContent;
  const errors = validateTariff(broken);
  for (const m of [/market/, /start at 0 years/, /group without a factor: Z/, /prefix 'a-b'/, /defaultZone/, /roundTo/, /Unknown field 'extra'/]) {
    assert.ok(errors.some((e) => m.test(e)), `${m} in ${errors.join('; ')}`);
  }
});

test('coverage: what a tariff cannot price for a product', () => {
  const product = { market: 'SE', currency: 'SEK', species: ['dog'], annualLimits: [3_000_000, 6_000_000], deductibleOptions: ['standard', 'high'] };
  assert.deepEqual(tariffCoverage(TARIFF, product), []);
  assert.deepEqual(tariffCoverage(TARIFF, { ...product, species: ['dog', 'cat'], annualLimits: [6_000_000, 12_000_000], deductibleOptions: ['low'], currency: 'EUR' }), [
    'The tariff is in SEK, the product in EUR',
    'No base premium for dog with annual limit 12000000',
    'No base premium for cat with annual limit 6000000',
    'No base premium for cat with annual limit 12000000',
    'No age bands for cat',
    'No factor for deductible low',
  ]);
});

test('price terms after the base price: the best group discount, a campaign, the cap and the minimum (ADR 0030)', () => {
  const terms = { content: PRICE_TERMS, ref: { series: 'SE-HUND-TERMS', version: 1, checksum: 't' } };
  const plain = price({ content: TARIFF, ref }, bella);
  const none = price({ content: TARIFF, ref }, bella, terms);
  assert.deepEqual([none.basePremium, none.annualPremium, none.facts.discountBp], [493_400, 493_400, 0]);
  assert.notEqual(none.inputHash, plain.inputHash); // the terms version is part of the hash

  // Second animal in a litter: the litter discount (15 %) beats the general one (10 %).
  const second = price({ content: TARIFF, ref }, { ...bella, group: { kind: 'litter', memberNo: 2 } }, terms);
  assert.deepEqual(second.breakdown.slice(-3).map((s) => [s.code, s.value, s.amount]), [['group-discount', 1_500, 419_390], ['rounding', 100, 419_400], ['term', 365, 419_400]]);
  assert.equal(price({ content: TARIFF }, { ...bella, group: { kind: 'household', memberNo: 1 } }, terms).facts.discountBp, 0); // the first animal

  // A campaign as well: 15 % + 20 % = 35 %, capped at 30 %.
  const both = price({ content: TARIFF, ref }, { ...bella, group: { kind: 'litter', memberNo: 3 }, campaignCode: 'puppy2026' }, terms);
  assert.deepEqual(both.breakdown.filter((s) => ['group-discount', 'campaign', 'discount-cap'].includes(s.code)).map((s) => [s.code, s.value]), [['group-discount', 1_500], ['campaign', 2_000], ['discount-cap', 3_000]]);
  assert.equal(both.annualPremium, 345_400); // 493 400 × 0.7 = 345 380 -> 345 400
  assert.throws(() => price({ content: TARIFF }, { ...bella, campaignCode: 'PUPPY2026', newPolicy: false }, terms), /not valid/); // not at renewal
  assert.throws(() => price({ content: TARIFF }, { ...bella, startDate: '2027-02-01', endDate: '2028-02-01', campaignCode: 'PUPPY2026' }, terms), /not valid/);
  assert.throws(() => price({ content: TARIFF }, { ...bella, campaignCode: 'NOPE' }, terms), /NOPE/);

  // Never below the minimum premium.
  const cheap = price({ content: { ...TARIFF, minimumAnnual: 480_000 } }, { ...bella, group: { kind: 'litter', memberNo: 2 } }, terms);
  assert.equal(cheap.annualPremium, 480_000);
  assert.throws(() => price({ content: TARIFF }, bella, { content: { ...PRICE_TERMS, currency: 'EUR' } }), /another market or currency/);
});

test('price terms are checked before they are used', () => {
  assert.deepEqual(validatePriceTerms(PRICE_TERMS), []);
  const errors = validatePriceTerms({
    ...PRICE_TERMS,
    groupDiscounts: [{ kind: 'friends' as never, fromMember: 0, bp: 20_000 }],
    campaigns: [{ code: 'x', validFrom: '2026-01-01', validTo: '2025-01-01', bp: 100, newPoliciesOnly: true }],
    maxTotalDiscountBp: -1,
  });
  for (const m of [/group kind 'friends'/, /fromMember/, /group discount/, /campaign code 'x'/, /validTo after/, /maxTotalDiscountBp/]) {
    assert.ok(errors.some((e) => m.test(e)), `${m} in ${errors.join('; ')}`);
  }
});
