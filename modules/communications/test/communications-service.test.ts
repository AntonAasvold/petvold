import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommunicationsError, CommunicationsService, InMemoryNoticeSettingsStore, InMemoryNoticeStore, NOTICE_RULES, type ClaimSource, type InvoiceSource, type InvoiceView, type PolicyView, type SourceEvent, type TermView, type TransactionView } from '../src/index.ts';

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

function setup(o: { language?: string; policy?: Partial<PolicyView>; transactions?: Record<string, TransactionView>; claims?: ClaimSource; invoices?: InvoiceSource; petvoldTemplates?: (type: string, market: string) => boolean } = {}) {
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
      proposal: async (id) =>
        id === 'ppr_1' ? { id, kind: 'transfer', fromPartyId: 'pty_anna', toPartyId: 'pty_bo', from: '2027-06-01', deadline: '2027-07-10' } : null,
    },
    settings: new InMemoryNoticeSettingsStore(),
    ...(o.claims ? { claims: o.claims } : {}),
    ...(o.invoices ? { invoices: o.invoices } : {}),
    ...(o.petvoldTemplates ? { petvoldTemplates: o.petvoldTemplates } : {}),
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

test('a sold animal\'s new owner gets the offer to take over the policy; a death gives no notice', async () => {
  const { s } = setup();
  const offer = (await s.handlePolicyEvent(event('proposal.created', { proposalId: 'ppr_1', kind: 'transfer' })))!;
  assert.deepEqual([offer.type, offer.recipientPartyId, offer.legalBasis, offer.dueBy], ['transfer-offer', 'pty_bo', [], '2026-11-19']);
  assert.deepEqual([offer.content.proposalId, offer.content.from, offer.content.deadline, offer.content.fromPartyId, offer.content.productVersion], ['ppr_1', '2027-06-01', '2027-07-10', 'pty_anna', 'SE-HUND@1']);
  assert.equal(await s.handlePolicyEvent(event('proposal.created', { proposalId: 'ppr_2', kind: 'cancel-death' }, { id: 'pev_death' })), null);
});

test('the insurer\'s settings: versions, promptly days, optional types turned off and texts in the notice (ADR 0032)', async () => {
  const { s } = setup({ transactions: { ptx_c: { type: 'cancel', cancellation: { reason: 'withdrawal', receivedOn: '2026-11-16', effectiveDate: '2026-11-17', refund: { amount: 0, currency: 'SEK' } } } } });
  const v1 = await s.settings();
  assert.deepEqual([v1.version, v1.markets, v1.changedBy], [1, { SE: {} }, 'petvold-defaults']);
  const declined = (await s.handlePolicyEvent(event('application.declined', {}, { id: 'pev_d1', policyId: undefined, applicationId: 'app_1' })))!;
  assert.equal(declined.settingsVersion, 1);
  // Without the insurer's text on review, the refusal cannot be sent as it is: it is in the queue.
  assert.deepEqual([(await s.get(declined.id)).incomplete, (await s.list({ attention: true })).map((n) => n.id)], [['review'], [declined.id]]);

  const change = (markets: unknown, basedOnVersion = 1) => s.changeSettings({ markets: markets as never, basedOnVersion, reason: 'Texts for Sweden' }, 'comms');
  await rejects(change({ SE: { disabledTypes: ['application-declined'] } }), 'validation', /required by law/);
  await rejects(change({ SE: { promptlyDays: 0 } }), 'validation', /1-30/);
  await rejects(change({ XX: {} }), 'validation', /no notice rules/);
  await rejects(change({ SE: { texts: { swe: { review: 'x' } } } }), 'validation', /ISO 639-1/);
  await rejects(change({ SE: { texts: { sv: { footer: 'x' } } } }), 'validation', /Unknown texts/);
  await rejects(change({}, 7), 'conflict', /version 1, not 7/);
  await rejects(s.changeSettings({ markets: {}, basedOnVersion: 1, reason: ' ' }, 'comms'), 'validation', /reason/);
  const review = 'Contact our complaints function first. You can also turn to the consumer insurance bureau or the national board for consumer disputes.';
  const v2 = await change({ SE: { promptlyDays: 5, disabledTypes: ['cancellation-confirmation'], texts: { sv: { sender: 'Example Insurance', review } } } });
  assert.equal(v2.version, 2);
  assert.deepEqual((await s.settingsVersions()).map((v) => v.version), [1, 2]);

  const again = (await s.handlePolicyEvent(event('application.declined', {}, { id: 'pev_d2', policyId: undefined, applicationId: 'app_1' })))!;
  assert.deepEqual([again.settingsVersion, again.dueBy, again.content.review, again.content.sender, (await s.get(again.id)).incomplete], [2, '2026-11-21', review, 'Example Insurance', undefined]);
  assert.equal(await s.handlePolicyEvent(event('policy.cancelled', { transactionId: 'ptx_c' })), null, 'turned off');
  // The notice made before keeps what it was made with.
  assert.equal((await s.get(declined.id)).content.review, undefined);
});

// Claims (ADR 0036) -----------------------------------------------------------

const claimFacts = { claimId: 'clm_1', claimNo: 'S-2026-000001', policyId: 'pol_1', animalId: 'ani_rex', market: 'SE', treatmentFrom: '2027-02-01' };
const claims = (recipient: 'customer' | 'clinic' = 'customer'): ClaimSource => ({
  decision: async (claimId, seq) =>
    claimId === 'clm_1' && seq === 1
      ? {
          ...claimFacts,
          decisionId: 'dec_1',
          seq: 1,
          outcome: 'partial',
          payout: { amount: 1_216_500, currency: 'SEK' },
          automated: false,
          mainReason: { reason: 'decision.partial', params: { payout: 1_216_500, currency: 'SEK' } },
          steps: [{ step: 'billed', amount: 1_864_000, reason: 'step.billed', params: { currency: 'SEK' } }],
          deviation: { reasonCode: 'not_covered', reason: 'The food is not covered' },
          reviewAvailable: false,
        }
      : null,
  informationRequest: async (claimId, requestId) =>
    claimId === 'clm_1' && requestId === 'inf_1'
      ? { ...claimFacts, requestId, recipient, items: ['medical-record'], note: 'The record from the first visit', dueDate: '2027-03-15' }
      : null,
});
const claimEvent = (type: string, data: Record<string, unknown>) => ({ id: `claims:${type}`, type, claimId: 'clm_1', occurredAt: '2026-11-16T10:00:00.000Z', data });

test('a claims decision gives the customer a notice with the calculation, and needs the review text (ADR 0036)', async () => {
  const { s } = setup({ claims: claims() });
  const n = (await s.handleClaimEvent(claimEvent('claim.decided', { seq: 1 })))!;
  assert.deepEqual([n.type, n.schema, n.recipientPartyId, n.policyId, n.dueBy], ['claim-decision', 'claim-decision.v1', 'pty_anna', 'pol_1', '2026-11-19']);
  assert.deepEqual([n.content.claimNo, n.content.outcome, n.content.payout, n.content.deviation], ['S-2026-000001', 'partial', { amount: 1_216_500, currency: 'SEK' }, { reasonCode: 'not_covered', reason: 'The food is not covered' }]);
  assert.ok(n.legalBasis.some((l) => l.includes('chapter 7 section 1')));
  assert.deepEqual((await s.get(n.id)).incomplete, ['review'], 'without the insurer\'s review text it waits for a person');
  assert.equal(await s.handleClaimEvent(claimEvent('claim.decided', { seq: 1 })), null, 'a repeat gives nothing new');
});

test('a request for information to the customer, its reminder and expiry give notices; the expiry may be turned off', async () => {
  const { s } = setup({ claims: claims() });
  const asked = (await s.handleClaimEvent(claimEvent('claim.information_requested', { requestId: 'inf_1' })))!;
  assert.deepEqual([asked.type, asked.content.note, asked.content.dueDate, asked.content.items], ['claim-information-request', 'The record from the first visit', '2027-03-15', ['medical-record']]);
  const reminded = (await s.handleClaimEvent(claimEvent('claim.information_reminded', { requestId: 'inf_1' })))!;
  assert.equal(reminded.type, 'claim-information-reminder');
  const expired = (await s.handleClaimEvent(claimEvent('claim.information_expired', { requestId: 'inf_1' })))!;
  assert.deepEqual([expired.type, expired.content.decidedOnAvailableBasis, 'note' in expired.content, expired.legalBasis], ['claim-information-expired', true, false, []]);

  const off = setup({ claims: claims() });
  await off.s.changeSettings({ markets: { SE: { disabledTypes: ['claim-information-expired'] } }, basedOnVersion: 1, reason: 'Handlers call the customer' }, 'h');
  assert.equal(await off.s.handleClaimEvent(claimEvent('claim.information_expired', { requestId: 'inf_1' })), null);
  await rejects(off.s.changeSettings({ markets: { SE: { disabledTypes: ['claim-decision'] } }, basedOnVersion: 2, reason: 'x' }, 'h'), 'validation', /required by law/);
});

test('a request to the clinic, other claims events and an installation without the claims port give no notice', async () => {
  const { s } = setup({ claims: claims('clinic') });
  assert.equal(await s.handleClaimEvent(claimEvent('claim.information_requested', { requestId: 'inf_1' })), null);
  assert.equal(await s.handleClaimEvent(claimEvent('claim.registered', {})), null);
  const without = setup();
  assert.equal(await without.s.handleClaimEvent(claimEvent('claim.decided', { seq: 1 })), null);
  await assert.rejects(s.handleClaimEvent(claimEvent('claim.decided', { seq: 9 })), /does not exist/);
});

test('with the setting petvold, Petvold makes the PDF of the types it has templates for; the report then names only channel and time (ADR 0038)', async () => {
  const { s, at } = setup({ petvoldTemplates: (type) => type === 'policy-confirmation' });
  await rejects(s.changeSettings({ markets: { SE: { documentMaker: 'pigeon' as never } }, basedOnVersion: 1, reason: 'x' }, 'u'), 'validation', /documentMaker/);
  await s.changeSettings({ markets: { SE: { documentMaker: 'petvold' } }, basedOnVersion: 1, reason: 'Petvold makes the letters' }, 'u');
  assert.equal((await s.settings()).markets.SE!.documentMaker, 'petvold');

  const n = (await s.handlePolicyEvent(event('policy.issued', { transactionId: 'ptx_issue' })))!;
  assert.equal(n.documentMaker, 'petvold');
  // Petvold has no template for the refusal here: the insurer's document system makes it.
  const c = (await s.handlePolicyEvent(event('application.declined', {}, { id: 'pev_d', policyId: undefined, applicationId: 'app_1' })))!;
  assert.equal(c.documentMaker, 'insurer');

  at('2026-11-17T09:00:00.000Z');
  const ok = { outcome: 'sent' as const, channel: 'digital-mailbox', sentAt: '2026-11-17T08:00:00Z' };
  await rejects(s.addDelivery(n.id, ok, 'ds'), 'conflict', /not made the document/);
  await rejects(s.addDocument(n.id, { id: 'doc_1', sha256: 'x' }, 'petvold'), 'validation', /sha256/);
  const made = await s.addDocument(n.id, { id: 'doc_1', sha256: 'c'.repeat(64) }, 'petvold');
  assert.deepEqual(made.document, { id: 'doc_1', sha256: 'c'.repeat(64), madeBy: 'petvold', madeAt: '2026-11-17T09:00:00.000Z' });
  await rejects(s.addDocument(n.id, { id: 'doc_2', sha256: 'c'.repeat(64) }, 'petvold'), 'conflict', /already/);
  await rejects(s.addDocument(c.id, { id: 'doc_3', sha256: 'c'.repeat(64) }, 'petvold'), 'conflict', /insurer/);

  await rejects(s.addDelivery(n.id, { ...ok, documentId: 'arch-1', sha256: 'a'.repeat(64) }, 'ds'), 'validation', /Petvold made/);
  const done = await s.addDelivery(n.id, ok, 'ds');
  assert.deepEqual([done.status, done.deliveries[0]!.documentId, done.deliveries[0]!.sha256], ['sent', 'doc_1', 'c'.repeat(64)]);
});

test('the setting petvold is refused where Petvold cannot make documents', async () => {
  const { s } = setup();
  await rejects(s.changeSettings({ markets: { SE: { documentMaker: 'petvold' } }, basedOnVersion: 1, reason: 'x' }, 'u'), 'validation', /PETVOLD_GOTENBERG_URL/);
  await s.changeSettings({ markets: { SE: { documentMaker: 'insurer' } }, basedOnVersion: 1, reason: 'x' }, 'u');
  assert.equal((await s.settings()).markets.SE!.documentMaker, undefined);
});


const invoice: InvoiceView = {
  id: 'inv_1',
  number: 'SE-2026-000001',
  partyId: 'pty_anna',
  market: 'SE',
  currency: 'SEK',
  issueDate: '2026-11-22',
  dueDate: '2026-12-06',
  reference: { type: 'ocr', value: '202600000121' },
  total: 40_000,
  lines: [{ policyId: 'pol_1', periodStart: '2026-12-01', periodEnd: '2027-01-01', premium: 40_000, tax: 0, fee: 0, amount: 40_000 }],
};
const issuedEvent = { id: 'bev_1', type: 'invoice.issued', invoiceId: 'inv_1', occurredAt: '2026-11-22T03:00:00.000Z', data: {} };

test('invoice.issued gives the invoice, to be sent on its issue date, incomplete without where to pay', async () => {
  const { s, at } = setup({ invoices: { invoice: async (id) => (id === 'inv_1' ? structuredClone(invoice) : null) } });
  const n = (await s.handleBillingEvent(issuedEvent))!;
  assert.deepEqual([n.type, n.schema, n.recipientPartyId, n.invoiceId, n.policyId, n.dueBy, n.language], ['invoice', 'invoice.v1', 'pty_anna', 'inv_1', undefined, '2026-11-22', 'sv']);
  assert.deepEqual(n.content, {
    invoiceId: 'inv_1',
    invoiceNo: 'SE-2026-000001',
    issueDate: '2026-11-22',
    dueDate: '2026-12-06',
    total: { amount: 40_000, currency: 'SEK' },
    reference: { type: 'ocr', value: '202600000121' },
    lines: invoice.lines,
  });
  assert.match(n.legalBasis[0]!, /chapter 5 section 1/);
  assert.deepEqual((await s.get(n.id)).incomplete, ['payment']);
  assert.equal(await s.handleBillingEvent(issuedEvent), null, 'the same event again');
  assert.deepEqual((await s.list({ invoiceId: 'inv_1' })).map((x) => x.id), [n.id]);

  // With the insurer's text it is complete; sent the day after, it is late.
  await s.changeSettings({ markets: { SE: { texts: { sv: { payment: 'Bankgiro 123-4567' } } } }, basedOnVersion: 1, reason: 'Bankgiro' }, 'comms');
  const second = (await s.handleBillingEvent({ ...issuedEvent, id: 'bev_2' }))!;
  assert.equal(second.content.payment, 'Bankgiro 123-4567');
  assert.equal((await s.get(second.id)).incomplete, undefined);
  at('2026-11-23T10:00:00.000Z');
  const late = await s.addDelivery(second.id, { outcome: 'sent', channel: 'email', sentAt: '2026-11-23T09:00:00Z', documentId: 'd1', sha256: 'b'.repeat(64) }, 'docs');
  assert.equal(late.late, true);
});

test('billing events: other types and no billing give nothing, an unknown invoice is an error', async () => {
  assert.equal(await setup().s.handleBillingEvent(issuedEvent), null);
  const { s } = setup({ invoices: { invoice: async () => null } });
  assert.equal(await s.handleBillingEvent({ ...issuedEvent, type: 'invoice.paid' }), null);
  await assert.rejects(s.handleBillingEvent(issuedEvent), /invoice inv_1/);
  await assert.rejects(s.changeSettings({ markets: { SE: { texts: { sv: { payment: ' ' } } } }, basedOnVersion: 1, reason: 'x' }, 'c'), /payment/);
});
