/**
 * Tariffs and price terms as forms instead of JSON (ADR 0030). Amounts are in
 * major units, factors as decimals (1.15 for 11 500 basis points), discounts
 * in per cent, and tables one row per line. What the form does not show is
 * kept from the content it started from. The API validates everything again.
 * Pure; tested with node:test.
 */
import { toMajorText } from './claim-form.ts';
import { toMinorUnits } from './settings-logic.ts';

type Content = Record<string, any>;

export interface TariffForm {
  market: string;
  currency: string;
  /** species; annual limit; premium per line, amounts in major units. */
  basePremiums: string;
  /** species; from age in years; factor per line. */
  ageBands: string;
  /** breed = group per line. */
  breedGroups: string;
  defaultBreedGroup: string;
  /** group = factor per line. */
  breedGroupFactors: string;
  /** deductible = factor per line. */
  deductibleFactors: string;
  /** postal code prefix = zone per line. */
  zones: string;
  defaultZone: string;
  /** zone = factor per line. */
  zoneFactors: string;
  minimumAnnual: string;
  roundTo: string;
}

export interface PriceTermsForm {
  market: string;
  currency: string;
  /** kind; from member; per cent per line. */
  groupDiscounts: string;
  /** code; from; to (or empty); per cent; new or all per line. */
  campaigns: string;
  maxTotalDiscount: string;
}

export const isTariff = (c: unknown): boolean => typeof c === 'object' && c !== null && 'basePremiums' in c && 'zoneFactors' in c;
export const isPriceTerms = (c: unknown): boolean => typeof c === 'object' && c !== null && 'groupDiscounts' in c && 'campaigns' in c;

/** 11 500 basis points as "1.15". */
export const factorText = (bp: number): string => String(bp / 10_000);
/** "1.15" or "1,15" as 11 500 basis points; at least 1. */
export function factorOf(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 10_000);
  return bp >= 1 ? bp : null;
}
/** "15" or "12,5" per cent as basis points, 0 to 100 %. */
export function percentOf(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp <= 10_000 ? bp : null;
}
const percentText = (bp: number) => String(bp / 100);
const intOf = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

/** Lines of fields separated by semicolons; empty lines left out. */
const rows = (text: string): string[][] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(';').map((x) => x.trim()));

/** key = value per line, each key once; null if a line is not. */
export function pairsOf(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^([^=\s]+)\s*=\s*(\S.*)$/.exec(line);
    if (!m || out[m[1]!] !== undefined) return null;
    out[m[1]!] = m[2]!.trim();
  }
  return out;
}
const pairsText = (o: Record<string, string | number> | undefined, show: (v: any) => string = String) =>
  Object.entries(o ?? {})
    .map(([k, v]) => `${k} = ${show(v)}`)
    .join('\n');

/** key = factor per line as basis points; null if any is not. */
function factorsOf(text: string): Record<string, number> | null {
  const p = pairsOf(text);
  if (!p) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p)) {
    const bp = factorOf(v);
    if (bp === null) return null;
    out[k] = bp;
  }
  return out;
}

function basePremiumsOf(text: string, currency: string) {
  const out: { species: string; annualLimit: number; amount: number }[] = [];
  for (const [species, limit, amount, ...rest] of rows(text)) {
    const annualLimit = toMinorUnits(limit ?? '', currency);
    const a = toMinorUnits(amount ?? '', currency);
    if (!species || annualLimit === null || a === null || rest.length) return null;
    out.push({ species, annualLimit, amount: a });
  }
  return out.length ? out : null;
}

function ageBandsOf(text: string) {
  const out: { species: string; fromYears: number; bp: number }[] = [];
  for (const [species, from, factor, ...rest] of rows(text)) {
    const fromYears = intOf(from ?? '');
    const bp = factorOf(factor ?? '');
    if (!species || fromYears === null || bp === null || rest.length) return null;
    out.push({ species, fromYears, bp });
  }
  return out;
}

export function tariffFormFrom(c: Content): TariffForm {
  const cur = c.currency ?? '';
  const money = (m: number | undefined) => (m === undefined || !cur ? '' : toMajorText(m, cur));
  return {
    market: c.market ?? '',
    currency: cur,
    basePremiums: (c.basePremiums ?? []).map((b: Content) => `${b.species}; ${money(b.annualLimit)}; ${money(b.amount)}`).join('\n'),
    ageBands: (c.ageBands ?? []).map((a: Content) => `${a.species}; ${a.fromYears}; ${factorText(a.bp)}`).join('\n'),
    breedGroups: pairsText(c.breedGroups),
    defaultBreedGroup: c.defaultBreedGroup ?? '',
    breedGroupFactors: pairsText(c.breedGroupFactors, factorText),
    deductibleFactors: pairsText(c.deductibleFactors, factorText),
    zones: pairsText(c.zones),
    defaultZone: c.defaultZone ?? '',
    zoneFactors: pairsText(c.zoneFactors, factorText),
    minimumAnnual: money(c.minimumAnnual),
    roundTo: money(c.roundTo),
  };
}

export function tariffFormProblems(f: TariffForm): string[] {
  const out: string[] = [];
  const cur = f.currency.trim();
  if (!/^[A-Z]{2}$/.test(f.market.trim())) out.push('product.badMarket');
  if (!/^[A-Z]{3}$/.test(cur)) return [...out, 'product.badCurrency'];
  const base = basePremiumsOf(f.basePremiums, cur);
  const bands = ageBandsOf(f.ageBands);
  if (!base) out.push('tariff.badBase');
  if (!bands) out.push('tariff.badAgeBands');
  else if (base && !base.every((b) => bands.some((a) => a.species === b.species && a.fromYears === 0))) out.push('tariff.needAgeZero');
  const groups = pairsOf(f.breedGroups);
  const groupFactors = factorsOf(f.breedGroupFactors);
  if (!groups || !groupFactors) out.push('tariff.badBreedGroups');
  else if (![...Object.values(groups), f.defaultBreedGroup.trim()].every((g) => g && groupFactors[g] !== undefined)) out.push('tariff.groupWithoutFactor');
  if (!factorsOf(f.deductibleFactors) || !Object.keys(factorsOf(f.deductibleFactors)!).length) out.push('tariff.badDeductibleFactors');
  const zones = pairsOf(f.zones);
  const zoneFactors = factorsOf(f.zoneFactors);
  if (!zones || !zoneFactors || !Object.keys(zones).every((p) => /^\d+$/.test(p))) out.push('tariff.badZones');
  else if (![...Object.values(zones), f.defaultZone.trim()].every((z) => z && zoneFactors[z] !== undefined)) out.push('tariff.zoneWithoutFactor');
  if (toMinorUnits(f.minimumAnnual, cur) === null) out.push('tariff.badMinimum');
  const r = toMinorUnits(f.roundTo, cur);
  if (r === null || r < 1) out.push('tariff.badRoundTo');
  return out;
}

export function tariffContentFrom(f: TariffForm, base: Content = {}): Content {
  const cur = f.currency.trim();
  return {
    ...base,
    market: f.market.trim(),
    currency: cur,
    basePremiums: basePremiumsOf(f.basePremiums, cur),
    ageBands: ageBandsOf(f.ageBands),
    breedGroups: pairsOf(f.breedGroups),
    defaultBreedGroup: f.defaultBreedGroup.trim(),
    breedGroupFactors: factorsOf(f.breedGroupFactors),
    deductibleFactors: factorsOf(f.deductibleFactors),
    zones: pairsOf(f.zones),
    defaultZone: f.defaultZone.trim(),
    zoneFactors: factorsOf(f.zoneFactors),
    minimumAnnual: toMinorUnits(f.minimumAnnual, cur),
    roundTo: toMinorUnits(f.roundTo, cur),
  };
}

const KINDS = ['litter', 'household', 'any'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function groupDiscountsOf(text: string) {
  const out: { kind: string; fromMember: number; bp: number }[] = [];
  for (const [kind, from, pct, ...rest] of rows(text)) {
    const fromMember = intOf(from ?? '');
    const bp = percentOf(pct ?? '');
    if (!KINDS.includes(kind ?? '') || fromMember === null || fromMember < 1 || bp === null || rest.length) return null;
    out.push({ kind: kind!, fromMember, bp });
  }
  return out;
}

function campaignsOf(text: string) {
  const out: Content[] = [];
  for (const [code, from, to, pct, who, ...rest] of rows(text)) {
    const bp = percentOf(pct ?? '');
    if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(code ?? '') || !DAY.test(from ?? '') || (to && (!DAY.test(to) || to <= from!)) || bp === null || !['new', 'all'].includes(who ?? '') || rest.length) return null;
    if (out.some((c) => c.code === code)) return null;
    out.push({ code, validFrom: from, ...(to ? { validTo: to } : {}), bp, newPoliciesOnly: who === 'new' });
  }
  return out;
}

export function priceTermsFormFrom(c: Content): PriceTermsForm {
  return {
    market: c.market ?? '',
    currency: c.currency ?? '',
    groupDiscounts: (c.groupDiscounts ?? []).map((g: Content) => `${g.kind}; ${g.fromMember}; ${percentText(g.bp)}`).join('\n'),
    campaigns: (c.campaigns ?? []).map((k: Content) => `${k.code}; ${k.validFrom}; ${k.validTo ?? ''}; ${percentText(k.bp)}; ${k.newPoliciesOnly ? 'new' : 'all'}`).join('\n'),
    maxTotalDiscount: c.maxTotalDiscountBp !== undefined ? percentText(c.maxTotalDiscountBp) : '',
  };
}

export function priceTermsFormProblems(f: PriceTermsForm): string[] {
  const out: string[] = [];
  if (!/^[A-Z]{2}$/.test(f.market.trim())) out.push('product.badMarket');
  if (!/^[A-Z]{3}$/.test(f.currency.trim())) out.push('product.badCurrency');
  if (!groupDiscountsOf(f.groupDiscounts)) out.push('terms.badGroupDiscounts');
  if (!campaignsOf(f.campaigns)) out.push('terms.badCampaigns');
  if (percentOf(f.maxTotalDiscount) === null) out.push('terms.badMax');
  return out;
}

export function priceTermsContentFrom(f: PriceTermsForm, base: Content = {}): Content {
  return {
    ...base,
    market: f.market.trim(),
    currency: f.currency.trim(),
    groupDiscounts: groupDiscountsOf(f.groupDiscounts),
    campaigns: campaignsOf(f.campaigns),
    maxTotalDiscountBp: percentOf(f.maxTotalDiscount),
  };
}
