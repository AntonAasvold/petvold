/**
 * Requests for information in the claim view (ADR 0036): who may ask and
 * answer, what a request needs, and where the claim stands against the month
 * in FAL 7 kap. 1 §. The API decides every call. Pure; tested with node:test.
 */
import type { Me } from './permissions.ts';

export const INFORMATION_ITEMS = ['itemised-invoice', 'medical-record', 'referral', 'other'] as const;
export type InformationItem = (typeof INFORMATION_ITEMS)[number];
export type Recipient = 'customer' | 'clinic';

/** The insurer pays within a month of a complete basis (FAL 7 kap. 1 §); the claim view counts 30 days. */
export const PAYMENT_DAYS = 30;

/** Information may be asked for on a claim that is not closed and has no open proposal (the API's rules). */
export const mayRequestInformation = (me: Me | null, status: string): boolean =>
  !!me?.permissions.includes('claims:request-information') && !['withdrawn', 'dismissed', 'awaiting-approval'].includes(status);

/** An answer is registered with claims:register, on an open or expired request. */
export const mayAnswer = (me: Me | null, r: { status: string }): boolean => !!me?.permissions.includes('claims:register') && (r.status === 'open' || r.status === 'expired');

/** An open request may be cancelled with claims:request-information. */
export const mayCancel = (me: Me | null, r: { status: string }): boolean => !!me?.permissions.includes('claims:request-information') && r.status === 'open';

export interface InformationForm {
  recipient: Recipient;
  items: InformationItem[];
  note: string;
  /** Empty: from the product's claims rules. */
  dueDate: string;
}

export const emptyInformation = (): InformationForm => ({ recipient: 'customer', items: [], note: '', dueDate: '' });

/** What is missing in a request, as message ids. Empty: it may be sent. */
export function informationProblems(f: InformationForm, today: string): string[] {
  const out: string[] = [];
  if (!f.items.length) out.push('info.needItems');
  if (!f.note.trim()) out.push('info.needNote');
  if (f.dueDate && f.dueDate <= today) out.push('info.dueAfterToday');
  return out;
}

export function informationBody(f: InformationForm) {
  return { recipient: f.recipient, items: [...new Set(f.items)], note: f.note.trim(), ...(f.dueDate ? { dueDate: f.dueDate } : {}) };
}

/** Adds or removes an item, keeping the order of INFORMATION_ITEMS. */
export const toggleItem = (items: InformationItem[], item: InformationItem, on: boolean): InformationItem[] =>
  INFORMATION_ITEMS.filter((i) => (i === item ? on : items.includes(i)));

const DAY = 86_400_000;

/**
 * Where an undecided claim stands against the month: the days left, negative
 * when it has passed. null while the basis is not complete.
 */
export function daysLeftToPay(basisCompleteAt: string | undefined, now: string): number | null {
  if (!basisCompleteAt) return null;
  return PAYMENT_DAYS - Math.floor((Date.parse(now) - Date.parse(basisCompleteAt)) / DAY);
}

/** A decision made more than 30 days after the basis was complete is marked (ADR 0036). */
export function decidedLate(decidedAt: string, basisCompleteAt: string | undefined): boolean {
  if (!basisCompleteAt || decidedAt < basisCompleteAt) return false;
  return Date.parse(decidedAt) - Date.parse(basisCompleteAt) > PAYMENT_DAYS * DAY;
}
