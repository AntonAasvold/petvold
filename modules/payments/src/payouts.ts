/**
 * Payouts (ADR 0040, punkt 8): a claim's payout order becomes a payout to the
 * policyholder's account, through the market's adapter. The details a payee
 * is paid to belong to this module, per party, and are never changed: new
 * details replace the old from a time, with who gave them.
 *
 * A payout waits when the payee has no details, and is held for a person when
 * the details are newer than the market's hold (payments.newPayeeHoldDays): a
 * guard against fraud with changed account details. The person who releases
 * it must not be the one who gave the details.
 */
import type { ISODate, Timestamp } from '@petvold/common';

export type PayeeMethod = 'se-bank' | 'iban';

/** Who is paid: a party (the policyholder), or a clinic with an agreement on direct settlement. */
export type Payee = { partyId: string; clinicId?: undefined } | { clinicId: string; partyId?: undefined };

/** The payee's fields alone, e.g. to filter by. Pure. */
export const payeeOf = (x: { partyId?: string | undefined; clinicId?: string | undefined }): Payee => (x.clinicId ? { clinicId: x.clinicId } : { partyId: x.partyId! });

/**
 * An agreement on direct settlement with a clinic (ADR 0040, punkt 8): while it
 * is in force, a payout order that names the clinic is paid to the clinic.
 * Never changes; an ending is added beside it.
 */
export interface ClinicAgreement {
  id: string;
  clinicId: string;
  market: string;
  validFrom: ISODate;
  /** Exclusive. Omitted: until ended. */
  validTo?: ISODate;
  createdBy: string;
  createdAt: Timestamp;
  ended?: { validTo: ISODate; by: string; at: Timestamp; reason: string };
}

/** Whether the agreement is in force on a day. Pure. */
export function agreementInForce(a: ClinicAgreement, day: ISODate): boolean {
  const to = a.ended && (!a.validTo || a.ended.validTo < a.validTo) ? a.ended.validTo : a.validTo;
  return a.validFrom <= day && (!to || day < to);
}

/** Where a payee is paid. A Swedish bank account, or an IBAN. Never changes. */
export type PayeeAccount = Payee & {
  id: string;
  market: string;
  method: PayeeMethod;
  /** se-bank: clearing number and account number. iban: the IBAN and optionally the BIC. Personal data. */
  details: { clearing: string; account: string } | { iban: string; bic?: string };
  /** From when it is the payee's: the newest replaces the others. */
  createdAt: Timestamp;
  createdBy: string;
};

export type PayoutStatus = 'awaiting-details' | 'held' | 'pending' | 'paid' | 'failed';

/** What happened to a payout, in order. Never changes; the last step is its status. */
export interface PayoutStep {
  status: PayoutStatus;
  at: Timestamp;
  by: string;
  /** The payee account it was, or will be, paid to. */
  payeeAccountId?: string;
  /** The adapter's id for the payment. */
  providerRef?: string;
  note?: string;
}

/** A claim's payout order on its way to the payee. */
export type Payout = Payee & {
  id: string;
  /** The claim's payout order: one payout per order, so an order is never paid twice. */
  orderId: string;
  claimId: string;
  decisionId: string;
  policyId: string;
  market: string;
  currency: string;
  amount: number;
  provider: string;
  sourceEventId: string;
  createdAt: Timestamp;
};

export type PayoutView = Payout & { status: PayoutStatus; steps: PayoutStep[] };

/** What the adapter is asked to pay. */
export interface PayoutRequest {
  /** Petvold's id, sent as the idempotency key, so a retry never pays twice (ADR 0017, punkt 4). */
  payoutId: string;
  market: string;
  currency: string;
  amount: number;
  account: PayeeAccount['details'] & { method: PayeeMethod };
}

export interface PayoutResult {
  status: 'paid' | 'pending' | 'failed';
  providerRef: string;
  reason?: string;
}

/** Throws a message if the details are not a well-formed account for the method. Pure. */
export function payeeDetailsProblem(method: PayeeMethod, details: Record<string, unknown>): string | null {
  if (method === 'se-bank') {
    const clearing = String(details.clearing ?? '');
    const account = String(details.account ?? '');
    if (!/^\d{4,5}$/.test(clearing)) return 'clearing must be 4 or 5 digits';
    if (!/^\d{6,12}$/.test(account)) return 'account must be 6 to 12 digits';
    if (Object.keys(details).some((k) => k !== 'clearing' && k !== 'account')) return 'se-bank takes clearing and account only';
    return null;
  }
  const iban = String(details.iban ?? '').replace(/\s/g, '').toUpperCase();
  if (!isIban(iban)) return 'iban is not a valid IBAN';
  if (details.bic !== undefined && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(String(details.bic))) return 'bic is not a valid BIC';
  if (Object.keys(details).some((k) => k !== 'iban' && k !== 'bic')) return 'iban takes iban and bic only';
  return null;
}

/** ISO 13616: country, check digits, and the remainder 1 modulo 97. Pure. */
export function isIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** The details with all but the last four digits of the number hidden. Pure. */
export function maskDetails(details: PayeeAccount['details']): PayeeAccount['details'] {
  const mask = (s: string) => `${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
  return 'iban' in details ? { iban: mask(details.iban), ...(details.bic ? { bic: details.bic } : {}) } : { clearing: details.clearing, account: mask(details.account) };
}

/**
 * Where a payout stands before it is sent: waiting for details, held because
 * the details are new, or ready. Pure.
 */
export function payoutGate(account: PayeeAccount | null, now: Timestamp, holdDays: number): 'awaiting-details' | 'held' | 'ready' {
  if (!account) return 'awaiting-details';
  const age = (Date.parse(now) - Date.parse(account.createdAt)) / 86_400_000;
  return holdDays > 0 && age < holdDays ? 'held' : 'ready';
}
