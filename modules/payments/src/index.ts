/**
 * Payments (ADR 0017, ADR 0040 step 3): how money moves in and out of the
 * insurer's accounts. This step receives incoming payments: a payment
 * service tells Petvold through its adapter, and the module stores the
 * payment once and publishes payment.succeeded. Billing matches it to an
 * invoice (step 3b), and payouts come in step 3c.
 *
 * Each payment service is an adapter behind the port PaymentProvider. No
 * other part of Petvold reads a service's own format. The module never reads
 * another module's tables (ADR 0001).
 */
import { isISODate, isMarketCode, marketDate, type ISODate, type Timestamp } from '@petvold/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { agreementInForce, maskDetails, payeeDetailsProblem, payeeOf, payoutGate, type ClinicAgreement, type Payee, type PayeeAccount, type PayeeMethod, type Payout, type PayoutRequest, type PayoutResult, type PayoutStatus, type PayoutStep, type PayoutView } from './payouts.ts';
export * from './payouts.ts';

/** What an adapter can do, per market and currency (ADR 0017, punkt 5). */
export interface ProviderCapability {
  market: string;
  currency: string;
  /** 'incoming': it tells Petvold of payments into the insurer's account. 'outgoing': it pays out from it. */
  kind: 'incoming' | 'outgoing';
}

/** A notification as it reached Petvold, before the adapter has checked it. */
export interface RawNotification {
  /** Header names in lower case. */
  headers: Record<string, string | undefined>;
  body: string;
}

/** A payment into the insurer's account, in Petvold's own form. */
export interface ReceivedPayment {
  kind: 'payment.received';
  /** The service's id for the payment. A second notification with the same id is the same payment. */
  providerRef: string;
  market: string;
  currency: string;
  /** Minor units, above zero. */
  amount: number;
  /** The payment reference the payer gave (OCR or RF), or null when there was none. */
  reference: string | null;
  /** The day the money reached the account. */
  bookedOn: ISODate;
}

/**
 * The service's answer on a payout Petvold sent it, e.g. the bank's debit of a
 * payment in a pain.001 file, or its return (ADR 0040, punkt 12).
 */
export interface PayoutConfirmation {
  kind: 'payout.confirmed';
  /** Petvold's payout id, as the payout was sent. */
  payoutId: string;
  outcome: 'paid' | 'failed';
  /** The service's id for the debit or the return. */
  providerRef: string;
  /** Why it failed, e.g. the bank's return code. */
  reason?: string;
  bookedOn: ISODate;
}

export type ProviderNotification = ReceivedPayment | PayoutConfirmation;

/**
 * The port to a payment service (ADR 0017, punkt 2). Only what the steps so far
 * use: payouts, collection and status come with the steps that need them.
 */
export interface PaymentProvider {
  readonly id: string;
  capabilities(): ProviderCapability[];
  /**
   * Checks the signature and translates the notification. One notification may
   * carry several payments, as a bank file does. Throws
   * ProviderNotificationError when the signature or the content is wrong.
   */
  parseNotification(raw: RawNotification, now: Timestamp): Promise<ProviderNotification[]>;
  /** Pays out. The payout's id is the idempotency key: asked twice, it pays once. Only with an 'outgoing' capability. */
  payout?(req: PayoutRequest): Promise<PayoutResult>;
  /** Files a signed-in person or integration uploads (importFile), e.g. a bank file: never through the open notification route. */
  readonly uploadOnly?: boolean;
  /** The file of payment orders for the bank, e.g. pain.001, for payouts it left pending (makePayoutFile). */
  payoutFile?(input: PayoutFileInput): string;
  /** A page where the customer pays, e.g. Stripe Checkout with card and Swish. Only with an 'incoming' capability. */
  checkout?(req: CheckoutRequest): Promise<CheckoutSession>;
}

/** What the customer is to pay on a service's page: the amount and the reference that finds the invoice. */
export interface CheckoutRequest {
  market: string;
  currency: string;
  amount: number;
  /** The invoice's OCR or RF: the payment carries it back. */
  reference: string;
  /** On the page, e.g. the invoice's number. */
  description: string;
  successUrl: string;
  cancelUrl: string;
  /** e.g. sv. */
  locale?: string;
  expiresAt: Timestamp;
  /** The same key gives the same page. */
  idempotencyKey: string;
}

export interface CheckoutSession {
  provider: string;
  id: string;
  url: string;
  expiresAt: Timestamp;
}

/** What a payout file is made of. */
export interface PayoutFileInput {
  msgId: string;
  createdAt: Timestamp;
  market: string;
  currency: string;
  executionDate: ISODate;
  transfers: {
    payoutId: string;
    amount: number;
    currency: string;
    creditor: { name: string; account: { method: 'se-bank'; clearing: string; account: string } | { method: 'iban'; iban: string; bic?: string } };
    message: string;
  }[];
}

/** A file of payouts for the bank, e.g. pain.001 (ADR 0040, punkt 12). Never changes, but its content goes when a payee in it is erased. */
export interface PayoutFile {
  id: string;
  provider: string;
  market: string;
  currency: string;
  executionDate: ISODate;
  payoutIds: string[];
  total: number;
  sha256: string;
  createdBy: string;
  createdAt: Timestamp;
  /** The file. It holds names and account numbers: null once a payee in it is erased (ADR 0040, punkt 11). */
  content: string | null;
}

export class ProviderNotificationError extends Error {
  constructor(
    public readonly code: 'unauthenticated' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderNotificationError';
  }
}

/** A payment Petvold has received. Never changes. */
export interface Payment {
  id: string;
  direction: 'incoming';
  /** Incoming payments are settled when Petvold hears of them. Collections add pending and failed (ADR 0017, punkt 3). */
  status: 'succeeded';
  provider: string;
  providerRef: string;
  market: string;
  currency: string;
  amount: number;
  reference: string | null;
  bookedOn: ISODate;
  receivedAt: Timestamp;
}

export interface PaymentEvent {
  id: string;
  type: 'payment.succeeded' | 'payout.paid' | 'payout.failed';
  /** payment.succeeded: the payment. */
  paymentId?: string;
  /** payout.*: the payout. */
  payoutId?: string;
  market: string;
  occurredAt: Timestamp;
  data: Record<string, unknown>;
  /** Its position in the module's outbox, set when read from it. */
  sequence?: number;
}

export interface PaymentFilter {
  market?: string;
  reference?: string;
}

export interface PaymentsStore {
  /**
   * Adds the payment and its event in one transaction. False when the provider
   * already gave a payment with the same providerRef: nothing is added.
   */
  addPayment(payment: Payment, event: PaymentEvent): Promise<boolean>;
  payment(id: string): Promise<Payment | null>;
  byProviderRef(provider: string, providerRef: string): Promise<Payment | null>;
  /** Oldest first. */
  payments(filter: PaymentFilter): Promise<Payment[]>;
  pendingEvents(limit: number): Promise<PaymentEvent[]>;
  addPaymentFile(file: PaymentFile): Promise<void>;
  addPayoutFile(file: PayoutFile): Promise<void>;
  /** Newest first. */
  payoutFiles(filter: { provider?: string; market?: string }): Promise<PayoutFile[]>;
  payoutFile(id: string): Promise<PayoutFile | null>;
  /** Empties the content of the files with a payout to the party: they hold its name and account. The number emptied now. */
  erasePayoutFiles(partyId: string): Promise<number>;
  /** Newest first. */
  paymentFiles(filter: { provider?: string }): Promise<PaymentFile[]>;
  markPublished(ids: string[], at: Timestamp): Promise<void>;
  addPayeeAccount(account: PayeeAccount): Promise<void>;
  /** The payee's accounts, oldest first; the last in the market is the current one. Erased ones are left out. */
  payeeAccounts(payee: Payee): Promise<PayeeAccount[]>;
  /** Erases the party's account numbers, keeping the rows (ADR 0040, punkt 11). The number erased now; 0 when done before. */
  erasePayeeAccounts(partyId: string, at: Timestamp): Promise<number>;
  addAgreement(agreement: ClinicAgreement): Promise<void>;
  /** Adds the agreement's ending. Throws PayoutConflictError if it has one. */
  endAgreement(id: string, ended: NonNullable<ClinicAgreement['ended']>): Promise<void>;
  agreement(id: string): Promise<ClinicAgreement | null>;
  /** Oldest first. */
  agreements(filter: { clinicId?: string; market?: string }): Promise<ClinicAgreement[]>;
  /** null when it does not exist or is erased. */
  payeeAccount(id: string): Promise<PayeeAccount | null>;
  /** Stores the payout with its first step and events. false, and nothing stored, if the order already has a payout. */
  addPayout(payout: Payout, step: PayoutStep, events: PaymentEvent[]): Promise<boolean>;
  /**
   * Adds a step as step number `seq` (1 is the first). Throws PayoutConflictError,
   * and stores nothing, if that step is taken: someone else moved the payout first.
   */
  addPayoutStep(payoutId: string, seq: number, step: PayoutStep, events: PaymentEvent[]): Promise<void>;
  payout(id: string): Promise<PayoutView | null>;
  /** Oldest first. */
  payouts(filter: PayoutFilter): Promise<PayoutView[]>;
}

export interface PayoutFilter {
  status?: PayoutStatus;
  claimId?: string;
  partyId?: string;
  clinicId?: string;
  market?: string;
  orderId?: string;
}

export class PayoutConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutConflictError';
  }
}

export type PaymentsErrorCode = 'not_found' | 'unknown_provider' | 'validation' | 'conflict' | 'forbidden';

export class PaymentsError extends Error {
  constructor(
    public readonly code: PaymentsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentsError';
  }
}

export interface PaymentsDeps {
  store: PaymentsStore;
  providers: PaymentProvider[];
  clock: { now(): Timestamp };
  ids: { next(prefix: string): string };
  /** Who is paid for a policy: the policyholder on a day. Needed for payouts. */
  policies?: { policyholderOn(policyId: string, date: ISODate): Promise<string | null> };
  /** Days that new payee details hold a payout for a person (payments.newPayeeHoldDays). Default 0: never. */
  newPayeeHoldDays?: number;
  /** The payee's name, for a payout file (pain.001 needs it): the party's from the parties module, a clinic's id. null if there is none, e.g. anonymized. */
  payeeNames?: { nameOf(payee: Payee): Promise<string | null> };
}

/** A file read into payments, e.g. a bank's camt.054 (ADR 0040, punkt 12). Never changes. */
export interface PaymentFile {
  id: string;
  provider: string;
  /** SHA-256 of the file as uploaded. The same file read again has the same. */
  sha256: string;
  size: number;
  importedBy: string;
  importedAt: Timestamp;
  /** Payments the file added, and those Petvold already had. */
  received: number;
  duplicates: number;
  /** The payments it added. */
  paymentIds: string[];
}

/** What one notification gave: the payments it added, and those Petvold already had. */
export interface ReceiveResult {
  received: Payment[];
  duplicates: Payment[];
  /** Payouts the notification confirmed paid or failed now. A confirmation of one already settled, or of a debit that is not Petvold's, is left out. */
  confirmed: PayoutView[];
}

export class PaymentsService {
  private readonly providers: Map<string, PaymentProvider>;

  constructor(private readonly d: PaymentsDeps) {
    this.providers = new Map(d.providers.map((p) => [p.id, p]));
    if (this.providers.size !== d.providers.length) throw new Error('Two payment providers have the same id');
  }

  /** The adapters this installation has. */
  providerIds(): string[] {
    return [...this.providers.keys()].sort();
  }

  /**
   * A notification from a payment service. The adapter checks it; a payment
   * outside the adapter's markets and currencies is refused, and a payment
   * already received is not received again.
   */
  /**
   * A file a signed-in person or integration uploads to an adapter that takes
   * files, e.g. the bank's camt.054 (ADR 0040, punkt 12). Read like a
   * notification, all or nothing, and kept with who read it in, when, its
   * checksum and what it gave.
   */
  async importFile(providerId: string, body: string, by: string): Promise<PaymentFile> {
    const provider = this.providers.get(providerId);
    if (!provider?.uploadOnly) throw new PaymentsError('unknown_provider', `No payment provider ${providerId} that takes files`);
    const r = await this.receiveWith(provider, { headers: {}, body });
    const file: PaymentFile = {
      id: this.d.ids.next('pfl'),
      provider: provider.id,
      sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
      size: Buffer.byteLength(body, 'utf8'),
      importedBy: by,
      importedAt: this.d.clock.now(),
      received: r.received.length,
      duplicates: r.duplicates.length,
      paymentIds: r.received.map((p) => p.id),
    };
    await this.d.store.addPaymentFile(file);
    return file;
  }

  /**
   * A page where the customer pays, through an adapter that has one (e.g.
   * Stripe Checkout). The payment comes back through its notification with
   * the reference, and billing matches it to the invoice.
   */
  async createCheckout(providerId: string, req: CheckoutRequest): Promise<CheckoutSession> {
    const provider = this.providers.get(providerId);
    if (!provider?.checkout) throw new PaymentsError('not_found', `No payment provider ${providerId} with a payment page`);
    if (!provider.capabilities().some((c) => c.kind === 'incoming' && c.market === req.market && c.currency === req.currency)) {
      throw new PaymentsError('validation', `The provider ${providerId} does not take payments in ${req.market} and ${req.currency}`);
    }
    return provider.checkout(req);
  }

  /** The adapters with a payment page, for the channels. */
  checkoutProviders(): string[] {
    return [...this.providers.values()].filter((p) => p.checkout).map((p) => p.id).sort();
  }

  paymentFiles(filter: { provider?: string } = {}): Promise<PaymentFile[]> {
    return this.d.store.paymentFiles(filter);
  }

  async receive(providerId: string, raw: RawNotification): Promise<ReceiveResult> {
    const provider = this.providers.get(providerId);
    // An adapter for files has no signature: only importFile, after a sign-in, reaches it.
    if (!provider || provider.uploadOnly) throw new PaymentsError('unknown_provider', `No payment provider ${providerId}`);
    return this.receiveWith(provider, raw);
  }

  private async receiveWith(provider: PaymentProvider, raw: RawNotification): Promise<ReceiveResult> {
    const now = this.d.clock.now();
    const parsed = await provider.parseNotification(raw, now);
    const caps = provider.capabilities();
    for (const n of parsed) checkReceived(n, caps);
    const out: ReceiveResult = { received: [], duplicates: [], confirmed: [] };
    for (const n of parsed) {
      if (n.kind === 'payout.confirmed') {
        const settled = await this.confirm(provider, n);
        if (settled) out.confirmed.push(settled);
        continue;
      }
      const payment: Payment = {
        id: this.d.ids.next('pay'),
        direction: 'incoming',
        status: 'succeeded',
        provider: provider.id,
        providerRef: n.providerRef,
        market: n.market,
        currency: n.currency,
        amount: n.amount,
        reference: n.reference,
        bookedOn: n.bookedOn,
        receivedAt: now,
      };
      if (await this.d.store.addPayment(payment, succeeded(this.d.ids.next('evt'), payment))) {
        out.received.push(payment);
      } else {
        const existing = await this.d.store.byProviderRef(provider.id, n.providerRef);
        if (existing && !samePayment(existing, n)) {
          throw new ProviderNotificationError('invalid', `Payment ${n.providerRef} was received before with other content`);
        }
        if (existing) out.duplicates.push(existing);
      }
    }
    return out;
  }

  async payments(filter: PaymentFilter = {}): Promise<Payment[]> {
    return this.d.store.payments(filter);
  }

  async payment(id: string): Promise<Payment> {
    const p = await this.d.store.payment(id);
    if (!p) throw new PaymentsError('not_found', `Payment ${id} does not exist`);
    return p;
  }

  /**
   * A claim's payout order (claim.payout_ordered, ADR 0040 punkt 8) becomes a
   * payout: to the clinic in the order if it has an agreement on direct
   * settlement in force that day, else to the policyholder. It is sent at once, or waits for details, or
   * is held when the details are new. Repeats give nothing new. Without an
   * adapter that pays out in the market, Petvold makes no payout: the order
   * stays with the insurer's systems, as claim.payout_ordered says it.
   */
  async handleClaimEvent(e: { id: string; type: string; claimId?: string; market: string; occurredAt: Timestamp; data: Record<string, unknown> }): Promise<PayoutView | null> {
    if (e.type !== 'claim.payout_ordered' || !e.claimId) return null;
    const provider = this.outgoing(e.market, String(e.data.currency));
    if (!provider) return null;
    if (!this.d.policies) throw new Error('Payouts need the policies port');
    const orderId = String(e.data.payoutOrderId);
    const existing = (await this.d.store.payouts({ claimId: e.claimId })).find((p) => p.orderId === orderId);
    if (existing) return existing;
    const day = marketDate(e.market, e.occurredAt);
    const policyId = String(e.data.policyId);
    const clinicId = typeof e.data.clinicId === 'string' ? e.data.clinicId : undefined;
    const agreement = clinicId ? (await this.d.store.agreements({ clinicId, market: e.market })).some((a) => agreementInForce(a, day)) : false;
    let payee: Payee;
    if (clinicId && agreement) {
      payee = { clinicId };
    } else {
      const partyId = await this.d.policies.policyholderOn(policyId, day);
      if (!partyId) throw new Error(`No policyholder for ${policyId}, for payout order ${orderId}`);
      payee = { partyId };
    }
    return this.createPayout(provider, payee, {
      purpose: 'claim',
      orderId,
      claimId: e.claimId,
      decisionId: String(e.data.decisionId),
      policyId,
      market: e.market,
      currency: String(e.data.currency),
      amount: Number(e.data.amount),
      sourceEventId: e.id,
    });
  }

  /**
   * Billing pays back a payer's credit (refund.ordered, ADR 0040 punkt 6 and 8):
   * a payout to the payer, like a claim's. Without an adapter that pays out,
   * nothing: the refund stays with the insurer's systems.
   */
  async handleBillingEvent(e: { id: string; type: string; refundId?: string; market: string; occurredAt: Timestamp; data: Record<string, unknown> }): Promise<PayoutView | null> {
    if (e.type !== 'refund.ordered' || !e.refundId) return null;
    const provider = this.outgoing(e.market, String(e.data.currency));
    if (!provider) return null;
    return this.createPayout(provider, { partyId: String(e.data.partyId) }, {
      purpose: 'premium-refund',
      orderId: e.refundId,
      market: e.market,
      currency: String(e.data.currency),
      amount: Number(e.data.amount),
      sourceEventId: e.id,
    });
  }

  /** Stores a payout once per order, and sends it, or leaves it waiting or held. */
  private async createPayout(
    provider: PaymentProvider,
    payee: Payee,
    o: Pick<Payout, 'purpose' | 'orderId' | 'claimId' | 'decisionId' | 'policyId' | 'market' | 'currency' | 'amount' | 'sourceEventId'>,
  ): Promise<PayoutView> {
    const existing = (await this.d.store.payouts({ orderId: o.orderId }))[0];
    if (existing) return existing;
    const now = this.d.clock.now();
    const payout: Payout = {
      id: this.d.ids.next('pyo'),
      ...o,
      ...payee,
      provider: provider.id,
      createdAt: now,
    };
    const account = await this.currentAccount(payee, o.market);
    const gate = payoutGate(account, now, this.d.newPayeeHoldDays ?? 0);
    const first: PayoutStep =
      gate === 'awaiting-details'
        ? { status: 'awaiting-details', at: now, by: 'payments' }
        : gate === 'held'
          ? { status: 'held', at: now, by: 'payments', payeeAccountId: account!.id, note: 'The payee details are new' }
          : { status: 'pending', at: now, by: 'payments', payeeAccountId: account!.id };
    if (!(await this.d.store.addPayout(payout, first, []))) return (await this.d.store.payouts({ orderId: o.orderId }))[0]!;
    if (gate === 'ready') await this.send(payout.id, 2, account!);
    return (await this.d.store.payout(payout.id))!;
  }

  /**
   * New payee details for a party (ADR 0040, punkt 8). They replace the old
   * from now. Payouts waiting for details go on: held if the details are newer
   * than the hold, else sent. A held payout is held again on the new details.
   */
  async addPayeeAccount(payee: Payee, input: { market: string; method: PayeeMethod; details: Record<string, unknown> }, by: string): Promise<PayeeAccount> {
    const problem = payeeDetailsProblem(input.method, input.details);
    if (problem) throw new PaymentsError('validation', problem);
    const details =
      input.method === 'iban'
        ? { iban: String(input.details.iban).replace(/\s/g, '').toUpperCase(), ...(input.details.bic ? { bic: String(input.details.bic) } : {}) }
        : { clearing: String(input.details.clearing), account: String(input.details.account) };
    const account: PayeeAccount = { id: this.d.ids.next('pya'), ...payee, market: input.market, method: input.method, details, createdAt: this.d.clock.now(), createdBy: by };
    await this.d.store.addPayeeAccount(account);
    // Payouts waiting for details go on, and held ones are held again on the new details.
    const waiting = (await this.d.store.payouts({ ...payee, market: input.market })).filter((p) => p.status === 'awaiting-details' || p.status === 'held');
    for (const p of waiting) {
      const gate = payoutGate(account, this.d.clock.now(), this.d.newPayeeHoldDays ?? 0);
      try {
        if (gate === 'held') {
          const note = p.status === 'held' ? 'The payee details changed' : 'The payee details are new';
          await this.d.store.addPayoutStep(p.id, p.steps.length + 1, { status: 'held', at: this.d.clock.now(), by: 'payments', payeeAccountId: account.id, note }, []);
        } else {
          await this.d.store.addPayoutStep(p.id, p.steps.length + 1, { status: 'pending', at: this.d.clock.now(), by: 'payments', payeeAccountId: account.id }, []);
          await this.send(p.id, p.steps.length + 2, account);
        }
      } catch (err) {
        if (!(err instanceof PayoutConflictError)) throw err;
      }
    }
    return account;
  }

  /** The payee's details, newest last, with the numbers masked. */
  async payeeAccounts(payee: Payee): Promise<(PayeeAccount & { current: boolean })[]> {
    const all = await this.d.store.payeeAccounts(payee);
    const current = new Set(Object.values(Object.fromEntries(all.map((a) => [a.market, a.id]))));
    return all.map((a) => ({ ...a, details: maskDetails(a.details), current: current.has(a.id) }));
  }

  /**
   * A person releases a held payout (ADR 0040, punkt 8). Not the one who gave
   * the payee details: four eyes against fraud with changed details.
   */
  async releasePayout(id: string, by: string, note?: string): Promise<PayoutView> {
    const p = await this.payout(id);
    if (p.status !== 'held') throw new PaymentsError('conflict', `Payout ${id} is ${p.status}, not held`);
    const accountId = p.steps.at(-1)!.payeeAccountId!;
    const account = await this.d.store.payeeAccount(accountId);
    const current = await this.currentAccount(payeeOf(p), p.market);
    if (!account || !current || current.id !== account.id) throw new PaymentsError('conflict', 'The payee details changed after the payout was held');
    if (account.createdBy === by) throw new PaymentsError('forbidden', 'The one who gave the payee details cannot release the payout');
    try {
      await this.d.store.addPayoutStep(id, p.steps.length + 1, { status: 'pending', at: this.d.clock.now(), by, payeeAccountId: account.id, ...(note ? { note } : {}) }, []);
    } catch (err) {
      if (err instanceof PayoutConflictError) throw new PaymentsError('conflict', `Payout ${id} was moved by someone else`);
      throw err;
    }
    await this.send(id, p.steps.length + 2, account);
    return this.payout(id);
  }

  async payout(id: string): Promise<PayoutView> {
    const p = await this.d.store.payout(id);
    if (!p) throw new PaymentsError('not_found', `Payout ${id} does not exist`);
    return p;
  }

  async payouts(filter: PayoutFilter = {}): Promise<PayoutView[]> {
    return this.d.store.payouts(filter);
  }

  /**
   * Why the party's payee details cannot be erased now, or null (ADR 0040,
   * punkt 11): a payout to them that is on its way. A payout still waiting for
   * details does not stop it; it waits for details given after the erasure.
   */
  async erasureBlocker(partyId: string): Promise<string | null> {
    const busy = (await this.d.store.payouts({ partyId })).filter((p) => p.status === 'held' || p.status === 'pending');
    return busy.length ? `Payouts on their way to the party: ${busy.map((p) => p.id).join(', ')}` : null;
  }

  /**
   * Erases the party's payee account numbers when the party is anonymized (ADR
   * 0040, punkt 11, ADR 0028). The rows stay, so the payouts' history holds
   * together. Safe to run again, e.g. after a restore from backup.
   */
  async erasePayee(partyId: string): Promise<number> {
    const blocker = await this.erasureBlocker(partyId);
    if (blocker) throw new PaymentsError('conflict', blocker);
    const n = await this.d.store.erasePayeeAccounts(partyId, this.d.clock.now());
    await this.d.store.erasePayoutFiles(partyId);
    return n;
  }

  /**
   * The bank's payment orders, e.g. pain.001, for the payouts an adapter left
   * pending and that are in no file yet, in a market and currency (ADR 0040,
   * punkt 12). Kept, so it can be fetched again; the bank's camt.054 then
   * confirms each payout paid or returned.
   */
  async makePayoutFile(input: { provider: string; market: string; currency: string; executionDate?: ISODate }, by: string): Promise<PayoutFile> {
    const provider = this.providers.get(input.provider);
    if (!provider?.payoutFile) throw new PaymentsError('not_found', `No payment provider ${input.provider} that makes payout files`);
    const inFiles = new Set((await this.d.store.payoutFiles({ provider: provider.id })).flatMap((f) => f.payoutIds));
    const pending = (await this.d.store.payouts({ status: 'pending', market: input.market })).filter((p) => p.provider === provider.id && p.currency === input.currency && !inFiles.has(p.id));
    if (!pending.length) throw new PaymentsError('conflict', `No payouts waiting for a file in ${input.market} and ${input.currency}`);
    const transfers: PayoutFileInput['transfers'] = [];
    for (const p of pending) {
      const accountId = p.steps.at(-1)?.payeeAccountId;
      const account = accountId ? await this.d.store.payeeAccount(accountId) : null;
      const name = await this.d.payeeNames?.nameOf(payeeOf(p));
      if (!account || !name) throw new PaymentsError('conflict', `Payout ${p.id} has no payee name or account details to pay to`);
      const details = account.details as Record<string, string>;
      transfers.push({
        payoutId: p.id,
        amount: p.amount,
        currency: p.currency,
        creditor: { name, account: account.method === 'se-bank' ? { method: 'se-bank', clearing: details.clearing!, account: details.account! } : { method: 'iban', iban: details.iban!, ...(details.bic ? { bic: details.bic } : {}) } },
        // A reference, no language: the claim, or the refund.
        message: p.claimId ?? p.orderId,
      });
    }
    const createdAt = this.d.clock.now();
    const id = this.d.ids.next('pof');
    const content = provider.payoutFile({ msgId: id.replace(/^pof_/, '').slice(0, 35), createdAt, market: input.market, currency: input.currency, executionDate: input.executionDate ?? marketDate(input.market, createdAt), transfers });
    const file: PayoutFile = {
      id,
      provider: provider.id,
      market: input.market,
      currency: input.currency,
      executionDate: input.executionDate ?? marketDate(input.market, createdAt),
      payoutIds: transfers.map((t) => t.payoutId),
      total: transfers.reduce((s, t) => s + t.amount, 0),
      sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      createdBy: by,
      createdAt,
      content,
    };
    await this.d.store.addPayoutFile(file);
    return file;
  }

  payoutFiles(filter: { provider?: string; market?: string } = {}): Promise<PayoutFile[]> {
    return this.d.store.payoutFiles(filter);
  }

  async payoutFile(id: string): Promise<PayoutFile> {
    const f = await this.d.store.payoutFile(id);
    if (!f) throw new PaymentsError('not_found', `Payout file ${id} does not exist`);
    return f;
  }

  /**
   * When the party last had a relation in payments, for retention (ADR 0028,
   * 0040 punkt 11): ongoing while a payout to them is not paid or failed, else
   * the last day details were given or a payout made.
   */
  async activityOf(partyId: string): Promise<{ ongoing: true } | { lastDate: ISODate } | null> {
    const payouts = await this.d.store.payouts({ partyId });
    if (payouts.some((p) => p.status !== 'paid' && p.status !== 'failed')) return { ongoing: true };
    const dates = [...(await this.d.store.payeeAccounts({ partyId })).map((a) => marketDate(a.market, a.createdAt)), ...payouts.map((p) => marketDate(p.market, p.steps.at(-1)!.at))].sort();
    return dates.length ? { lastDate: dates.at(-1)! } : null;
  }

  /**
   * An agreement on direct settlement with a clinic (ADR 0040, punkt 8), from
   * a day and optionally to a day. Two agreements for the same clinic and
   * market may not overlap.
   */
  async addAgreement(input: { clinicId: string; market: string; validFrom: ISODate; validTo?: ISODate }, by: string): Promise<ClinicAgreement> {
    if (!isISODate(input.validFrom) || (input.validTo !== undefined && (!isISODate(input.validTo) || input.validTo <= input.validFrom))) {
      throw new PaymentsError('validation', 'validFrom must be a date, and validTo a later one');
    }
    const end = (a: ClinicAgreement) => (a.ended && (!a.validTo || a.ended.validTo < a.validTo) ? a.ended.validTo : a.validTo);
    for (const a of await this.d.store.agreements({ clinicId: input.clinicId, market: input.market })) {
      const aEnd = end(a);
      if ((!aEnd || input.validFrom < aEnd) && (!input.validTo || a.validFrom < input.validTo)) {
        throw new PaymentsError('conflict', `The clinic has an agreement from ${a.validFrom}${aEnd ? ` to ${aEnd}` : ''} that overlaps`);
      }
    }
    const a: ClinicAgreement = { id: this.d.ids.next('cag'), clinicId: input.clinicId, market: input.market, validFrom: input.validFrom, ...(input.validTo ? { validTo: input.validTo } : {}), createdBy: by, createdAt: this.d.clock.now() };
    await this.d.store.addAgreement(a);
    return a;
  }

  /** Ends an agreement from a day: payout orders from that day go to the policyholder. */
  async endAgreement(id: string, input: { validTo: ISODate; reason: string }, by: string): Promise<ClinicAgreement> {
    const a = await this.agreement(id);
    if (a.ended) throw new PaymentsError('conflict', `Agreement ${id} is ended already`);
    if (!isISODate(input.validTo) || input.validTo < a.validFrom || (a.validTo && input.validTo > a.validTo)) throw new PaymentsError('validation', 'validTo must lie within the agreement');
    try {
      await this.d.store.endAgreement(id, { validTo: input.validTo, by, at: this.d.clock.now(), reason: input.reason });
    } catch (err) {
      if (err instanceof PayoutConflictError) throw new PaymentsError('conflict', `Agreement ${id} is ended already`);
      throw err;
    }
    return this.agreement(id);
  }

  async agreement(id: string): Promise<ClinicAgreement> {
    const a = await this.d.store.agreement(id);
    if (!a) throw new PaymentsError('not_found', `Agreement ${id} does not exist`);
    return a;
  }

  async agreements(filter: { clinicId?: string; market?: string } = {}): Promise<ClinicAgreement[]> {
    return this.d.store.agreements(filter);
  }

  private async currentAccount(payee: Payee, market: string): Promise<PayeeAccount | null> {
    return (await this.d.store.payeeAccounts(payee)).filter((a) => a.market === market).at(-1) ?? null;
  }

  private outgoing(market: string, currency: string): PaymentProvider | null {
    return [...this.providers.values()].find((x) => x.payout && x.capabilities().some((c) => c.kind === 'outgoing' && c.market === market && c.currency === currency)) ?? null;
  }

  /** Asks the adapter to pay a pending payout, and stores what it says as step `seq`. */
  /**
   * The service's answer on a payout it was sent: paid or failed, with the event.
   * Only a payout of this provider that is pending moves; one already settled is
   * a repeat, and a debit with no payout of Petvold's is not Petvold's. null then.
   */
  private async confirm(provider: PaymentProvider, n: PayoutConfirmation): Promise<PayoutView | null> {
    const p = await this.d.store.payout(n.payoutId);
    if (!p || p.provider !== provider.id) return null;
    const view = await this.payout(p.id);
    if (view.status !== 'pending') return null;
    const last = view.steps.at(-1)!;
    await this.settle(p, view.steps.length + 1, { status: n.outcome, at: this.d.clock.now(), by: provider.id, ...(last.payeeAccountId ? { payeeAccountId: last.payeeAccountId } : {}), providerRef: n.providerRef, ...(n.reason ? { note: n.reason } : {}) });
    return this.payout(p.id);
  }

  /** A paid or failed step with its event, payout.paid or payout.failed. */
  private async settle(p: Payout, seq: number, step: PayoutStep): Promise<void> {
    const event: PaymentEvent = {
      id: this.d.ids.next('evt'),
      type: step.status === 'paid' ? 'payout.paid' : 'payout.failed',
      payoutId: p.id,
      market: p.market,
      occurredAt: step.at,
      data: { purpose: p.purpose, ...(p.claimId ? { claimId: p.claimId, policyId: p.policyId } : {}), ...payeeOf(p), orderId: p.orderId, amount: p.amount, currency: p.currency },
    };
    await this.d.store.addPayoutStep(p.id, seq, step, [event]);
  }

  private async send(payoutId: string, seq: number, account: PayeeAccount): Promise<void> {
    const p = (await this.d.store.payout(payoutId))!;
    const provider = this.providers.get(p.provider);
    if (!provider?.payout) throw new Error(`The provider ${p.provider} does not pay out`);
    const r = await provider.payout({ payoutId: p.id, market: p.market, currency: p.currency, amount: p.amount, account: { method: account.method, ...account.details } });
    if (r.status === 'pending') return;
    await this.settle(p, seq, { status: r.status, at: this.d.clock.now(), by: provider.id, payeeAccountId: account.id, providerRef: r.providerRef, ...(r.reason ? { note: r.reason } : {}) });
  }
}

/** The event for a received payment. Pure. */
export function succeeded(eventId: string, p: Payment): PaymentEvent {
  return {
    id: eventId,
    type: 'payment.succeeded',
    paymentId: p.id,
    market: p.market,
    occurredAt: p.receivedAt,
    data: {
      direction: p.direction,
      provider: p.provider,
      amount: p.amount,
      currency: p.currency,
      reference: p.reference,
      bookedOn: p.bookedOn,
    },
  };
}

/** Throws unless the payment is well formed and within the adapter's capabilities. Pure. */
export function checkReceived(n: ProviderNotification, caps: readonly ProviderCapability[]): void {
  const bad = (m: string) => new ProviderNotificationError('invalid', m);
  if (n.kind === 'payout.confirmed') {
    if (!/^pyo_[A-Za-z0-9]+$/.test(n.payoutId) || !n.providerRef || n.providerRef.length > 200) throw bad('A payout confirmation needs a payout id and the service\'s id');
    if (n.outcome !== 'paid' && n.outcome !== 'failed') throw bad('A payout is confirmed paid or failed');
    if (!isISODate(n.bookedOn)) throw bad('bookedOn is not a date');
    return;
  }
  if (n.kind !== 'payment.received') throw bad(`Unknown notification ${String((n as { kind?: unknown }).kind)}`);
  if (!n.providerRef || n.providerRef.length > 200) throw bad('The payment has no id, or one over 200 characters');
  if (!Number.isSafeInteger(n.amount) || n.amount <= 0) throw bad('The amount must be a whole number of minor units above zero');
  if (!isMarketCode(n.market) || !/^[A-Z]{3}$/.test(n.currency)) throw bad('The market or the currency is not valid');
  if (!isISODate(n.bookedOn)) throw bad('bookedOn is not a date');
  if (n.reference !== null && !/^[A-Za-z0-9]{1,35}$/.test(n.reference)) throw bad('The reference must be 1 to 35 letters and digits');
  if (!caps.some((c) => c.kind === 'incoming' && c.market === n.market && c.currency === n.currency)) {
    throw bad(`The provider does not take payments in ${n.market} and ${n.currency}`);
  }
}

const samePayment = (p: Payment, n: ReceivedPayment) =>
  p.market === n.market && p.currency === n.currency && p.amount === n.amount && p.reference === n.reference && p.bookedOn === n.bookedOn;

/**
 * Checks a signature in the form Standard Webhooks uses, the same as Petvold's
 * own webhooks (ADR 0033): 'v1,' and the HMAC-SHA256 of 'id.timestamp.body' in
 * base64, with the secret 'whsec_' and base64. A timestamp more than the
 * tolerance from now is refused, so an old notification cannot be sent again.
 * Pure.
 */
export function verifySignature(secret: string, raw: RawNotification, now: Timestamp, toleranceSeconds = 300): void {
  const id = raw.headers['webhook-id'];
  const ts = raw.headers['webhook-timestamp'];
  const sig = raw.headers['webhook-signature'];
  const fail = (m: string) => new ProviderNotificationError('unauthenticated', m);
  if (!id || !ts || !sig) throw fail('The notification is not signed');
  const at = Number(ts);
  if (!/^\d{1,12}$/.test(ts) || Math.abs(Date.parse(now) / 1000 - at) > toleranceSeconds) throw fail('The signature is too old or from the future');
  const expected = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${raw.body}`).digest();
  const ok = sig.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw fail('The signature does not match');
}

/** Signs a notification as verifySignature expects, e.g. in a test or a demo bank. Pure. */
export function signNotification(secret: string, id: string, timestamp: number, body: string): RawNotification {
  const value = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { headers: { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${value}` }, body };
}

export class InMemoryPaymentsStore implements PaymentsStore {
  private readonly list: Payment[] = [];
  private readonly outbox: (PaymentEvent & { publishedAt?: Timestamp })[] = [];
  private readonly accounts: PayeeAccount[] = [];
  private readonly payoutList: Payout[] = [];
  private readonly steps = new Map<string, PayoutStep[]>();

  async addPayeeAccount(account: PayeeAccount) {
    this.accounts.push(structuredClone(account));
  }

  private readonly agreementList: ClinicAgreement[] = [];

  private readonly erased = new Set<string>();

  async payeeAccounts(payee: Payee) {
    return structuredClone(this.accounts.filter((a) => !this.erased.has(a.id) && (payee.clinicId ? a.clinicId === payee.clinicId : a.partyId === payee.partyId)));
  }

  async erasePayeeAccounts(partyId: string) {
    let n = 0;
    for (const a of this.accounts) {
      if (a.partyId !== partyId || this.erased.has(a.id)) continue;
      this.erased.add(a.id);
      a.details = {} as PayeeAccount['details'];
      n++;
    }
    return n;
  }

  async addAgreement(a: ClinicAgreement) {
    this.agreementList.push(structuredClone(a));
  }

  async endAgreement(id: string, ended: NonNullable<ClinicAgreement['ended']>) {
    const a = this.agreementList.find((x) => x.id === id);
    if (!a) throw new Error(`Agreement ${id} does not exist`);
    if (a.ended) throw new PayoutConflictError(`Agreement ${id} is ended already`);
    a.ended = structuredClone(ended);
  }

  async agreement(id: string) {
    const a = this.agreementList.find((x) => x.id === id);
    return a ? structuredClone(a) : null;
  }

  async agreements(filter: { clinicId?: string; market?: string }) {
    return structuredClone(this.agreementList.filter((a) => (!filter.clinicId || a.clinicId === filter.clinicId) && (!filter.market || a.market === filter.market)));
  }

  async payeeAccount(id: string) {
    const a = this.accounts.find((x) => x.id === id && !this.erased.has(x.id));
    return a ? structuredClone(a) : null;
  }

  async addPayout(payout: Payout, step: PayoutStep, events: PaymentEvent[]) {
    if (this.payoutList.some((p) => p.orderId === payout.orderId)) return false;
    this.payoutList.push(structuredClone(payout));
    this.steps.set(payout.id, [structuredClone(step)]);
    this.pushEvents(events);
    return true;
  }

  async addPayoutStep(payoutId: string, seq: number, step: PayoutStep, events: PaymentEvent[]) {
    const steps = this.steps.get(payoutId);
    if (!steps) throw new Error(`Payout ${payoutId} does not exist`);
    if (steps.length !== seq - 1) throw new PayoutConflictError(`Step ${seq} of payout ${payoutId} is taken`);
    steps.push(structuredClone(step));
    this.pushEvents(events);
  }

  private view(p: Payout): PayoutView {
    const steps = this.steps.get(p.id) ?? [];
    return structuredClone({ ...p, status: steps.at(-1)!.status, steps });
  }

  async payout(id: string) {
    const p = this.payoutList.find((x) => x.id === id);
    return p ? this.view(p) : null;
  }

  async payouts(filter: PayoutFilter) {
    return this.payoutList
      .map((p) => this.view(p))
      .filter(
        (p) =>
          (!filter.status || p.status === filter.status) &&
          (!filter.claimId || p.claimId === filter.claimId) &&
          (!filter.partyId || p.partyId === filter.partyId) &&
          (!filter.clinicId || p.clinicId === filter.clinicId) &&
          (!filter.orderId || p.orderId === filter.orderId) &&
          (!filter.market || p.market === filter.market),
      )
      .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
  }

  private pushEvents(events: PaymentEvent[]) {
    for (const e of events) this.outbox.push({ ...structuredClone(e), sequence: this.outbox.length + 1 });
  }

  async addPayment(payment: Payment, event: PaymentEvent): Promise<boolean> {
    if (this.list.some((p) => p.provider === payment.provider && p.providerRef === payment.providerRef)) return false;
    this.list.push(structuredClone(payment));
    this.outbox.push({ ...structuredClone(event), sequence: this.outbox.length + 1 });
    return true;
  }

  async payment(id: string) {
    const p = this.list.find((x) => x.id === id);
    return p ? structuredClone(p) : null;
  }

  async byProviderRef(provider: string, providerRef: string) {
    const p = this.list.find((x) => x.provider === provider && x.providerRef === providerRef);
    return p ? structuredClone(p) : null;
  }

  async payments(filter: PaymentFilter) {
    return structuredClone(
      this.list
        .filter((p) => (!filter.market || p.market === filter.market) && (!filter.reference || p.reference === filter.reference))
        .sort((a, b) => (a.receivedAt === b.receivedAt ? (a.id < b.id ? -1 : 1) : a.receivedAt < b.receivedAt ? -1 : 1)),
    );
  }

  private readonly files: PaymentFile[] = [];
  private readonly payoutFileList: PayoutFile[] = [];

  async addPayoutFile(file: PayoutFile) {
    this.payoutFileList.push(structuredClone(file));
  }

  async payoutFiles(filter: { provider?: string; market?: string }) {
    return structuredClone(this.payoutFileList.filter((f) => (!filter.provider || f.provider === filter.provider) && (!filter.market || f.market === filter.market)).reverse());
  }

  async payoutFile(id: string) {
    const f = this.payoutFileList.find((x) => x.id === id);
    return f ? structuredClone(f) : null;
  }

  async erasePayoutFiles(partyId: string) {
    const ids = new Set(this.payoutList.filter((p) => p.partyId === partyId).map((p) => p.id));
    let n = 0;
    for (const f of this.payoutFileList) {
      if (f.content !== null && f.payoutIds.some((id) => ids.has(id))) {
        f.content = null;
        n++;
      }
    }
    return n;
  }


  async addPaymentFile(file: PaymentFile) {
    this.files.push(structuredClone(file));
  }

  async paymentFiles(filter: { provider?: string }) {
    return structuredClone(this.files.filter((f) => !filter.provider || f.provider === filter.provider).reverse());
  }

  async pendingEvents(limit: number) {
    return structuredClone(this.outbox.filter((e) => !e.publishedAt).slice(0, limit)).map(({ publishedAt: _, ...e }) => e);
  }

  async markPublished(ids: string[], at: Timestamp) {
    for (const e of this.outbox) if (ids.includes(e.id) && !e.publishedAt) e.publishedAt = at;
  }
}

export { FakeProvider, FAKE_NOTIFICATION_SCHEMA, type FakeNotification } from './fake.ts';
