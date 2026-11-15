/** Example data for tests and the dev server. Made up (ADR 0009). */
import type { TariffContent } from './index.ts';

/** A made-up Swedish dog tariff (ADR 0009). */
export const TARIFF: TariffContent = {
  market: 'SE',
  currency: 'SEK',
  basePremiums: [
    { species: 'dog', annualLimit: 3_000_000, amount: 240_000 },
    { species: 'dog', annualLimit: 6_000_000, amount: 300_000 },
  ],
  ageBands: [
    { species: 'dog', fromYears: 0, bp: 9_000 },
    { species: 'dog', fromYears: 3, bp: 10_000 },
    { species: 'dog', fromYears: 7, bp: 13_000 },
    { species: 'dog', fromYears: 10, bp: 16_000 },
  ],
  breedGroups: { 'dog-labrador-retriever': 'B', 'dog-bulldog': 'C' },
  defaultBreedGroup: 'A',
  breedGroupFactors: { A: 10_000, B: 11_000, C: 13_000 },
  deductibleFactors: { standard: 10_000, high: 8_500 },
  zones: { '1': 'city', '41': 'city', '411': 'centre' },
  defaultZone: 'rural',
  zoneFactors: { city: 11_500, centre: 12_000, rural: 9_500 },
  minimumAnnual: 120_000,
  roundTo: 100,
};
