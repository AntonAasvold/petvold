/**
 * The shared suite for payment adapters (ADR 0017, punkt 7). An adapter is done
 * when it passes against the service's test environment; the fake adapter
 * passes it too. The harness makes notifications in the service's own format.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Timestamp } from '@petvold/common';
import { ProviderNotificationError, type PaymentProvider, type RawNotification, type ReceivedPayment } from '../src/index.ts';

export interface ProviderHarness {
  provider: PaymentProvider;
  now: Timestamp;
  /** A notification of these payments, signed as the service signs, at `now`. */
  notify(payments: Omit<ReceivedPayment, 'kind'>[]): RawNotification;
  /** The same notification signed long before `now`. */
  stale(payments: Omit<ReceivedPayment, 'kind'>[]): RawNotification;
}

const sample = (o: Partial<ReceivedPayment> = {}): Omit<ReceivedPayment, 'kind'> => ({
  providerRef: 'ref_1',
  market: 'SE',
  currency: 'SEK',
  amount: 41_200,
  reference: '202600000121',
  bookedOn: '2026-12-01',
  ...o,
});

export function providerSuite(name: string, make: () => Promise<ProviderHarness>): void {
  describe(name, () => {
    test('it can take payments somewhere', async () => {
      const { provider } = await make();
      assert.ok(provider.id);
      assert.ok(provider.capabilities().length > 0);
    });

    test('a signed notification is translated, amounts in minor units', async () => {
      const h = await make();
      const out = await h.provider.parseNotification(h.notify([sample(), sample({ providerRef: 'ref_2', reference: null, amount: 1 })]), h.now);
      assert.deepEqual(out, [
        { kind: 'payment.received', ...sample() },
        { kind: 'payment.received', ...sample({ providerRef: 'ref_2', reference: null, amount: 1 }) },
      ]);
    });

    test('a changed body is refused', async () => {
      const h = await make();
      const raw = h.notify([sample()]);
      const tampered = { ...raw, body: raw.body.replace('41200', '91200') };
      assert.notEqual(tampered.body, raw.body);
      await assert.rejects(h.provider.parseNotification(tampered, h.now), (e) => e instanceof ProviderNotificationError && e.code === 'unauthenticated');
    });

    test('an unsigned or old notification is refused', async () => {
      const h = await make();
      const raw = h.notify([sample()]);
      await assert.rejects(h.provider.parseNotification({ headers: {}, body: raw.body }, h.now), (e) => e instanceof ProviderNotificationError && e.code === 'unauthenticated');
      await assert.rejects(h.provider.parseNotification(h.stale([sample()]), h.now), (e) => e instanceof ProviderNotificationError && e.code === 'unauthenticated');
    });
  });
}
