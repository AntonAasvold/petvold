/** Webhooks through the API and the installation's relay and worker (ADR 0033). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';
import { eventValidator } from '../src/events-contract.ts';

async function setup() {
  let now = '2026-11-15T10:00:00.000Z';
  const clock = { now: () => now };
  let answer = 204;
  const received: { url: string; headers: Record<string, string>; body: string }[] = [];
  const inst = await compose({
    databases: {},
    engineVersion: 'test',
    clock,
    webhooks: { transport: { post: async (url, headers, body) => (received.push({ url, headers, body }), { status: answer }) } },
  });
  const tokens: Record<string, Principal> = {
    integration: { subject: 'integration@example.test', roles: ['integration-admin'], markets: '*' },
    integrationSe: { subject: 'integration-se@example.test', roles: ['integration-admin'], markets: ['SE'] },
    handler: { subject: 'h@example.test', roles: ['handler'], markets: '*' },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let n = 0;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': `key-whk-${String(++n).padStart(4, '0')}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { inst, call, received, clock, at: (iso: string) => (now = iso), answer: (s: number) => (answer = s) };
}

test('a subscription gets the policy module\'s events as signed CloudEvents, without personal data', async () => {
  const { inst, call, received, clock } = await setup();
  const body = { url: 'https://crm.example.com/petvold', eventTypes: ['policy.issued', 'application.*'], markets: ['SE'], description: 'CRM' };
  assert.equal((await call('POST', '/v1/webhook-subscriptions', 'handler', body)).status, 403);
  assert.equal((await call('POST', '/v1/webhook-subscriptions', 'integration', { ...body, url: 'https://192.168.1.10/hook' })).status, 422);
  assert.equal((await call('POST', '/v1/webhook-subscriptions', 'integrationSe', { ...body, markets: '*' })).status, 403);
  const created = await call('POST', '/v1/webhook-subscriptions', 'integration', body);
  assert.equal(created.status, 201);
  assert.ok(validatorFor('WebhookSubscriptionWithSecret')(structuredClone(created.body)), JSON.stringify(validatorFor('WebhookSubscriptionWithSecret').errors));
  const { subscription, secret } = created.body;
  assert.equal((await call('GET', `/v1/webhook-subscriptions/${subscription.id}`, 'integration')).body.secret, undefined);

  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  while ((await inst.webhookWorker.tick()).delivered > 0);
  const types = received.map((r) => JSON.parse(r.body).type);
  assert.ok(types.includes('petvold.policy.issued.v1') && types.includes('petvold.application.declined.v1'));
  assert.ok(!types.some((t) => t.startsWith('petvold.policy.version_superseded') || t === 'petvold.policy.cancelled.v1'), 'only what it subscribed to');
  for (const r of received) {
    const signed = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${r.headers['webhook-id']}.${r.headers['webhook-timestamp']}.${r.body}`).digest('base64');
    assert.equal(r.headers['webhook-signature'], `v1,${signed}`);
    const e = JSON.parse(r.body) as { market: string };
    assert.ok(validatorFor('CloudEvent')(e), JSON.stringify(validatorFor('CloudEvent').errors));
    assert.equal(e.market, 'SE');
    assert.equal(JSON.stringify(e).includes('example.test'), false, 'no one who did it, no e-mail addresses');
  }
  const deliveries = await call('GET', `/v1/webhook-subscriptions/${subscription.id}/deliveries?status=delivered`, 'integration');
  assert.equal(deliveries.body.items.length, received.length);
  assert.ok(validatorFor('WebhookDelivery')(structuredClone(deliveries.body.items[0])), JSON.stringify(validatorFor('WebhookDelivery').errors));
});

test('a subscription is changed by revision and its secret rotated; the caller sees only its markets', async () => {
  const { call } = await setup();
  const body = { url: 'https://docs.example.com/hook', eventTypes: ['proposal.created'], markets: ['NO'] };
  const { subscription } = (await call('POST', '/v1/webhook-subscriptions', 'integration', body)).body;
  assert.equal((await call('GET', `/v1/webhook-subscriptions/${subscription.id}`, 'integrationSe')).status, 404);
  assert.equal((await call('GET', '/v1/webhook-subscriptions', 'integrationSe')).body.items.length, 0);
  const off = await call('PUT', `/v1/webhook-subscriptions/${subscription.id}`, 'integration', { ...body, status: 'disabled', basedOnRevision: 1 });
  assert.deepEqual([off.status, off.body.status, off.body.revision], [200, 'disabled', 2]);
  assert.equal((await call('PUT', `/v1/webhook-subscriptions/${subscription.id}`, 'integration', { ...body, status: 'active', basedOnRevision: 1 })).status, 409);
  const rotated = await call('POST', `/v1/webhook-subscriptions/${subscription.id}/secret-rotations`, 'integration');
  assert.deepEqual([rotated.status, rotated.body.subscription.revision, rotated.body.subscription.previousSecretUntil], [201, 3, '2026-11-16T10:00:00.000Z']);
  assert.equal((await call('GET', `/v1/webhook-subscriptions/${subscription.id}/deliveries?status=lost`, 'integration')).status, 422);
  assert.equal((await call('GET', '/v1/webhook-subscriptions/whs_none', 'integration')).status, 404);
});

test('every event a subscription to everything gets follows asyncapi.yaml: claims, animals, policies and notices', async () => {
  const { inst, call, received, clock } = await setup();
  await call('POST', '/v1/webhook-subscriptions', 'integration', { url: 'https://lake.example.com/petvold', eventTypes: ['*'], markets: '*' });
  await seedSampleData(inst, clock);
  // Bella is sold, and a notice is sent: an animal event, a proposal and a delivery.
  await inst.deps.animals!.transfer('ani_bella', { partyId: 'pty_owner002', from: '2026-11-14' }, 'registrar');
  while ((await inst.relay.tick()) > 0);
  const [notice] = await inst.deps.communications!.list({ status: 'pending' });
  await inst.deps.communications!.addDelivery(notice!.id, { outcome: 'sent', channel: 'letter', sentAt: clock.now(), documentId: 'arch-1', sha256: 'a'.repeat(64) }, 'docs');
  while ((await inst.relay.tick()) > 0);
  while ((await inst.webhookWorker.tick()).delivered > 0);

  const events = received.map((r) => JSON.parse(r.body) as { type: string; data: Record<string, unknown> });
  const types = new Set(events.map((e) => e.type.replace(/^petvold\.|\.v1$/g, '')));
  for (const t of ['claim.registered', 'claim.decided', 'claim.decision_proposed', 'claim.review_requested', 'animal.ownership_changed', 'policy.issued', 'proposal.created', 'application.declined', 'notice.created', 'notice.delivered']) {
    assert.ok(types.has(t), `${t} was sent`);
  }
  for (const e of events) {
    const v = eventValidator(e.type.replace(/^petvold\.|\.v1$/g, ''));
    assert.ok(v(e), `${e.type}: ${JSON.stringify(v.errors)}`);
  }
  const review = events.find((e) => e.type === 'petvold.claim.review_requested.v1')!;
  assert.equal('statement' in review.data, false, "the customer's own words stay in Petvold");
  assert.equal(events.some((e) => JSON.stringify(e).includes('@example.test')), false, 'no one who did it');
});

test('dead deliveries are listed across subscriptions and sent again, one or all', async () => {
  const { inst, call, at, answer } = await setup();
  const { subscription } = (await call('POST', '/v1/webhook-subscriptions', 'integration', { url: 'https://crm.example.com/hook', eventTypes: ['animal.*'], markets: ['SE'] })).body;
  const other = (await call('POST', '/v1/webhook-subscriptions', 'integration', { url: 'https://no.example.com/hook', eventTypes: ['animal.*'], markets: ['NO'] })).body.subscription;
  await seedSampleData(inst, { now: inst.deps.clock.now });
  for (const [animal, to] of [['ani_bella', 'pty_owner002'], ['ani_doris', 'pty_owner003']] as const) await inst.deps.animals!.transfer(animal, { partyId: to, from: '2026-11-14' }, 'registrar');
  while ((await inst.relay.tick()) > 0);
  answer(500);
  await inst.webhookWorker.tick();
  at('2026-11-18T10:00:01.000Z');
  await inst.webhookWorker.tick();
  const dead = await call('GET', '/v1/webhook-deliveries?status=dead', 'integration');
  assert.deepEqual(dead.body.items.map((d: any) => d.subscriptionId), [subscription.id, subscription.id]);
  assert.equal((await call('GET', '/v1/webhook-deliveries?status=dead', 'integrationSe')).body.items.length, 2);
  assert.equal((await call('GET', `/v1/webhook-deliveries?subscriptionId=${other.id}`, 'integration')).body.items.length, 0);
  assert.equal((await call('GET', '/v1/webhook-deliveries?status=lost', 'integration')).status, 422);

  answer(204);
  const one = await call('POST', `/v1/webhook-subscriptions/${subscription.id}/deliveries/${dead.body.items[0].id}/retries`, 'integration');
  assert.deepEqual([one.status, one.body.status, one.body.retriedAt], [201, 'pending', '2026-11-18T10:00:01.000Z']);
  assert.ok(validatorFor('WebhookDelivery')(structuredClone(one.body)), JSON.stringify(validatorFor('WebhookDelivery').errors));
  assert.equal((await call('POST', `/v1/webhook-subscriptions/${subscription.id}/deliveries/${dead.body.items[0].id}/retries`, 'integration')).status, 409);
  assert.equal((await call('POST', `/v1/webhook-subscriptions/${other.id}/deliveries/${dead.body.items[1].id}/retries`, 'integration')).status, 404);
  const all = await call('POST', `/v1/webhook-subscriptions/${subscription.id}/delivery-retries`, 'integration');
  assert.deepEqual([all.status, all.body.retried], [201, 1]);
  assert.deepEqual(await inst.webhookWorker.tick(), { delivered: 2, failed: 0, dead: 0 });
  assert.equal((await call('GET', `/v1/webhook-subscriptions/${subscription.id}`, 'integration')).body.failingSince, undefined);
});
