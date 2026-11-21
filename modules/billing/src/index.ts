/**
 * Billing (ADR 0040): payer accounts and premium plans, made from the policy
 * module's events. Later steps add invoices, credit notes, credit balances and
 * unpaid premium.
 *
 * The module never reads another module's tables (ADR 0001). It learns of
 * policies from their events, and reads what an event does not carry (the
 * product's billing settings, the policyholder at renewal) through ports.
 */
import { marketDate, type ISODate, type Timestamp } from '@petvold/common';
import { PAYMENT_INTERVALS, premiumPlan, type PaymentInterval, type PlanInput, type PremiumPlan } from '@petvold/billing-core';

export { PAYMENT_INTERVALS, type PaymentInterval, type PlanInput, type PremiumPlan } from '@petvold/billing-core';

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
  sources: string[];
}

export const BILLING_MARKET_RULES: Record<string, BillingMarketRules> = {
  SE: {
    market: 'SE',
    firstPremiumDays: 14,
    premiumTaxBp: 0,
    sources: [
      'Insurance Contracts Act (2005:104) chapter 5 section 1: the first premium within fourteen days of the notice, never before the insurance period starts',
      'Sweden has no tax on non-life insurance premiums for pets',
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
  createdAt: Timestamp;
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
  plans(filter: { policyId?: string; accountId?: string }): Promise<PlanRecord[]>;
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

  async plans(filter: { policyId?: string; accountId?: string }) {
    return structuredClone(
      this.planList
        .filter((p) => (!filter.policyId || p.policyId === filter.policyId) && (!filter.accountId || p.accountId === filter.accountId))
        .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1)),
    );
  }
}

export const isPaymentInterval = (v: unknown): v is PaymentInterval => (PAYMENT_INTERVALS as readonly unknown[]).includes(v);
