/**
 * Payments received on the payers' accounts (ADR 0040, punkt 6): what billing
 * knows of a payment from payment.succeeded, how it is matched to a payer
 * account, and how it is allocated to the account's invoices. The functions
 * here are pure; the service and the stores use them.
 *
 * Nothing is ever changed. An invoice's paid and open amounts are worked out
 * from its credit notes and the allocations made to it, and a payer's credit
 * balance is what was received on the account and not used by an invoice.
 */
import { allocatePayment } from '@petvold/billing-core';
import type { ISODate, Timestamp } from '@petvold/common';
import type { CreditNote, Invoice } from './index.ts';

/** A payment into the insurer's account, as billing has it from payment.succeeded. Never changes. */
export interface PaymentReceipt {
  /** The payment's id in the payments module. */
  paymentId: string;
  market: string;
  currency: string;
  amount: number;
  /** The reference the payer gave, or null. */
  reference: string | null;
  bookedOn: ISODate;
  receivedAt: Timestamp;
  sourceEventId: string;
}

/** Which payer account a payment belongs to. One per payment, never changed. */
export interface PaymentMatch {
  paymentId: string;
  accountId: string;
  /** The invoice it went to first: the one its reference named, or the one a person chose. */
  invoiceId?: string;
  /** 'reference': by the invoice's reference when it came in. 'manual': a person matched it. */
  how: 'reference' | 'manual';
  matchedBy: string;
  matchedAt: Timestamp;
  note?: string;
}

/** What a payment paid of an invoice. */
export interface Allocation {
  paymentId: string;
  invoiceId: string;
  accountId: string;
  amount: number;
}

/** Everything on one payer account that payments are allocated against. */
export interface AccountLedger {
  invoices: Invoice[];
  creditNotes: CreditNote[];
  allocations: Allocation[];
  /** The amounts of the payments matched to the account. */
  received: number;
}

export type InvoiceStatus = 'open' | 'partly-paid' | 'paid' | 'credited';

/** An invoice with what has been credited and paid of it. */
export interface InvoiceBalance {
  /** Taken off by credit notes. */
  credited: number;
  /** Paid by payments, never more than total minus credited. */
  paid: number;
  /** Still to pay. */
  open: number;
  status: InvoiceStatus;
}

/** A received payment, as the API shows it. */
export interface ReceivedPayment extends PaymentReceipt {
  status: 'matched' | 'unmatched';
  match?: PaymentMatch;
  allocations: { invoiceId: string; amount: number }[];
  /** What it paid of no invoice: part of the payer's credit balance. 0 when unmatched. */
  unallocated: number;
}

/** What each invoice has been credited and paid. Pure. */
export function invoiceBalances(invoices: readonly Invoice[], creditNotes: readonly CreditNote[], allocations: readonly Allocation[]): Map<string, InvoiceBalance> {
  const credited = new Map<string, number>();
  for (const c of creditNotes) credited.set(c.invoiceId, (credited.get(c.invoiceId) ?? 0) + c.total);
  const allocated = new Map<string, number>();
  for (const a of allocations) allocated.set(a.invoiceId, (allocated.get(a.invoiceId) ?? 0) + a.amount);
  const out = new Map<string, InvoiceBalance>();
  for (const i of invoices) {
    const c = Math.min(credited.get(i.id) ?? 0, i.total);
    const net = i.total - c;
    const paid = Math.min(allocated.get(i.id) ?? 0, net);
    const open = net - paid;
    const status: InvoiceStatus = open > 0 ? (paid > 0 ? 'partly-paid' : 'open') : paid > 0 ? 'paid' : 'credited';
    out.set(i.id, { credited: c, paid, open, status });
  }
  return out;
}

/**
 * What the payer owes and has to their credit. A payment allocated to an
 * invoice that a credit note later took down counts as credit for the part the
 * invoice no longer needs. Pure.
 */
export function accountBalance(ledger: AccountLedger): { open: number; credit: number } {
  const balances = invoiceBalances(ledger.invoices, ledger.creditNotes, ledger.allocations);
  let open = 0;
  let paid = 0;
  for (const b of balances.values()) {
    open += b.open;
    paid += b.paid;
  }
  return { open, credit: ledger.received - paid };
}

/**
 * Allocates a payment on an account (ADR 0040, punkt 6): to the named invoice
 * first, the one whose reference the payer gave, and what is left to the
 * oldest due invoice first. What no invoice needs is the payer's credit. An
 * invoice is never paid more than is open on it. Pure.
 */
export function allocate(
  amount: number,
  ledger: Pick<AccountLedger, 'invoices' | 'creditNotes' | 'allocations'>,
  first?: string,
): { allocations: { invoiceId: string; amount: number }[]; unallocated: number; settled: string[] } {
  const balances = invoiceBalances(ledger.invoices, ledger.creditNotes, ledger.allocations);
  const open = ledger.invoices.map((i) => ({ id: i.id, dueDate: i.dueDate, open: balances.get(i.id)!.open })).filter((i) => i.open > 0);
  const out: { invoiceId: string; amount: number }[] = [];
  let left = amount;
  const named = first ? open.find((i) => i.id === first) : undefined;
  if (named) {
    const take = Math.min(left, named.open);
    if (take > 0) out.push({ invoiceId: named.id, amount: take });
    left -= take;
  }
  const rest = allocatePayment(left, open.filter((i) => i !== named));
  out.push(...rest.allocations.map((a) => ({ invoiceId: a.id, amount: a.amount })));
  const settled = out.filter((a) => a.amount === open.find((i) => i.id === a.invoiceId)!.open).map((a) => a.invoiceId);
  return { allocations: out, unallocated: rest.unallocated, settled };
}
