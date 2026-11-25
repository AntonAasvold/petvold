/**
 * The Stripe adapter (ADR 0017, ADR 0040 punkt 12): payments in by card, and
 * by Swish where the Stripe account has it on, through Stripe Checkout.
 *
 * Petvold makes a Checkout Session for what is still to pay on an invoice, with
 * the invoice's reference (OCR or RF) in the session's metadata, and gives the
 * channel its address. The customer pays on Stripe's page. Stripe tells
 * Petvold with checkout.session.completed (paid at once, e.g. card or Swish)
 * or checkout.session.async_payment_succeeded (paid later), and the payment is
 * matched to the invoice by its reference, as from the bank.
 *
 * By Stripe's public documentation (docs.stripe.com): the Checkout Session API,
 * and webhook signatures, Stripe-Signature with t and v1, HMAC-SHA256 in hex of
 * "t.body" with the endpoint's signing secret as the key. No Stripe library:
 * fetch and node:crypto. Stripe does not pay out to the customer's account, so
 * payouts stay with the bank files.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { marketDate, type Timestamp } from '@petvold/common';
import { ProviderNotificationError, type CheckoutRequest, type CheckoutSession, type PaymentProvider, type ProviderCapability, type ProviderNotification, type RawNotification } from './index.ts';

export interface StripeConfig {
  /** The secret API key: sk_test_… in a sandbox, sk_live_… with real money. */
  secretKey: string;
  /** The webhook endpoint's signing secret, whsec_…. */
  webhookSecret: string;
  markets: { market: string; currency: string }[];
  toleranceSeconds?: number;
  /** For tests. Default https://api.stripe.com. */
  apiBase?: string;
  /** For tests. Default the global fetch. */
  fetch?: typeof fetch;
}

/**
 * Checks Stripe-Signature (docs.stripe.com/webhooks, "Verify manually"): at
 * least one v1 must match, and the time be within the tolerance. v0 and
 * debugging entries are ignored. Throws ProviderNotificationError.
 */
export function verifyStripeSignature(secret: string, raw: RawNotification, now: Timestamp, toleranceSeconds = 300): void {
  const fail = (m: string) => new ProviderNotificationError('unauthenticated', m);
  const header = raw.headers['stripe-signature'];
  if (!header) throw fail('The notification has no Stripe-Signature');
  const entries = header.split(',').map((e) => {
    const i = e.indexOf('=');
    return [e.slice(0, i).trim(), e.slice(i + 1).trim()] as const;
  });
  const t = entries.find(([k]) => k === 't')?.[1];
  const v1 = entries.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !/^\d{1,12}$/.test(t) || !v1.length) throw fail('Stripe-Signature has no t or v1');
  const expected = createHmac('sha256', secret).update(`${t}.${raw.body}`).digest();
  const matches = v1.some((v) => {
    if (!/^[0-9a-f]{64}$/.test(v)) return false;
    const given = Buffer.from(v, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matches) throw fail('The signature does not match');
  if (Math.abs(Date.parse(now) / 1000 - Number(t)) > toleranceSeconds) throw fail('The signature is too old or from the future');
}

/** Signs a body as Stripe does, for tests and a local demo. Pure. */
export function signStripe(secret: string, timestamp: number, body: string): RawNotification {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { headers: { 'stripe-signature': `t=${timestamp},v1=${v1}`, 'content-type': 'application/json' }, body };
}

/** Stripe's amounts are in the currency's smallest unit already, and its currency codes in lower case. */
const upper = (s: unknown) => String(s ?? '').toUpperCase();

/** Form encoding with Stripe's nested keys: a[b][c]=v. */
export function formEncode(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** The event's session as a payment, or nothing for an event Petvold does not act on. Pure. */
export function paymentOfEvent(event: unknown, markets: readonly { market: string; currency: string }[]): ProviderNotification[] {
  const e = event as { type?: string; created?: number; data?: { object?: Record<string, unknown> } };
  const s = e.data?.object;
  const paidNow = e.type === 'checkout.session.completed' && s?.payment_status === 'paid';
  const paidLater = e.type === 'checkout.session.async_payment_succeeded';
  if (!s || (!paidNow && !paidLater)) return [];
  const metadata = (s.metadata ?? {}) as Record<string, string>;
  const market = metadata.petvold_market;
  // A session Petvold did not make, e.g. another system's on the same account: not Petvold's.
  if (!market) return [];
  const currency = upper(s.currency);
  if (!markets.some((m) => m.market === market && m.currency === currency)) {
    throw new ProviderNotificationError('invalid', `The session is in ${market} and ${currency}, which the adapter does not take`);
  }
  const amount = Number(s.amount_total);
  const ref = String(s.payment_intent ?? s.id ?? '');
  if (!ref) throw new ProviderNotificationError('invalid', 'The session has no id');
  return [
    {
      kind: 'payment.received',
      providerRef: ref,
      market,
      currency,
      amount,
      reference: metadata.petvold_reference && /^[A-Za-z0-9]{1,35}$/.test(metadata.petvold_reference) ? metadata.petvold_reference : null,
      bookedOn: marketDate(market, new Date((e.created ?? 0) * 1000).toISOString()),
    },
  ];
}

export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe';

  constructor(private readonly o: StripeConfig) {
    if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(o.secretKey)) throw new Error("Stripe's secret key must be sk_test_… or sk_live_…");
    if (!/^whsec_[A-Za-z0-9]+$/.test(o.webhookSecret)) throw new Error("Stripe's webhook signing secret must be whsec_…");
    if (!o.markets.length) throw new Error('The Stripe adapter needs at least one market');
  }

  /** sk_test_: Stripe's sandbox, where no real money moves. */
  get testMode(): boolean {
    return this.o.secretKey.startsWith('sk_test_');
  }

  capabilities(): ProviderCapability[] {
    return this.o.markets.map((m) => ({ ...m, kind: 'incoming' as const }));
  }

  async parseNotification(raw: RawNotification, now: Timestamp): Promise<ProviderNotification[]> {
    verifyStripeSignature(this.o.webhookSecret, raw, now, this.o.toleranceSeconds);
    let event: unknown;
    try {
      event = JSON.parse(raw.body);
    } catch {
      throw new ProviderNotificationError('invalid', 'The body is not JSON');
    }
    return paymentOfEvent(event, this.o.markets);
  }

  /**
   * A Checkout Session for a payment: one line, the amount and the reference in
   * the metadata, so the payment finds its invoice. Stripe shows the payment
   * methods the account has on. The idempotency key makes a retry the same session.
   */
  async checkout(req: CheckoutRequest): Promise<CheckoutSession> {
    if (!this.o.markets.some((m) => m.market === req.market && m.currency === req.currency)) {
      throw new Error(`The Stripe adapter does not take payments in ${req.market} and ${req.currency}`);
    }
    const expiresAt = Math.floor(Date.parse(req.expiresAt) / 1000);
    const body = formEncode({
      mode: 'payment',
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': req.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': req.amount,
      'line_items[0][price_data][product_data][name]': req.description,
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      client_reference_id: req.reference,
      'metadata[petvold_reference]': req.reference,
      'metadata[petvold_market]': req.market,
      'payment_intent_data[metadata][petvold_reference]': req.reference,
      'payment_intent_data[metadata][petvold_market]': req.market,
      ...(req.locale ? { locale: req.locale } : {}),
      expires_at: expiresAt,
    });
    const res = await (this.o.fetch ?? fetch)(`${this.o.apiBase ?? 'https://api.stripe.com'}/v1/checkout/sessions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.o.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': req.idempotencyKey,
      },
      body,
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; url?: string; expires_at?: number; error?: { message?: string } };
    if (!res.ok || !data.id || !data.url) throw new Error(`Stripe did not make the session (${res.status}): ${data.error?.message ?? 'no message'}`);
    return { provider: this.id, id: data.id, url: data.url, expiresAt: new Date((data.expires_at ?? expiresAt) * 1000).toISOString() };
  }
}

/**
 * The adapter's settings from the environment: PETVOLD_STRIPE_SECRET_KEY,
 * PETVOLD_STRIPE_WEBHOOK_SECRET and PETVOLD_STRIPE_MARKETS (e.g. SE:SEK, the
 * default). null without the keys.
 */
export function stripeFromEnv(env: Record<string, string | undefined>): StripeConfig | null {
  const secretKey = env.PETVOLD_STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.PETVOLD_STRIPE_WEBHOOK_SECRET?.trim();
  if (!secretKey && !webhookSecret) return null;
  if (!secretKey || !webhookSecret) throw new Error('Stripe needs both PETVOLD_STRIPE_SECRET_KEY and PETVOLD_STRIPE_WEBHOOK_SECRET');
  const markets = (env.PETVOLD_STRIPE_MARKETS?.trim() || 'SE:SEK').split(',').map((m) => {
    const [market, currency] = m.trim().split(':');
    if (!/^[A-Z]{2}$/.test(market ?? '') || !/^[A-Z]{3}$/.test(currency ?? '')) throw new Error(`PETVOLD_STRIPE_MARKETS: "${m}" is not market:currency, e.g. SE:SEK`);
    return { market: market!, currency: currency! };
  });
  return { secretKey, webhookSecret, markets };
}
