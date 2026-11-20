/**
 * Registering a claim from the back office: the form, what is missing, and the
 * body for POST /v1/claims and /v1/claim-previews. The claim takes market,
 * currency and animal from the policy, so the handler cannot get them wrong.
 * Pure; tested with node:test. The API validates everything again.
 */
import { minorPerMajor, toMinorUnits } from './settings-logic.ts';

/** Line categories the sample rules know. The product's rules decide what is reimbursed. */
export const LINE_CATEGORIES = ['examination', 'diagnostics', 'medication', 'surgery', 'anaesthesia', 'hospitalisation', 'food'] as const;

export interface LineForm {
  /** The line's id on a stored claim, kept when it is corrected. */
  id?: string;
  /** A line's own diagnosis, kept when it is corrected; the form does not change it. */
  diagnosisCode?: string;
  description: string;
  category: string;
  /** In major units as typed, e.g. "1 250,50". */
  amount: string;
  vat: string;
}

export interface ClaimForm {
  channel: 'customer' | 'clinic_direct';
  treatmentFrom: string;
  treatmentTo: string;
  diagnosisCode: string;
  lines: LineForm[];
}

export interface PolicyFacts {
  id: string;
  market: string;
  animalId: string;
  currency: string;
}

export const emptyLine = (): LineForm => ({ description: '', category: 'examination', amount: '', vat: '' });

/** What is missing or wrong, as message ids. Empty: it may be sent. */
export function claimFormProblems(f: ClaimForm, policy: PolicyFacts | null, today: string): string[] {
  const out: string[] = [];
  if (!policy) out.push('register.needPolicy');
  if (!f.treatmentFrom || !f.treatmentTo) out.push('register.needDates');
  else if (f.treatmentTo < f.treatmentFrom) out.push('register.datesOrder');
  else if (f.treatmentFrom > today) out.push('register.future');
  if (!f.diagnosisCode.trim()) out.push('register.needDiagnosis');
  if (!f.lines.length) out.push('register.needLine');
  const currency = policy?.currency ?? 'SEK';
  f.lines.forEach((l) => {
    const amount = toMinorUnits(l.amount, currency);
    const vat = l.vat.trim() ? toMinorUnits(l.vat, currency) : 0;
    if (!l.description.trim() || amount === null || vat === null || (amount !== null && vat !== null && vat > amount)) {
      if (!out.includes('register.badLine')) out.push('register.badLine');
    }
  });
  return out;
}

/**
 * The body for POST /v1/claims (and /v1/claim-previews). Call only when
 * claimFormProblems is empty. No id or claim number: the server gives both
 * (ADR 0036).
 */
export function toClaimInput(f: ClaimForm, policy: PolicyFacts) {
  return {
    policyId: policy.id,
    animalId: policy.animalId,
    market: policy.market,
    currency: policy.currency,
    channel: f.channel,
    treatmentFrom: f.treatmentFrom,
    treatmentTo: f.treatmentTo,
    diagnosisCode: f.diagnosisCode.trim().toUpperCase(),
    lines: f.lines.map((l, i) => {
      const vat = l.vat.trim() ? toMinorUnits(l.vat, policy.currency)! : 0;
      return {
        id: l.id ?? String(i + 1),
        ...(l.diagnosisCode ? { diagnosisCode: l.diagnosisCode } : {}),
        description: l.description.trim(),
        category: l.category,
        amount: toMinorUnits(l.amount, policy.currency)!,
        ...(vat ? { vat } : {}),
      };
    }),
  };
}

/** An amount in minor units as the form shows it, e.g. 85000 SEK as "850". */
export function toMajorText(minor: number, currency: string): string {
  const per = minorPerMajor(currency);
  const decimals = Math.round(Math.log10(per));
  const text = (minor / per).toFixed(decimals);
  return decimals && text.endsWith('.' + '0'.repeat(decimals)) ? text.slice(0, -decimals - 1) : text;
}

interface StoredClaim {
  channel: 'customer' | 'clinic_direct';
  treatmentFrom: string;
  treatmentTo: string;
  diagnosisCode: string;
  currency: string;
  lines: { id: string; description: string; category: string; diagnosisCode?: string; amount: number; vat?: number }[];
}

/** The form filled in from a stored claim, to correct it (ADR 0036). */
export function formFromClaim(c: StoredClaim): ClaimForm {
  return {
    channel: c.channel,
    treatmentFrom: c.treatmentFrom,
    treatmentTo: c.treatmentTo,
    diagnosisCode: c.diagnosisCode,
    lines: c.lines.map((l) => ({
      id: l.id,
      ...(l.diagnosisCode ? { diagnosisCode: l.diagnosisCode } : {}),
      description: l.description,
      category: l.category,
      amount: toMajorText(l.amount, c.currency),
      vat: l.vat ? toMajorText(l.vat, c.currency) : '',
    })),
  };
}

/** A new line in a correction gets an id the claim does not have. */
export function newLineId(lines: LineForm[]): string {
  let n = lines.length + 1;
  while (lines.some((l) => l.id === `l${n}`)) n++;
  return `l${n}`;
}

/** The body for POST /v1/claims/{id}/corrections: every correctable field; the server works out what changed. */
export function correctionBody(f: ClaimForm, policy: PolicyFacts, reason: string, expectedRevision: number) {
  const { channel, treatmentFrom, treatmentTo, diagnosisCode, lines } = toClaimInput(f, policy);
  return { channel, treatmentFrom, treatmentTo, diagnosisCode, lines, reason: reason.trim(), expectedRevision };
}

/** The sum of the lines in minor units, for the form's total; lines that are not amounts count as 0. */
export function linesTotal(lines: LineForm[], currency: string): number {
  return lines.reduce((s, l) => s + (toMinorUnits(l.amount, currency) ?? 0), 0);
}
