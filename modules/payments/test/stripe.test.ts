/** The Stripe adapter (ADR 0040, punkt 12), against made-up events and a fake fetch: no call reaches Stripe. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StripeProvider, formEncode, paymentOfEvent, signStripe, stripeFromEnv, verifyStripeSignature } from '../src/stripe.ts';
import { InMemoryPaymentsStore, PaymentsError, PaymentsService, ProviderNotificationError } from '../src/index.ts';

// Made up for the tests: no real key or secret.
const SECRET = 'whsec_testsecretforpetvold';
const KEY = 'sk_test_petvoldfake';
const NOW = '2026-12-01T10:00:00.000Z';
const T = Date.parse(NOW) / 1000;
const markets = [{ market: 'SE', currency: 'SEK' }];

const completed = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    created: T,
    data: { object: { id: 'cs_test_1', object: 'checkout.session', payment_intent: 'pi_test_1', payment_status: 'paid', amount_total: 41_200, currency: 'sek', metadata: { petvold_reference: '202600000121', petvold_market: 'SE' }, ...o } },
  });
const unauth = (re: RegExp) => (e: unknown) => e instanceof ProviderNotificationError && e.code === 'unauthenticated' && re.test(e.message);

test("Stripe's signature: v1 over t.body with the secret, within five minutes; v0 and debug entries do not count", () => {
  const raw = signStripe(SECRET, T, completed());
  verifyStripeSignature(SECRET, raw, NOW);
  const v1 = raw.headers['stripe-signature']!.split('v1=')[1]!;
  verifyStripeSignature(SECRET, { ...raw, headers: { 'stripe-signature': `t=${T},v1=${'0'.repeat(64)},v1=${v1},v0=abc,secret=whsec_****,payload=a25a` } }, NOW);
  assert.throws(() => verifyStripeSignature(SECRET, { ...raw, body: raw.body.replace('41200', '1') }, NOW), unauth(/does not match/));
  assert.throws(() => verifyStripeSignature('whsec_other', raw, NOW), unauth(/does not match/));
  assert.throws(() => verifyStripeSignature(SECRET, raw, '2026-12-01T10:05:01.000Z'), unauth(/too old/));
  assert.throws(() => verifyStripeSignature(SECRET, { ...raw, headers: { 'stripe-signature': `t=${T},v0=${v1}` } }, NOW), unauth(/no t or v1/));
  assert.throws(() => verifyStripeSignature(SECRET, { ...raw, headers: {} }, NOW), unauth(/no Stripe-Signature/));
});

test('a paid session is a payment with the invoice reference; other events, unpaid sessions and sessions not made by Petvold are nothing', () => {
  assert.deepEqual(paymentOfEvent(JSON.parse(completed()), markets), [
    { kind: 'payment.received', providerRef: 'pi_test_1', market: 'SE', currency: 'SEK', amount: 41_200, reference: '202600000121', bookedOn: '2026-12-01' },
  ]);
  const later = JSON.parse(completed({ payment_status: 'paid' }));
  later.type = 'checkout.session.async_payment_succeeded';
  assert.equal(paymentOfEvent(later, markets).length, 1);
  assert.deepEqual(paymentOfEvent(JSON.parse(completed({ payment_status: 'unpaid' })), markets), [], 'paid later, if at all');
  assert.deepEqual(paymentOfEvent({ type: 'payment_intent.succeeded', data: { object: {} } }, markets), []);
  assert.deepEqual(paymentOfEvent(JSON.parse(completed({ metadata: {} })), markets), [], "not Petvold's session");
  assert.throws(() => paymentOfEvent(JSON.parse(completed({ currency: 'eur' })), markets), (e: unknown) => e instanceof ProviderNotificationError && /EUR/.test(e.message));
});

test('a Checkout Session is made with the amount, the reference in the metadata, and the idempotency key', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: 'cs_test_9', url: 'https://checkout.stripe.com/c/pay/cs_test_9', expires_at: T + 3600 }), { status: 200 });
  }) as unknown as typeof fetch;
  const p = new StripeProvider({ secretKey: KEY, webhookSecret: SECRET, markets, fetch: fakeFetch });
  assert.equal(p.testMode, true);
  const s = await p.checkout({ market: 'SE', currency: 'SEK', amount: 41_200, reference: '202600000121', description: 'Invoice SE-2026-000001', successUrl: 'https://kund.example.test/tack', cancelUrl: 'https://kund.example.test/faktura', locale: 'sv', expiresAt: '2026-12-01T11:00:00.000Z', idempotencyKey: 'chk-inv_1' });
  assert.deepEqual(s, { provider: 'stripe', id: 'cs_test_9', url: 'https://checkout.stripe.com/c/pay/cs_test_9', expiresAt: '2026-12-01T11:00:00.000Z' });
  const { url, init } = calls[0]!;
  assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
  const headers = init.headers as Record<string, string>;
  assert.deepEqual([headers.authorization, headers['idempotency-key']], [`Bearer ${KEY}`, 'chk-inv_1']);
  const form = new URLSearchParams(String(init.body));
  assert.deepEqual(
    ['mode', 'line_items[0][price_data][currency]', 'line_items[0][price_data][unit_amount]', 'metadata[petvold_reference]', 'payment_intent_data[metadata][petvold_market]', 'locale', 'expires_at'].map((k) => form.get(k)),
    ['payment', 'sek', '41200', '202600000121', 'SE', 'sv', String(T + 3600)],
  );
  const failing = new StripeProvider({ secretKey: KEY, webhookSecret: SECRET, markets, fetch: (async () => new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 })) as unknown as typeof fetch });
  await assert.rejects(failing.checkout({ market: 'SE', currency: 'SEK', amount: 1, reference: 'x', description: 'x', successUrl: 'https://a.test', cancelUrl: 'https://a.test', expiresAt: NOW, idempotencyKey: 'k' }), /401.*Invalid API Key/);
  assert.equal(formEncode({ 'a[b]': 'x y', c: undefined }), 'a%5Bb%5D=x%20y');
});

test('through the service: a signed event becomes a payment once, and a page is made only where the adapter takes payments', async () => {
  let n = 0;
  const p = new StripeProvider({ secretKey: KEY, webhookSecret: SECRET, markets, fetch: (async () => new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/x', expires_at: T })) ) as unknown as typeof fetch });
  const service = new PaymentsService({ store: new InMemoryPaymentsStore(), providers: [p], clock: { now: () => NOW }, ids: { next: (x) => `${x}_${++n}` } });
  const raw = signStripe(SECRET, T, completed());
  assert.equal((await service.receive('stripe', raw)).received.length, 1);
  assert.equal((await service.receive('stripe', raw)).duplicates.length, 1, 'Stripe sends an event again: the same payment');
  assert.deepEqual(service.checkoutProviders(), ['stripe']);
  const code = (x: Promise<unknown>) => x.then(() => 'ok', (e) => (e instanceof PaymentsError ? e.code : String(e)));
  const req = { market: 'FI', currency: 'EUR', amount: 1, reference: 'x', description: 'x', successUrl: 'https://a.test', cancelUrl: 'https://a.test', expiresAt: NOW, idempotencyKey: 'k' };
  assert.equal(await code(service.createCheckout('stripe', req)), 'validation');
  assert.equal(await code(service.createCheckout('fake', req)), 'not_found');
});

test('the environment', () => {
  assert.equal(stripeFromEnv({}), null);
  assert.deepEqual(stripeFromEnv({ PETVOLD_STRIPE_SECRET_KEY: KEY, PETVOLD_STRIPE_WEBHOOK_SECRET: SECRET })?.markets, markets);
  assert.throws(() => stripeFromEnv({ PETVOLD_STRIPE_SECRET_KEY: KEY }), /both/);
  assert.throws(() => new StripeProvider({ secretKey: 'pk_test_x', webhookSecret: SECRET, markets }), /sk_test_/);
});
