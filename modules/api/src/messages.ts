import type { Assessment, DecisionExplanation, Reason } from '@petvold/claims-core';

/**
 * Message catalogues for rule outcomes. The core returns only `reason` + `params`;
 * the text is produced here at the edge. New language = new catalogue, no change in the core.
 * `{name}` is replaced by params.name; `{name:money}` is formatted as an amount.
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
    'routing.rule_review': 'Regeln {code} kräver att en handläggare granskar',
    'routing.rule_fail': 'Regeln {code} är inte uppfylld',
    'routing.proposal_rejected': 'Förslaget är avslag, och avslag beslutas av en handläggare',
    'routing.above_auto_limit': 'Ersättningen {payout:money} är över gränsen för automatisk reglering, {limit:money}',
    'decision.approved': 'Ersättning beviljas med hela beloppet efter självrisk, {payout:money}',
    'decision.partial': 'Ersättning beviljas delvis med {payout:money}',
    'decision.nothing_payable': 'Inget att ersätta: hela beloppet ryms inom självrisken eller ersätts inte',
    'deviation.pre_existing_condition': 'Handläggaren avslog ersättningen: besväret fanns före försäkringens början',
    'deviation.not_covered': 'Handläggaren avslog ersättningen: kostnaden omfattas inte av försäkringen',
    'deviation.insufficient_documentation': 'Handläggaren avslog ersättningen: underlaget räcker inte för att bedöma skadan',
    'deviation.incorrect_invoice': 'Handläggaren avslog ersättningen: fakturan är felaktig',
    'deviation.other': 'Handläggaren avslog ersättningen, se motiveringen',
    'step.billed': 'Fakturerat belopp',
    'step.non_reimbursable': 'Kostnader som inte ersätts, till exempel foder',
    'step.vat_excluded': 'Moms som inte ersätts',
    'step.deductible_fixed': 'Fast självrisk',
    'step.deductible_fixed_in_period': 'Ingen fast självrisk: den är redan betald i självriskperioden {validFrom} till {validTo}',
    'step.deductible_variable': 'Rörlig självrisk, {percent} %',
    'step.limit_capped': 'Begränsning till återstående försäkringsbelopp ({remaining:money})',
    'step.payout': 'Ersättning',
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
    'routing.rule_review': 'The rule {code} asks for a claims handler to review',
    'routing.rule_fail': 'The rule {code} is not met',
    'routing.proposal_rejected': 'The proposal is to reject, and a claims handler decides a rejection',
    'routing.above_auto_limit': 'The payout {payout:money} is above the limit for automatic settlement, {limit:money}',
    'decision.approved': 'Approved in full after the deductible, {payout:money}',
    'decision.partial': 'Approved in part, {payout:money}',
    'decision.nothing_payable': 'Nothing to pay: the whole amount falls within the deductible or is not reimbursed',
    'deviation.pre_existing_condition': 'The claims handler rejected the claim: the condition existed before the policy started',
    'deviation.not_covered': 'The claims handler rejected the claim: the cost is not covered by the policy',
    'deviation.insufficient_documentation': 'The claims handler rejected the claim: the documentation is not enough to assess the claim',
    'deviation.incorrect_invoice': 'The claims handler rejected the claim: the invoice is incorrect',
    'deviation.other': 'The claims handler rejected the claim, see the motivation',
    'step.billed': 'Amount billed',
    'step.non_reimbursable': 'Costs that are not reimbursed, such as food',
    'step.vat_excluded': 'VAT that is not reimbursed',
    'step.deductible_fixed': 'Fixed deductible',
    'step.deductible_fixed_in_period': 'No fixed deductible: already paid in the deductible period {validFrom} to {validTo}',
    'step.deductible_variable': 'Variable deductible, {percent} %',
    'step.limit_capped': 'Limited to the remaining annual limit ({remaining:money})',
    'step.payout': 'Payout',
  },
};

const intlLocale: Record<Locale, string> = { sv: 'sv-SE', en: 'en-GB' };

/** Picks the language from Accept-Language. Default: English. */
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

/** Renders a reason key with its params, e.g. a rule outcome or an explanation step. */
export function renderRule(r: Reason, locale: Locale): string {
  const template = catalogs[locale][r.reason] ?? catalogs.en[r.reason] ?? r.reason;
  return template.replace(/\{(\w+)(?::(money))?\}/g, (_, key: string, kind?: string) => {
    const v = r.params[key];
    if (v === undefined) return `{${key}}`;
    if (kind === 'money' && typeof v === 'number') return formatMoney(v, String(r.params.currency ?? 'EUR'), locale);
    return String(v);
  });
}

export function localizeAssessment<T extends Assessment>(a: T, locale: Locale): T {
  const routing = (a as { routing?: { mode: string; reasons: Reason[] } }).routing;
  return {
    ...a,
    rules: a.rules.map((r) => ({ ...r, message: renderRule(r, locale) })),
    ...(routing ? { routing: { ...routing, reasons: routing.reasons.map((r) => ({ ...r, message: renderRule(r, locale) })) } } : {}),
  };
}

/** Adds text to every part of a decision explanation. */
export function localizeExplanation(e: DecisionExplanation, locale: Locale) {
  const withText = <T extends Reason>(r: T) => ({ ...r, message: renderRule(r, locale) });
  return {
    ...e,
    mainReason: withText(e.mainReason),
    rules: e.rules.map(withText),
    steps: e.steps.map(withText),
    ...(e.deviation
      ? { deviation: { ...e.deviation, message: renderRule({ reason: `deviation.${e.deviation.reasonCode}`, params: {} }, locale) } }
      : {}),
  };
}

/** Adds text to every assessment in a response, at any depth. */
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
