/** Stripe Checkout through the API (ADR 0040, punkt 12), with a fake fetch: no call reaches Stripe. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StripeProvider, signStripe } from '@petvold/payments/stripe';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';

const SECRET = 'whsec_testsecretforpetvold';

test('a channel makes a payment page for an invoice; the signed checkout.session.completed pays the invoice', async () => {
  const clock = { now: () => new Date().toISOString() };
  const sessions: URLSearchParams[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    sessions.push(new URLSearchParams(String(init.body)));
    return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
  }) as unknown as typeof fetch;
  const stripe = new StripeProvider({ secretKey: 'sk_test_petvoldfake', webhookSecret: SECRET, markets: [{ market: 'SE', currency: 'SEK' }], fetch: fakeFetch });
  const inst = await compose({ databases: {}, engineVersion: 'test', clock, payments: { providers: [stripe] } });
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  await inst.deps.billing!.invoicingRun({ market: 'SE', onDate: new Date().toISOString().slice(0, 10), dryRun: false }, 'scheduler');
  const tokens: Record<string, Principal> = {
    clerk: { subject: 'ekonomi@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    handler: { subject: 'h@example.test', roles: ['handler'], markets: ['SE'] },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let k = 0;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': `key-chk-${String(++k).padStart(4, '0')}` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const invoice = (await call('GET', '/v1/invoices?status=open', 'clerk')).body.items[0];
  const page = { successUrl: 'https://kund.example.test/tack', cancelUrl: 'https://kund.example.test/faktura', locale: 'sv' };

  assert.equal((await call('POST', `/v1/invoices/${invoice.id}/checkout-sessions`, 'handler', page)).status, 403);
  assert.equal((await call('POST', `/v1/invoices/${invoice.id}/checkout-sessions`, 'clerk', { ...page, successUrl: 'http://evil.example.test' })).status, 422, 'https only');
  const made = await call('POST', `/v1/invoices/${invoice.id}/checkout-sessions`, 'clerk', page);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.ok(validatorFor('CheckoutSession')(structuredClone(made.body)), JSON.stringify(validatorFor('CheckoutSession').errors));
  assert.deepEqual([made.body.provider, made.body.url, made.body.amount], ['stripe', 'https://checkout.stripe.com/c/pay/cs_test_1', invoice.open]);
  assert.deepEqual([sessions[0]!.get('metadata[petvold_reference]'), sessions[0]!.get('line_items[0][price_data][unit_amount]')], [invoice.reference.value, String(invoice.open)]);

  // Stripe tells Petvold, signed.
  const event = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000), data: { object: { id: 'cs_test_1', payment_intent: 'pi_test_1', payment_status: 'paid', amount_total: invoice.open, currency: 'sek', metadata: { petvold_reference: invoice.reference.value, petvold_market: 'SE' } } } });
  const raw = signStripe(SECRET, Math.floor(Date.now() / 1000), event);
  const forged = await app.request('/provider-notifications/stripe', { method: 'POST', headers: { ...raw.headers, 'stripe-signature': raw.headers['stripe-signature']!.replace(/v1=./, 'v1=0') }, body: event });
  assert.equal(forged.status, 401);
  const told = await app.request('/provider-notifications/stripe', { method: 'POST', headers: raw.headers as Record<string, string>, body: event });
  assert.equal(told.status, 200);
  while ((await inst.relay.tick()) > 0);
  assert.equal((await call('GET', `/v1/invoices/${invoice.id}`, 'clerk')).body.status, 'paid');
  assert.equal((await call('POST', `/v1/invoices/${invoice.id}/checkout-sessions`, 'clerk', page)).status, 409, 'nothing left to pay');
});
