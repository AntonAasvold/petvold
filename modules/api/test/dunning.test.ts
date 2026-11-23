/** Unpaid premium through the installation (ADR 0040, punkt 7): reminder, notice of cancellation and reversal when paid in time. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '@petvold/common';
import { FAKE_NOTIFICATION_SCHEMA, signNotification } from '@petvold/payments';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';
import { eventValidator } from '../src/events-contract.ts';

const SECRET = `whsec_${Buffer.alloc(32, 'dunning-test').toString('base64')}`;

test('an unpaid invoice is reminded, its policies given notice, and the notice reversed when paid in time', async () => {
  let now = '2026-11-15T10:00:00.000Z';
  const clock = { now: () => now };
  const received: string[] = [];
  const inst = await compose({
    databases: {},
    engineVersion: 'test',
    clock,
    payments: { fake: { secret: SECRET, markets: [{ market: 'SE', currency: 'SEK' }] } },
    webhooks: { transport: { post: async (_u, _h, body) => (received.push(body), { status: 204 }) } },
  });
  const tokens: Record<string, Principal> = {
    clerk: { subject: 'finance@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    integration: { subject: 'integration@example.test', roles: ['integration-admin'], markets: '*' },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  const drain = async () => {
    while ((await inst.relay.tick()) > 0);
  };
  const sub = await app.request('/v1/webhook-subscriptions', {
    method: 'POST',
    headers: { authorization: 'Bearer integration', 'content-type': 'application/json', 'idempotency-key': 'key-dunning-0001' },
    body: JSON.stringify({ url: 'https://erp.example.com/petvold', eventTypes: ['invoice.overdue'], markets: ['SE'] }),
  });
  assert.equal(sub.status, 201);
  await seedSampleData(inst, clock);
  await drain();
  await inst.deps.billing!.invoicingRun({ market: 'SE', onDate: '2026-11-15', dryRun: false }, 'scheduler');
  await drain();
  const billing = inst.deps.billing!;
  const policies = inst.deps.policies!;
  const [inv] = await billing.invoices({ status: 'open' });
  assert.ok(inv);
  const policyIds = [...new Set(inv.lines.map((l) => l.policyId))];

  // A week after the due date: a reminder to the customer.
  now = `${addDays(inv.dueDate, 7)}T04:00:00.000Z`;
  assert.deepEqual((await billing.dunningRun({ market: 'SE', onDate: addDays(inv.dueDate, 7), dryRun: false }, 'scheduler')).reminded.includes(inv.id), true);
  await drain();
  const reminders = await inst.deps.communications!.list({ type: 'payment-reminder', invoiceId: inv.id });
  assert.equal(reminders.length, 1);
  assert.deepEqual(reminders[0]?.content.open, { amount: inv.total, currency: inv.currency });
  while ((await inst.webhookWorker.tick()).delivered > 0);
  const overdue = received.map((b) => JSON.parse(b)).filter((e) => e.type === 'petvold.invoice.overdue.v1' && e.subject === inv.id);
  assert.equal(overdue.length, 1);
  assert.ok(eventValidator('invoice.overdue')(overdue[0]), JSON.stringify(eventValidator('invoice.overdue').errors));

  // Three weeks after: notice of cancellation for unpaid premium, in force in fourteen days.
  const noticeDay = addDays(inv.dueDate, 21);
  now = `${noticeDay}T04:00:00.000Z`;
  const r = await billing.dunningRun({ market: 'SE', onDate: noticeDay, dryRun: false }, 'scheduler');
  assert.deepEqual(r.noticed.find((n) => n.invoiceId === inv.id)?.cancellations.map((c) => [c.policyId, c.effectiveDate]), policyIds.map((p) => [p, addDays(noticeDay, 14)]));
  await drain();
  for (const policyId of policyIds) {
    const notice = (await inst.deps.communications!.list({ type: 'insurer-termination', policyId }))[0];
    assert.equal(notice?.content.reason, 'unpaid-premium');
    assert.equal(notice?.content.voidIfPaidBefore, addDays(noticeDay, 14));
  }

  // Paid within the notice period: the cancellation has no effect, and is reversed.
  const paidOn = addDays(noticeDay, 5);
  now = `${paidOn}T10:00:00.000Z`;
  const raw = signNotification(SECRET, 'msg_pay', Date.parse(now) / 1000, JSON.stringify({ schema: FAKE_NOTIFICATION_SCHEMA, payments: [{ id: 'fb_late', market: 'SE', currency: 'SEK', amount: inv.total, reference: inv.reference.value, bookedOn: paidOn }] }));
  const res = await app.request('/provider-notifications/fake', { method: 'POST', headers: { 'content-type': 'application/json', ...(raw.headers as Record<string, string>) }, body: raw.body });
  assert.equal(res.status, 200);
  await drain();
  for (const policyId of policyIds) {
    const last = (await policies.transactions(policyId)).at(-1);
    assert.equal(last?.type, 'reinstate', `${policyId} reinstated`);
  }
  const shown = await app.request(`/v1/invoices/${inv.id}`, { headers: { authorization: 'Bearer clerk' } });
  const body = (await shown.json()) as any;
  assert.ok(validatorFor('Invoice')(structuredClone(body)), JSON.stringify(validatorFor('Invoice').errors));
  assert.deepEqual(body.dunning.map((s: any) => s.step), ['reminded', 'cancellation-noticed', ...policyIds.map(() => 'cancellation-voided')]);
  assert.equal(body.status, 'paid');
  assert.equal(inst.relay.deadLetters().length, 0);
});
