/** The WebhookStore contract, run against every implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { WebhookConflictError, type Delivery, type StoredSubscription, type WebhookStore } from '../src/index.ts';

const at = '2026-11-16T10:00:00.000Z';
export const subscription = (n = 1, o: Partial<StoredSubscription> = {}): StoredSubscription => ({
  id: `whs_${n}`,
  url: `https://hooks.example.com/${n}`,
  eventTypes: ['policy.*'],
  markets: ['SE'],
  status: 'active',
  revision: 1,
  createdBy: 'integration@example.test',
  createdAt: at,
  changedBy: 'integration@example.test',
  changedAt: at,
  secret: 'v1:sealed',
  ...o,
});
export const delivery = (n: number, o: Partial<Delivery> = {}): Delivery => ({
  id: `whd_${n}`,
  subscriptionId: 'whs_1',
  eventId: `pev_${n}`,
  eventType: 'policy.issued',
  event: { specversion: '1.0', id: `pev_${n}`, source: '/petvold/policies', type: 'petvold.policy.issued.v1', subject: 'pol_1', time: at, datacontenttype: 'application/json', market: 'SE', data: { policyId: 'pol_1' } },
  status: 'pending',
  attempts: 0,
  nextAttemptAt: at,
  createdAt: at,
  ...o,
});

export function webhookStoreSuite(name: string, make: () => Promise<{ store: WebhookStore }>) {
  describe(name, () => {
    test('subscriptions are created once and changed by revision', async () => {
      const { store } = await make();
      await store.createSubscription(subscription(1, { markets: '*', description: 'CRM' }));
      await assert.rejects(store.createSubscription(subscription(1)), WebhookConflictError);
      assert.deepEqual(await store.getSubscription('whs_1'), subscription(1, { markets: '*', description: 'CRM' }));
      const next = subscription(1, { revision: 2, status: 'disabled', disabledReason: 'Gone', previousSecret: 'v1:old', previousSecretUntil: '2026-11-17T10:00:00.000Z' });
      await store.updateSubscription(next);
      await assert.rejects(store.updateSubscription(next), WebhookConflictError, 'the same revision twice');
      assert.deepEqual(await store.getSubscription('whs_1'), next);
      assert.equal(await store.getSubscription('whs_2'), null);
      await store.createSubscription(subscription(2));
      assert.deepEqual((await store.listSubscriptions()).map((s) => s.id), ['whs_1', 'whs_2']);
    });

    test('deliveries are queued once per subscription and event, claimed with a lease, and recorded', async () => {
      const { store } = await make();
      await store.createSubscription(subscription(1));
      await store.createSubscription(subscription(2, { status: 'disabled' }));
      assert.equal(await store.enqueue([delivery(1), delivery(2, { nextAttemptAt: '2026-11-16T11:00:00.000Z' }), delivery(3, { subscriptionId: 'whs_2' })]), 3);
      assert.equal(await store.enqueue([delivery(4, { eventId: 'pev_1' })]), 0, 'the same event again');
      const lease = '2026-11-16T10:01:00.000Z';
      assert.deepEqual((await store.claimDue(at, 10, lease)).map((d) => [d.id, d.nextAttemptAt]), [['whd_1', lease]], 'only due, only active subscriptions');
      assert.deepEqual(await store.claimDue(at, 10, lease), [], 'leased');
      const done: Delivery = { ...delivery(1), status: 'delivered', attempts: 1, nextAttemptAt: lease, lastAttemptAt: at, lastStatus: 204, deliveredAt: at };
      await store.recordAttempt(done);
      assert.deepEqual(await store.listDeliveries({ subscriptionId: 'whs_1', status: 'delivered' }), [done]);
      assert.deepEqual((await store.listDeliveries({ subscriptionId: 'whs_1' })).map((d) => d.id), ['whd_1', 'whd_2']);
      assert.deepEqual((await store.claimDue('2026-11-16T11:00:00.000Z', 10, '2026-11-16T11:01:00.000Z')).map((d) => d.id), ['whd_2']);
    });
  });
}
