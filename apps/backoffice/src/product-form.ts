/**
 * Products and claims rules as forms instead of JSON (ADR 0021, 0023): the
 * content becomes fields a person can read, and the fields become content
 * again. What the form does not show (a product's documents, or fields a later
 * version adds) is kept from the content it started from. The API validates
 * everything again. Pure; tested with node:test.
 */
import { toMajorText } from './claim-form.ts';
import { toMinorUnits } from './settings-logic.ts';

type Labels = Record<string, string>;

export interface DeductibleForm {
  code: string;
  labels: Labels;
  /** In major units as typed. */
  fixed: string;
  fixedPer: 'period' | 'claim' | 'policy_year';
  periodDays: string;
  periodEndsAtRenewal: boolean;
  /** In per cent as typed, e.g. "25". */
  variable: string;
  /** Higher variable deductible by age, e.g. "8: 35; 10: 45" (age in years: per cent). */
  byAge: string;
}

export interface ProductForm {
  market: string;
  currency: string;
  species: string[];
  names: Labels;
  ruleSeries: string;
  tariffSeries: string;
  priceTermsSeries: string;
  underwritingSeries: string;
  /** In major units, separated by semicolons, e.g. "30 000; 60 000". */
  annualLimits: string;
  defaultAnnualLimit: string;
  deductibles: DeductibleForm[];
  defaultDeductible: string;
  waitingPeriodDays: string;
  /** Policy settings; empty means the default. */
  policy: Record<PolicySetting, string> & { midTermCancellation: '' | 'term-end' | 'immediate' };
}

export const POLICY_SETTINGS = ['termMonths', 'renewalLeadDays', 'transferAcceptanceDays', 'applicationExpiryDays', 'maxStartAheadDays'] as const;
export type PolicySetting = (typeof POLICY_SETTINGS)[number];
export const POLICY_DEFAULTS: Record<PolicySetting, number> = { termMonths: 12, renewalLeadDays: 45, transferAcceptanceDays: 30, applicationExpiryDays: 30, maxStartAheadDays: 90 };

/** The languages a label is edited in: those it has, then Swedish and English. */
export const labelLanguages = (labels: Labels): string[] => [...new Set([...Object.keys(labels), 'sv', 'en'])];

const percent = (bp: number) => String(bp / 100);
const bpOf = (text: string): number | null => {
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp <= 10_000 ? bp : null;
};
const intOf = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);
const amounts = (text: string, currency: string): (number | null)[] =>
  text
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => toMinorUnits(x, currency));
const cleanLabels = (labels: Labels): Labels => Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));

type Content = Record<string, any>;

export function productFormFrom(c: Content): ProductForm {
  const v = c.vetCare ?? {};
  const currency = c.currency ?? 'SEK';
  const p = c.policy ?? {};
  return {
    market: c.market ?? '',
    currency,
    species: [...(c.species ?? [])],
    names: { ...(c.names ?? {}) },
    ruleSeries: c.ruleSeries ?? '',
    tariffSeries: c.tariffSeries ?? '',
    priceTermsSeries: c.priceTermsSeries ?? '',
    underwritingSeries: c.underwritingSeries ?? '',
    annualLimits: (v.annualLimits ?? []).map((m: number) => toMajorText(m, currency)).join('; '),
    defaultAnnualLimit: v.defaultAnnualLimit !== undefined ? toMajorText(v.defaultAnnualLimit, currency) : '',
    deductibles: (v.deductibles ?? []).map((d: Content) => ({
      code: d.code ?? '',
      labels: { ...(d.labels ?? {}) },
      fixed: d.terms?.fixed !== undefined ? toMajorText(d.terms.fixed, currency) : '',
      fixedPer: d.terms?.fixedPer ?? 'period',
      periodDays: d.terms?.periodDays !== undefined ? String(d.terms.periodDays) : '',
      periodEndsAtRenewal: !!d.terms?.periodEndsAtRenewal,
      variable: d.terms?.variableBp !== undefined ? percent(d.terms.variableBp) : '',
      byAge: (d.terms?.variableBpByAge ?? []).map((s: { fromAgeYears: number; bp: number }) => `${s.fromAgeYears}: ${percent(s.bp)}`).join('; '),
    })),
    defaultDeductible: v.defaultDeductible ?? '',
    waitingPeriodDays: v.waitingPeriodDays !== undefined ? String(v.waitingPeriodDays) : '',
    policy: {
      midTermCancellation: p.midTermCancellation ?? '',
      ...(Object.fromEntries(POLICY_SETTINGS.map((k) => [k, p[k] !== undefined ? String(p[k]) : ''])) as Record<PolicySetting, string>),
    },
  };
}

export const emptyDeductible = (): DeductibleForm => ({ code: '', labels: {}, fixed: '', fixedPer: 'period', periodDays: '', periodEndsAtRenewal: false, variable: '', byAge: '' });

function byAgeOf(text: string): { fromAgeYears: number; bp: number }[] | null {
  const parts = text.split(';').map((x) => x.trim()).filter(Boolean);
  const out: { fromAgeYears: number; bp: number }[] = [];
  for (const part of parts) {
    const m = /^(\d+)\s*:\s*(\d+(?:[.,]\d{1,2})?)$/.exec(part);
    const bp = m ? bpOf(m[2]!) : null;
    if (!m || bp === null || Number(m[1]) < 1) return null;
    out.push({ fromAgeYears: Number(m[1]), bp });
  }
  return out;
}

/** What is missing or wrong, as message ids. Empty: it may be saved. */
export function productFormProblems(f: ProductForm): string[] {
  const out = new Set<string>();
  if (!/^[A-Z]{2}$/.test(f.market.trim())) out.add('product.badMarket');
  if (!/^[A-Z]{3}$/.test(f.currency.trim())) out.add('product.badCurrency');
  if (!f.species.length) out.add('product.needSpecies');
  if (!Object.keys(cleanLabels(f.names)).length) out.add('product.needName');
  if (!/^[A-Z0-9][A-Z0-9-]{1,63}$/.test(f.ruleSeries.trim())) out.add('product.needRuleSeries');
  if (f.priceTermsSeries.trim() && !f.tariffSeries.trim()) out.add('product.priceTermsNeedTariff');
  const limits = amounts(f.annualLimits, f.currency);
  if (!limits.length || limits.some((x) => x === null)) out.add('product.badLimits');
  else if (!limits.includes(toMinorUnits(f.defaultAnnualLimit, f.currency))) out.add('product.badDefaultLimit');
  if (!f.deductibles.length) out.add('product.needDeductible');
  for (const d of f.deductibles) {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(d.code.trim()) || !Object.keys(cleanLabels(d.labels)).length) out.add('product.badDeductible');
    if (toMinorUnits(d.fixed, f.currency) === null || bpOf(d.variable) === null || byAgeOf(d.byAge) === null) out.add('product.badDeductible');
    if (d.fixedPer === 'period' && !(intOf(d.periodDays) ?? 0)) out.add('product.needPeriodDays');
  }
  const codes = f.deductibles.map((d) => d.code.trim());
  if (new Set(codes).size !== codes.length) out.add('product.duplicateDeductible');
  if (f.deductibles.length && !codes.includes(f.defaultDeductible)) out.add('product.badDefaultDeductible');
  if (intOf(f.waitingPeriodDays) === null) out.add('product.badWaiting');
  for (const k of POLICY_SETTINGS) if (f.policy[k].trim() && intOf(f.policy[k]) === null) out.add('product.badSetting');
  return [...out];
}

/** The content from the form, over the content it started from. Call only when productFormProblems is empty. */
export function productContentFrom(f: ProductForm, base: Content = {}): Content {
  const policy: Content = { ...(base.policy ?? {}) };
  if (f.policy.midTermCancellation) policy.midTermCancellation = f.policy.midTermCancellation;
  else delete policy.midTermCancellation;
  for (const k of POLICY_SETTINGS) {
    if (f.policy[k].trim()) policy[k] = intOf(f.policy[k]);
    else delete policy[k];
  }
  const series = (k: 'tariffSeries' | 'priceTermsSeries' | 'underwritingSeries', out: Content) => {
    if (f[k].trim()) out[k] = f[k].trim();
    else delete out[k];
  };
  const out: Content = {
    ...base,
    market: f.market.trim(),
    currency: f.currency.trim(),
    species: [...f.species],
    names: cleanLabels(f.names),
    ruleSeries: f.ruleSeries.trim(),
    vetCare: {
      ...(base.vetCare ?? {}),
      annualLimits: amounts(f.annualLimits, f.currency) as number[],
      defaultAnnualLimit: toMinorUnits(f.defaultAnnualLimit, f.currency),
      deductibles: f.deductibles.map((d) => {
        const byAge = byAgeOf(d.byAge)!;
        return {
          code: d.code.trim(),
          labels: cleanLabels(d.labels),
          terms: {
            fixed: toMinorUnits(d.fixed, f.currency),
            fixedPer: d.fixedPer,
            ...(d.fixedPer === 'period' ? { periodDays: intOf(d.periodDays) } : {}),
            ...(d.fixedPer === 'period' && d.periodEndsAtRenewal ? { periodEndsAtRenewal: true } : {}),
            variableBp: bpOf(d.variable),
            ...(byAge.length ? { variableBpByAge: byAge } : {}),
          },
        };
      }),
      defaultDeductible: f.defaultDeductible,
      waitingPeriodDays: intOf(f.waitingPeriodDays),
    },
  };
  series('tariffSeries', out);
  series('priceTermsSeries', out);
  series('underwritingSeries', out);
  if (Object.keys(policy).length) out.policy = policy;
  else delete out.policy;
  return out;
}

// Claims rules -----------------------------------------------------------------

export interface ClaimsRulesForm {
  market: string;
  vatReimbursable: boolean;
  /** Comma-separated categories. */
  nonReimbursable: string;
  /** One per line: CODE = group. */
  diagnosisGroups: string;
  /** In major units of the market's currency. */
  autoSettleMax: string;
  reminderAfterDays: string;
  expiresAfterDays: string;
}

/** Whether content is claims rules, which the form can edit. Tariffs, price terms and underwriting rules stay JSON. */
export const isClaimsRules = (c: unknown): boolean => typeof c === 'object' && c !== null && 'autoSettleMax' in c && 'diagnosisGroups' in c;

/** The rules hold amounts in the market's currency; every market Petvold knows has two decimals. */
const RULES_CURRENCY = 'EUR';

export function rulesFormFrom(c: Content): ClaimsRulesForm {
  return {
    market: c.market ?? '',
    vatReimbursable: !!c.vatReimbursable,
    nonReimbursable: (c.nonReimbursableCategories ?? []).join(', '),
    diagnosisGroups: Object.entries(c.diagnosisGroups ?? {})
      .map(([code, group]) => `${code} = ${group}`)
      .join('\n'),
    autoSettleMax: c.autoSettleMax !== undefined ? toMajorText(c.autoSettleMax, RULES_CURRENCY) : '',
    reminderAfterDays: c.informationRequest ? String(c.informationRequest.reminderAfterDays) : '',
    expiresAfterDays: c.informationRequest ? String(c.informationRequest.expiresAfterDays) : '',
  };
}

function groupsOf(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^([^=\s]+)\s*=\s*(\S.*)$/.exec(line);
    if (!m || out[m[1]!] !== undefined) return null;
    out[m[1]!] = m[2]!.trim();
  }
  return out;
}

export function rulesFormProblems(f: ClaimsRulesForm): string[] {
  const out: string[] = [];
  if (!/^[A-Z]{2}$/.test(f.market.trim())) out.push('product.badMarket');
  if (groupsOf(f.diagnosisGroups) === null) out.push('rules.badGroups');
  if (toMinorUnits(f.autoSettleMax, RULES_CURRENCY) === null) out.push('rules.badAutoSettle');
  const r = f.reminderAfterDays.trim();
  const e = f.expiresAfterDays.trim();
  const day = (x: string) => intOf(x) !== null && intOf(x)! >= 1 && intOf(x)! <= 365;
  if ((r || e) && !(day(r) && day(e))) out.push('rules.badInformationDays');
  return out;
}

export function rulesContentFrom(f: ClaimsRulesForm, base: Content = {}): Content {
  const out: Content = {
    ...base,
    market: f.market.trim(),
    vatReimbursable: f.vatReimbursable,
    nonReimbursableCategories: f.nonReimbursable
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    diagnosisGroups: groupsOf(f.diagnosisGroups),
    autoSettleMax: toMinorUnits(f.autoSettleMax, RULES_CURRENCY),
  };
  if (f.reminderAfterDays.trim()) out.informationRequest = { reminderAfterDays: intOf(f.reminderAfterDays), expiresAfterDays: intOf(f.expiresAfterDays) };
  else delete out.informationRequest;
  return out;
}
