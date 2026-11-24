/**
 * A payer's account in the back office (ADR 0040, steg 8): its invoices, a
 * credit note or write-off on one, and paying back the credit. Pure, so it is
 * tested without a browser. The API decides every call; this checks a form
 * before it is sent, by the rules the API uses (KRED-06, KRED-07, KRED-12).
 */
import { toMinorUnits } from './settings-logic.ts';

export interface InvoiceAmounts {
  total: number;
  credited: number;
  open: number;
}

/** The most a credit note may take: what earlier ones left, also of a paid invoice. A write-off: at most what is unpaid. */
export const creditMax = (inv: InvoiceAmounts, kind: 'credit' | 'write-off'): number => (kind === 'write-off' ? inv.open : inv.total - inv.credited);

export interface CreditForm {
  kind: 'credit' | 'write-off';
  /** In major units, as typed, e.g. 195,07. */
  amount: string;
  reason: string;
}

export type CreditProblem = 'amount' | 'too-much' | 'reason';

export function creditProblems(form: CreditForm, inv: InvoiceAmounts, currency: string): CreditProblem[] {
  const out: CreditProblem[] = [];
  const minor = toMinorUnits(form.amount, currency);
  if (minor === null || minor < 1) out.push('amount');
  else if (minor > creditMax(inv, form.kind)) out.push('too-much');
  const reason = form.reason.trim();
  if (!reason || reason.length > 2000) out.push('reason');
  return out;
}

export const creditBody = (form: CreditForm, currency: string) => ({ kind: form.kind, amount: toMinorUnits(form.amount, currency)!, reason: form.reason.trim() });

export interface RefundForm {
  /** Empty: all of the credit. */
  amount: string;
  note: string;
}

export type RefundProblem = 'amount' | 'too-much' | 'nothing';

export function refundProblems(form: RefundForm, credit: number, currency: string): RefundProblem[] {
  if (credit < 1) return ['nothing'];
  if (!form.amount.trim()) return [];
  const minor = toMinorUnits(form.amount, currency);
  if (minor === null || minor < 1) return ['amount'];
  return minor > credit ? ['too-much'] : [];
}

export function refundBody(form: RefundForm, currency: string): { amount?: number; note?: string } {
  const note = form.note.trim();
  return { ...(form.amount.trim() ? { amount: toMinorUnits(form.amount, currency)! } : {}), ...(note ? { note } : {}) };
}

/** What the dunning run last did to an invoice, or null. */
export function dunningState(inv: { dunning: readonly { step: string }[] }): string | null {
  return inv.dunning.at(-1)?.step ?? null;
}
