/**
 * Registering a claim from the back office: the form, what is missing, and the
 * body for POST /v1/claims and /v1/claim-previews. The claim takes market,
 * currency and animal from the policy, so the handler cannot get them wrong.
 * Pure; tested with node:test. The API validates everything again.
 */
import { toMinorUnits } from './settings-logic.ts';

/** Line categories the sample rules know. The product's rules decide what is reimbursed. */
export const LINE_CATEGORIES = ['examination', 'diagnostics', 'medication', 'surgery', 'anaesthesia', 'hospitalisation', 'food'] as const;

export interface LineForm {
  description: string;
  category: string;
  /** In major units as typed, e.g. "1 250,50". */
  amount: string;
  vat: string;
}

export interface ClaimForm {
  claimNo: string;
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

/** A new claim id: clm_ and 12 random letters and digits. The client chooses the id (ClaimFields.id). */
export function newClaimId(random: () => number = Math.random): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return `clm_${Array.from({ length: 12 }, () => abc[Math.floor(random() * abc.length)]).join('')}`;
}

/** What is missing or wrong, as message ids. Empty: it may be sent. */
export function claimFormProblems(f: ClaimForm, policy: PolicyFacts | null, today: string): string[] {
  const out: string[] = [];
  if (!policy) out.push('register.needPolicy');
  if (!f.claimNo.trim()) out.push('register.needClaimNo');
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

/** The body for POST /v1/claims (and /v1/claim-previews). Call only when claimFormProblems is empty. */
export function toClaimInput(f: ClaimForm, policy: PolicyFacts, id: string) {
  return {
    id,
    claimNo: f.claimNo.trim(),
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
        id: String(i + 1),
        description: l.description.trim(),
        category: l.category,
        amount: toMinorUnits(l.amount, policy.currency)!,
        ...(vat ? { vat } : {}),
      };
    }),
  };
}

/** The sum of the lines in minor units, for the form's total; lines that are not amounts count as 0. */
export function linesTotal(lines: LineForm[], currency: string): number {
  return lines.reduce((s, l) => s + (toMinorUnits(l.amount, currency) ?? 0), 0);
}

/**
 * A suggested claim number, S-<year>-<six digits>, that the handler may change.
 * Claim numbers are unique (the API answers 409 for one in use); a series kept
 * by the server is a question for the claims process ADR.
 */
export function suggestClaimNo(today: string, random: () => number = Math.random): string {
  return `S-${today.slice(0, 4)}-${String(Math.floor(random() * 900_000) + 100_000)}`;
}
