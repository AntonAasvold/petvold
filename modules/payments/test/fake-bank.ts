/** Notifications from the fake bank, for the tests. */
import { FAKE_NOTIFICATION_SCHEMA, type ReceivedPayment } from '../src/index.ts';

export const SECRET = `whsec_${Buffer.from('fake-bank-secret-for-tests-only!').toString('base64')}`;

export function fakeBody(payments: Omit<ReceivedPayment, 'kind'>[]): string {
  return JSON.stringify({
    schema: FAKE_NOTIFICATION_SCHEMA,
    payments: payments.map((p) => ({ id: p.providerRef, market: p.market, currency: p.currency, amount: p.amount, reference: p.reference, bookedOn: p.bookedOn })),
  });
}
