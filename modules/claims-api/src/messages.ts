import type { Assessment, RuleResult } from '@petvold/claims-core';

/**
 * Språkfiler för regelutfall. Kärnan returnerar bara `reason` + `params`;
 * texten skapas här i kanten. Nytt språk = ny katalog, ingen ändring i kärnan.
 * `{name}` ersätts med params.name; `{name:money}` formateras som belopp.
 */
export type Locale = 'sv' | 'en';

const catalogs: Record<Locale, Record<string, string>> = {
  sv: {
    'policy.not_found': 'Ingen försäkring gällde {date}',
    'policy.found': 'Version {version} gällde {date}',
    'market.mismatch': 'Ärendet gäller marknad {claimMarket} men försäkringen {policyMarket}',
    'currency.mismatch': 'Ärendet är i {claimCurrency} men försäkringen i {policyCurrency}',
    'market.ok': 'Marknad {market}, valuta {currency}',
    'animal.mismatch': 'Djuret i ärendet är inte försäkrat på policyn',
    'policy.inactive': 'Försäkringen var inte aktiv på behandlingsdatumet',
    'policy.ends_during_treatment': 'Behandlingen fortsätter efter versionens slut ({validTo}); kontrollera senare version',
    'policy.active': 'Försäkringen var gällande på alla behandlingsdatum',
    'coverage.missing': 'Försäkringen saknar momentet veterinärvård',
    'coverage.ok': 'Momentet veterinärvård ingår',
    'waiting.within': 'Behandling inom karenstiden (slutar {endsOn})',
    'waiting.passed': 'Karenstiden har passerat',
    'diagnosis.unknown': 'Diagnoskoden {diagnosisCode} saknas i regelverket',
    'diagnosis.known': 'Diagnosgrupp {diagnosisGroup}',
    'rider.excluded': 'Undantaget av förbehåll: {description}',
    'rider.possible': 'Möjlig koppling till förbehåll: {description} (samma diagnosgrupp)',
    'rider.none': 'Inga förbehåll berör diagnosen',
    'limit.capped': 'Ersättningen begränsas av återstående försäkringsbelopp ({remaining:money})',
  },
  en: {
    'policy.not_found': 'No policy was in force on {date}',
    'policy.found': 'Version {version} was in force on {date}',
    'market.mismatch': 'Claim is for market {claimMarket} but the policy is {policyMarket}',
    'currency.mismatch': 'Claim is in {claimCurrency} but the policy is in {policyCurrency}',
    'market.ok': 'Market {market}, currency {currency}',
    'animal.mismatch': 'The animal on the claim is not insured on this policy',
    'policy.inactive': 'The policy was not active on the treatment date',
    'policy.ends_during_treatment': 'Treatment continues past the end of this version ({validTo}); check the next version',
    'policy.active': 'The policy was in force on all treatment dates',
    'coverage.missing': 'The policy has no vet care cover',
    'coverage.ok': 'Vet care cover included',
    'waiting.within': 'Treatment within the waiting period (ends {endsOn})',
    'waiting.passed': 'Waiting period has passed',
    'diagnosis.unknown': 'Diagnosis code {diagnosisCode} is not in the rule set',
    'diagnosis.known': 'Diagnosis group {diagnosisGroup}',
    'rider.excluded': 'Excluded by policy exclusion: {description}',
    'rider.possible': 'Possibly related to exclusion: {description} (same diagnosis group)',
    'rider.none': 'No exclusions apply to the diagnosis',
    'limit.capped': 'Payout limited by the remaining annual limit ({remaining:money})',
  },
};

const intlLocale: Record<Locale, string> = { sv: 'sv-SE', en: 'en-GB' };

/** Väljer språk ur Accept-Language. Standard: engelska. */
export function pickLocale(acceptLanguage: string | undefined): Locale {
  const wanted = (acceptLanguage ?? '')
    .split(',')
    .map((p) => p.trim().split(';')[0]!.toLowerCase().slice(0, 2));
  return (wanted.find((l) => l in catalogs) as Locale | undefined) ?? 'en';
}

export function formatMoney(minor: number, currency: string, locale: Locale): string {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(intlLocale[locale], { style: 'currency', currency }).format(minor / 10 ** digits);
}

export function renderRule(r: RuleResult, locale: Locale): string {
  const template = catalogs[locale][r.reason] ?? catalogs.en[r.reason] ?? r.reason;
  return template.replace(/\{(\w+)(?::(money))?\}/g, (_, key: string, kind?: string) => {
    const v = r.params[key];
    if (v === undefined) return `{${key}}`;
    if (kind === 'money' && typeof v === 'number') return formatMoney(v, String(r.params.currency ?? 'EUR'), locale);
    return String(v);
  });
}

export function localizeAssessment<T extends Assessment>(a: T, locale: Locale): T {
  return { ...a, rules: a.rules.map((r) => ({ ...r, message: renderRule(r, locale) })) };
}

/** Lägger på text för alla bedömningar i ett svar, oavsett nivå. */
export function localizeDeep<T>(value: T, locale: Locale): T {
  if (Array.isArray(value)) return value.map((v) => localizeDeep(v, locale)) as T;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.rules) && typeof o.inputHash === 'string') return localizeAssessment(o as unknown as Assessment, locale) as T;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, localizeDeep(v, locale)])) as T;
  }
  return value;
}

export const supportedLocales = Object.keys(catalogs) as Locale[];
export const messageKeys = (locale: Locale) => Object.keys(catalogs[locale]);
