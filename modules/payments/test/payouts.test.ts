/** Payouts of the claims' payout orders (ADR 0040, punkt 8). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider, InMemoryPaymentsStore, isIban, maskDetails, payeeDetailsProblem, payoutGate, PaymentsError, PaymentsService, type PaymentProvider, type PayoutResult } from '../src/index.ts';
import { SECRET } from './fake-bank.ts';

let now = '2026-12-01T10:00:00.000Z';
function setup(o: { holdDays?: number; provider?: PaymentProvider } = {}) {
  let n = 0;
  now = '2026-12-01T10:00:00.000Z';
  const store = new InMemoryPaymentsStore();
  const service = new PaymentsService({
    store,
    providers: [o.provider ?? new FakeProvider({ secret: SECRET, markets: [{ market: 'SE', currency: 'SEK' }] })],
    clock: { now: () => now },
    ids: { next: (prefix) => `${prefix}_${++n}` },
    policies: { policyholderOn: async (policyId) => (policyId === 'pol_1' ? 'pty_anna' : null) },
    newPayeeHoldDays: o.holdDays ?? 0,
  });
  return { store, service };
}

const ordered = (orderId = 'ord_1', amount = 1_234_500) => ({
  id: `cev_${orderId}`,
  type: 'claim.payout_ordered',
  claimId: 'clm_1',
  market: 'SE',
  occurredAt: '2026-12-01T09:00:00.000Z',
  data: { payoutOrderId: orderId, decisionId: 'dec_1', policyId: 'pol_1', amount, currency: 'SEK', channel: 'customer' },
});
const bank = { market: 'SE', method: 'se-bank' as const, details: { clearing: '8327', account: '9412345678' } };

test('a payout order with the payee\'s details is paid at once, once, with payout.paid', async () => {
  const { service, store } = setup();
  await service.addPayeeAccount({ partyId: 'pty_anna' }, bank, 'kundservice@example.test');
  const p = await service.handleClaimEvent(ordered());
  assert.equal(p?.status, 'paid');
  assert.deepEqual(p?.steps.map((s) => s.status), ['pending', 'paid']);
  assert.equal(p?.steps[1]?.providerRef, `fake-${p?.id}`);
  assert.equal(p?.partyId, 'pty_anna');
  const again = await service.handleClaimEvent(ordered());
  assert.equal(again?.id, p?.id);
  assert.equal((await service.payouts()).length, 1);
  const events = (await store.pendingEvents(10)).filter((e) => e.type === 'payout.paid');
  assert.deepEqual(events.map((e) => [e.payoutId, e.data.amount, e.data.orderId]), [[p?.id, 1_234_500, 'ord_1']]);
});

test('without details it waits; the details send it', async () => {
  const { service } = setup();
  const p = await service.handleClaimEvent(ordered());
  assert.equal(p?.status, 'awaiting-details');
  assert.deepEqual((await service.payouts({ status: 'awaiting-details' })).map((x) => x.id), [p?.id]);
  await service.addPayeeAccount({ partyId: 'pty_anna' }, bank, 'kundservice@example.test');
  const after = await service.payout(p!.id);
  assert.deepEqual(after.steps.map((s) => s.status), ['awaiting-details', 'pending', 'paid']);
});

test('new details hold the payout; another person releases it', async () => {
  const { service } = setup({ holdDays: 3 });
  await service.addPayeeAccount({ partyId: 'pty_anna' }, bank, 'kundservice@example.test');
  const p = await service.handleClaimEvent(ordered());
  assert.equal(p?.status, 'held');
  const code = (x: Promise<unknown>) => x.then(() => 'ok', (e) => (e instanceof PaymentsError ? e.code : String(e)));
  assert.equal(await code(service.releasePayout(p!.id, 'kundservice@example.test')), 'forbidden', 'not the one who gave the details');
  const released = await service.releasePayout(p!.id, 'ekonomi@example.test', 'Called the customer');
  assert.deepEqual(released.steps.map((s) => [s.status, s.by]), [['held', 'payments'], ['pending', 'ekonomi@example.test'], ['paid', 'fake']]);
  assert.equal(await code(service.releasePayout(p!.id, 'ekonomi@example.test')), 'conflict', 'once');

  // Details older than the hold: paid at once.
  now = '2026-12-05T10:00:00.000Z';
  assert.equal((await service.handleClaimEvent(ordered('ord_2')))?.status, 'paid');
});

test('details changed while held hold the payout again, on the new details', async () => {
  const { service } = setup({ holdDays: 3 });
  await service.addPayeeAccount({ partyId: 'pty_anna' }, bank, 'a@example.test');
  const p = await service.handleClaimEvent(ordered());
  const second = await service.addPayeeAccount({ partyId: 'pty_anna' }, { ...bank, details: { clearing: '6000', account: '123456789' } }, 'b@example.test');
  const held = await service.payout(p!.id);
  assert.deepEqual(held.steps.map((s) => [s.status, s.note]), [['held', 'The payee details are new'], ['held', 'The payee details changed']]);
  assert.equal(held.steps.at(-1)?.payeeAccountId, second.id);
  // The one who gave the new details cannot release it; someone else can, to the new account.
  await assert.rejects(service.releasePayout(p!.id, 'b@example.test'), (e) => e instanceof PaymentsError && e.code === 'forbidden');
  const paid = await service.releasePayout(p!.id, 'a@example.test');
  assert.equal(paid.steps.at(-1)?.payeeAccountId, second.id);
  assert.equal(paid.status, 'paid');
});

test('a payment service that fails or answers later', async () => {
  let answer: PayoutResult['status'] = 'failed';
  const provider: PaymentProvider = {
    id: 'bankfile',
    capabilities: () => [{ market: 'SE', currency: 'SEK', kind: 'outgoing' }],
    parseNotification: async () => [],
    payout: async (r) => ({ status: answer, providerRef: `bf-${r.payoutId}`, ...(answer === 'failed' ? { reason: 'Account closed' } : {}) }),
  };
  const { service, store } = setup({ provider });
  await service.addPayeeAccount({ partyId: 'pty_anna' }, bank, 'a@example.test');
  const failed = await service.handleClaimEvent(ordered());
  assert.deepEqual([failed?.status, failed?.steps.at(-1)?.note], ['failed', 'Account closed']);
  assert.ok((await store.pendingEvents(10)).some((e) => e.type === 'payout.failed'));
  answer = 'pending';
  assert.equal((await service.handleClaimEvent(ordered('ord_2')))?.status, 'pending');
});

test('details are checked, and shown masked', async () => {
  const { service } = setup();
  for (const bad of [{ clearing: '83', account: '9412345678' }, { clearing: '8327', account: '12' }, { clearing: '8327', account: '9412345678', extra: 1 }]) {
    await assert.rejects(service.addPayeeAccount({ partyId: 'pty_anna' }, { market: 'SE', method: 'se-bank', details: bad }, 'x'), (e) => e instanceof PaymentsError && e.code === 'validation');
  }
  await assert.rejects(service.addPayeeAccount({ partyId: 'pty_anna' }, { market: 'SE', method: 'iban', details: { iban: 'SE4550000000058398257465' } }, 'x'), (e) => e instanceof PaymentsError);
  await service.addPayeeAccount({ partyId: 'pty_anna' }, { market: 'SE', method: 'iban', details: { iban: 'se45 5000 0000 0583 9825 7466' } }, 'x');
  await service.addPayeeAccount({ partyId: 'pty_anna' }, bank, 'y');
  const shown = await service.payeeAccounts({ partyId: 'pty_anna' });
  assert.deepEqual(shown.map((a) => [a.details, a.current]), [
    [{ iban: '********************7466' }, false],
    [{ clearing: '8327', account: '******5678' }, true],
  ]);
});

test('IBAN, masking and the gate are pure', () => {
  assert.equal(isIban('SE4550000000058398257466'), true);
  assert.equal(isIban('GB82WEST12345698765432'), true);
  assert.equal(isIban('GB82WEST12345698765433'), false);
  assert.equal(payeeDetailsProblem('iban', { iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' }), null);
  assert.deepEqual(maskDetails({ clearing: '8327', account: '1234' }), { clearing: '8327', account: '1234' });
  const acc = { id: 'pya_1', partyId: 'p', market: 'SE', method: 'se-bank' as const, details: { clearing: '8327', account: '123456' }, createdAt: '2026-12-01T10:00:00.000Z', createdBy: 'x' };
  assert.equal(payoutGate(null, '2026-12-01T10:00:00.000Z', 3), 'awaiting-details');
  assert.equal(payoutGate(acc, '2026-12-03T10:00:00.000Z', 3), 'held');
  assert.equal(payoutGate(acc, '2026-12-04T10:00:00.000Z', 3), 'ready');
  assert.equal(payoutGate(acc, '2026-12-01T10:00:00.000Z', 0), 'ready');
});

test('retention sees an unfinished payout as ongoing', async () => {
  const { service } = setup();
  assert.equal(await service.activityOf('pty_anna'), null);
  await service.handleClaimEvent(ordered());
  assert.deepEqual(await service.activityOf('pty_anna'), { ongoing: true });
  await service.addPayeeAccount({ partyId: 'pty_anna' }, bank, 'x');
  assert.deepEqual(await service.activityOf('pty_anna'), { lastDate: '2026-12-01' });
});

test('other events are not payout orders, and an unknown policy is an error to retry', async () => {
  const { service } = setup();
  assert.equal(await service.handleClaimEvent({ ...ordered(), type: 'claim.decided' }), null);
  await assert.rejects(service.handleClaimEvent({ ...ordered(), data: { ...ordered().data, policyId: 'pol_x' } }));
});

test('without an adapter that pays out, Petvold makes no payout and the order stays with the insurer', async () => {
  const provider: PaymentProvider = { id: 'inonly', capabilities: () => [{ market: 'SE', currency: 'SEK', kind: 'incoming' }], parseNotification: async () => [] };
  const { service } = setup({ provider });
  assert.equal(await service.handleClaimEvent(ordered()), null);
  assert.equal((await service.payouts()).length, 0);
});

const clinicOrder = (orderId: string, at = '2026-12-01T09:00:00.000Z') => ({ ...ordered(orderId), occurredAt: at, data: { ...ordered(orderId).data, channel: 'clinic_direct', clinicId: 'clinic_001' } });

test('with an agreement in force the clinic in the order is paid; without one, the policyholder', async () => {
  const { service } = setup();
  await service.addPayeeAccount({ partyId: 'pty_anna' }, bank, 'a@example.test');
  await service.addPayeeAccount({ clinicId: 'clinic_001' }, { ...bank, details: { clearing: '5000', account: '1234567890' } }, 'a@example.test');
  // No agreement yet: the policyholder.
  assert.deepEqual(await service.handleClaimEvent(clinicOrder('ord_1')).then((p) => [p?.partyId, p?.clinicId]), ['pty_anna', undefined]);
  const a = await service.addAgreement({ clinicId: 'clinic_001', market: 'SE', validFrom: '2026-12-01' }, 'avtal@example.test');
  const toClinic = await service.handleClaimEvent(clinicOrder('ord_2'));
  assert.deepEqual([toClinic?.clinicId, toClinic?.partyId, toClinic?.status], ['clinic_001', undefined, 'paid']);
  assert.deepEqual((await service.payouts({ clinicId: 'clinic_001' })).map((p) => p.orderId), ['ord_2']);
  // An order without the clinic goes to the policyholder, agreement or not.
  assert.equal((await service.handleClaimEvent(ordered('ord_3')))?.partyId, 'pty_anna');
  // Ended from 1 February: orders from then go to the policyholder.
  const ended = await service.endAgreement(a.id, { validTo: '2027-02-01', reason: 'The clinic left the agreement' }, 'avtal@example.test');
  assert.equal(ended.ended?.validTo, '2027-02-01');
  assert.equal((await service.handleClaimEvent(clinicOrder('ord_4', '2027-01-31T10:00:00.000Z')))?.clinicId, 'clinic_001');
  assert.equal((await service.handleClaimEvent(clinicOrder('ord_5', '2027-02-01T10:00:00.000Z')))?.partyId, 'pty_anna');
  await assert.rejects(service.endAgreement(a.id, { validTo: '2027-03-01', reason: 'again' }, 'x'), (e) => e instanceof PaymentsError && e.code === 'conflict');
});

test('agreements may not overlap, and their dates are checked', async () => {
  const { service } = setup();
  await service.addAgreement({ clinicId: 'clinic_001', market: 'SE', validFrom: '2026-01-01', validTo: '2026-07-01' }, 'x');
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof PaymentsError ? e.code : String(e)));
  assert.equal(await code(service.addAgreement({ clinicId: 'clinic_001', market: 'SE', validFrom: '2026-06-01' }, 'x')), 'conflict');
  assert.equal(await code(service.addAgreement({ clinicId: 'clinic_001', market: 'SE', validFrom: '2026-07-01' }, 'x')), 'ok', 'from the day the first ends');
  assert.equal(await code(service.addAgreement({ clinicId: 'clinic_002', market: 'SE', validFrom: '2026-07-01', validTo: '2026-07-01' }, 'x')), 'validation');
  assert.equal(await code(service.addAgreement({ clinicId: 'clinic_001', market: 'NO', validFrom: '2026-06-01' }, 'x')), 'ok', 'another market');
});

test('a clinic without details waits like a party, and gets paid when it gives them', async () => {
  const { service } = setup();
  await service.addAgreement({ clinicId: 'clinic_001', market: 'SE', validFrom: '2026-01-01' }, 'x');
  const p = await service.handleClaimEvent(clinicOrder('ord_1'));
  assert.equal(p?.status, 'awaiting-details');
  await service.addPayeeAccount({ clinicId: 'clinic_001' }, bank, 'x');
  assert.equal((await service.payout(p!.id)).status, 'paid');
  assert.deepEqual((await service.payeeAccounts({ clinicId: 'clinic_001' })).map((a) => [a.clinicId, a.current]), [['clinic_001', true]]);
  assert.deepEqual(await service.payeeAccounts({ partyId: 'pty_anna' }), []);
});

test('a refund of a payer\'s credit is paid out to the payer, once', async () => {
  const { service, store } = setup();
  await service.addPayeeAccount({ partyId: 'pty_anna' }, bank, 'a@example.test');
  const e = { id: 'bev_r', type: 'refund.ordered', refundId: 'ref_1', market: 'SE', occurredAt: '2026-12-01T09:00:00.000Z', data: { accountId: 'bac_1', partyId: 'pty_anna', amount: 12_300, currency: 'SEK', reason: 'nothing-more-to-bill' } };
  const p = await service.handleBillingEvent(e);
  assert.deepEqual([p?.purpose, p?.orderId, p?.partyId, p?.amount, p?.status, p?.claimId], ['premium-refund', 'ref_1', 'pty_anna', 12_300, 'paid', undefined]);
  assert.equal((await service.handleBillingEvent(e))?.id, p?.id, 'once');
  const [paidEvent] = (await store.pendingEvents(10)).filter((x) => x.type === 'payout.paid');
  assert.deepEqual([paidEvent?.data.purpose, paidEvent?.data.claimId], ['premium-refund', undefined]);
  assert.equal(await service.handleBillingEvent({ ...e, type: 'invoice.paid' }), null);
});

test("an anonymized party's payee details are erased, but not while a payout is on its way (ADR 0040, punkt 11)", async () => {
  const { service } = setup({ holdDays: 3 });
  const code = (x: Promise<unknown>) => x.then(() => 'ok', (e) => (e instanceof PaymentsError ? e.code : String(e)));
  await service.addPayeeAccount({ partyId: 'pty_anna' }, bank, 'kundservice@example.test');
  const held = await service.handleClaimEvent(ordered());
  assert.equal(held?.status, 'held');
  assert.match((await service.erasureBlocker('pty_anna')) ?? '', new RegExp(held!.id));
  assert.equal(await code(service.erasePayee('pty_anna')), 'conflict');
  await service.releasePayout(held!.id, 'ekonomi@example.test');
  assert.equal(await service.erasureBlocker('pty_anna'), null, 'paid: nothing on its way');
  assert.equal(await service.erasePayee('pty_anna'), 1);
  assert.equal(await service.erasePayee('pty_anna'), 0, 'safe to run again');
  assert.deepEqual(await service.payeeAccounts({ partyId: 'pty_anna' }), []);
  assert.equal((await service.payout(held!.id)).status, 'paid', "the payout's history is kept");
  // A later order waits for details given after the erasure.
  assert.equal((await service.handleClaimEvent(ordered('ord_2', 500)))?.status, 'awaiting-details');
  assert.equal(await service.erasureBlocker('pty_anna'), null, 'waiting for details does not stop an erasure');
});
