/**
 * Payee account details and agreements on direct settlement in the back
 * office (ADR 0040, steg 8). Pure, so it is tested without a browser. The API
 * decides every call; this checks a form before it is sent, by the rules in
 * the contract: a Swedish clearing and account number, or an IBAN by ISO 13616.
 */

export interface PayeeForm {
  market: string;
  method: 'se-bank' | 'iban';
  clearing: string;
  account: string;
  iban: string;
  bic: string;
}

export type PayeeProblem = 'market' | 'clearing' | 'account' | 'iban' | 'bic';

const digits = (s: string) => s.replace(/[\s-]/g, '');
const compact = (s: string) => s.replace(/\s/g, '').toUpperCase();

/** An IBAN's check digits, by ISO 13616: the number mod 97 is 1. */
export function ibanOk(input: string): boolean {
  const iban = compact(input);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const n = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

export function payeeProblems(form: PayeeForm): PayeeProblem[] {
  const out: PayeeProblem[] = [];
  if (!/^[A-Z]{2}$/.test(form.market)) out.push('market');
  if (form.method === 'se-bank') {
    if (!/^[0-9]{4,5}$/.test(digits(form.clearing))) out.push('clearing');
    if (!/^[0-9]{6,12}$/.test(digits(form.account))) out.push('account');
  } else {
    if (!ibanOk(form.iban)) out.push('iban');
    if (form.bic.trim() && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact(form.bic))) out.push('bic');
  }
  return out;
}

export function payeeBody(form: PayeeForm): { market: string; method: 'se-bank' | 'iban'; details: Record<string, string> } {
  const details: Record<string, string> =
    form.method === 'se-bank' ? { clearing: digits(form.clearing), account: digits(form.account) } : { iban: compact(form.iban), ...(form.bic.trim() ? { bic: compact(form.bic) } : {}) };
  return { market: form.market, method: form.method, details };
}

/** The masked details on one line, as the API gives them. */
export function detailsLine(a: { method: string; details: { clearing?: string; account?: string; iban?: string; bic?: string } }): string {
  return a.method === 'se-bank' ? `${a.details.clearing ?? ''} ${a.details.account ?? ''}`.trim() : [a.details.iban, a.details.bic].filter(Boolean).join(' · ');
}

export interface AgreementForm {
  clinicId: string;
  market: string;
  validFrom: string;
  /** Optional, exclusive. */
  validTo: string;
}

export type AgreementProblem = 'clinic' | 'market' | 'from' | 'to';

export function agreementProblems(form: AgreementForm): AgreementProblem[] {
  const out: AgreementProblem[] = [];
  if (!form.clinicId.trim() || form.clinicId.trim().length > 100) out.push('clinic');
  if (!/^[A-Z]{2}$/.test(form.market)) out.push('market');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.validFrom)) out.push('from');
  if (form.validTo && (!/^\d{4}-\d{2}-\d{2}$/.test(form.validTo) || form.validTo <= form.validFrom)) out.push('to');
  return out;
}

export const agreementBody = (form: AgreementForm) => ({
  clinicId: form.clinicId.trim(),
  market: form.market,
  validFrom: form.validFrom,
  ...(form.validTo ? { validTo: form.validTo } : {}),
});

/** An agreement is in force on a day when it has begun and not ended (validTo is exclusive). */
export function inForce(a: { validFrom: string; validTo?: string; ended?: { validTo: string } }, day: string): boolean {
  const to = a.ended?.validTo ?? a.validTo;
  return a.validFrom <= day && (!to || day < to);
}

/** An ending needs a reason and a day after the agreement began. */
export function endingProblems(a: { validFrom: string }, validTo: string, reason: string): ('to' | 'reason')[] {
  const out: ('to' | 'reason')[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validTo) || validTo <= a.validFrom) out.push('to');
  if (!reason.trim() || reason.trim().length > 2000) out.push('reason');
  return out;
}
