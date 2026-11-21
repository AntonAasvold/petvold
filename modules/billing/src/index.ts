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
import {
  PAYMENT_INTERVALS,
  addMonths,
  applyBpHalfUp,
  daysBetween,
  distributeAdjustment,
  paymentReference,
  premiumPlan,
  reduceInstallments,
  settleTerm,
  splitByWeight,
  type Installment,
  type PaymentInterval,
  type PlanInput,
  type PremiumPlan,
  type ReferenceType,
  type TermLine,
} from '@petvold/billing-core';

export { PAYMENT_INTERVALS, type PaymentInterval, type PlanInput, type PremiumPlan, type ReferenceType } from '@petvold/billing-core';

/** Days before an installment is due that it goes on an invoice, when the plan does not say (ADR 0040, punkt 5). */
export const DEFAULT_INVOICE_LEAD_DAYS = 31;

/**
 * The law on premiums per market (ADR 0040), shipped with Petvold like the
 * policy module's market profiles. A product can choose within it but never
 * weaken it.
 */
export interface BillingMarketRules {
  market: string;
  /** Days from sending the notice that the first premium is due, never before the term starts. */
  firstPremiumDays: number;
  /** Months from sending the invoice that a later premium is due at the earliest, also at renewal. */
  laterPremiumMonths: number;
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
    laterPremiumMonths: 1,
    premiumTaxBp: 0,
    paymentReference: 'ocr',
    sources: [
      'Insurance Contracts Act (2005:104) chapter 5 section 1 first paragraph: the first premium need not be paid earlier than fourteen days after the demand was sent',
      'Insurance Contracts Act chapter 5 section 1 second and third paragraphs: a later premium period, and a renewal, need not be paid earlier than a month after the demand was sent',
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
  /**
   * A plan made by a change, a cancellation or a transfer (ADR 0040, punkt 4):
   * the plan it replaces, and what happened. Its installments are what is left
   * to invoice of the term; what the replaced plan invoiced stays on its invoices.
   */
  replaces?: string;
  adjustment?: PlanAdjustment;
  createdAt: Timestamp;
}

export interface PlanAdjustment {
  kind: 'change' | 'cancellation' | 'reinstatement' | 'transfer-from' | 'transfer-to';
  transactionId: string;
  /** The day it takes effect. */
  from: ISODate;
  /** The premium added (positive) or taken off (negative) for this term. */
  premium: number;
  /** The same for the tax. */
  tax: number;
}

/** What a credit note takes off one line of an invoice. */
export interface CreditNoteLine {
  planId: string;
  policyId: string;
  seq: number;
  amount: number;
}

/**
 * A credit note (ADR 0040, punkt 5): what is taken off an invoice, from the
 * invoice series. Made automatically from a change, a cancellation or a
 * transfer; one per invoice. Never changes.
 */
export interface CreditNote {
  id: string;
  number: string;
  invoiceId: string;
  accountId: string;
  partyId: string;
  market: string;
  currency: string;
  issueDate: ISODate;
  lines: CreditNoteLine[];
  total: number;
  /** The policy event it was made from. */
  source: { eventId: string; eventType: string };
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
  /** The earliest line's due date, but never before any line on it may be due by law. */
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
  type: 'invoice.issued' | 'invoice.credited';
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
  /**
   * Stores what a policy event did to the plans, in one transaction: new plans
   * (each replacing one, or new for a new payer, with its account if it has
   * none), and credit notes numbered from the invoice series. false, and
   * nothing stored, if the event already did it.
   */
  addAdjustment(
    input: { market: string; year: number; accounts: PayerAccount[]; plans: PlanRecord[]; credits: Omit<CreditNote, 'number'>[] },
    numbered: (credit: Omit<CreditNote, 'number'>, no: number) => CreditNote,
    events: (credits: CreditNote[]) => BillingEvent[],
  ): Promise<boolean>;
  /** Oldest first. */
  creditNotes(filter: { invoiceId?: string; accountId?: string; policyId?: string }): Promise<CreditNote[]>;
  creditNote(id: string): Promise<CreditNote | null>;
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
    if (e.type === 'policy.changed' || e.type === 'policy.cancelled' || e.type === 'policy.transferred' || e.type === 'policy.reinstated') return (await this.adjust(e))[0] ?? null;
    if (e.type !== 'policy.issued' && e.type !== 'policy.renewed') return null;
    if (!e.policyId) throw new Error(`Event ${e.id} has no policy`);
    const data = e.data as {
      termNo?: number;
      policyholderPartyId?: string;
      productVersion: string;
      startDate: ISODate;
      endDate: ISODate;
      premium: { amount: number; currency: string };
      /** policy.issued: the customer's choice (ADR 0040). */
      paymentInterval?: string;
    };
    const product = await this.d.products.billing(data.productVersion);
    if (!product) throw new Error(`The product version ${data.productVersion} of event ${e.id} does not exist`);
    const rules = (this.d.rules ?? BILLING_MARKET_RULES)[product.market];
    if (!rules) throw new Error(`No billing rules for the market ${product.market} (event ${e.id})`);
    const issued = e.type === 'policy.issued';
    const termNo = issued ? 1 : Number(data.termNo);
    const partyId = issued ? data.policyholderPartyId : await this.d.policies.policyholderOn(e.policyId, data.startDate);
    if (!partyId) throw new Error(`No policyholder for event ${e.id}`);

    // The customer's choice at issue, kept from term to term while the product allows it (ADR 0040, punkt 2).
    const previous = issued ? undefined : (await this.d.store.plans({ policyId: e.policyId })).filter((p) => p.termNo < termNo).at(-1);
    const chosen = issued ? data.paymentInterval : previous?.plan.interval;
    const interval = chosen && (product.paymentIntervals as string[]).includes(chosen) ? (chosen as PaymentInterval) : product.defaultPaymentInterval;

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

  /** The plans in force: those no other plan replaces. */
  private async currentPlans(filter: { policyId?: string; market?: string }): Promise<PlanRecord[]> {
    const all = await this.d.store.plans(filter);
    const replaced = new Set(all.flatMap((p) => (p.replaces ? [p.replaces] : [])));
    return all.filter((p) => !replaced.has(p.id));
  }

  /**
   * The lines of a term (ADR 0040, punkt 4): what is invoiced from any of the
   * term's plans for the account, with what is still owed after credit notes,
   * and the installments of the plan in force that are not invoiced yet.
   */
  private async termLines(plan: PlanRecord): Promise<{ lines: (TermLine & { invoiceId?: string; planId: string; seq: number })[]; uninvoiced: Installment[] }> {
    const termPlans = (await this.d.store.plans({ policyId: plan.policyId })).filter((p) => p.termNo === plan.termNo && p.accountId === plan.accountId);
    const ids = new Set(termPlans.map((p) => p.id));
    const invoices = (await this.d.store.invoices({ policyId: plan.policyId })).filter((i) => i.accountId === plan.accountId);
    const credited = new Map<string, number>();
    for (const c of await this.d.store.creditNotes({ policyId: plan.policyId })) for (const l of c.lines) credited.set(`${l.planId}#${l.seq}`, (credited.get(`${l.planId}#${l.seq}`) ?? 0) + l.amount);
    const lines: (TermLine & { invoiceId?: string; planId: string; seq: number })[] = [];
    for (const inv of invoices) {
      for (const l of inv.lines) {
        if (!ids.has(l.planId)) continue;
        const key = `${l.planId}#${l.seq}`;
        lines.push({ key, invoiceId: inv.id, planId: l.planId, seq: l.seq, dueDate: inv.dueDate, premium: l.premium, tax: l.tax, fee: l.fee, open: l.amount - (credited.get(key) ?? 0), invoiced: true });
      }
    }
    const done = (await this.d.store.invoicedSeqs([plan.id])).get(plan.id) ?? new Set<number>();
    const uninvoiced = plan.plan.installments.filter((i) => !done.has(i.seq));
    for (const i of uninvoiced) lines.push({ key: `${plan.id}#${i.seq}`, planId: plan.id, seq: i.seq, dueDate: i.dueDate, premium: i.premium, tax: i.tax, fee: i.fee, open: i.amount, invoiced: false });
    return { lines, uninvoiced };
  }

  /** A plan that replaces another with new installments, its totals summed from them. */
  private replacement(e: SourceEvent, old: PlanRecord, installments: Installment[], adjustment: PlanAdjustment, now: Timestamp): PlanRecord {
    const tax = old.plan.tax + adjustment.tax;
    const termPremium = old.plan.termPremium + adjustment.premium;
    const fees = installments.reduce((s, i) => s + i.fee, 0);
    return {
      ...structuredClone(old),
      id: this.d.ids.next('ppl'),
      source: { eventId: e.id, eventType: e.type, occurredAt: e.occurredAt },
      plan: {
        ...structuredClone(old.plan),
        model: 'premium-plan.v1',
        termPremium,
        tax,
        fees,
        total: installments.reduce((s, i) => s + i.amount, 0),
        installments,
      },
      replaces: old.id,
      adjustment,
      createdAt: now,
    };
  }

  /**
   * What a change, a cancellation or a transfer does to the plans and the
   * invoices (ADR 0040, punkt 4 and beslut 2026-11-21). Returns the new plans;
   * none if the event already did it or concerns no plan.
   */
  private async adjust(e: SourceEvent): Promise<PlanRecord[]> {
    if (!e.policyId) throw new Error(`Event ${e.id} has no policy`);
    const now = this.d.clock.now();
    const current = await this.currentPlans({ policyId: e.policyId });
    if (current.length === 0) return [];
    const market = current[0]!.market;
    const rules = (this.d.rules ?? BILLING_MARKET_RULES)[market];
    if (!rules) throw new Error(`No billing rules for the market ${market} (event ${e.id})`);
    const eventDate = marketDate(market, e.occurredAt);
    const transactionId = String(e.data.transactionId ?? '');
    const plans: PlanRecord[] = [];
    const accounts: PayerAccount[] = [];
    const creditLines: { invoiceId: string; line: CreditNoteLine }[] = [];

    if (e.type === 'policy.reinstated') {
      // The cancellation is reversed (ADR 0040, punkt 4): each term gets back the installments the cancellation
      // took out, and what it credited is charged again. Only a cancellation plan still in force can be reversed.
      const reverses = String(e.data.reverses ?? '');
      const all = await this.d.store.plans({ policyId: e.policyId });
      for (const cancelPlan of current.filter((p) => p.adjustment?.kind === 'cancellation' && p.adjustment.transactionId === reverses)) {
        const before = all.find((p) => p.id === cancelPlan.replaces)!;
        const doneBefore = (await this.d.store.invoicedSeqs([before.id])).get(before.id) ?? new Set<number>();
        let installments = before.plan.installments.filter((i) => !doneBefore.has(i.seq)).map((i) => ({ ...i }));
        const credited = (await this.d.store.creditNotes({ policyId: e.policyId }))
          .filter((c) => c.source.eventId === cancelPlan.source.eventId)
          .flatMap((c) => c.lines)
          .filter((l) => all.some((p) => p.id === l.planId && p.termNo === cancelPlan.termNo && p.accountId === cancelPlan.accountId))
          .reduce((s, l) => s + l.amount, 0);
        const { lines } = await this.termLines(cancelPlan);
        // A charge the cancellation made and that is invoiced is paid for by the restored installments: it comes off them.
        const doneCancel = (await this.d.store.invoicedSeqs([cancelPlan.id])).get(cancelPlan.id) ?? new Set<number>();
        const chargedAlready = cancelPlan.plan.installments.filter((i) => doneCancel.has(i.seq)).reduce((s, i) => s + i.amount, 0);
        let rest = 0;
        if (chargedAlready > 0) {
          const r = reduceInstallments(chargedAlready, installments.map((i) => ({ seq: i.seq, premium: i.amount })));
          installments = installments.map((i) => {
            const off = r.parts.find((x) => x.seq === i.seq)?.amount ?? 0;
            return { ...i, premium: i.premium - Math.min(off, i.premium), tax: i.tax - Math.max(0, off - i.premium), amount: i.amount - off };
          });
          rest = r.rest;
        }
        const recharge = credited - rest;
        if (recharge > 0) {
          const seq = Math.max(0, ...lines.map((l) => l.seq), ...installments.map((i) => i.seq)) + 1;
          installments.push({ seq, periodStart: cancelPlan.plan.termStart, periodEnd: cancelPlan.plan.termEnd, dueDate: eventDate, premium: recharge, tax: 0, fee: 0, amount: recharge });
        }
        installments.sort((a, b) => a.seq - b.seq);
        plans.push(this.replacement(e, cancelPlan, installments, { kind: 'reinstatement', transactionId, from: cancelPlan.adjustment!.from, premium: -cancelPlan.adjustment!.premium, tax: -cancelPlan.adjustment!.tax }, now));
      }
      if (plans.length === 0) return [];
    } else if (e.type === 'policy.changed') {
      const d = e.data as { termNo: number; from: ISODate; premiumAdjustment: number };
      const plan = current.find((p) => p.termNo === Number(d.termNo));
      if (!plan || !d.premiumAdjustment) return [];
      const taxDelta = applyBpHalfUp(Math.max(0, plan.plan.termPremium + d.premiumAdjustment), plan.plan.premiumTaxBp) - plan.plan.tax;
      const { lines, uninvoiced } = await this.termLines(plan);
      let installments = uninvoiced.map((i) => ({ ...i }));
      if (d.premiumAdjustment > 0) {
        const p = distributeAdjustment(d.premiumAdjustment, installments.map((i) => i.seq));
        const t = distributeAdjustment(taxDelta, installments.map((i) => i.seq));
        if (p.kind === 'spread') {
          const taxOf = new Map(t.kind === 'spread' ? t.parts.map((x) => [x.seq, x.amount]) : []);
          installments = installments.map((i) => {
            const add = p.parts.find((x) => x.seq === i.seq)?.amount ?? 0;
            const addTax = taxOf.get(i.seq) ?? 0;
            return { ...i, premium: i.premium + add, tax: i.tax + addTax, amount: i.amount + add + addTax };
          });
        } else {
          // Everything is invoiced: the rest of the term on its own (FAL 5 kap. 1 § sets its due date when invoiced).
          const seq = Math.max(0, ...lines.map((l) => l.seq)) + 1;
          installments.push({ seq, periodStart: maxDate(d.from, plan.plan.termStart), periodEnd: plan.plan.termEnd, dueDate: eventDate, premium: d.premiumAdjustment, tax: taxDelta, fee: 0, amount: d.premiumAdjustment + taxDelta });
        }
      } else {
        // A lower premium comes off what is not invoiced yet; only the rest is credited (beslut 2026-11-21).
        const r = reduceInstallments(-d.premiumAdjustment, installments);
        const rt = reduceInstallments(-taxDelta, installments.map((i) => ({ seq: i.seq, premium: i.tax })));
        installments = installments.map((i) => {
          const off = r.parts.find((x) => x.seq === i.seq)?.amount ?? 0;
          const offTax = rt.parts.find((x) => x.seq === i.seq)?.amount ?? 0;
          return { ...i, premium: i.premium - off, tax: i.tax - offTax, amount: i.amount - off - offTax };
        });
        let rest = r.rest + rt.rest;
        // The newest invoiced lines first: the months nearest the end of the term.
        for (const l of lines.filter((x) => x.invoiced && x.open > 0).sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0))) {
          if (rest === 0) break;
          const amount = Math.min(rest, l.open);
          creditLines.push({ invoiceId: l.invoiceId!, line: { planId: l.planId, policyId: plan.policyId, seq: l.seq, amount } });
          rest -= amount;
        }
      }
      plans.push(this.replacement(e, plan, installments, { kind: 'change', transactionId, from: d.from, premium: d.premiumAdjustment, tax: taxDelta }, now));
    } else {
      // A cancellation or a transfer: the premium back, split over the terms by the days they lose.
      const cancelled = e.type === 'policy.cancelled';
      const d = e.data as { effectiveDate?: ISODate; from?: ISODate; refund?: { amount: number }; premium?: { amount: number }; toPartyId?: string };
      const from = (cancelled ? d.effectiveDate : d.from)!;
      const back = (cancelled ? d.refund?.amount : d.premium?.amount) ?? 0;
      const affected = current.filter((p) => p.plan.termEnd > from).sort((a, b) => a.termNo - b.termNo);
      if (affected.length === 0) return [];
      const shares = splitByWeight(back, affected.map((p) => daysBetween(maxDate(from, p.plan.termStart), p.plan.termEnd)));
      for (const [k, plan] of affected.entries()) {
        const share = Math.min(shares[k]!, plan.plan.termPremium);
        const taxReduction = plan.plan.tax - applyBpHalfUp(plan.plan.termPremium - share, plan.plan.premiumTaxBp);
        const { lines } = await this.termLines(plan);
        const settled = settleTerm({ lines, premiumReduction: share, taxReduction });
        for (const c of settled.credited) {
          const l = lines.find((x) => x.key === c.key)!;
          creditLines.push({ invoiceId: l.invoiceId!, line: { planId: l.planId, policyId: plan.policyId, seq: l.seq, amount: c.amount } });
        }
        const installments: Installment[] = [];
        if (settled.newCharge > 0) {
          const seq = Math.max(0, ...lines.map((l) => l.seq)) + 1;
          // The tax's part of the charge, as the tax's part of what the term now costs.
          const newTax = plan.plan.tax - taxReduction;
          const tax = settled.newTotal > 0 ? Math.round((settled.newCharge * newTax) / settled.newTotal) : 0;
          const end = minDate(from, plan.plan.termEnd);
          installments.push({ seq, periodStart: plan.plan.termStart, periodEnd: end > plan.plan.termStart ? end : plan.plan.termEnd, dueDate: eventDate, premium: settled.newCharge - tax, tax, fee: 0, amount: settled.newCharge });
        }
        plans.push(this.replacement(e, plan, installments, { kind: cancelled ? 'cancellation' : 'transfer-from', transactionId, from, premium: -share, tax: -taxReduction }, now));

        // The new owner pays from the sale day to the end of the term, the same amount (ADR 0040, punkt 4).
        if (!cancelled && share > 0) {
          const partyId = d.toPartyId!;
          const product = await this.d.products.billing(plan.productVersion);
          const interval = product && product.paymentIntervals.includes(plan.plan.interval) ? plan.plan.interval : (product?.defaultPaymentInterval ?? 'year');
          const account = (await this.d.store.accountFor(partyId, market, plan.plan.currency)) ??
            accounts.find((a) => a.partyId === partyId) ?? { id: this.d.ids.next('bac'), partyId, market, currency: plan.plan.currency, paymentMethod: 'invoice' as const, createdAt: now };
          if (!accounts.includes(account)) accounts.push(account);
          const input: PlanInput = {
            currency: plan.plan.currency,
            termStart: maxDate(from, plan.plan.termStart),
            termEnd: plan.plan.termEnd,
            termPremium: share,
            interval,
            ...(product && product.installmentFee > 0 ? { installmentFee: product.installmentFee } : {}),
            ...(plan.plan.premiumTaxBp > 0 ? { premiumTaxBp: plan.plan.premiumTaxBp } : {}),
            firstPremium: { noticeSentOn: eventDate, payWithinDays: rules.firstPremiumDays },
          };
          plans.push({
            id: this.d.ids.next('ppl'),
            accountId: account.id,
            policyId: plan.policyId,
            termNo: plan.termNo,
            market,
            productVersion: plan.productVersion,
            source: { eventId: e.id, eventType: e.type, occurredAt: e.occurredAt },
            input,
            plan: premiumPlan(input),
            ...(product ? { invoiceLeadDays: product.invoiceLeadDays } : {}),
            adjustment: { kind: 'transfer-to', transactionId, from, premium: share, tax: applyBpHalfUp(share, plan.plan.premiumTaxBp) },
            createdAt: now,
          });
        }
      }
    }

    // One credit note per invoice.
    const byInvoice = new Map<string, CreditNoteLine[]>();
    for (const c of creditLines) byInvoice.set(c.invoiceId, [...(byInvoice.get(c.invoiceId) ?? []), c.line]);
    const credits: Omit<CreditNote, 'number'>[] = [];
    for (const [invoiceId, lines] of byInvoice) {
      const inv = (await this.d.store.invoice(invoiceId))!;
      credits.push({
        id: this.d.ids.next('crn'),
        invoiceId,
        accountId: inv.accountId,
        partyId: inv.partyId,
        market,
        currency: inv.currency,
        issueDate: eventDate,
        lines,
        total: lines.reduce((s, l) => s + l.amount, 0),
        source: { eventId: e.id, eventType: e.type },
        createdAt: now,
      });
    }
    const year = Number(eventDate.slice(0, 4));
    const stored = await this.d.store.addAdjustment(
      { market, year, accounts, plans, credits },
      (c, no) => ({ ...c, number: `${market}-${year}-${String(no).padStart(6, '0')}` }),
      (made) =>
        made.map((c) => ({
          id: this.d.ids.next('bev'),
          type: 'invoice.credited' as const,
          invoiceId: c.invoiceId,
          market,
          occurredAt: now,
          data: { creditNoteId: c.id, creditNoteNo: c.number, accountId: c.accountId, partyId: c.partyId, total: c.total, currency: c.currency, reason: e.type },
        })),
    );
    return stored ? plans : [];
  }

  async creditNotes(filter: { invoiceId?: string; accountId?: string; policyId?: string }): Promise<CreditNote[]> {
    return this.d.store.creditNotes(filter);
  }

  async creditNote(id: string): Promise<CreditNote> {
    const c = await this.d.store.creditNote(id);
    if (!c) throw new BillingError('not_found', `Credit note ${id} does not exist`);
    return c;
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
   * per payer account. By law (in Sweden FAL 5 kap. 1 §) the first premium of
   * a new policy is due at the earliest fourteen days after the invoice, and a
   * later premium a month after; the invoice is never due before any of its lines.
   * A dry run says what would be invoiced and stores nothing. A plan whose
   * installment another run invoiced meanwhile is left for the next run.
   */
  async invoicingRun(input: { market: string; onDate: ISODate; dryRun: boolean }, by: string): Promise<InvoicingRunResult> {
    const rules = (this.d.rules ?? BILLING_MARKET_RULES)[input.market];
    if (!rules) throw new BillingError('validation', `No billing rules for the market ${input.market}`);
    const plans = await this.currentPlans({ market: input.market });
    const invoiced = await this.d.store.invoicedSeqs(plans.map((p) => p.id));
    const byAccount = new Map<string, InvoiceLine[]>();
    const dueOf = new Map<InvoiceLine, ISODate>();
    /** The law's earliest due date per line, counted from the invoice: days for a first premium, months for a later one. */
    const minDue = new Map<InvoiceLine, ISODate>();
    for (const p of plans) {
      const horizon = addDays(input.onDate, p.invoiceLeadDays ?? DEFAULT_INVOICE_LEAD_DAYS);
      const done = invoiced.get(p.id) ?? new Set<number>();
      for (const i of p.plan.installments) {
        if (done.has(i.seq) || i.dueDate > horizon) continue;
        const line: InvoiceLine = { planId: p.id, policyId: p.policyId, termNo: p.termNo, seq: i.seq, periodStart: i.periodStart, periodEnd: i.periodEnd, premium: i.premium, tax: i.tax, fee: i.fee, amount: i.amount };
        const first = i.seq === 1 && p.input.firstPremium;
        const min = first ? addDays(input.onDate, p.input.firstPremium!.payWithinDays) : addMonths(input.onDate, rules.laterPremiumMonths);
        minDue.set(line, min);
        dueOf.set(line, maxDate(i.dueDate, min));
        byAccount.set(p.accountId, [...(byAccount.get(p.accountId) ?? []), line]);
      }
    }
    const result: InvoicingRunResult = { market: input.market, onDate: input.onDate, dryRun: input.dryRun, checked: plans.length, invoices: [] };
    for (const [accountId, lines] of [...byAccount].sort(([a], [b]) => (a < b ? -1 : 1))) {
      lines.sort((a, b) => (dueOf.get(a)! < dueOf.get(b)! ? -1 : dueOf.get(a)! > dueOf.get(b)! ? 1 : a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : a.seq - b.seq));
      const planned: PlannedInvoice = {
        accountId,
        issueDate: input.onDate,
        // The earliest line's, but never before any line on it may be due by law.
        dueDate: [lines.map((l) => dueOf.get(l)!).sort()[0]!, ...lines.map((l) => minDue.get(l)!)].sort().at(-1)!,
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
  private readonly creditList: CreditNote[] = [];
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

  async addAdjustment(
    input: { market: string; year: number; accounts: PayerAccount[]; plans: PlanRecord[]; credits: Omit<CreditNote, 'number'>[] },
    numbered: (credit: Omit<CreditNote, 'number'>, no: number) => CreditNote,
    events: (credits: CreditNote[]) => BillingEvent[],
  ) {
    const eventId = input.plans[0]?.source.eventId ?? input.credits[0]?.source.eventId;
    if (eventId && (this.planList.some((p) => p.source.eventId === eventId && p.adjustment) || this.creditList.some((c) => c.source.eventId === eventId))) return false;
    if (input.plans.some((p) => p.replaces && this.planList.some((q) => q.replaces === p.replaces))) throw new InvoiceConflictError('A plan is already replaced');
    for (const a of input.accounts) if (![...this.accountsById.values()].some((x) => x.partyId === a.partyId && x.market === a.market && x.currency === a.currency)) this.accountsById.set(a.id, structuredClone(a));
    const key = `${input.market}:${input.year}`;
    const made: CreditNote[] = [];
    for (const c of input.credits) {
      const no = (this.series.get(key) ?? 0) + 1;
      this.series.set(key, no);
      made.push(numbered(c, no));
    }
    for (const p of input.plans) {
      const acc = input.accounts.find((a) => a.id === p.accountId);
      const stored = acc ? [...this.accountsById.values()].find((x) => x.partyId === acc.partyId && x.market === acc.market && x.currency === acc.currency)! : undefined;
      this.planList.push({ ...structuredClone(p), ...(stored ? { accountId: stored.id } : {}) });
    }
    this.creditList.push(...structuredClone(made));
    this.outbox.push(...structuredClone(events(made)));
    return true;
  }

  async creditNotes(filter: { invoiceId?: string; accountId?: string; policyId?: string }) {
    return structuredClone(
      this.creditList.filter(
        (c) =>
          (!filter.invoiceId || c.invoiceId === filter.invoiceId) &&
          (!filter.accountId || c.accountId === filter.accountId) &&
          (!filter.policyId || c.lines.some((l) => l.policyId === filter.policyId)),
      ).sort((a, b) => (a.createdAt === b.createdAt ? (a.number < b.number ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1)),
    );
  }

  async creditNote(id: string) {
    const c = this.creditList.find((x) => x.id === id);
    return c ? structuredClone(c) : null;
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
const minDate = (a: ISODate, b: ISODate) => (a < b ? a : b);

export const isPaymentInterval = (v: unknown): v is PaymentInterval => (PAYMENT_INTERVALS as readonly unknown[]).includes(v);
