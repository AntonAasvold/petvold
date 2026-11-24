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
import { addDays, marketDate, type ISODate, type Timestamp } from '@petvold/common';
import { createHash } from 'node:crypto';
import { dayCsv, dayTotals, type ChartAccount, type ChartOfAccounts, type DayClose } from './close.ts';
export * from './close.ts';

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
  /** The day it is booked on: its event's day, or the first open day if that day was closed already. */
  bookingDate: ISODate;
  /** The event's own day, when it is not the booking date. */
  eventDate?: ISODate;
  text: string;
  /** The event it was made from, and the object it is about. */
  source: { eventId: string; eventType: string; objectType: 'invoice' | 'credit-note' | 'payment' | 'payout' | 'refund' | 'claim'; objectId: string };
  lines: VerificationLine[];
  createdAt: Timestamp;
}

export type VerificationDraft = Omit<Verification, 'id' | 'number' | 'createdAt' | 'eventDate'>;

/** What the module tells others (ADR 0008, 0033). */
export interface AccountingEvent {
  id: string;
  type: 'accounting.day_closed';
  market: string;
  day: ISODate;
  occurredAt: Timestamp;
  data: Record<string, unknown>;
  sequence?: number;
}

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

export class ChartConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartConflictError';
  }
}

export class AccountingError extends Error {
  constructor(
    public readonly code: 'not_found' | 'validation' | 'conflict',
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
   * Stores a verification in one transaction, locked against the market's day
   * close: its booking date is its event's day, or the first open day if that
   * day is closed; the number is the next in the market's series for the year
   * of the booking date. null, and nothing stored, if its event is booked.
   */
  add(market: string, eventDate: ISODate, numbered: (bookingDate: ISODate, no: number) => Verification): Promise<Verification | null>;
  /** The last closed day in the market, or null. */
  closedThrough(market: string): Promise<ISODate | null>;
  /**
   * Closes the day after the last closed one, locked against new
   * verifications in the market: `make` sees the day's verifications and says
   * what to store. null if the day is not the next to close.
   */
  closeDay(market: string, day: ISODate, make: (verifications: Verification[]) => { close: DayClose; events: AccountingEvent[] }): Promise<DayClose | null>;
  dayClose(market: string, day: ISODate): Promise<DayClose | null>;
  /** Oldest first. */
  dayCloses(filter: { market?: string; from?: ISODate; to?: ISODate }): Promise<DayClose[]>;
  /** The newest version, or null before the first. */
  chart(): Promise<ChartOfAccounts | null>;
  chartVersions(): Promise<ChartOfAccounts[]>;
  /** Throws ChartConflictError if the version exists. */
  addChart(c: ChartOfAccounts): Promise<void>;
  pendingEvents(limit: number): Promise<AccountingEvent[]>;
  markPublished(ids: string[], at: Timestamp): Promise<void>;
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
    const stored = await this.d.store.add(draft.market, draft.bookingDate, (bookingDate, no) => ({
      ...draft,
      id,
      number: `V-${draft.market}-${bookingDate.slice(0, 4)}-${String(no).padStart(6, '0')}`,
      bookingDate,
      ...(bookingDate !== draft.bookingDate ? { eventDate: draft.bookingDate } : {}),
      createdAt: now,
    }));
    return stored ?? (await this.d.store.bySourceEvent(e.id));
  }

  /**
   * The day close for one market (ADR 0040, punkt 9), daily: every day from the
   * one after the last closed, or the first with a verification, to the day
   * before onDate is closed in order, each with its totals, the chart in force
   * and the file's checksum, and accounting.day_closed. A dry run says which.
   */
  async closeDays(input: { market: string; onDate: ISODate; dryRun: boolean }, by: string): Promise<{ market: string; onDate: ISODate; dryRun: boolean; days: ISODate[]; closes: DayClose[] }> {
    const last = await this.d.store.closedThrough(input.market);
    const first = last ? addDays(last, 1) : (await this.d.store.verifications({ market: input.market }))[0]?.bookingDate;
    const days: ISODate[] = [];
    for (let d = first; d && d < input.onDate; d = addDays(d, 1)) days.push(d);
    const out = { market: input.market, onDate: input.onDate, dryRun: input.dryRun, days, closes: [] as DayClose[] };
    if (input.dryRun) return out;
    const chart = await this.d.store.chart();
    const mapping = chart?.markets[input.market] ?? {};
    for (const day of days) {
      const made = await this.d.store.closeDay(input.market, day, (vs) => {
        const at = this.d.clock.now();
        const csv = dayCsv(vs, mapping);
        const close: DayClose = {
          market: input.market,
          day,
          closedAt: at,
          closedBy: by,
          verificationCount: vs.length,
          ...dayTotals(vs, mapping),
          chartVersion: chart?.version ?? 0,
          csvSha256: createHash('sha256').update(csv).digest('hex'),
        };
        const event: AccountingEvent = {
          id: this.d.ids.next('aev'),
          type: 'accounting.day_closed',
          market: input.market,
          day,
          occurredAt: at,
          data: { day, verificationCount: close.verificationCount, totals: close.totals, chartVersion: close.chartVersion, unmapped: close.unmapped, csvSha256: close.csvSha256 },
        };
        return { close, events: [event] };
      });
      if (!made) break; // another server closed it meanwhile
      out.closes.push(made);
    }
    return out;
  }

  async dayCloses(filter: { market?: string; from?: ISODate; to?: ISODate } = {}): Promise<DayClose[]> {
    return this.d.store.dayCloses(filter);
  }

  /** A closed day's file, made again from its verifications and its chart version, and checked against the checksum. */
  async dayFile(market: string, day: ISODate): Promise<{ close: DayClose; csv: string }> {
    const close = await this.d.store.dayClose(market, day);
    if (!close) throw new AccountingError('not_found', `The day ${day} is not closed in ${market}`);
    const chart = (await this.d.store.chartVersions()).find((c) => c.version === close.chartVersion);
    const csv = dayCsv(await this.d.store.verifications({ market, from: day, to: day }), chart?.markets[market] ?? {});
    if (createHash('sha256').update(csv).digest('hex') !== close.csvSha256) throw new Error(`The file for ${market} ${day} no longer matches its checksum`);
    return { close, csv };
  }

  /** The chart of accounts in force: version 0, empty, before the first change. */
  async chart(): Promise<ChartOfAccounts> {
    return (await this.d.store.chart()) ?? { version: 0, markets: {}, changedBy: 'petvold', changedAt: '1970-01-01T00:00:00.000Z', reason: 'No chart yet: the files use Petvold\'s kinds of account' };
  }

  async chartVersions(): Promise<ChartOfAccounts[]> {
    return this.d.store.chartVersions();
  }

  /** A new version of the chart, based on the one in force (ADR 0020). From then, day closes use it. */
  async changeChart(input: { basedOnVersion: number; markets: ChartOfAccounts['markets']; reason: string }, by: string): Promise<ChartOfAccounts> {
    const cur = await this.chart();
    if (input.basedOnVersion !== cur.version) throw new AccountingError('conflict', `The chart is at version ${cur.version}, not ${input.basedOnVersion}`);
    for (const [market, accounts] of Object.entries(input.markets)) {
      if (!/^[A-Z]{2}$/.test(market)) throw new AccountingError('validation', `Unknown market ${market}`);
      for (const [kind, acc] of Object.entries(accounts)) {
        if (!(ACCOUNT_KINDS as readonly string[]).includes(kind)) throw new AccountingError('validation', `Unknown kind of account ${kind}`);
        if (!acc || !/^[A-Za-z0-9.-]{1,20}$/.test(acc.number)) throw new AccountingError('validation', `${market} ${kind}: the account number must be 1 to 20 letters, digits, points or dashes`);
      }
    }
    const next: ChartOfAccounts = { version: cur.version + 1, markets: structuredClone(input.markets), changedBy: by, changedAt: this.d.clock.now(), reason: input.reason };
    try {
      await this.d.store.addChart(next);
    } catch (err) {
      if (err instanceof ChartConflictError) throw new AccountingError('conflict', 'The chart was changed meanwhile');
      throw err;
    }
    return next;
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
  private readonly closes: DayClose[] = [];
  private readonly charts: ChartOfAccounts[] = [];
  private readonly outbox: (AccountingEvent & { publishedAt?: Timestamp })[] = [];

  async add(market: string, eventDate: ISODate, numbered: (bookingDate: ISODate, no: number) => Verification) {
    const closed = await this.closedThrough(market);
    const bookingDate = closed && eventDate <= closed ? addDays(closed, 1) : eventDate;
    const key = `${market}:${bookingDate.slice(0, 4)}`;
    const v = numbered(bookingDate, (this.series.get(key) ?? 0) + 1);
    if (this.list.some((x) => x.source.eventId === v.source.eventId)) return null;
    this.series.set(key, (this.series.get(key) ?? 0) + 1);
    this.list.push(structuredClone(v));
    return structuredClone(v);
  }

  async closedThrough(market: string) {
    return this.closes.filter((c) => c.market === market).map((c) => c.day).sort().at(-1) ?? null;
  }

  async closeDay(market: string, day: ISODate, make: (verifications: Verification[]) => { close: DayClose; events: AccountingEvent[] }) {
    const last = await this.closedThrough(market);
    if (last ? day !== addDays(last, 1) : this.list.some((v) => v.market === market && v.bookingDate < day)) return null;
    const { close, events } = make(await this.verifications({ market, from: day, to: day }));
    this.closes.push(structuredClone(close));
    for (const e of events) this.outbox.push({ ...structuredClone(e), sequence: this.outbox.length + 1 });
    return structuredClone(close);
  }

  async dayClose(market: string, day: ISODate) {
    const c = this.closes.find((x) => x.market === market && x.day === day);
    return c ? structuredClone(c) : null;
  }

  async dayCloses(f: { market?: string; from?: ISODate; to?: ISODate }) {
    return structuredClone(this.closes.filter((c) => (!f.market || c.market === f.market) && (!f.from || c.day >= f.from) && (!f.to || c.day <= f.to)).sort((a, b) => (a.day === b.day ? (a.market < b.market ? -1 : 1) : a.day < b.day ? -1 : 1)));
  }

  async chart() {
    return structuredClone(this.charts.at(-1) ?? null);
  }

  async chartVersions() {
    return structuredClone(this.charts);
  }

  async addChart(c: ChartOfAccounts) {
    if (this.charts.some((x) => x.version === c.version)) throw new ChartConflictError(`Chart version ${c.version} exists`);
    this.charts.push(structuredClone(c));
  }

  async pendingEvents(limit: number) {
    return structuredClone(this.outbox.filter((e) => !e.publishedAt).slice(0, limit)).map(({ publishedAt: _, ...e }) => e);
  }

  async markPublished(ids: string[], at: Timestamp) {
    for (const e of this.outbox) if (ids.includes(e.id) && !e.publishedAt) e.publishedAt = at;
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
