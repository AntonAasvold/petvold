import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store.ts';
import { ensureSubscription, PetvoldError, SETTING, type SavedSubscription } from '../src/subscription.ts';

const URL_ = 'http://localhost:8790/webhooks/petvold';
const sub = (over: Record<string, unknown> = {}) => ({ id: 'whs_1', url: URL_, eventTypes: ['*'], markets: '*', status: 'active', revision: 1, createdBy: 'x', createdAt: 't', changedBy: 'x', changedAt: 't', ...over });

/** A Petvold that answers from a script, and the calls it got. */
function petvold(answers: Record<string, (body: unknown) => [number, unknown]>) {
  const calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method!, path, body, headers: init.headers as Record<string, string> });
    const answer = answers[`${init.method} ${path}`];
    const [status, data] = answer ? answer(body) : [404, { title: 'Not found' }];
    return new Response(JSON.stringify(data), { status });
  }) as unknown as typeof globalThis.fetch;
  return { api: { baseUrl: 'http://petvold.test/', token: 'dev-integration', fetch }, calls };
}

const now = () => '2026-11-28T10:00:00Z';

test('makes the subscription when Petvold has none, and keeps the secret', async () => {
  const store = new MemoryStore();
  const p = petvold({
    'GET /v1/webhook-subscriptions': () => [200, { items: [sub({ id: 'whs_other', url: 'https://elsewhere.example/hook' })] }],
    'POST /v1/webhook-subscriptions': () => [201, { subscription: sub(), secret: 'whsec_new' }],
  });
  const r = await ensureSubscription(p.api, store, URL_, now);
  assert.deepEqual(r, { subscription: { id: 'whs_1', secret: 'whsec_new' }, outcome: 'created' });
  assert.deepEqual(p.calls[1]!.body, { url: URL_, eventTypes: ['*'], markets: '*', description: 'Petvold Demo' });
  assert.match(p.calls[1]!.headers['idempotency-key']!, /^demo-.{8,}/);
  assert.equal(p.calls[0]!.headers.authorization, 'Bearer dev-integration');
  assert.deepEqual(await store.setting<SavedSubscription>(SETTING), { id: 'whs_1', secret: 'whsec_new' });
});

test('changes the secret of a subscription the test data made', async () => {
  const store = new MemoryStore();
  const p = petvold({
    'GET /v1/webhook-subscriptions': () => [200, { items: [sub()] }],
    'POST /v1/webhook-subscriptions/whs_1/secret-rotations': () => [201, { subscription: sub({ revision: 2 }), secret: 'whsec_rotated' }],
  });
  const r = await ensureSubscription(p.api, store, URL_, now);
  assert.equal(r.outcome, 'rotated');
  assert.equal((await store.setting<SavedSubscription>(SETTING))?.secret, 'whsec_rotated');
});

test('keeps a subscription whose secret it has, across pages', async () => {
  const store = new MemoryStore();
  await store.setSetting(SETTING, { id: 'whs_1', secret: 'whsec_saved' });
  let page = 0;
  const p = petvold({ 'GET /v1/webhook-subscriptions': () => (page++ === 0 ? [200, { items: [sub({ id: 'whs_0', url: 'https://x.example' })], nextCursor: 'c2' }] : [200, { items: [sub()] }]) });
  const r = await ensureSubscription(p.api, store, URL_, now);
  assert.deepEqual(r, { subscription: { id: 'whs_1', secret: 'whsec_saved' }, outcome: 'kept' });
  assert.equal(p.calls.length, 2);
});

test('turns a disabled subscription on again', async () => {
  const store = new MemoryStore();
  await store.setSetting(SETTING, { id: 'whs_1', secret: 'whsec_saved' });
  const p = petvold({
    'GET /v1/webhook-subscriptions': () => [200, { items: [sub({ status: 'disabled', revision: 4, description: 'Petvold Demo' })] }],
    'PUT /v1/webhook-subscriptions/whs_1': (b) => [200, { ...sub(), ...(b as object) }],
  });
  await ensureSubscription(p.api, store, URL_, now);
  assert.deepEqual(p.calls[1]!.body, { basedOnRevision: 4, url: URL_, eventTypes: ['*'], markets: '*', description: 'Petvold Demo', status: 'active' });
});

test('an error from Petvold is thrown with its status and detail', async () => {
  const p = petvold({ 'GET /v1/webhook-subscriptions': () => [403, { title: 'Forbidden', detail: 'needs webhooks:read' }] });
  await assert.rejects(ensureSubscription(p.api, new MemoryStore(), URL_, now), (e: unknown) => e instanceof PetvoldError && e.status === 403 && /needs webhooks:read/.test(e.message));
});
