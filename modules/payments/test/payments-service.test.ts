import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider, InMemoryPaymentsStore, PaymentsError, PaymentsService, ProviderNotificationError, signNotification, type ReceivedPayment } from '../src/index.ts';
import { fakeBody, SECRET } from './fake-bank.ts';

const NOW = '2026-12-01T10:00:00.000Z';

function setup() {
  let n = 0;
  const store = new InMemoryPaymentsStore();
  const service = new PaymentsService({
    store,
    providers: [new FakeProvider({ secret: SECRET, markets: [{ market: 'SE', currency: 'SEK' }] })],
    clock: { now: () => NOW },
    ids: { next: (prefix) => `${prefix}_${++n}` },
  });
  const send = (payments: Omit<ReceivedPayment, 'kind'>[], id = 'msg_1') => service.receive('fake', signNotification(SECRET, id, Date.parse(NOW) / 1000, fakeBody(payments)));
  return { store, service, send };
}

const pay = (o: Partial<ReceivedPayment> = {}) => ({ providerRef: 'fb_1', market: 'SE', currency: 'SEK', amount: 41_200, reference: '202600000121', bookedOn: '2026-12-01', ...o });

test('a notification gives a payment and payment.succeeded', async () => {
  const { service, store, send } = setup();
  const r = await send([pay()]);
  assert.equal(r.received.length, 1);
  const p = r.received[0]!;
  assert.deepEqual(await service.payment(p.id), { id: p.id, direction: 'incoming', status: 'succeeded', provider: 'fake', providerRef: 'fb_1', market: 'SE', currency: 'SEK', amount: 41_200, reference: '202600000121', bookedOn: '2026-12-01', receivedAt: NOW });
  const events = await store.pendingEvents(10);
  assert.deepEqual(events.map((e) => [e.type, e.paymentId, e.market]), [['payment.succeeded', p.id, 'SE']]);
});

test('a notification sent twice gives the payment once', async () => {
  const { service, send } = setup();
  await send([pay()]);
  const again = await send([pay(), pay({ providerRef: 'fb_2', reference: null })], 'msg_2');
  assert.equal(again.received.length, 1);
  assert.equal(again.duplicates.length, 1);
  assert.equal((await service.payments()).length, 2);
});

test('the same id with other content is refused', async () => {
  const { send } = setup();
  await send([pay()]);
  await assert.rejects(send([pay({ amount: 99_900 })], 'msg_2'), (e) => e instanceof ProviderNotificationError && e.code === 'invalid');
});

test('a payment outside the markets, or one that is not well formed, refuses the whole notification', async () => {
  const { service, send } = setup();
  for (const bad of [pay({ market: 'FI', currency: 'EUR' }), pay({ amount: 0 }), pay({ amount: 10.5 }), pay({ bookedOn: '2026-13-01' }), pay({ reference: 'not a ref!' }), pay({ providerRef: '' })]) {
    await assert.rejects(send([pay({ providerRef: 'fb_ok' }), bad]), (e) => e instanceof ProviderNotificationError && e.code === 'invalid', JSON.stringify(bad));
  }
  assert.equal((await service.payments()).length, 0);
});

test('an unknown provider and an unknown payment', async () => {
  const { service } = setup();
  await assert.rejects(service.receive('stripe', { headers: {}, body: '{}' }), (e) => e instanceof PaymentsError && e.code === 'unknown_provider');
  await assert.rejects(service.payment('pay_x'), (e) => e instanceof PaymentsError && e.code === 'not_found');
});

test('a body that is not the fake format is refused', async () => {
  const { service } = setup();
  for (const body of ['nope', '{}', JSON.stringify({ schema: 'petvold-fake-bank.v1', payments: [] }), JSON.stringify({ schema: 'petvold-fake-bank.v1', payments: [null] })]) {
    await assert.rejects(service.receive('fake', signNotification(SECRET, 'm', Date.parse(NOW) / 1000, body)), (e) => e instanceof ProviderNotificationError && e.code === 'invalid', body);
  }
});
