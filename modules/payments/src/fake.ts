/**
 * The fake adapter (ADR 0017, punkt 7): a bank that exists only in tests, the
 * dev server and the demo service. It speaks Petvold's own small format,
 * signed like the real services' notifications, so the path through Petvold
 * is the same as for a real adapter.
 *
 * A notification is JSON, one or more payments:
 *   { "schema": "petvold-fake-bank.v1",
 *     "payments": [{ "id": "fb_1", "market": "SE", "currency": "SEK",
 *                    "amount": 41200, "reference": "202600000121", "bookedOn": "2026-12-01" }] }
 * signed with the headers webhook-id, webhook-timestamp and webhook-signature.
 */
import type { Timestamp } from '@petvold/common';
import { ProviderNotificationError, verifySignature, type PaymentProvider, type ProviderCapability, type ProviderNotification, type RawNotification } from './index.ts';

export const FAKE_NOTIFICATION_SCHEMA = 'petvold-fake-bank.v1';

export interface FakeNotification {
  schema: typeof FAKE_NOTIFICATION_SCHEMA;
  payments: { id: string; market: string; currency: string; amount: number; reference?: string | null; bookedOn: string }[];
}

export class FakeProvider implements PaymentProvider {
  readonly id = 'fake';

  constructor(
    private readonly o: {
      /** 'whsec_' and base64, shared with the fake bank. */
      secret: string;
      markets: { market: string; currency: string }[];
      toleranceSeconds?: number;
    },
  ) {
    if (!/^whsec_[A-Za-z0-9+/=]{20,}$/.test(o.secret)) throw new Error("The fake provider's secret must be 'whsec_' and base64");
  }

  capabilities(): ProviderCapability[] {
    return this.o.markets.map((m) => ({ ...m, kind: 'incoming' as const }));
  }

  async parseNotification(raw: RawNotification, now: Timestamp): Promise<ProviderNotification[]> {
    verifySignature(this.o.secret, raw, now, this.o.toleranceSeconds);
    let body: unknown;
    try {
      body = JSON.parse(raw.body);
    } catch {
      throw new ProviderNotificationError('invalid', 'The body is not JSON');
    }
    const b = body as Partial<FakeNotification>;
    if (b?.schema !== FAKE_NOTIFICATION_SCHEMA || !Array.isArray(b.payments) || b.payments.length === 0 || b.payments.length > 1000) {
      throw new ProviderNotificationError('invalid', `The body must be ${FAKE_NOTIFICATION_SCHEMA} with 1 to 1000 payments`);
    }
    return b.payments.map((p) => {
      if (typeof p !== 'object' || p === null) throw new ProviderNotificationError('invalid', 'A payment must be an object');
      return {
        kind: 'payment.received' as const,
        providerRef: String(p.id ?? ''),
        market: String(p.market ?? ''),
        currency: String(p.currency ?? ''),
        amount: typeof p.amount === 'number' ? p.amount : NaN,
        reference: p.reference === undefined || p.reference === null ? null : String(p.reference),
        bookedOn: String(p.bookedOn ?? ''),
      };
    });
  }
}
