/** Credit notes and write-offs a person makes, with approval above the limit (ADR 0040, punkt 5 and 10). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillingError, BillingService, InMemoryBillingStore, withinLimit, type SourceEvent } from '../src/index.ts';

function setup() {
  let n = 0;
  const store = new InMemoryBillingStore();
  const service = new BillingService({
    store,
    products: { billing: async () => ({ market: 'SE', currency: 'SEK', paymentIntervals: ['year', 'quarter', 'month'], defaultPaymentInterval: 'quarter', installmentFee: 0, invoiceLeadDays: 31 }) },
    policies: { policyholderOn: async () => 'pty_anna' },
    clock: { now: () => '2026-12-20T09:30:00.000Z' },
    ids: { next: (p) => `${p}_${++n}` },
  });
  return { service, store };
}
const issued = (policyId: string): SourceEvent => ({
  id: `pev_${policyId}`,
  type: 'policy.issued',
  policyId,
  occurredAt: '2026-11-21T10:00:00.000Z',
  data: { transactionId: `ptx_${policyId}`, policyholderPartyId: 'pty_anna', productVersion: 'P@1', startDate: '2026-12-01', endDate: '2027-12-01', premium: { amount: 400_000, currency: 'SEK' } },
});
/** One quarterly invoice for two policies: 2 000 kr in all. */
async function invoiced() {
  const s = setup();
  await s.service.handlePolicyEvent(issued('pol_1'));
  await s.service.handlePolicyEvent(issued('pol_2'));
  await s.service.invoicingRun({ market: 'SE', onDate: '2026-11-21', dryRun: false }, 'scheduler');
  const [inv] = await s.service.invoices({});
  assert.equal(inv?.total, 200_000);
  return { ...s, inv: inv! };
}
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof BillingError ? e.code : String(e)));
const clerk = { SEK: 100_000 };
const manager = { SEK: 5_000_000 };

test('within the limit a credit note is made at once, spread over the lines, numbered from the series', async () => {
  const { service, store, inv } = await invoiced();
  const r = await service.credit(inv.id, { kind: 'credit', amount: 30_000, reason: 'Goodwill after a complaint' }, 'ekonomi@example.test', clerk);
  assert.ok('creditNote' in r);
  const note = r.creditNote;
  assert.deepEqual([note.kind, note.reason, note.total, note.number], ['credit', 'Goodwill after a complaint', 30_000, 'SE-2026-000002']);
  assert.deepEqual(note.lines.map((l) => [l.policyId, l.amount]), [['pol_1', 15_000], ['pol_2', 15_000]]);
  assert.deepEqual(await service.invoice(inv.id).then((i) => [i.credited, i.open, i.status]), [30_000, 170_000, 'open']);
  const [e] = (await store.pendingEvents(50)).filter((x) => x.type === 'invoice.credited');
  assert.deepEqual([e?.data.reason, e?.data.kind], ['manual', 'credit']);
});

test('a write-off gives up at most what is unpaid; a credit note at most what is left to credit', async () => {
  const { service, inv } = await invoiced();
  assert.equal(await code(service.credit(inv.id, { kind: 'write-off', amount: 200_001, reason: 'x' }, 'a', null)), 'conflict');
  assert.equal(await code(service.credit(inv.id, { kind: 'credit', amount: 0, reason: 'x' }, 'a', null)), 'validation');
  assert.equal(await code(service.credit(inv.id, { kind: 'credit', amount: 100, reason: ' ' }, 'a', null)), 'validation');
  const r = await service.credit(inv.id, { kind: 'write-off', amount: 200_000, reason: 'The customer has died; the estate has no means' }, 'a', null);
  assert.ok('creditNote' in r && r.creditNote.kind === 'write-off');
  assert.deepEqual(await service.invoice(inv.id).then((i) => [i.open, i.status]), [0, 'credited']);
  assert.equal(await code(service.credit(inv.id, { kind: 'credit', amount: 1, reason: 'x' }, 'a', null)), 'conflict', 'nothing left');
});

test('a credit note on a paid invoice turns the paid part into credit', async () => {
  const { service, inv } = await invoiced();
  await service.handlePaymentEvent({ id: 'pmev_1', type: 'payment.succeeded', paymentId: 'pay_1', market: 'SE', occurredAt: '2026-12-01T09:00:00.000Z', data: { direction: 'incoming', provider: 'fake', amount: 200_000, currency: 'SEK', reference: inv.reference.value, bookedOn: '2026-12-01' } });
  await service.credit(inv.id, { kind: 'credit', amount: 50_000, reason: 'Wrong price' }, 'a', null);
  assert.deepEqual((await service.account(inv.accountId)).balance, { open: 0, credit: 50_000 });
  assert.equal(await code(service.credit(inv.id, { kind: 'write-off', amount: 1, reason: 'x' }, 'a', null)), 'conflict', 'nothing unpaid to write off');
});

test('above the limit a proposal, approved by someone else within their limit', async () => {
  const { service, inv } = await invoiced();
  const r = await service.credit(inv.id, { kind: 'credit', amount: 150_000, reason: 'Double invoiced' }, 'ekonomi@example.test', clerk);
  assert.ok('proposal' in r);
  const p = r.proposal;
  assert.deepEqual([p.status, p.amount, p.kind], ['proposed', 150_000, 'credit']);
  assert.equal((await service.invoice(inv.id)).credited, 0, 'nothing credited yet');
  assert.deepEqual((await service.creditProposals({ status: 'proposed' })).map((x) => x.id), [p.id]);
  assert.equal(await code(service.approveCreditProposal(p.id, 'ekonomi@example.test', manager)), 'forbidden', 'not the proposer');
  assert.equal(await code(service.approveCreditProposal(p.id, 'ekonomi-2@example.test', clerk)), 'forbidden', 'above the approver\'s limit');
  const note = await service.approveCreditProposal(p.id, 'ekonomichef@example.test', manager);
  assert.deepEqual([note.total, note.source.eventType, note.source.eventId], [150_000, 'credit-proposal', p.id]);
  assert.deepEqual(await service.creditProposal(p.id).then((x) => [x.status, x.decidedBy, x.creditNoteId]), ['approved', 'ekonomichef@example.test', note.id]);
  assert.equal(await code(service.approveCreditProposal(p.id, 'ekonomichef@example.test', manager)), 'conflict', 'once');
  assert.equal((await service.creditNotes({ invoiceId: inv.id })).length, 1);
});

test('a proposal can be returned, and one the invoice no longer allows is refused', async () => {
  const { service, inv } = await invoiced();
  const a = await service.credit(inv.id, { kind: 'write-off', amount: 150_000, reason: 'x' }, 'a', clerk);
  const b = await service.credit(inv.id, { kind: 'write-off', amount: 100_001, reason: 'y' }, 'a', clerk);
  assert.ok('proposal' in a && 'proposal' in b);
  const returned = await service.returnCreditProposal(a.proposal.id, 'Send it to collection instead', 'chef');
  assert.deepEqual([returned.status, returned.returnReason], ['returned', 'Send it to collection instead']);
  assert.equal(await code(service.returnCreditProposal(a.proposal.id, 'again', 'chef')), 'conflict');
  // The customer pays most of it meanwhile: only 50 000 is unpaid now.
  await service.handlePaymentEvent({ id: 'pmev_2', type: 'payment.succeeded', paymentId: 'pay_2', market: 'SE', occurredAt: '2026-12-01T09:00:00.000Z', data: { direction: 'incoming', provider: 'fake', amount: 150_000, currency: 'SEK', reference: inv.reference.value, bookedOn: '2026-12-01' } });
  assert.equal(await code(service.approveCreditProposal(b.proposal.id, 'chef', null)), 'conflict');
});

test('limits: none, a currency missing, and within', () => {
  assert.equal(withinLimit(null, 'SEK', 10 ** 9), true);
  assert.equal(withinLimit({ SEK: 100 }, 'EUR', 1), false);
  assert.equal(withinLimit({ SEK: 100 }, 'SEK', 100), true);
  assert.equal(withinLimit({ SEK: 100 }, 'SEK', 101), false);
});
