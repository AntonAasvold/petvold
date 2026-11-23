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
  await service.addPayeeAccount('pty_anna', bank, 'kundservice@example.test');
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
  await service.addPayeeAccount('pty_anna', bank, 'kundservice@example.test');
  const after = await service.payout(p!.id);
  assert.deepEqual(after.steps.map((s) => s.status), ['awaiting-details', 'pending', 'paid']);
});

test('new details hold the payout; another person releases it', async () => {
  const { service } = setup({ holdDays: 3 });
  await service.addPayeeAccount('pty_anna', bank, 'kundservice@example.test');
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
  await service.addPayeeAccount('pty_anna', bank, 'a@example.test');
  const p = await service.handleClaimEvent(ordered());
  const second = await service.addPayeeAccount('pty_anna', { ...bank, details: { clearing: '6000', account: '123456789' } }, 'b@example.test');
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
  await service.addPayeeAccount('pty_anna', bank, 'a@example.test');
  const failed = await service.handleClaimEvent(ordered());
  assert.deepEqual([failed?.status, failed?.steps.at(-1)?.note], ['failed', 'Account closed']);
  assert.ok((await store.pendingEvents(10)).some((e) => e.type === 'payout.failed'));
  answer = 'pending';
  assert.equal((await service.handleClaimEvent(ordered('ord_2')))?.status, 'pending');
});

test('details are checked, and shown masked', async () => {
  const { service } = setup();
  for (const bad of [{ clearing: '83', account: '9412345678' }, { clearing: '8327', account: '12' }, { clearing: '8327', account: '9412345678', extra: 1 }]) {
    await assert.rejects(service.addPayeeAccount('pty_anna', { market: 'SE', method: 'se-bank', details: bad }, 'x'), (e) => e instanceof PaymentsError && e.code === 'validation');
  }
  await assert.rejects(service.addPayeeAccount('pty_anna', { market: 'SE', method: 'iban', details: { iban: 'SE4550000000058398257465' } }, 'x'), (e) => e instanceof PaymentsError);
  await service.addPayeeAccount('pty_anna', { market: 'SE', method: 'iban', details: { iban: 'se45 5000 0000 0583 9825 7466' } }, 'x');
  await service.addPayeeAccount('pty_anna', bank, 'y');
  const shown = await service.payeeAccounts('pty_anna');
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
  await service.addPayeeAccount('pty_anna', bank, 'x');
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
