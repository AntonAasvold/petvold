/**
 * Billing (ADR 0040): payer accounts and premium plans, made from the policy
 * module's events, and invoices made by the invoicing run. Later steps add
 * payments, credit notes, credit balances and unpaid premium.
 *
 * The module never reads another module's tables (ADR 0001). It learns of
 * policies from their events, and reads what an event does not carry (the
 * product's billing settings, the policyholder at renewal) through ports.
 */
import { addDays, marketDate, type ISODate, type Timestamp } from '@petvold/common';
import { PAYMENT_INTERVALS, paymentReference, premiumPlan, type PaymentInterval, type PlanInput, type PremiumPlan, type ReferenceType } from '@petvold/billing-core';

export { PAYMENT_INTERVALS, type PaymentInterval, type PlanInput, type PremiumPlan, type ReferenceType } from '@petvold/billing-core';

/** Days before an installment is due that it goes on an invoice, when the plan does not say (ADR 0040, punkt 5). */
export const DEFAULT_INVOICE_LEAD_DAYS = 20;

/**
 * The law on premiums per market (ADR 0040), shipped with Petvold like the
 * policy module's market profiles. A product can choose within it but never
 * weaken it.
 */
export interface BillingMarketRules {
  market: string;
  /** Days from sending the notice that the first premium is due, never before the term starts. */
  firstPremiumDays: number;
  /** Tax on the premium in basis points. 0: none. */
  premiumTaxBp: number;
  /** The invoice's payment reference: OCR for Bankgirot, or RF (ISO 11649) in EUR markets. */
  paymentReference: ReferenceType;
  sources: string[];
}

export const BILLING_MARKET_RULES: Record<string, BillingMarketRules> = {
  SE: {
    market: 'SE',
    firstPremiumDays: 14,
    premiumTaxBp: 0,
    paymentReference: 'ocr',
    sources: [
      'Insurance Contracts Act (2005:104) chapter 5 section 1: the first premium within fourteen days of the notice, never before the insurance period starts',
      'Sweden has no tax on non-life insurance premiums for pets',
      'Bankgirot, OCR reference control: a reference with a length digit and a mod 10 check digit',
      'Accounting Act (1999:1078) chapter 5 section 7: invoices numbered in an unbroken series',
    ],
  },
};

/** One payer per market and currency (ADR 0040, punkt 2). The payer is the policyholder. */
export interface PayerAccount {
  id: string;
  partyId: string;
  market: string;
  currency: string;
  /** How the payer pays. Only invoice until payments exists (ADR 0040, steg 3). */
  paymentMethod: 'invoice';
  createdAt: Timestamp;
}

/**
 * A premium plan for one term of a policy. Never changes: a change is a new
 * plan that replaces it (ADR 0040, punkt 3).
 */
export interface PlanRecord {
  id: string;
  accountId: string;
  policyId: string;
  termNo: number;
  market: string;
  productVersion: string;
  /** The event it was made from. Unique: the relay delivers at least once. */
  source: { eventId: string; eventType: string; occurredAt: Timestamp };
  /** What it was computed from, so it can be recomputed (ADR 0018). */
  input: PlanInput;
  plan: PremiumPlan;
  /** From the product when the plan was made. Omitted: DEFAULT_INVOICE_LEAD_DAYS. */
  invoiceLeadDays?: number;
  createdAt: Timestamp;
}

/** One installment of a plan on an invoice. */
export interface InvoiceLine {
  planId: string;
  policyId: string;
  termNo: number;
  /** The installment's seq in the plan. A plan's installment is invoiced at most once. */
  seq: number;
  periodStart: ISODate;
  /** Exclusive. */
  periodEnd: ISODate;
  premium: number;
  tax: number;
  fee: number;
  amount: number;
}

/**
 * An invoice (ADR 0040, punkt 5): the installments of one payer account due
 * within the lead time. Never changes; a correction is a credit note.
 */
export interface Invoice {
  id: string;
  /** From the market's unbroken series, e.g. SE-2026-000001. */
  number: string;
  accountId: string;
  partyId: string;
  market: string;
  currency: string;
  issueDate: ISODate;
  /** The earliest line's due date, but never before a new policy's first premium on it may be due. */
  dueDate: ISODate;
  reference: { type: ReferenceType; value: string };
  lines: InvoiceLine[];
  total: number;
  /** The invoicing run that made it: 'scheduler' or a person. */
  createdBy: string;
  createdAt: Timestamp;
}

/** What the module tells others (ADR 0008, 0033). Written with the change. */
export interface BillingEvent {
  id: string;
  type: 'invoice.issued';
  invoiceId: string;
  market: string;
  occurredAt: Timestamp;
  data: Record<string, unknown>;
  /** Its position in the module's outbox, set when read from it. Increasing, with gaps where a transaction rolled back. */
  sequence?: number;
}

/** An invoice the run makes, or would make in a dry run. */
export interface PlannedInvoice {
  accountId: string;
  issueDate: ISODate;
  dueDate: ISODate;
  lines: InvoiceLine[];
  total: number;
}

export interface InvoicingRunResult {
  market: string;
  onDate: ISODate;
  dryRun: boolean;
  /** Plans looked at. */
  checked: number;
  /** The invoices made; in a dry run, those that would be made, without ids. */
  invoices: (PlannedInvoice & { invoiceId?: string; number?: string })[];
}

export interface InvoiceFilter {
  accountId?: string;
  policyId?: string;
  market?: string;
}

/** An event from another module, as the relay hands it over. */
export interface SourceEvent {
  id: string;
  type: string;
  policyId?: string;
  occurredAt: Timestamp;
  data: Record<string, unknown>;
}

/** What billing reads from the product catalog. */
export interface ProductSource {
  /** The product version's market, currency and billing settings with defaults. null: no such version. */
  billing(productVersion: string): Promise<{
    market: string;
    currency: string;
    paymentIntervals: PaymentInterval[];
    defaultPaymentInterval: PaymentInterval;
    installmentFee: number;
    invoiceLeadDays: number;
  } | null>;
}

/** What billing reads from the policy module. */
export interface PolicySource {
  /** The policyholder on a day. null: no such policy. */
  policyholderOn(policyId: string, date: ISODate): Promise<string | null>;
}

export interface BillingStore {
  /**
   * Stores the plan, and the payer account if the party has none in the market
   * and currency, in one transaction. false, and nothing stored, if the source
   * event already gave a plan. The plan's accountId is set to the account's.
   */
  addPlan(account: PayerAccount, plan: PlanRecord): Promise<boolean>;
  account(id: string): Promise<PayerAccount | null>;
  accountFor(partyId: string, market: string, currency: string): Promise<PayerAccount | null>;
  /** Oldest first. */
  accounts(filter: { partyId?: string; market?: string }): Promise<PayerAccount[]>;
  /** Oldest first. */
  plans(filter: { policyId?: string; accountId?: string; market?: string }): Promise<PlanRecord[]>;
  /** The seqs already invoiced per plan. */
  invoicedSeqs(planIds: string[]): Promise<Map<string, Set<number>>>;
  /**
   * Takes the next number in the market's series for the year and stores the
   * invoice with it and its events, in one transaction. The number and the
   * reference come from `numbered`. Throws InvoiceConflictError, and stores
   * nothing, if a line's installment is already invoiced.
   */
  addInvoice(market: string, year: number, numbered: (no: number) => Invoice, events: (i: Invoice) => BillingEvent[]): Promise<Invoice>;
  invoice(id: string): Promise<Invoice | null>;
  /** Oldest first. */
  invoices(filter: InvoiceFilter): Promise<Invoice[]>;
  /** Unpublished events, oldest first. */
  pendingEvents(limit: number): Promise<BillingEvent[]>;
  markPublished(ids: string[], at: Timestamp): Promise<void>;
}

export class InvoiceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceConflictError';
  }
}

export type BillingErrorCode = 'validation' | 'not_found';

export class BillingError extends Error {
  constructor(
    public readonly code: BillingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

export interface BillingDeps {
  store: BillingStore;
  products: ProductSource;
  policies: PolicySource;
  clock: { now(): Timestamp };
  ids: { next(prefix: string): string };
  /** Defaults to BILLING_MARKET_RULES. */
  rules?: Record<string, BillingMarketRules>;
}

export class BillingService {
  constructor(private readonly d: BillingDeps) {}

  /**
   * Makes the premium plan a policy event calls for: policy.issued and
   * policy.renewed give a plan for the term. Repeats give nothing new, so the
   * relay may deliver an event more than once. Returns the new plan, or null.
   */
  async handlePolicyEvent(e: SourceEvent): Promise<PlanRecord | null> {
    if (e.type !== 'policy.issued' && e.type !== 'policy.renewed') return null;
    if (!e.policyId) throw new Error(`Event ${e.id} has no policy`);
    const data = e.data as {
      termNo?: number;
      policyholderPartyId?: string;
      productVersion: string;
      startDate: ISODate;
      endDate: ISODate;
      premium: { amount: number; currency: string };
    };
    const product = await this.d.products.billing(data.productVersion);
    if (!product) throw new Error(`The product version ${data.productVersion} of event ${e.id} does not exist`);
    const rules = (this.d.rules ?? BILLING_MARKET_RULES)[product.market];
    if (!rules) throw new Error(`No billing rules for the market ${product.market} (event ${e.id})`);
    const issued = e.type === 'policy.issued';
    const termNo = issued ? 1 : Number(data.termNo);
    const partyId = issued ? data.policyholderPartyId : await this.d.policies.policyholderOn(e.policyId, data.startDate);
    if (!partyId) throw new Error(`No policyholder for event ${e.id}`);

    // The chosen interval is kept from term to term while the product allows it (ADR 0040, punkt 2).
    const previous = issued ? undefined : (await this.d.store.plans({ policyId: e.policyId })).filter((p) => p.termNo < termNo).at(-1);
    const interval = previous && product.paymentIntervals.includes(previous.plan.interval) ? previous.plan.interval : product.defaultPaymentInterval;

    const input: PlanInput = {
      currency: data.premium.currency,
      termStart: data.startDate,
      termEnd: data.endDate,
      termPremium: data.premium.amount,
      interval,
      ...(product.installmentFee > 0 ? { installmentFee: product.installmentFee } : {}),
      ...(rules.premiumTaxBp > 0 ? { premiumTaxBp: rules.premiumTaxBp } : {}),
      // The notice goes with the policy confirmation, made from the same event.
      ...(issued ? { firstPremium: { noticeSentOn: marketDate(product.market, e.occurredAt), payWithinDays: rules.firstPremiumDays } } : {}),
    };
    const now = this.d.clock.now();
    const account: PayerAccount = (await this.d.store.accountFor(partyId, product.market, input.currency)) ?? {
      id: this.d.ids.next('bac'),
      partyId,
      market: product.market,
      currency: input.currency,
      paymentMethod: 'invoice',
      createdAt: now,
    };
    const record: PlanRecord = {
      id: this.d.ids.next('ppl'),
      accountId: account.id,
      policyId: e.policyId,
      termNo,
      market: product.market,
      productVersion: data.productVersion,
      source: { eventId: e.id, eventType: e.type, occurredAt: e.occurredAt },
      input,
      plan: premiumPlan(input),
      invoiceLeadDays: product.invoiceLeadDays,
      createdAt: now,
    };
    if (!(await this.d.store.addPlan(account, record))) return null;
    return (await this.d.store.plans({ policyId: e.policyId })).find((p) => p.id === record.id) ?? null;
  }

  async account(id: string): Promise<PayerAccount> {
    const a = await this.d.store.account(id);
    if (!a) throw new BillingError('not_found', `Payer account ${id} does not exist`);
    return a;
  }

  async accounts(filter: { partyId?: string; market?: string }): Promise<PayerAccount[]> {
    return this.d.store.accounts(filter);
  }

  async plans(filter: { policyId?: string; accountId?: string }): Promise<PlanRecord[]> {
    if (!filter.policyId && !filter.accountId) throw new BillingError('validation', 'policyId or accountId is required');
    return this.d.store.plans(filter);
  }

  async invoice(id: string): Promise<Invoice> {
    const i = await this.d.store.invoice(id);
    if (!i) throw new BillingError('not_found', `Invoice ${id} does not exist`);
    return i;
  }

  async invoices(filter: InvoiceFilter): Promise<Invoice[]> {
    return this.d.store.invoices(filter);
  }

  /**
   * The invoicing run for one market (ADR 0040, punkt 5): every installment not
   * yet invoiced that is due within its plan's lead time goes on one invoice
   * per payer account. The first premium of a new policy is due at the
   * earliest the market's days after the invoice is issued (FAL 5 kap. 1 §).
   * A dry run says what would be invoiced and stores nothing. A plan whose
   * installment another run invoiced meanwhile is left for the next run.
   */
  async invoicingRun(input: { market: string; onDate: ISODate; dryRun: boolean }, by: string): Promise<InvoicingRunResult> {
    const rules = (this.d.rules ?? BILLING_MARKET_RULES)[input.market];
    if (!rules) throw new BillingError('validation', `No billing rules for the market ${input.market}`);
    const plans = await this.d.store.plans({ market: input.market });
    const invoiced = await this.d.store.invoicedSeqs(plans.map((p) => p.id));
    const byAccount = new Map<string, InvoiceLine[]>();
    const dueOf = new Map<InvoiceLine, ISODate>();
    /** A new policy's first premium: never due before the market's days after the invoice. */
    const firstPremiumMin = new Map<InvoiceLine, ISODate>();
    for (const p of plans) {
      const horizon = addDays(input.onDate, p.invoiceLeadDays ?? DEFAULT_INVOICE_LEAD_DAYS);
      const done = invoiced.get(p.id) ?? new Set<number>();
      for (const i of p.plan.installments) {
        if (done.has(i.seq) || i.dueDate > horizon) continue;
        const line: InvoiceLine = { planId: p.id, policyId: p.policyId, termNo: p.termNo, seq: i.seq, periodStart: i.periodStart, periodEnd: i.periodEnd, premium: i.premium, tax: i.tax, fee: i.fee, amount: i.amount };
        const first = i.seq === 1 && p.input.firstPremium;
        const min = first ? addDays(input.onDate, p.input.firstPremium!.payWithinDays) : undefined;
        if (min) firstPremiumMin.set(line, min);
        dueOf.set(line, min ? maxDate(i.dueDate, min) : i.dueDate);
        byAccount.set(p.accountId, [...(byAccount.get(p.accountId) ?? []), line]);
      }
    }
    const result: InvoicingRunResult = { market: input.market, onDate: input.onDate, dryRun: input.dryRun, checked: plans.length, invoices: [] };
    for (const [accountId, lines] of [...byAccount].sort(([a], [b]) => (a < b ? -1 : 1))) {
      lines.sort((a, b) => (dueOf.get(a)! < dueOf.get(b)! ? -1 : dueOf.get(a)! > dueOf.get(b)! ? 1 : a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : a.seq - b.seq));
      const planned: PlannedInvoice = {
        accountId,
        issueDate: input.onDate,
        // The earliest line's, but never before a first premium on it may be due.
        dueDate: [lines.map((l) => dueOf.get(l)!).sort()[0]!, ...lines.flatMap((l) => (firstPremiumMin.has(l) ? [firstPremiumMin.get(l)!] : []))].sort().at(-1)!,
        lines,
        total: lines.reduce((s, l) => s + l.amount, 0),
      };
      if (input.dryRun) {
        result.invoices.push(planned);
        continue;
      }
      const account = (await this.d.store.account(accountId))!;
      const now = this.d.clock.now();
      const year = Number(input.onDate.slice(0, 4));
      try {
        const inv = await this.d.store.addInvoice(
          input.market,
          year,
          (no) => ({
            id: this.d.ids.next('inv'),
            number: `${input.market}-${year}-${String(no).padStart(6, '0')}`,
            accountId,
            partyId: account.partyId,
            market: input.market,
            currency: account.currency,
            issueDate: planned.issueDate,
            dueDate: planned.dueDate,
            reference: { type: rules.paymentReference, value: paymentReference(rules.paymentReference, `${year}${String(no).padStart(6, '0')}`) },
            lines: planned.lines,
            total: planned.total,
            createdBy: by,
            createdAt: now,
          }),
          (i) => [
            {
              id: this.d.ids.next('bev'),
              type: 'invoice.issued',
              invoiceId: i.id,
              market: i.market,
              occurredAt: now,
              data: {
                invoiceNo: i.number,
                accountId: i.accountId,
                partyId: i.partyId,
                issueDate: i.issueDate,
                dueDate: i.dueDate,
                total: i.total,
                currency: i.currency,
                reference: i.reference.value,
                policyIds: [...new Set(i.lines.map((l) => l.policyId))],
              },
            },
          ],
        );
        result.invoices.push({ ...planned, invoiceId: inv.id, number: inv.number });
      } catch (e) {
        if (!(e instanceof InvoiceConflictError)) throw e;
      }
    }
    return result;
  }

  /**
   * When the party last had a relation in billing, for retention (ADR 0028,
   * 0040 punkt 11): ongoing while a planned term has not ended, else the last
   * term's end. Invoices and payments are kept for seven years whatever this says.
   */
  async activityOf(partyId: string): Promise<{ ongoing: true } | { lastDate: ISODate } | null> {
    const now = this.d.clock.now();
    const ends: ISODate[] = [];
    for (const a of await this.d.store.accounts({ partyId })) {
      for (const p of await this.d.store.plans({ accountId: a.id })) {
        if (p.plan.termEnd > marketDate(a.market, now)) return { ongoing: true };
        ends.push(p.plan.termEnd);
      }
    }
    const last = ends.sort().at(-1);
    return last ? { lastDate: last } : null;
  }
}

export class InMemoryBillingStore implements BillingStore {
  private readonly accountsById = new Map<string, PayerAccount>();
  private readonly planList: PlanRecord[] = [];
  private readonly invoiceList: Invoice[] = [];
  private readonly series = new Map<string, number>();
  private readonly outbox: (BillingEvent & { publishedAt?: Timestamp })[] = [];

  async addPlan(account: PayerAccount, plan: PlanRecord): Promise<boolean> {
    if (this.planList.some((p) => p.source.eventId === plan.source.eventId)) return false;
    const existing = [...this.accountsById.values()].find((a) => a.partyId === account.partyId && a.market === account.market && a.currency === account.currency);
    const acc = existing ?? structuredClone(account);
    if (!existing) this.accountsById.set(acc.id, acc);
    this.planList.push({ ...structuredClone(plan), accountId: acc.id });
    return true;
  }

  async account(id: string) {
    const a = this.accountsById.get(id);
    return a ? structuredClone(a) : null;
  }

  async accountFor(partyId: string, market: string, currency: string) {
    const a = [...this.accountsById.values()].find((x) => x.partyId === partyId && x.market === market && x.currency === currency);
    return a ? structuredClone(a) : null;
  }

  async accounts(filter: { partyId?: string; market?: string }) {
    return structuredClone(
      [...this.accountsById.values()]
        .filter((a) => (!filter.partyId || a.partyId === filter.partyId) && (!filter.market || a.market === filter.market))
        .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1)),
    );
  }

  async plans(filter: { policyId?: string; accountId?: string; market?: string }) {
    return structuredClone(
      this.planList
        .filter((p) => (!filter.policyId || p.policyId === filter.policyId) && (!filter.accountId || p.accountId === filter.accountId) && (!filter.market || p.market === filter.market))
        .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1)),
    );
  }

  async invoicedSeqs(planIds: string[]) {
    const out = new Map<string, Set<number>>();
    for (const i of this.invoiceList) for (const l of i.lines) if (planIds.includes(l.planId)) out.set(l.planId, (out.get(l.planId) ?? new Set()).add(l.seq));
    return out;
  }

  async addInvoice(market: string, year: number, numbered: (no: number) => Invoice, events: (i: Invoice) => BillingEvent[]) {
    const key = `${market}:${year}`;
    const inv = numbered((this.series.get(key) ?? 0) + 1);
    const taken = await this.invoicedSeqs(inv.lines.map((l) => l.planId));
    if (inv.lines.some((l) => taken.get(l.planId)?.has(l.seq))) throw new InvoiceConflictError(`An installment on invoice ${inv.id} is already invoiced`);
    this.series.set(key, (this.series.get(key) ?? 0) + 1);
    this.invoiceList.push(structuredClone(inv));
    this.outbox.push(...structuredClone(events(inv)));
    return structuredClone(inv);
  }

  async invoice(id: string) {
    const i = this.invoiceList.find((x) => x.id === id);
    return i ? structuredClone(i) : null;
  }

  async invoices(filter: InvoiceFilter) {
    return structuredClone(
      this.invoiceList.filter(
        (i) =>
          (!filter.accountId || i.accountId === filter.accountId) &&
          (!filter.market || i.market === filter.market) &&
          (!filter.policyId || i.lines.some((l) => l.policyId === filter.policyId)),
      ).sort((a, b) => (a.createdAt === b.createdAt ? (a.number < b.number ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1)),
    );
  }

  async pendingEvents(limit: number) {
    return structuredClone(this.outbox.map((e, i) => ({ ...e, sequence: i + 1 })).filter((e) => !e.publishedAt).slice(0, limit)).map(({ publishedAt: _p, ...e }) => e);
  }

  async markPublished(ids: string[], at: Timestamp) {
    for (const e of this.outbox) if (ids.includes(e.id) && !e.publishedAt) e.publishedAt = at;
  }
}

const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);

export const isPaymentInterval = (v: unknown): v is PaymentInterval => (PAYMENT_INTERVALS as readonly unknown[]).includes(v);
