/** Documents through the API (ADR 0038): upload to a claim, a customer's list, links that expire. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Principal } from '@petvold/api';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp } from '../src/index.ts';
import { validatorFor } from '../src/contract.ts';

const tokens: Record<string, Principal> = {
  handler: { subject: 'handlaggare@example.test', roles: ['handler'], markets: '*' },
  clinic: { subject: 'klinik-002', roles: ['clinic'], markets: ['SE'], clinicId: 'clinic_002' },
  customer: { subject: 'customer-portal', roles: ['customer-channel'], markets: ['SE'], policyIds: ['pol_bella'] },
  registrar: { subject: 'registrar@example.test', roles: ['party-registrar'], markets: ['SE'] },
};

async function setup() {
  let now = '2026-11-20T10:00:00.000Z';
  const clock = { now: () => now };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock, documents: { key: Buffer.alloc(32, 1).toString('base64'), publicBaseUrl: 'https://petvold.example.test' } });
  await seedSampleData(inst, clock);
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let n = 0;
  const call = async (method: string, path: string, token = 'handler', body?: unknown, form?: FormData) => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'idempotency-key': `key-doc-${++n}` } : {}) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(path, { method, headers, ...(form ? { body: form } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? ((await res.json()) as any) : new Uint8Array(await res.arrayBuffer()) };
  };
  const file = (text: string, type = 'application/pdf', name = 'invoice.pdf') => {
    const f = new FormData();
    f.append('file', new File([text], name, { type }));
    return f;
  };
  return { app, call, file, at: (iso: string) => (now = iso) };
}

const valid = (schema: string, body: unknown) => assert.ok(validatorFor(schema)(body), `${schema}: ${JSON.stringify(validatorFor(schema).errors)}`);

test('a file uploaded to a claim is in the customer\'s list and opens through a link that expires (ADR 0038)', async () => {
  const { app, call, file, at } = await setup();
  const up = await call('POST', '/v1/claims/clm_021877/documents', 'handler', undefined, file('%PDF-1.7 the invoice'));
  assert.equal(up.status, 201);
  valid('Document', up.body);
  assert.deepEqual([up.body.owner.claimId, up.body.partyIds, up.body.mediaType], ['clm_021877', ['pty_owner001'], 'application/pdf']);
  assert.equal((await call('POST', '/v1/claims/clm_021877/documents', 'handler', undefined, file('<html>', 'application/pdf'))).status, 422, 'the content must match');

  const list = await call('GET', '/v1/documents?partyId=pty_owner001');
  assert.deepEqual(list.body.items.map((d: any) => d.id), [up.body.id]);
  assert.equal((await call('GET', '/v1/documents?partyId=pty_owner001', 'registrar')).status, 403, 'documents:read is needed');

  const link = await call('POST', `/v1/documents/${up.body.id}/links`, 'handler', { audience: 'internal' });
  assert.equal(link.status, 201);
  valid('DocumentLinkCreated', link.body);
  const path = new URL(link.body.url).pathname;
  assert.match(path, /^\/d\/lnk_/);
  const opened = await app.request(path);
  assert.equal(opened.status, 200);
  assert.equal(new TextDecoder().decode(await opened.arrayBuffer()), '%PDF-1.7 the invoice');
  assert.deepEqual([opened.headers.get('cache-control'), opened.headers.get('referrer-policy'), opened.headers.get('content-type')], ['no-store', 'no-referrer', 'application/pdf']);
  const links = await call('GET', `/v1/documents/${up.body.id}/links`);
  assert.equal(links.body.items[0].accesses.length, 1);
  at('2026-11-20T10:16:00.000Z');
  assert.equal((await app.request(path)).status, 410, 'expired');
});

test('a link for the customer needs documents:share, and a revoked link stops at once', async () => {
  const { app, call, file } = await setup();
  const up = await call('POST', '/v1/claims/clm_021877/documents', 'handler', undefined, file('%PDF-1.7 x'));
  assert.equal((await call('POST', `/v1/documents/${up.body.id}/links`, 'handler', { audience: 'customer' })).status, 403);
  const link = await call('POST', `/v1/documents/${up.body.id}/links`, 'customer', { audience: 'customer', seconds: 7 * 24 * 3600 });
  assert.equal(link.status, 201);
  const path = new URL(link.body.url).pathname;
  assert.equal((await app.request(path)).status, 200);
  const revoked = await call('POST', `/v1/documents/${up.body.id}/links/${link.body.link.id}/revocations`, 'customer', {});
  assert.equal(revoked.status, 201);
  valid('DocumentLink', revoked.body);
  assert.equal((await app.request(path)).status, 410);
  assert.equal((await app.request('/d/not-a-token')).status, 410);
});

test('a document outside the caller\'s scope does not exist for it', async () => {
  const { call, file } = await setup();
  const up = await call('POST', '/v1/claims/clm_021877/documents', 'handler', undefined, file('%PDF-1.7 x'));
  assert.equal((await call('GET', `/v1/documents/${up.body.id}`, 'clinic')).status, 404, 'another clinic\'s claim');
  assert.equal((await call('GET', `/v1/documents/${up.body.id}`, 'customer')).status, 200, 'the customer\'s own policy');
  assert.equal((await call('GET', '/v1/documents/doc_none')).status, 404);
  assert.equal((await call('GET', '/v1/documents')).status, 422, 'never every document at once');
});
