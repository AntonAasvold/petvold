import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import {
  InMemoryWebhookStore,
  SecretBox,
  WebhookError,
  WebhookService,
  WebhookWorker,
  isPrivateAddress,
  matches,
  nextAttemptAt,
  sign,
  toCloudEvent,
  type SourceEvent,
  type Transport,
} from '../src/index.ts';

const key = randomBytes(32).toString('base64');
function setup(o: { allowHosts?: string[] } = {}) {
  let now = '2026-11-16T10:00:00.000Z';
  let n = 0;
  const store = new InMemoryWebhookStore();
  const clock = { now: () => now };
  const service = new WebhookService({ store, box: new SecretBox(key), clock, ids: { next: (p) => `${p}_${++n}` }, ...(o.allowHosts ? { allowHosts: o.allowHosts } : {}) });
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  let answer: number | Error = 204;
  const transport: Transport = {
    post: async (url, headers, body) => {
      sent.push({ url, headers, body });
      if (answer instanceof Error) throw answer;
      return { status: answer };
    },
  };
  const worker = new WebhookWorker({ service, store, transport, clock, random: () => 0.5 });
  return { service, store, worker, sent, at: (iso: string) => (now = iso), answer: (a: number | Error) => (answer = a) };
}
const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof WebhookError && e.code === code && (!msg || msg.test(e.message)));
const issued = (o: Partial<SourceEvent> = {}): SourceEvent => ({
  id: 'pev_1',
  type: 'policy.issued',
  policyId: 'pol_1',
  market: 'SE',
  occurredAt: '2026-11-16T09:59:00.000Z',
  data: { transactionId: 'ptx_1', animalId: 'ani_rex', policyholderPartyId: 'pty_anna', premium: { amount: 480_000, currency: 'SEK' }, note: 'Personal remark', decidedBy: 'anna.handler@example.test' },
  ...o,
});
const input = { url: 'https://hooks.example.com/petvold', eventTypes: ['policy.*'], markets: ['SE'] };

test('an event becomes a thin CloudEvent: ids and allowed fields only, versioned type', () => {
  const e = toCloudEvent(issued())!;
  assert.deepEqual(e, {
    specversion: '1.0',
    id: 'pev_1',
    source: '/petvold/policies',
    type: 'petvold.policy.issued.v1',
    subject: 'pol_1',
    time: '2026-11-16T09:59:00.000Z',
    datacontenttype: 'application/json',
    market: 'SE',
    data: { policyId: 'pol_1', transactionId: 'ptx_1', animalId: 'ani_rex', policyholderPartyId: 'pty_anna', premium: { amount: 480_000, currency: 'SEK' } },
  });
  assert.equal(toCloudEvent(issued({ type: 'policy.version_superseded' })), null, 'internal');
  const declined = toCloudEvent({ id: 'pev_2', type: 'application.declined', applicationId: 'app_1', market: 'SE', occurredAt: issued().occurredAt, data: { reason: 'too-old', decidedBy: 'uw@example.test' } })!;
  assert.deepEqual(declined.data, { applicationId: 'app_1', reason: 'too-old' });
  assert.equal(declined.subject, 'app_1');
});

test('patterns, private addresses and the retry schedule', () => {
  assert.deepEqual([matches('*', 'policy.issued'), matches('policy.*', 'policy.issued'), matches('policy.*', 'proposal.created'), matches('policy.issued', 'policy.issued')], [true, true, false, true]);
  assert.deepEqual(['10.1.2.3', '127.0.0.1', '192.168.0.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1', '93.184.216.34'].map(isPrivateAddress), [true, true, true, true, true, true, true, true, false]);
  const created = '2026-11-16T10:00:00.000Z';
  assert.equal(nextAttemptAt(created, 1, created, () => 0.5), '2026-11-16T10:00:05.000Z');
  assert.equal(nextAttemptAt(created, 2, created, () => 0.5), '2026-11-16T10:05:00.000Z');
  assert.equal(nextAttemptAt(created, 3, created, () => 0), '2026-11-16T10:27:00.000Z', '30 min less 10 %');
  assert.equal(nextAttemptAt(created, 9, '2026-11-18T10:00:01.000Z', () => 0.5), null, 'more than three days');
});

test('a subscription is validated, its secret shown once and sealed in the store', async () => {
  const { service, store } = setup();
  await rejects(service.create({ ...input, url: 'http://hooks.example.com' }, 'ia'), 'validation', /https/);
  await rejects(service.create({ ...input, url: 'https://10.0.0.5/hook' }, 'ia'), 'validation', /private/);
  await rejects(service.create({ ...input, url: 'https://localhost/hook' }, 'ia'), 'validation', /private/);
  await rejects(service.create({ ...input, url: 'https://user:pw@hooks.example.com' }, 'ia'), 'validation', /credentials/);
  await rejects(service.create({ ...input, eventTypes: ['claim.decided'] }, 'ia'), 'validation', /no public event type/);
  await rejects(service.create({ ...input, markets: ['se'] }, 'ia'), 'validation', /market/);
  const { subscription, secret } = await service.create({ ...input, eventTypes: ['policy.*', 'application.declined', 'policy.*'] }, 'ia');
  assert.match(secret, /^whsec_[A-Za-z0-9+/]{43}=$/);
  assert.deepEqual([subscription.eventTypes, subscription.status, subscription.revision, 'secret' in subscription], [['application.declined', 'policy.*'], 'active', 1, false]);
  const stored = (await store.getSubscription(subscription.id))!;
  assert.ok(stored.secret.startsWith('v1:') && !stored.secret.includes(secret.slice(6, 20)), 'sealed');
  // A local receiver is allowed when the installation names it.
  assert.equal((await setup({ allowHosts: ['localhost'] }).service.create({ ...input, url: 'http://localhost:4000/hook' }, 'ia')).subscription.url, 'http://localhost:4000/hook');
});

test('the worker sends a signed CloudEvent, once per subscription, and records the delivery', async () => {
  const { service, worker, sent } = setup();
  const { subscription, secret } = await service.create(input, 'ia');
  await service.create({ ...input, url: 'https://other.example.com/', markets: ['NO'] }, 'ia');
  assert.equal(await service.enqueue(issued()), 1, 'only the subscription for SE');
  assert.equal(await service.enqueue(issued()), 0, 'a repeat from the relay');
  assert.deepEqual(await worker.tick(), { delivered: 1, failed: 0, dead: 0 });
  const [req] = sent;
  assert.equal(req!.url, input.url);
  assert.deepEqual([req!.headers['content-type'], req!.headers['webhook-id'], req!.headers['webhook-timestamp']], ['application/cloudevents+json', 'pev_1', String(Date.parse('2026-11-16T10:00:00.000Z') / 1000)]);
  // The receiver checks the signature as Standard Webhooks describes.
  const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`pev_1.${req!.headers['webhook-timestamp']}.${req!.body}`).digest('base64');
  assert.equal(req!.headers['webhook-signature'], `v1,${expected}`);
  assert.equal(JSON.parse(req!.body).type, 'petvold.policy.issued.v1');
  const [d] = await service.deliveries(subscription.id);
  assert.deepEqual([d!.status, d!.attempts, d!.lastStatus, d!.deliveredAt], ['delivered', 1, 204, '2026-11-16T10:00:00.000Z']);
  assert.deepEqual(await worker.tick(), { delivered: 0, failed: 0, dead: 0 });
});

test('a failed attempt is retried later; after three days the delivery is dead', async () => {
  const { service, worker, at, answer } = setup();
  const { subscription } = await service.create(input, 'ia');
  await service.enqueue(issued());
  answer(503);
  assert.deepEqual(await worker.tick(), { delivered: 0, failed: 1, dead: 0 });
  let [d] = await service.deliveries(subscription.id);
  assert.deepEqual([d!.status, d!.lastStatus, d!.lastError, d!.nextAttemptAt], ['pending', 503, 'HTTP 503', '2026-11-16T10:00:05.000Z']);
  assert.deepEqual(await worker.tick(), { delivered: 0, failed: 0, dead: 0 }, 'not due yet');
  answer(new Error('connect ECONNREFUSED'));
  at('2026-11-16T10:00:06.000Z');
  await worker.tick();
  [d] = await service.deliveries(subscription.id);
  assert.deepEqual([d!.attempts, d!.lastError, d!.lastStatus], [2, 'connect ECONNREFUSED', 503]);
  at('2026-11-19T10:00:06.000Z');
  assert.deepEqual(await worker.tick(), { delivered: 0, failed: 0, dead: 1 });
  assert.equal((await service.deliveries(subscription.id, 'dead')).length, 1);
});

test('410 Gone disables the subscription; a person turns it on again and the queue flows', async () => {
  const { service, worker, answer } = setup();
  const { subscription } = await service.create(input, 'ia');
  await service.enqueue(issued());
  await service.enqueue(issued({ id: 'pev_2' }));
  answer(410);
  await worker.tick();
  const off = await service.get(subscription.id);
  assert.deepEqual([off.status, off.disabledReason], ['disabled', 'The receiver answered 410 Gone']);
  assert.equal(await service.enqueue(issued({ id: 'pev_3' })), 0, 'a disabled subscription gets nothing new');
  await rejects(service.change(subscription.id, { ...input, status: 'active', basedOnRevision: 1 }, 'ia'), 'conflict', /revision 2/);
  const on = await service.change(subscription.id, { ...input, status: 'active', basedOnRevision: 2 }, 'ia');
  assert.deepEqual([on.status, on.disabledReason, on.revision], ['active', undefined, 3]);
  answer(200);
  assert.deepEqual(await worker.tick(), { delivered: 1, failed: 0, dead: 0 }, 'the second event, still pending');
});

test('a rotated secret: both sign for 24 hours, then only the new one', async () => {
  const { service, worker, sent, at } = setup();
  const { subscription, secret: old } = await service.create(input, 'ia');
  const { secret: fresh, subscription: rotated } = await service.rotateSecret(subscription.id, 'ia');
  assert.notEqual(fresh, old);
  assert.equal(rotated.previousSecretUntil, '2026-11-17T10:00:00.000Z');
  await service.enqueue(issued());
  await worker.tick();
  const h = sent[0]!.headers;
  assert.equal(h['webhook-signature'], sign([fresh, old], 'pev_1', Number(h['webhook-timestamp']), sent[0]!.body));
  at('2026-11-17T10:00:01.000Z');
  await service.enqueue(issued({ id: 'pev_2' }));
  await worker.tick();
  assert.equal(sent[1]!.headers['webhook-signature']!.split(' ').length, 1);
});
