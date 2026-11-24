/**
 * Accounting (ADR 0040, punkt 9): every event that moves money becomes a
 * verification in double entry, with a number from an unbroken series per
 * market and year, a booking date, and a reference to the event and the
 * object. Petvold books in its own kinds of account; the chart of accounts
 * that maps them to the insurer's account numbers comes with the day close.
 *
 * Petvold is not the insurer's general ledger: periodization, provisions and
 * reports to the supervisor are made in the insurer's system. Each line for
 * premium carries the period it pays for, so that it can be periodized.
 *
 * The module never reads another module's tables (ADR 0001): it learns of
 * money from events, and reads what an event does not carry through ports.
 */
import { marketDate, type ISODate, type Timestamp } from '@petvold/common';

/** Petvold's own kinds of account. A verification uses these; the chart maps them. */
export const ACCOUNT_KINDS = [
  /** The insurer's bank account. */
  'bank',
  /** Premium the payers owe, per payer account. A negative balance is the payer's credit. */
  'premium-receivable',
  'premium-income',
  'premium-tax',
  'installment-fees',
  /** Payments received but not yet matched to a payer. */
  'unmatched-payments',
  /** Unpaid premium given up. */
  'customer-losses',
  /** Claims decided, the cost of the insurer. */
  'claims-cost',
  /** Claims decided and not yet paid out. */
  'claims-payable',
  /** Credit to be paid back to payers and not yet paid out. */
  'refunds-payable',
] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** One line of a verification: an amount in debit or in credit, never both. */
export interface VerificationLine {
  account: AccountKind;
  debit: number;
  credit: number;
  /** premium-receivable: the payer account. */
  payerAccountId?: string;
  policyId?: string;
  claimId?: string;
  /** Premium lines: the period the premium pays for, end exclusive, for periodization. */
  period?: { from: ISODate; to: ISODate };
}

/** A verification. Never changes; a correction is a new verification. */
export interface Verification {
  id: string;
  /** From the market's unbroken series per year, e.g. V-SE-2026-000001. */
  number: string;
  market: string;
  currency: string;
  bookingDate: ISODate;
  text: string;
  /** The event it was made from, and the object it is about. */
  source: { eventId: string; eventType: string; objectType: 'invoice' | 'credit-note' | 'payment' | 'payout' | 'refund' | 'claim'; objectId: string };
  lines: VerificationLine[];
  createdAt: Timestamp;
}

export type VerificationDraft = Omit<Verification, 'id' | 'number' | 'createdAt'>;

/** An event as the relay hands it over, from billing, payments or claims. */
export interface MoneyEvent {
  id: string;
  type: string;
  market: string;
  occurredAt: Timestamp;
  data: Record<string, unknown>;
  invoiceId?: string;
  paymentId?: string;
  payoutId?: string;
  refundId?: string;
  claimId?: string;
}

/** What accounting reads from billing that the events do not carry. */
export interface AccountingSources {
  invoice(id: string): Promise<{
    id: string;
    number: string;
    accountId: string;
    market: string;
    currency: string;
    issueDate: ISODate;
    lines: { planId: string; policyId: string; seq: number; periodStart: ISODate; periodEnd: ISODate; premium: number; tax: number; fee: number; amount: number }[];
  } | null>;
  creditNote(id: string): Promise<{
    id: string;
    number: string;
    kind: 'credit' | 'write-off';
    invoiceId: string;
    accountId: string;
    market: string;
    currency: string;
    issueDate: ISODate;
    lines: { planId: string; policyId: string; seq: number; amount: number }[];
    total: number;
  } | null>;
}

export class AccountingError extends Error {
  constructor(
    public readonly code: 'not_found' | 'validation',
    message: string,
  ) {
    super(message);
    this.name = 'AccountingError';
  }
}

const debit = (account: AccountKind, amount: number, extra: Partial<VerificationLine> = {}): VerificationLine => ({ account, debit: amount, credit: 0, ...extra });
const credit = (account: AccountKind, amount: number, extra: Partial<VerificationLine> = {}): VerificationLine => ({ account, debit: 0, credit: amount, ...extra });

/**
 * Splits an amount by weights so the parts add up: each gets its share
 * rounded down, and what is left goes one by one to the largest remainders
 * (ties to the first). With an amount at most the weights' sum, no part is
 * ever more than its weight. Pure.
 */
export function split(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return weights.map((_, i) => (i === 0 ? amount : 0));
  const parts = weights.map((w) => Math.floor((amount * w) / total));
  const order = weights.map((w, i) => ({ i, rest: (amount * w) % total })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let left = amount - parts.reduce((s, p) => s + p, 0), k = 0; left > 0; left--, k++) parts[order[k % order.length]!.i]! += 1;
  return parts;
}

/**
 * The verification an event calls for, or null if it moves no money. Pure,
 * given what the sources returned.
 *
 * - invoice.issued: the payer owes the invoice; premium, tax and fees are income.
 * - invoice.credited: a credit note takes back income; a write-off is a loss.
 * - payment.succeeded: money in the bank, unmatched until billing matches it.
 * - payment.matched: from unmatched payments to the payer.
 * - refund.ordered: the payer's credit becomes a debt to pay back.
 * - claim.payout_ordered: a claim's cost and a debt to pay out.
 * - payout.paid: the debt paid from the bank.
 */
export function verificationFor(
  e: MoneyEvent,
  facts: { invoice?: Awaited<ReturnType<AccountingSources['invoice']>>; creditNote?: Awaited<ReturnType<AccountingSources['creditNote']>> },
): VerificationDraft | null {
  const day = marketDate(e.market, e.occurredAt);
  const base = (currency: string, bookingDate: ISODate, text: string, objectType: Verification['source']['objectType'], objectId: string) => ({
    market: e.market,
    currency,
    bookingDate,
    text,
    source: { eventId: e.id, eventType: e.type, objectType, objectId },
  });
  const n = (k: string) => Number(e.data[k]);
  switch (e.type) {
    case 'invoice.issued': {
      const i = facts.invoice!;
      const lines: VerificationLine[] = [debit('premium-receivable', i.lines.reduce((s, l) => s + l.amount, 0), { payerAccountId: i.accountId })];
      for (const l of i.lines) {
        const period = { from: l.periodStart, to: l.periodEnd };
        if (l.premium) lines.push(credit('premium-income', l.premium, { policyId: l.policyId, period }));
        if (l.tax) lines.push(credit('premium-tax', l.tax, { policyId: l.policyId, period }));
        if (l.fee) lines.push(credit('installment-fees', l.fee, { policyId: l.policyId, period }));
      }
      return { ...base(i.currency, i.issueDate, `Invoice ${i.number}`, 'invoice', i.id), lines };
    }
    case 'invoice.credited': {
      const c = facts.creditNote!;
      const i = facts.invoice!;
      if (c.kind === 'write-off') {
        return {
          ...base(c.currency, c.issueDate, `Write-off ${c.number} of invoice ${i.number}`, 'credit-note', c.id),
          lines: [debit('customer-losses', c.total), credit('premium-receivable', c.total, { payerAccountId: c.accountId })],
        };
      }
      const lines: VerificationLine[] = [];
      for (const cl of c.lines) {
        const il = i.lines.find((l) => l.planId === cl.planId && l.seq === cl.seq)!;
        const [premium, tax, fee] = split(cl.amount, [il.premium, il.tax, il.fee]);
        const period = { from: il.periodStart, to: il.periodEnd };
        if (premium) lines.push(debit('premium-income', premium, { policyId: cl.policyId, period }));
        if (tax) lines.push(debit('premium-tax', tax, { policyId: cl.policyId, period }));
        if (fee) lines.push(debit('installment-fees', fee, { policyId: cl.policyId, period }));
      }
      lines.push(credit('premium-receivable', c.total, { payerAccountId: c.accountId }));
      return { ...base(c.currency, c.issueDate, `Credit note ${c.number} on invoice ${i.number}`, 'credit-note', c.id), lines };
    }
    case 'payment.succeeded': {
      if (e.data.direction !== 'incoming') return null;
      const bookedOn = String(e.data.bookedOn);
      return {
        ...base(String(e.data.currency), bookedOn, `Payment received${e.data.reference ? `, reference ${String(e.data.reference)}` : ''}`, 'payment', e.paymentId!),
        lines: [debit('bank', n('amount')), credit('unmatched-payments', n('amount'))],
      };
    }
    case 'payment.matched':
      return {
        ...base(String(e.data.currency), day, `Payment matched to payer account ${String(e.data.accountId)} (${String(e.data.how)})`, 'payment', e.paymentId!),
        lines: [debit('unmatched-payments', n('amount')), credit('premium-receivable', n('amount'), { payerAccountId: String(e.data.accountId) })],
      };
    case 'refund.ordered':
      return {
        ...base(String(e.data.currency), day, `Credit paid back to payer account ${String(e.data.accountId)}`, 'refund', e.refundId!),
        lines: [debit('premium-receivable', n('amount'), { payerAccountId: String(e.data.accountId) }), credit('refunds-payable', n('amount'))],
      };
    case 'claim.payout_ordered': {
      const claimId = e.claimId!;
      const policyId = String(e.data.policyId);
      return {
        ...base(String(e.data.currency), day, `Payout order ${String(e.data.payoutOrderId)} on claim ${claimId}`, 'claim', claimId),
        lines: [debit('claims-cost', n('amount'), { claimId, policyId }), credit('claims-payable', n('amount'), { claimId, policyId })],
      };
    }
    case 'payout.paid': {
      const payable: AccountKind = e.data.purpose === 'premium-refund' ? 'refunds-payable' : 'claims-payable';
      const claimId = typeof e.data.claimId === 'string' ? e.data.claimId : undefined;
      return {
        ...base(String(e.data.currency), day, e.data.purpose === 'premium-refund' ? `Refund ${String(e.data.orderId)} paid out` : `Claim ${claimId} paid out`, 'payout', e.payoutId!),
        lines: [debit(payable, n('amount'), claimId ? { claimId } : {}), credit('bank', n('amount'))],
      };
    }
    default:
      return null;
  }
}

/** Throws unless the verification balances and every line is one-sided and whole. Pure. */
export function assertBalanced(v: Pick<Verification, 'lines'>): void {
  let d = 0;
  let c = 0;
  for (const l of v.lines) {
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit) || l.debit < 0 || l.credit < 0 || (l.debit > 0) === (l.credit > 0)) {
      throw new AccountingError('validation', `A line on ${l.account} must have an amount in debit or in credit`);
    }
    d += l.debit;
    c += l.credit;
  }
  if (d !== c) throw new AccountingError('validation', `Debit ${d} and credit ${c} differ`);
}

export interface VerificationFilter {
  market?: string;
  /** Booking date, inclusive. */
  from?: ISODate;
  to?: ISODate;
  objectId?: string;
}

export interface AccountingStore {
  /**
   * Takes the next number in the market's series for the year and stores the
   * verification with it. null, and nothing stored, if its event is booked.
   */
  add(market: string, year: number, numbered: (no: number) => Verification): Promise<Verification | null>;
  verification(id: string): Promise<Verification | null>;
  bySourceEvent(eventId: string): Promise<Verification | null>;
  /** By number. */
  verifications(filter: VerificationFilter): Promise<Verification[]>;
}

export interface AccountingDeps {
  store: AccountingStore;
  sources: AccountingSources;
  clock: { now(): Timestamp };
  ids: { next(prefix: string): string };
}

export class AccountingService {
  constructor(private readonly d: AccountingDeps) {}

  /**
   * Books an event that moves money. Repeats give nothing new, so the relay may
   * deliver an event more than once. Returns the verification, or null if the
   * event moves no money.
   */
  async handleEvent(e: MoneyEvent): Promise<Verification | null> {
    const done = await this.d.store.bySourceEvent(e.id);
    if (done) return done;
    const facts: Parameters<typeof verificationFor>[1] = {};
    if (e.type === 'invoice.issued') {
      facts.invoice = await this.d.sources.invoice(e.invoiceId!);
      if (!facts.invoice) throw new Error(`The invoice ${e.invoiceId} of event ${e.id} does not exist`);
    }
    if (e.type === 'invoice.credited') {
      facts.creditNote = await this.d.sources.creditNote(String(e.data.creditNoteId));
      facts.invoice = await this.d.sources.invoice(e.invoiceId!);
      if (!facts.creditNote || !facts.invoice) throw new Error(`The credit note of event ${e.id} does not exist`);
    }
    const draft = verificationFor(e, facts);
    if (!draft) return null;
    assertBalanced(draft);
    const now = this.d.clock.now();
    const id = this.d.ids.next('ver');
    const year = Number(draft.bookingDate.slice(0, 4));
    const stored = await this.d.store.add(draft.market, year, (no) => ({ ...draft, id, number: `V-${draft.market}-${year}-${String(no).padStart(6, '0')}`, createdAt: now }));
    return stored ?? (await this.d.store.bySourceEvent(e.id));
  }

  async verification(id: string): Promise<Verification> {
    const v = await this.d.store.verification(id);
    if (!v) throw new AccountingError('not_found', `Verification ${id} does not exist`);
    return v;
  }

  async verifications(filter: VerificationFilter = {}): Promise<Verification[]> {
    return this.d.store.verifications(filter);
  }

  /** The balance per account kind and currency, from the verifications in the filter: debit minus credit. */
  async balances(filter: VerificationFilter = {}): Promise<{ account: AccountKind; currency: string; debit: number; credit: number; balance: number }[]> {
    const sums = new Map<string, { account: AccountKind; currency: string; debit: number; credit: number }>();
    for (const v of await this.d.store.verifications(filter)) {
      for (const l of v.lines) {
        const key = `${l.account}|${v.currency}`;
        const s = sums.get(key) ?? { account: l.account, currency: v.currency, debit: 0, credit: 0 };
        s.debit += l.debit;
        s.credit += l.credit;
        sums.set(key, s);
      }
    }
    return [...sums.values()].sort((a, b) => ACCOUNT_KINDS.indexOf(a.account) - ACCOUNT_KINDS.indexOf(b.account) || (a.currency < b.currency ? -1 : 1)).map((s) => ({ ...s, balance: s.debit - s.credit }));
  }
}

export class InMemoryAccountingStore implements AccountingStore {
  private readonly list: Verification[] = [];
  private readonly series = new Map<string, number>();

  async add(market: string, year: number, numbered: (no: number) => Verification) {
    const key = `${market}:${year}`;
    const v = numbered((this.series.get(key) ?? 0) + 1);
    if (this.list.some((x) => x.source.eventId === v.source.eventId)) return null;
    this.series.set(key, (this.series.get(key) ?? 0) + 1);
    this.list.push(structuredClone(v));
    return structuredClone(v);
  }

  async verification(id: string) {
    const v = this.list.find((x) => x.id === id);
    return v ? structuredClone(v) : null;
  }

  async bySourceEvent(eventId: string) {
    const v = this.list.find((x) => x.source.eventId === eventId);
    return v ? structuredClone(v) : null;
  }

  async verifications(f: VerificationFilter) {
    return structuredClone(
      this.list
        .filter((v) => (!f.market || v.market === f.market) && (!f.from || v.bookingDate >= f.from) && (!f.to || v.bookingDate <= f.to) && (!f.objectId || v.source.objectId === f.objectId))
        .sort((a, b) => (a.number < b.number ? -1 : 1)),
    );
  }
}
