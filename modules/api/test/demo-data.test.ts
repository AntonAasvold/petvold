/** The demo's test data (ADR 0041), a short run in memory. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from '../src/composition.ts';
import { DemoClock, demoIds, random, runDemo } from '../src/demo-data.ts';

const SECRET = `whsec_${Buffer.alloc(32, 'demo-test').toString('base64')}`;

async function run(seed: number) {
  const clock = new DemoClock('2026-06-01T06:00:00.000Z');
  const inst = await compose({ databases: {}, engineVersion: 'test', clock, ids: demoIds(seed), payments: { fake: { secret: SECRET, markets: [{ market: 'SE', currency: 'SEK' }] } } });
  const sum = await runDemo(inst, clock, { from: '2026-06-01', to: '2026-08-15', seed, customersPerDay: 0.6, bankSecret: SECRET });
  return { inst, sum };
}

test('months of customers, policies, claims, invoices and payments, the same for the same seed', async () => {
  const a = await run(7);
  assert.ok(a.sum.customers > 20 && a.sum.policies > 20, JSON.stringify(a.sum));
  assert.ok(a.sum.claims > 0 && a.sum.payments > 0, JSON.stringify(a.sum));
  assert.equal(a.inst.relay.deadLetters().length, 0);
  const invoices = await a.inst.stores.billing.invoices({});
  assert.ok(invoices.length > a.sum.policies / 2);
  // Every payment carries an invoice's reference and amount.
  const refs = new Map(invoices.map((i) => [i.reference.value, i.total]));
  for (const p of await a.inst.stores.payments.payments({})) assert.equal(refs.get(p.reference!), p.amount);

  const b = await run(7);
  assert.deepEqual(b.sum, a.sum);
  assert.deepEqual((await b.inst.stores.billing.invoices({})).map((i) => [i.id, i.number, i.total]), invoices.map((i) => [i.id, i.number, i.total]));
  const c = await run(8);
  assert.notDeepEqual(c.sum, a.sum);
});

test('the random numbers are the same for a seed', () => {
  const r1 = random(42);
  const r2 = random(42);
  const xs = Array.from({ length: 5 }, () => r1());
  assert.deepEqual(Array.from({ length: 5 }, () => r2()), xs);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});
