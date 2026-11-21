/** Payer accounts and premium plans through the API (ADR 0040), with the installation's relay. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';

async function setup() {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  const plans = await inst.stores.billing.plans({});
  const tokens: Record<string, Principal> = {
    clerk: { subject: 'finance@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    clerkDe: { subject: 'finance-de@example.test', roles: ['billing-clerk'], markets: ['DE'] },
    portal: { subject: 'portal', roles: ['customer-channel'], markets: ['SE'], policyIds: [plans[0]!.policyId] },
    clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  const call = async (path: string, token: string) => {
    const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { call, plans, inst };
}

test('every issued policy in the sample data has a premium plan on its policyholder\'s account', async () => {
  const { call, plans } = await setup();
  assert.ok(plans.length > 0);
  const accounts = await call('/v1/payer-accounts', 'clerk');
  assert.equal(accounts.status, 200);
  for (const a of accounts.body.items) assert.ok(validatorFor('PayerAccount')(structuredClone(a)), JSON.stringify(validatorFor('PayerAccount').errors));
  const first = accounts.body.items[0];
  assert.deepEqual((await call(`/v1/payer-accounts/${first.id}`, 'clerk')).body, first);
  assert.ok((await call(`/v1/payer-accounts?partyId=${first.partyId}`, 'clerk')).body.items.every((a: any) => a.partyId === first.partyId));

  const byPolicy = await call(`/v1/premium-plans?policyId=${plans[0]!.policyId}`, 'clerk');
  assert.equal(byPolicy.status, 200);
  for (const p of byPolicy.body.items) assert.ok(validatorFor('PremiumPlanRecord')(structuredClone(p)), JSON.stringify(validatorFor('PremiumPlanRecord').errors));
  const p = byPolicy.body.items[0];
  assert.equal(p.plan.installments.reduce((s: number, i: any) => s + i.amount, 0), p.plan.total);
  assert.ok((await call(`/v1/premium-plans?accountId=${p.accountId}`, 'clerk')).body.items.some((x: any) => x.id === p.id));
  assert.equal((await call('/v1/premium-plans', 'clerk')).status, 422, 'a filter is required');
});

test('scope: other markets, a portal bound to policies, and a clinic', async () => {
  const { call, plans } = await setup();
  const account = plans[0]!.accountId;
  assert.equal((await call('/v1/payer-accounts', 'clerkDe')).body.items.length, 0);
  assert.equal((await call(`/v1/payer-accounts/${account}`, 'clerkDe')).status, 404);
  assert.equal((await call(`/v1/payer-accounts/${account}`, 'portal')).status, 404, 'a portal sees no accounts');
  assert.equal((await call(`/v1/payer-accounts/bac_nope`, 'clerk')).status, 404);
  const mine = await call(`/v1/premium-plans?accountId=${account}`, 'portal');
  assert.ok(mine.body.items.length > 0 && mine.body.items.every((p: any) => p.policyId === plans[0]!.policyId));
  assert.equal((await call(`/v1/premium-plans?policyId=${plans[0]!.policyId}`, 'clinic')).status, 403);
});
