/**
 * The tariff (ADR 0030): what an insurance costs, as a pure function of a
 * versioned tariff and the facts about the animal, the choices and the place.
 *
 * No I/O, no framework, no text for users. All arithmetic is in integers: the
 * base premium is multiplied by the factors in basis points with BigInt and
 * rounded once, half up. Every step is in the breakdown, so a price can be
 * explained and recomputed like a claims decision (ADR 0018).
 */
import { createHash } from 'node:crypto';

export type ISODate = string;

/** The calculation models a tariff version can have. */
export const TARIFF_MODELS = ['tariff.v1'] as const;

/** Basis points: 10 000 = a factor of 1.0. */
export type BasisPoints = number;

/** What a tariff author writes. Amounts in minor units of `currency`, for a year. */
export interface TariffContent {
  market: string;
  currency: string;
  /** The yearly base premium per species and annual limit. */
  basePremiums: { species: string; annualLimit: number; amount: number }[];
  /** Per species: the factor from an age in whole years on the term's first day. The highest fromYears not above the age applies. */
  ageBands: { species: string; fromYears: number; bp: BasisPoints }[];
  /** Breed code -> risk group. A breed that is missing or unknown gets defaultBreedGroup. */
  breedGroups: Record<string, string>;
  defaultBreedGroup: string;
  /** Risk group -> factor. */
  breedGroupFactors: Record<string, BasisPoints>;
  /** Deductible option code (from the product) -> factor. */
  deductibleFactors: Record<string, BasisPoints>;
  /** Postal code prefix -> zone. The longest matching prefix applies; none gives defaultZone. */
  zones: Record<string, string>;
  defaultZone: string;
  /** Zone -> factor. */
  zoneFactors: Record<string, BasisPoints>;
  /** The lowest yearly premium, before rounding. */
  minimumAnnual: number;
  /** The yearly premium is rounded half up to a multiple of this, e.g. 100 for whole kronor. */
  roundTo: number;
}

/** Which tariff version priced it, for the evidence. */
export interface TariffRef {
  series: string;
  version: number;
  checksum: string;
}

export interface PriceInput {
  market: string;
  species: string;
  /** Omitted: unknown breed. */
  breed?: string;
  birthDate: ISODate;
  /** The term's first day. */
  startDate: ISODate;
  /** The term's last day, exclusive. */
  endDate: ISODate;
  annualLimit: number;
  deductibleOption: string;
  /** The policyholder's postal code. Only the zone is kept (ADR 0030). Omitted: the default zone. */
  postalCode?: string;
}

export interface PriceStep {
  code: 'base' | 'age' | 'breed-group' | 'deductible' | 'zone' | 'minimum' | 'rounding' | 'term';
  /** For a factor, its basis points; for an amount, minor units. */
  value: number;
  /** e.g. the age, the breed group or the zone the factor came from. */
  basis?: string | number;
  /** The amount after the step, in minor units. */
  amount: number;
}

export interface PriceResult {
  currency: string;
  /** The yearly premium at these facts and choices. */
  annualPremium: number;
  /** The premium for the term: the yearly premium per day of a year. */
  termPremium: number;
  breakdown: PriceStep[];
  /** What the price depended on, without the postal code: only its zone. */
  facts: { ageYears: number; breedGroup: string; zone: string; termDays: number; yearDays: number };
  tariff?: TariffRef;
  /** sha256 over the tariff reference and the facts; the same price gives the same hash. */
  inputHash: string;
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole years from birth to the date. Pure. */
export function ageInYears(birthDate: ISODate, onDate: ISODate): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [y, m, d] = onDate.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

const days = (from: ISODate, to: ISODate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function addYear(date: ISODate): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/** a / b rounded half up, for non-negative integers. */
function divRound(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (b * 2n);
}

/** The zone for a postal code: the longest matching prefix, else the default. Pure. */
export function zoneFor(t: Pick<TariffContent, 'zones' | 'defaultZone'>, postalCode: string | undefined): string {
  const code = (postalCode ?? '').replace(/\s+/g, '').toUpperCase();
  let best: string | undefined;
  for (const prefix of Object.keys(t.zones)) {
    if (code.startsWith(prefix) && (!best || prefix.length > best.length)) best = prefix;
  }
  return best ? t.zones[best]! : t.defaultZone;
}

/**
 * The price for the facts with the tariff (ADR 0030). Throws PricingError when
 * the tariff has no price for them, e.g. an annual limit it does not cover.
 */
export function price(tariff: { content: TariffContent; ref?: TariffRef }, input: PriceInput): PriceResult {
  const t = tariff.content;
  if (input.market !== t.market) throw new PricingError(`The tariff is for ${t.market}, not ${input.market}`);
  for (const d of [input.birthDate, input.startDate, input.endDate]) if (!DATE.test(d)) throw new PricingError('Dates are YYYY-MM-DD');
  if (input.endDate <= input.startDate) throw new PricingError('The term must end after it starts');
  const base = t.basePremiums.find((b) => b.species === input.species && b.annualLimit === input.annualLimit);
  if (!base) throw new PricingError(`The tariff has no base premium for ${input.species} with annual limit ${input.annualLimit}`);
  const ageYears = ageInYears(input.birthDate, input.startDate);
  if (ageYears < 0) throw new PricingError('The animal is not born on the start date');
  const band = t.ageBands
    .filter((a) => a.species === input.species && a.fromYears <= ageYears)
    .sort((a, b) => b.fromYears - a.fromYears)[0];
  if (!band) throw new PricingError(`The tariff has no age band for a ${input.species} of ${ageYears} years`);
  const breedGroup = (input.breed && t.breedGroups[input.breed]) || t.defaultBreedGroup;
  const breedBp = t.breedGroupFactors[breedGroup];
  if (breedBp === undefined) throw new PricingError(`The tariff has no factor for breed group ${breedGroup}`);
  const deductibleBp = t.deductibleFactors[input.deductibleOption];
  if (deductibleBp === undefined) throw new PricingError(`The tariff has no factor for deductible ${input.deductibleOption}`);
  const zone = zoneFor(t, input.postalCode);
  const zoneBp = t.zoneFactors[zone];
  if (zoneBp === undefined) throw new PricingError(`The tariff has no factor for zone ${zone}`);

  const breakdown: PriceStep[] = [{ code: 'base', value: base.amount, amount: base.amount }];
  let numerator = BigInt(base.amount);
  let denominator = 1n;
  const factor = (code: PriceStep['code'], bp: number, basis: string | number) => {
    numerator *= BigInt(bp);
    denominator *= 10_000n;
    breakdown.push({ code, value: bp, basis, amount: Number(divRound(numerator, denominator)) });
  };
  factor('age', band.bp, ageYears);
  factor('breed-group', breedBp, breedGroup);
  factor('deductible', deductibleBp, input.deductibleOption);
  factor('zone', zoneBp, zone);
  let annual = Number(divRound(numerator, denominator));
  if (annual < t.minimumAnnual) {
    annual = t.minimumAnnual;
    breakdown.push({ code: 'minimum', value: t.minimumAnnual, amount: annual });
  }
  const rounded = Number(divRound(BigInt(annual), BigInt(t.roundTo))) * t.roundTo;
  if (rounded !== annual) breakdown.push({ code: 'rounding', value: t.roundTo, amount: rounded });
  annual = rounded;

  const termDays = days(input.startDate, input.endDate);
  const yearDays = days(input.startDate, addYear(input.startDate));
  const termPremium = Number(divRound(BigInt(annual) * BigInt(termDays), BigInt(yearDays)));
  breakdown.push({ code: 'term', value: termDays, basis: yearDays, amount: termPremium });

  const facts = { ageYears, breedGroup, zone, termDays, yearDays };
  const hashed = {
    tariff: tariff.ref ?? null,
    market: input.market,
    species: input.species,
    annualLimit: input.annualLimit,
    deductibleOption: input.deductibleOption,
    facts,
  };
  return {
    currency: t.currency,
    annualPremium: annual,
    termPremium,
    breakdown,
    facts,
    ...(tariff.ref ? { tariff: tariff.ref } : {}),
    inputHash: createHash('sha256').update(canonicalJson(hashed)).digest('hex'),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** What is wrong with a tariff, if anything. Empty: valid. Pure. */
export function validateTariff(c: TariffContent): string[] {
  const errors: string[] = [];
  const fail = (m: string) => errors.push(m);
  const amount = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
  const bp = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= 1_000_000;
  if (!c || typeof c !== 'object') return ['The tariff must be an object'];
  if (!/^[A-Z]{2}$/.test(c.market ?? '')) fail(`Invalid market '${c.market}'`);
  if (!/^[A-Z]{3}$/.test(c.currency ?? '')) fail(`Invalid currency '${c.currency}'`);
  if (!Array.isArray(c.basePremiums) || c.basePremiums.length === 0) fail('At least one base premium is required');
  const seen = new Set<string>();
  for (const b of c.basePremiums ?? []) {
    if (!b.species || !amount(b.annualLimit) || !amount(b.amount)) fail('A base premium needs species, annualLimit and amount');
    const key = `${b.species}:${b.annualLimit}`;
    if (seen.has(key)) fail(`The base premium for ${b.species} and ${b.annualLimit} is listed twice`);
    seen.add(key);
  }
  for (const species of new Set((c.basePremiums ?? []).map((b) => b.species))) {
    if (!(c.ageBands ?? []).some((a) => a.species === species && a.fromYears === 0)) fail(`The age bands for ${species} must start at 0 years`);
  }
  for (const a of c.ageBands ?? []) if (!Number.isSafeInteger(a.fromYears) || a.fromYears < 0 || !bp(a.bp)) fail('An age band needs fromYears and a factor');
  const factors = (name: string, map: Record<string, number> | undefined) => {
    if (!map || typeof map !== 'object' || Object.keys(map).length === 0) fail(`${name} needs at least one factor`);
    for (const [k, v] of Object.entries(map ?? {})) if (!bp(v)) fail(`${name}: the factor for '${k}' must be 1-1 000 000 basis points`);
  };
  factors('breedGroupFactors', c.breedGroupFactors);
  factors('deductibleFactors', c.deductibleFactors);
  factors('zoneFactors', c.zoneFactors);
  if (c.breedGroupFactors?.[c.defaultBreedGroup] === undefined) fail('defaultBreedGroup must have a factor');
  for (const [breed, g] of Object.entries(c.breedGroups ?? {})) if (c.breedGroupFactors?.[g] === undefined) fail(`The breed ${breed} has a group without a factor: ${g}`);
  if (c.zoneFactors?.[c.defaultZone] === undefined) fail('defaultZone must have a factor');
  for (const [prefix, z] of Object.entries(c.zones ?? {})) {
    if (!/^[0-9A-Z]{1,10}$/.test(prefix)) fail(`Invalid postal code prefix '${prefix}'`);
    if (c.zoneFactors?.[z] === undefined) fail(`The prefix ${prefix} has a zone without a factor: ${z}`);
  }
  if (!amount(c.minimumAnnual)) fail('minimumAnnual must be a non-negative integer');
  if (!Number.isSafeInteger(c.roundTo) || c.roundTo < 1) fail('roundTo must be a positive integer');
  const known = new Set([
    'market', 'currency', 'basePremiums', 'ageBands', 'breedGroups', 'defaultBreedGroup', 'breedGroupFactors',
    'deductibleFactors', 'zones', 'defaultZone', 'zoneFactors', 'minimumAnnual', 'roundTo',
  ]);
  for (const k of Object.keys(c)) if (!known.has(k)) fail(`Unknown field '${k}' in the tariff`);
  return errors;
}
