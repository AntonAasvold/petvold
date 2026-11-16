/** Notices to the customer through the API (ADR 0032), with the installation's relay. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';

async function setup() {
  let now = '2026-11-15T10:00:00.000Z';
  const clock = { now: () => now };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  const confirmation = (await inst.deps.communications!.list({ type: 'policy-confirmation' }))[0]!;
  const tokens: Record<string, Principal> = {
    docs: { subject: 'document-service', roles: ['document-service'], markets: ['SE'] },
    docsDe: { subject: 'document-service-de', roles: ['document-service'], markets: ['DE'] },
    handler: { subject: 'h@example.test', roles: ['handler'], markets: '*' },
    portal: { subject: 'portal', roles: ['customer-channel'], markets: ['SE'], policyIds: [confirmation.policyId!] },
    clinic: { subject: 'klinik-001', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_001' },
    comms: { subject: 'comms@example.test', roles: ['communications-manager'], markets: ['SE'] },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let n = 0;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `key-ntc-${String(++n).padStart(4, '0')}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { call, confirmation, inst, at: (iso: string) => (now = iso) };
}

test('the document system reads pending notices and reports deliveries; the queue shows failed and overdue ones', async () => {
  const { call, confirmation, inst, at } = await setup();
  const pending = await call('GET', '/v1/notices?status=pending', 'docs');
  assert.equal(pending.status, 200);
  for (const n of pending.body.items) assert.ok(validatorFor('Notice')(structuredClone(n)), JSON.stringify(validatorFor('Notice').errors));
  assert.ok(pending.body.items.some((n: any) => n.type === 'application-declined'));
  assert.equal((await call('GET', '/v1/notices', 'docsDe')).body.items.length, 0, 'another market');
  assert.equal((await call('GET', '/v1/notices?status=lost', 'docs')).status, 422);
  assert.equal((await call('GET', '/v1/notices?type=letter', 'docs')).status, 422);

  const path = `/v1/notices/${confirmation.id}/deliveries`;
  assert.equal((await call('POST', path, 'handler', { outcome: 'failed', reason: 'x' })).status, 403, 'a handler only reads');
  assert.equal((await call('POST', path, 'docs', { outcome: 'sent', channel: 'letter' })).status, 422);
  assert.equal((await call('POST', path, 'docsDe', { outcome: 'failed', reason: 'x' })).status, 404);
  const failed = await call('POST', path, 'docs', { outcome: 'failed', channel: 'letter', reason: 'No postal address' });
  assert.equal(failed.status, 201);
  assert.ok(validatorFor('Notice')(structuredClone(failed.body)), JSON.stringify(validatorFor('Notice').errors));
  // Failed, and the refusal that lacks the insurer's review text.
  assert.deepEqual((await call('GET', '/v1/notices?attention=true', 'handler')).body.items.map((n: any) => n.status === 'failed' ? n.id : n.type), [confirmation.id, 'application-declined']);

  at('2026-11-16T09:00:00.000Z');
  const sent = await call('POST', path, 'docs', { outcome: 'sent', channel: 'digital-mailbox', sentAt: '2026-11-16T08:30:00Z', documentId: 'arch-2026-000123', sha256: 'c'.repeat(64) });
  assert.deepEqual([sent.status, sent.body.status, sent.body.late, sent.body.deliveries.length], [201, 'sent', undefined, 2]);
  assert.equal((await call('GET', '/v1/notices?attention=true', 'handler')).body.items.some((n: any) => n.id === confirmation.id), false);

  // A week on, the notices nobody sent are overdue.
  at('2026-11-22T09:00:00.000Z');
  const overdue = (await call('GET', '/v1/notices?overdue=true', 'handler')).body.items;
  assert.ok(overdue.length > 0 && overdue.every((n: any) => n.overdue && n.status !== 'sent'));
  assert.equal((await inst.deps.communications!.get(confirmation.id)).status, 'sent');
});

test('the customer portal sees only notices on its policies, and a clinic none', async () => {
  const { call, confirmation } = await setup();
  const mine = await call('GET', '/v1/notices', 'portal');
  assert.deepEqual(mine.body.items.map((n: any) => n.policyId), [confirmation.policyId]);
  assert.equal((await call('GET', `/v1/notices/${confirmation.id}`, 'portal')).status, 200);
  const other = (await call('GET', '/v1/notices?type=application-declined', 'handler')).body.items[0];
  assert.equal((await call('GET', `/v1/notices/${other.id}`, 'portal')).status, 404);
  assert.equal((await call('GET', '/v1/notices', 'clinic')).status, 403);
  assert.equal((await call('GET', '/v1/notices/ntc_none', 'handler')).status, 404);
});

test('the insurer writes its texts in versioned settings; a refusal without review text waits in the queue (ADR 0032)', async () => {
  const { call } = await setup();
  const declined = (await call('GET', '/v1/notices?type=application-declined', 'handler')).body.items[0];
  assert.deepEqual([declined.settingsVersion, declined.incomplete], [1, ['review']]);
  assert.ok((await call('GET', '/v1/notices?attention=true', 'handler')).body.items.some((n: any) => n.id === declined.id));

  const v1 = await call('GET', '/v1/notice-settings', 'docs');
  assert.equal(v1.status, 200);
  assert.ok(validatorFor('NoticeSettings')(structuredClone(v1.body)), JSON.stringify(validatorFor('NoticeSettings').errors));
  const body = { basedOnVersion: 1, reason: 'Swedish texts', markets: { SE: { promptlyDays: 5, texts: { sv: { sender: 'Example Insurance', review: 'Contact our complaints function.' } } } } };
  assert.equal((await call('POST', '/v1/notice-settings/versions', 'docs', body)).status, 403);
  assert.equal((await call('POST', '/v1/notice-settings/versions', 'comms', { ...body, markets: { SE: { disabledTypes: ['policy-confirmation'] } } })).status, 422);
  assert.equal((await call('POST', '/v1/notice-settings/versions', 'comms', { ...body, markets: { SE: { texts: { sv: { footer: 'x' } } } } })).status, 422, 'the contract');
  const v2 = await call('POST', '/v1/notice-settings/versions', 'comms', body);
  assert.deepEqual([v2.status, v2.body.version], [201, 2]);
  assert.equal((await call('POST', '/v1/notice-settings/versions', 'comms', body)).status, 409);
  assert.deepEqual((await call('GET', '/v1/notice-settings/versions', 'comms')).body.items.map((v: any) => v.version), [1, 2]);
});
