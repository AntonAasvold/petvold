/** Credit notes and write-offs through the API (ADR 0040, punkt 10): alone within the limit, else another person approves. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';

test('a clerk credits within the limit, proposes above it, and the head of finance approves', async () => {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  await inst.deps.billing!.invoicingRun({ market: 'SE', onDate: '2026-11-15', dryRun: false }, 'scheduler');
  const tokens: Record<string, Principal> = {
    clerk: { subject: 'ekonomi@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    manager: { subject: 'ekonomichef@example.test', roles: ['billing-manager'], markets: ['SE'] },
    handler: { subject: 'h@example.test', roles: ['handler'], markets: ['SE'] },
    documents: { subject: 'docs@example.test', roles: ['document-service'], markets: ['SE'] },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let k = 0;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': `key-crn-${String(++k).padStart(4, '0')}` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as any };
  };
  const inv = (await call('GET', '/v1/invoices?status=open', 'clerk')).body.items.find((i: any) => i.total > 200_000);
  assert.ok(inv, 'an invoice over 2 000 kr');

  assert.equal((await call('POST', `/v1/invoices/${inv.id}/credit-notes`, 'handler', { kind: 'credit', amount: 100, reason: 'x' })).status, 403);
  const small = await call('POST', `/v1/invoices/${inv.id}/credit-notes`, 'clerk', { kind: 'credit', amount: 50_000, reason: 'Goodwill' });
  assert.equal(small.status, 201);
  assert.ok(validatorFor('CreditNote')(structuredClone(small.body)), JSON.stringify(validatorFor('CreditNote').errors));

  const big = await call('POST', `/v1/invoices/${inv.id}/credit-notes`, 'clerk', { kind: 'write-off', amount: 150_000, reason: 'Hardship' });
  assert.equal(big.status, 202);
  assert.ok(validatorFor('CreditProposal')(structuredClone(big.body)), JSON.stringify(validatorFor('CreditProposal').errors));
  assert.deepEqual((await call('GET', '/v1/credit-proposals?status=proposed', 'manager')).body.items.map((p: any) => p.id), [big.body.id]);
  assert.equal((await call('POST', `/v1/credit-proposals/${big.body.id}/approvals`, 'clerk', {})).status, 403, 'not the proposer');
  const approved = await call('POST', `/v1/credit-proposals/${big.body.id}/approvals`, 'manager', {});
  assert.equal(approved.status, 201);
  assert.equal(approved.body.kind, 'write-off');
  assert.equal((await call('GET', `/v1/credit-proposals/${big.body.id}`, 'clerk')).body.status, 'approved');
  assert.equal((await call('POST', `/v1/invoices/${inv.id}/credit-notes`, 'manager', { kind: 'write-off', amount: inv.total, reason: 'x' })).status, 409, 'more than is unpaid');
  // The customer gets the credit note, but not the write-off (ADR 0040).
  while ((await inst.relay.tick()) > 0);
  const notices = (await call('GET', `/v1/notices?type=credit-note&recipientPartyId=${inv.partyId}`, 'documents')).body.items;
  assert.deepEqual(notices.map((n: any) => [n.content.creditNoteId, n.content.total.amount, n.content.cause, n.invoiceId]), [[small.body.id, 50_000, 'manual', inv.id]]);
  assert.ok(validatorFor('Notice')(structuredClone(notices[0])), JSON.stringify(validatorFor('Notice').errors));
  assert.equal(JSON.stringify(notices[0]).includes('Goodwill'), false, "never the person's reason");
  const me = await call('GET', '/v1/me', 'clerk');
  assert.deepEqual(me.body.creditLimits, { SEK: 100_000, EUR: 10_000 });
});
