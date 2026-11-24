/**
 * The books agree with the modules (ADR 0040, punkt 9): after months of demo
 * data, each account's balance is what billing and payments say is owed, paid
 * and unmatched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertBalanced } from '@petvold/accounting';
import { accountBalance } from '@petvold/billing';
import { compose } from '../src/composition.ts';
import { DemoClock, demoIds, runDemo } from '../src/demo-data.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';

const SECRET = `whsec_${Buffer.alloc(32, 'accounting-test').toString('base64')}`;

test('after three months, every verification balances and every account agrees with billing and payments', async () => {
  const clock = new DemoClock('2026-06-01T06:00:00.000Z');
  const inst = await compose({ databases: {}, engineVersion: 'test', clock, ids: demoIds(3), payments: { fake: { secret: SECRET, markets: [{ market: 'SE', currency: 'SEK' }] }, newPayeeHoldDays: 2 } });
  await runDemo(inst, clock, { from: '2026-06-01', to: '2026-09-01', seed: 3, customersPerDay: 0.6, bankSecret: SECRET });
  assert.equal(inst.relay.deadLetters().length, 0);
  const accounting = inst.deps.accounting!;
  const billing = inst.deps.billing!;
  const payments = inst.deps.payments!;

  const all = await accounting.verifications({ market: 'SE' });
  assert.ok(all.length > 100, `${all.length} verifications`);
  for (const v of all) assertBalanced(v);
  const numbers = all.filter((v) => v.number.startsWith('V-SE-2026-')).map((v) => Number(v.number.slice(-6)));
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1), 'an unbroken series');

  const balance = Object.fromEntries((await accounting.balances({ market: 'SE' })).map((b) => [b.account, b.balance]));
  let owed = 0;
  for (const a of await billing.accounts({ market: 'SE' })) {
    const b = accountBalance(await inst.stores.billing.ledger(a.id));
    owed += b.open - b.credit;
  }
  assert.equal(balance['premium-receivable'] ?? 0, owed, 'premium receivable is what the payers owe, less their credit');
  const unmatched = (await billing.receivedPayments({ status: 'unmatched' })).reduce((s, p) => s + p.amount, 0);
  assert.equal((balance['unmatched-payments'] ?? 0) + unmatched, 0, 'unmatched payments');
  const received = (await payments.payments({ market: 'SE' })).reduce((s, p) => s + p.amount, 0);
  const allPayouts = await payments.payouts({ market: 'SE' });
  const paidOut = allPayouts.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  assert.equal(balance.bank ?? 0, received - paidOut, 'the bank is what came in less what went out');
  const notPaid = (purpose: string) => allPayouts.filter((p) => p.purpose === purpose && p.status !== 'paid').reduce((s, p) => s + p.amount, 0) || 0;
  assert.equal((balance['claims-payable'] ?? 0) + notPaid('claim'), 0, 'claims not yet paid out');
  assert.equal((balance['refunds-payable'] ?? 0) + notPaid('premium-refund'), 0, 'refunds not yet paid out');

  // And through the API, as the accountants see it.
  const tokens: Record<string, Principal> = { accountant: { subject: 'redovisning@example.test', roles: ['accountant'], markets: ['SE'] }, handler: { subject: 'h', roles: ['handler'], markets: ['SE'] } };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  const get = async (path: string, token = 'accountant') => {
    const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as any };
  };
  const page = await get('/v1/verifications?market=SE&from=2026-07-01&to=2026-07-31&limit=50');
  assert.equal(page.status, 200);
  for (const v of page.body.items) assert.ok(validatorFor('Verification')(structuredClone(v)), JSON.stringify(validatorFor('Verification').errors));
  assert.equal((await get(`/v1/verifications/${page.body.items[0].id}`)).body.number, page.body.items[0].number);
  const balances = await get('/v1/account-balances?market=SE');
  assert.ok(validatorFor('AccountBalances')(structuredClone(balances.body)), JSON.stringify(validatorFor('AccountBalances').errors));
  assert.equal((await get('/v1/verifications', 'handler')).status, 403);
  assert.equal((await get('/v1/account-balances')).status, 422);
});
