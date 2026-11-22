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
import { isISODate, isMarketCode, type ISODate, type Timestamp } from '@petvold/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** What an adapter can do, per market and currency (ADR 0017, punkt 5). */
export interface ProviderCapability {
  market: string;
  currency: string;
  /** 'incoming': it tells Petvold of payments into the insurer's account. */
  kind: 'incoming';
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

export type ProviderNotification = ReceivedPayment;

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
  type: 'payment.succeeded';
  paymentId: string;
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
  markPublished(ids: string[], at: Timestamp): Promise<void>;
}

export type PaymentsErrorCode = 'not_found' | 'unknown_provider';

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
}

/** What one notification gave: the payments it added, and those Petvold already had. */
export interface ReceiveResult {
  received: Payment[];
  duplicates: Payment[];
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
  async receive(providerId: string, raw: RawNotification): Promise<ReceiveResult> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new PaymentsError('unknown_provider', `No payment provider ${providerId}`);
    const now = this.d.clock.now();
    const parsed = await provider.parseNotification(raw, now);
    const caps = provider.capabilities();
    for (const n of parsed) checkReceived(n, caps);
    const out: ReceiveResult = { received: [], duplicates: [] };
    for (const n of parsed) {
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

  async pendingEvents(limit: number) {
    return structuredClone(this.outbox.filter((e) => !e.publishedAt).slice(0, limit)).map(({ publishedAt: _, ...e }) => e);
  }

  async markPublished(ids: string[], at: Timestamp) {
    for (const e of this.outbox) if (ids.includes(e.id) && !e.publishedAt) e.publishedAt = at;
  }
}

export { FakeProvider, FAKE_NOTIFICATION_SCHEMA, type FakeNotification } from './fake.ts';
