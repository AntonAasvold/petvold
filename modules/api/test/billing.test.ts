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

test('the invoicing job makes invoices, the relay sends invoice.issued, and the API reads them', async () => {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  // A year ahead, so every plan in the sample data has something due.
  const run = await inst.deps.billing!.invoicingRun({ market: 'SE', onDate: '2027-11-01', dryRun: false }, 'scheduler');
  assert.ok(run.invoices.length > 0);
  const events = await inst.stores.billing.pendingEvents(100);
  assert.deepEqual(events.map((e) => e.type), run.invoices.map(() => 'invoice.issued'));
  while ((await inst.relay.tick()) > 0);
  assert.equal((await inst.stores.billing.pendingEvents(100)).length, 0, 'the relay published them');
  // Each invoice went to the customer as a notice, due to be sent on its issue date.
  const notices = await inst.deps.communications!.list({ type: 'invoice' });
  assert.deepEqual(notices.map((n) => n.invoiceId).sort(), run.invoices.map((i) => i.invoiceId).sort());
  assert.ok(notices.every((n) => n.dueBy === '2027-11-01' && n.content.reference !== undefined));

  const tokens: Record<string, Principal> = {
    clerk: { subject: 'finance@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    portal: { subject: 'portal', roles: ['customer-channel'], markets: ['SE'], policyIds: [run.invoices[0]!.lines[0]!.policyId] },
    clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  const call = async (path: string, token: string) => {
    const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as any };
  };
  const list = await call('/v1/invoices?market=SE', 'clerk');
  assert.equal(list.body.items.length, run.invoices.length);
  for (const i of list.body.items) assert.ok(validatorFor('Invoice')(structuredClone(i)), JSON.stringify(validatorFor('Invoice').errors));
  const first = list.body.items[0];
  assert.match(first.number, /^SE-2027-\d{6}$/);
  assert.deepEqual((await call(`/v1/invoices/${first.id}`, 'clerk')).body, first);
  assert.ok((await call(`/v1/invoices?policyId=${first.lines[0].policyId}`, 'clerk')).body.items.some((i: any) => i.id === first.id));
  const mine = (await call('/v1/invoices', 'portal')).body.items;
  assert.ok(mine.every((i: any) => i.lines.every((l: any) => l.policyId === run.invoices[0]!.lines[0]!.policyId)));
  assert.equal((await call('/v1/invoices', 'clinic')).status, 403);
  assert.equal((await call('/v1/invoices/inv_nope', 'clerk')).status, 404);
});

test('a cancellation through the policy module: the relay credits what is no longer owed, and the API shows the credit note', async () => {
  let now = '2026-11-15T10:00:00.000Z';
  const clock = { now: () => now };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  const billing = inst.deps.billing!;
  // Invoice what is due a year ahead, then end one invoiced policy from the start of its current term: the animal died.
  await billing.invoicingRun({ market: 'SE', onDate: '2027-11-01', dryRun: false }, 'scheduler');
  while ((await inst.relay.tick()) > 0);
  const invoice = (await billing.invoices({ market: 'SE' }))[0]!;
  const policyId = invoice.lines[0]!.policyId;
  const policy = await inst.deps.policies!.get(policyId);
  now = '2026-11-16T10:00:00.000Z';
  const term = policy.terms.at(-1)!;
  await inst.deps.policies!.cancel(policyId, { reason: 'need-ceased', effectiveDate: term.startDate < '2026-11-16' ? '2026-11-16' : term.startDate, note: 'The animal died' }, 'handler');
  while ((await inst.relay.tick()) > 0);

  const credits = await billing.creditNotes({ policyId });
  assert.ok(credits.length > 0, 'something invoiced is no longer owed');
  const tokens: Record<string, Principal> = { clerk: { subject: 'finance@example.test', roles: ['billing-clerk'], markets: ['SE'] }, clerkDe: { subject: 'de', roles: ['billing-clerk'], markets: ['DE'] } };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  const call = async (path: string, token: string) => {
    const res = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as any };
  };
  const list = await call(`/v1/credit-notes?policyId=${policyId}`, 'clerk');
  for (const c of list.body.items) assert.ok(validatorFor('CreditNote')(structuredClone(c)), JSON.stringify(validatorFor('CreditNote').errors));
  assert.deepEqual((await call(`/v1/credit-notes/${credits[0]!.id}`, 'clerk')).body.id, credits[0]!.id);
  assert.equal((await call(`/v1/credit-notes/${credits[0]!.id}`, 'clerkDe')).status, 404);
  const plans = (await call(`/v1/premium-plans?policyId=${policyId}`, 'clerk')).body.items;
  for (const p of plans) assert.ok(validatorFor('PremiumPlanRecord')(structuredClone(p)), JSON.stringify(validatorFor('PremiumPlanRecord').errors));
  assert.ok(plans.some((p: any) => p.adjustment?.kind === 'cancellation'));
  // invoice.credited went to the relay and was published.
  assert.equal((await inst.stores.billing.pendingEvents(100)).length, 0);
});
