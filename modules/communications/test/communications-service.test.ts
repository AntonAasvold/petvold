import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommunicationsError, CommunicationsService, InMemoryNoticeStore, NOTICE_RULES, type PolicyView, type SourceEvent, type TermView, type TransactionView } from '../src/index.ts';

const vetCare = { code: 'vet_care', annualLimit: 6_000_000, waitingPeriodDays: 30 };
const term = (termNo: number, o: Partial<TermView> = {}): TermView => ({
  termNo,
  startDate: `${2025 + termNo}-12-01`,
  endDate: `${2026 + termNo}-12-01`,
  productVersion: 'SE-HUND@1',
  currency: 'SEK',
  premium: 480_000,
  vetCare,
  deductibleOption: 'standard',
  riders: [{ description: 'Ear infection', diagnosisCodes: ['ORA-OTIT'], validFrom: '2026-12-01' }],
  ...o,
});

function setup(o: { language?: string; policy?: Partial<PolicyView>; transactions?: Record<string, TransactionView> } = {}) {
  let n = 0;
  let now = '2026-11-16T10:00:00.000Z';
  const store = new InMemoryNoticeStore();
  const policy: PolicyView = {
    id: 'pol_1',
    market: 'SE',
    animalId: 'ani_rex',
    terms: [term(1)],
    versions: [{ validFrom: '2026-12-01', validTo: '2027-12-01', policyholderPartyId: 'pty_anna', status: 'active' }],
    ...o.policy,
  };
  const transactions: Record<string, TransactionView> = {
    ptx_issue: { type: 'issue', acceptedDocuments: [{ type: 'terms', language: 'sv', sha256: 'a'.repeat(64) }] },
    ...o.transactions,
  };
  const s = new CommunicationsService({
    store,
    policies: {
      policy: async (id) => (id === policy.id ? structuredClone(policy) : null),
      transaction: async (_p, id) => transactions[id] ?? null,
      application: async (id) =>
        id === 'app_1'
          ? { id, market: 'SE', animalId: 'ani_old', policyholderPartyId: 'pty_lena', productVersion: 'SE-UW@1', reasons: ['too-old'], decidedBy: 'rules' }
          : null,
    },
    parties: { languageOf: async (id) => (id === 'pty_anna' ? o.language : undefined) },
    clock: { now: () => now },
    ids: { next: (p) => `${p}_${++n}` },
  });
  return { s, store, at: (iso: string) => (now = iso) };
}

const event = (type: string, data: Record<string, unknown> = {}, o: Partial<SourceEvent> = {}): SourceEvent => ({
  id: `pev_${type}`,
  type,
  policyId: 'pol_1',
  occurredAt: '2026-11-16T10:00:00.000Z',
  data,
  ...o,
});
const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof CommunicationsError && e.code === code && (!msg || msg.test(e.message)));

test('an issued policy gives a confirmation with the terms, riders and accepted documents, due promptly (ADR 0032)', async () => {
  const { s } = setup();
  const n = (await s.handlePolicyEvent(event('policy.issued', { transactionId: 'ptx_issue' })))!;
  assert.deepEqual([n.type, n.schema, n.recipientPartyId, n.language, n.policyId, n.dueBy], ['policy-confirmation', 'policy-confirmation.v1', 'pty_anna', 'sv', 'pol_1', '2026-11-19']);
  assert.deepEqual(n.legalBasis, NOTICE_RULES.SE!.types['policy-confirmation'].legalBasis);
  assert.deepEqual(n.content, {
    policyId: 'pol_1',
    animalId: 'ani_rex',
    termNo: 1,
    productVersion: 'SE-HUND@1',
    startDate: '2026-12-01',
    endDate: '2027-12-01',
    premium: { amount: 480_000, currency: 'SEK' },
    vetCare,
    deductibleOption: 'standard',
    riders: [{ description: 'Ear infection', diagnosisCodes: ['ORA-OTIT'], validFrom: '2026-12-01' }],
    acceptedDocuments: [{ type: 'terms', language: 'sv', sha256: 'a'.repeat(64) }],
  });
  assert.deepEqual(n.source, { eventId: 'pev_policy.issued', eventType: 'policy.issued', occurredAt: '2026-11-16T10:00:00.000Z' });
  // The relay may deliver an event again: no second notice.
  assert.equal(await s.handlePolicyEvent(event('policy.issued', { transactionId: 'ptx_issue' })), null);
  assert.equal((await s.list()).length, 1);
});

test('the party\'s language wins over the market\'s; events without a notice and markets without rules give none', async () => {
  assert.equal((await setup({ language: 'en' }).s.handlePolicyEvent(event('policy.issued', { transactionId: 'ptx_issue' })))!.language, 'en');
  const { s } = setup({ policy: { market: 'XX' } });
  assert.equal(await s.handlePolicyEvent(event('policy.issued', { transactionId: 'ptx_issue' })), null);
  assert.equal(await s.handlePolicyEvent(event('policy.version_superseded', { versionId: 'pv_1' })), null);
  assert.equal(await s.handlePolicyEvent(event('application.received', {}, { policyId: undefined, applicationId: 'app_1' })), null);
  await assert.rejects(setup().s.handlePolicyEvent(event('policy.issued', {}, { policyId: 'pol_none' })), /does not exist/);
});

test('a renewal notice lists what changed against the previous term, due when the new term starts', async () => {
  const renewed = term(2, { productVersion: 'SE-HUND@2', premium: 510_000 });
  const { s } = setup({ policy: { terms: [term(1), renewed], versions: [{ validFrom: '2026-12-01', validTo: '2028-12-01', policyholderPartyId: 'pty_anna', status: 'active' }] } });
  const n = (await s.handlePolicyEvent(event('policy.renewed', { transactionId: 'ptx_r', termNo: 2 })))!;
  assert.deepEqual([n.type, n.dueBy, n.content.changes, n.content.premium], ['renewal-notice', '2027-12-01', ['product-version', 'premium'], { amount: 510_000, currency: 'SEK' }]);
  assert.deepEqual(n.content.previous, { productVersion: 'SE-HUND@1', premium: { amount: 480_000, currency: 'SEK' }, vetCare, deductibleOption: 'standard' });
  const same = setup({ policy: { terms: [term(1), term(2)] } });
  assert.deepEqual((await same.s.handlePolicyEvent(event('policy.renewed', { termNo: 2 })))!.content.changes, []);
});

test('the insurer\'s cancellation is due the day it was sent; for unpaid premium it says how to void it', async () => {
  const cancellation = { reason: 'unpaid-premium', receivedOn: '2026-11-16', effectiveDate: '2026-11-30', refund: { amount: 0, currency: 'SEK' } };
  const { s } = setup({ transactions: { ptx_c: { type: 'cancel', cancellation } } });
  const n = (await s.handlePolicyEvent(event('policy.cancelled', { transactionId: 'ptx_c' })))!;
  assert.deepEqual([n.type, n.dueBy, n.legalBasis.length], ['insurer-termination', '2026-11-16', 3]);
  assert.deepEqual(n.content, { policyId: 'pol_1', animalId: 'ani_rex', reason: 'unpaid-premium', receivedOn: '2026-11-16', effectiveDate: '2026-11-30', refund: { amount: 0, currency: 'SEK' }, voidIfPaidBefore: '2026-11-30' });

  const breach = setup({ transactions: { ptx_c: { type: 'cancel', cancellation: { ...cancellation, reason: 'insurer-breach', note: 'False information at claim' } } } });
  assert.equal((await breach.s.handlePolicyEvent(event('policy.cancelled', { transactionId: 'ptx_c' })))!.content.grounds, 'False information at claim');
});

test('the customer\'s cancellation gives a confirmation to the policyholder on the last day', async () => {
  const cancellation = { reason: 'customer-immediate', receivedOn: '2027-03-01', effectiveDate: '2027-03-02', refund: { amount: 360_000, currency: 'SEK' }, note: 'Moved abroad' };
  const { s } = setup({
    transactions: { ptx_c: { type: 'cancel', cancellation } },
    policy: {
      versions: [
        { validFrom: '2026-12-01', validTo: '2027-02-01', policyholderPartyId: 'pty_anna', status: 'active' },
        { validFrom: '2027-02-01', validTo: '2027-03-02', policyholderPartyId: 'pty_bo', status: 'active' },
        { validFrom: '2027-03-02', validTo: '2027-12-01', policyholderPartyId: 'pty_bo', status: 'cancelled' },
      ],
    },
  });
  const n = (await s.handlePolicyEvent(event('policy.cancelled', { transactionId: 'ptx_c' })))!;
  assert.deepEqual([n.type, n.recipientPartyId, n.dueBy, n.legalBasis, n.content.grounds], ['cancellation-confirmation', 'pty_bo', '2026-11-19', [], undefined]);
});

test('a declined application gives a notice with the reasons, without a policy', async () => {
  const { s } = setup();
  const n = (await s.handlePolicyEvent(event('application.declined', {}, { policyId: undefined, applicationId: 'app_1' })))!;
  assert.deepEqual([n.type, n.recipientPartyId, n.applicationId, n.policyId], ['application-declined', 'pty_lena', 'app_1', undefined]);
  assert.deepEqual(n.content, { applicationId: 'app_1', animalId: 'ani_old', productVersion: 'SE-UW@1', reasons: ['too-old'], decidedBy: 'rules' });
});

test('the document system reports a delivery: sent with evidence, or failed with a reason; late and overdue are flagged', async () => {
  const { s, at } = setup();
  const n = (await s.handlePolicyEvent(event('policy.issued', { transactionId: 'ptx_issue' })))!;
  at('2026-11-17T09:00:00.000Z');
  const ok = { outcome: 'sent' as const, channel: 'digital-mailbox', sentAt: '2026-11-17T08:00:00Z', documentId: 'arch-123', sha256: 'B'.repeat(64) };
  await rejects(s.addDelivery(n.id, { ...ok, channel: 'pigeon' }, 'ds'), 'validation', /channel/);
  await rejects(s.addDelivery(n.id, { ...ok, sentAt: '2026-11-17T09:06:00Z' }, 'ds'), 'validation', /future/);
  await rejects(s.addDelivery(n.id, { ...ok, sentAt: '2026-11-15T10:00:00Z' }, 'ds'), 'validation', /before the notice/);
  await rejects(s.addDelivery(n.id, { ...ok, sha256: 'x' }, 'ds'), 'validation', /sha256/);
  await rejects(s.addDelivery(n.id, { ...ok, documentId: ' ' }, 'ds'), 'validation', /documentId/);
  await rejects(s.addDelivery(n.id, { outcome: 'failed', reason: ' ' }, 'ds'), 'validation', /reason/);
  await rejects(s.addDelivery(n.id, { outcome: 'failed', reason: 'x', documentId: 'd' }, 'ds'), 'validation', /no sentAt/);
  await rejects(s.addDelivery(n.id, { outcome: 'lost' as never }, 'ds'), 'validation', /outcome/);
  await rejects(s.addDelivery('ntc_none', ok, 'ds'), 'not_found');

  const f = await s.addDelivery(n.id, { outcome: 'failed', channel: 'letter', reason: 'No postal address' }, 'ds');
  assert.deepEqual([f.status, f.overdue, f.deliveries.length], ['failed', undefined, 1]);
  assert.deepEqual((await s.list({ attention: true })).map((x) => x.id), [n.id]);

  // Past dueBy and still not sent: overdue.
  at('2026-11-20T09:00:00.000Z');
  assert.deepEqual([(await s.get(n.id)).overdue, (await s.list({ overdue: true })).length], [true, 1]);
  const done = await s.addDelivery(n.id, { ...ok, sentAt: '2026-11-20T08:00:00Z' }, 'ds');
  assert.deepEqual([done.status, done.late, done.overdue, done.deliveries[1]!.sha256], ['sent', true, undefined, 'b'.repeat(64)]);
  assert.deepEqual(await s.list({ attention: true }), []);
  assert.deepEqual((await s.list({ late: true })).map((x) => x.id), [n.id]);
  assert.deepEqual((await s.list({ status: 'sent', attention: true })), []);
});
