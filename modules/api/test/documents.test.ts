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
  docs: { subject: 'document-service', roles: ['document-service'], markets: ['SE'] },
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
  return { app, call, file, inst, at: (iso: string) => (now = iso) };
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

test('an uploaded file becomes an attachment with urn:petvold:doc:, and must match the document (ADR 0038)', async () => {
  const { call, file } = await setup();
  const up = (await call('POST', '/v1/claims/clm_021877/documents', 'handler', undefined, file('%PDF-1.7 the record'))).body;
  const attach = (o: Record<string, unknown>) => call('POST', '/v1/claims/clm_021877/attachments', 'handler', { kind: 'medical-record', mediaType: up.mediaType, size: up.size, sha256: up.sha256, url: `urn:petvold:doc:${up.id}`, ...o });
  assert.equal((await attach({ sha256: 'f'.repeat(64) })).status, 422, 'another checksum');
  assert.equal((await call('POST', '/v1/claims/clm_033410/attachments', 'handler', { kind: 'invoice', mediaType: up.mediaType, size: up.size, sha256: up.sha256, url: `urn:petvold:doc:${up.id}` })).status, 422, 'another claim');
  assert.equal((await attach({})).status, 201);
});

test("the customer's list has Petvold's documents, notices the insurer sent and attachments in the insurer's archive", async () => {
  const { call, file, inst } = await setup();
  while ((await inst.relay.tick()) > 0);
  const up = (await call('POST', '/v1/claims/clm_021877/documents', 'handler', undefined, file('%PDF-1.7 the invoice'))).body;
  await call('POST', '/v1/claims/clm_021877/attachments', 'handler', { kind: 'invoice', mediaType: up.mediaType, size: up.size, sha256: up.sha256, url: `urn:petvold:doc:${up.id}` });
  await call('POST', '/v1/claims/clm_021877/attachments', 'handler', { kind: 'photo', mediaType: 'image/jpeg', size: 2048, sha256: 'b'.repeat(64), url: 'https://archive.example.test/photo-1' });
  // The insurer's document system sends a claims decision about Bella and reports it.
  const [confirmation] = (await call('GET', '/v1/notices?policyId=pol_bella&type=claim-decision', 'docs')).body.items;
  await call('POST', `/v1/notices/${confirmation.id}/deliveries`, 'docs', { outcome: 'sent', channel: 'digital-mailbox', sentAt: '2026-11-20T10:02:00Z', documentId: 'arch-2026-000777', sha256: 'c'.repeat(64) });
  const list = await call('GET', '/v1/parties/pty_owner001/documents');
  assert.equal(list.status, 200);
  list.body.items.forEach((x: unknown) => valid('CustomerDocument', x));
  const rows = list.body.items.map((x: any) => [x.source, x.type, x.kind ?? x.noticeType]);
  assert.ok(rows.some((r: string[]) => r[0] === 'petvold' && r[2] === 'invoice'), 'the uploaded file, with the attachment\'s kind');
  assert.ok(rows.some((r: string[]) => r[0] === 'insurer' && r[2] === 'photo'), 'the attachment in the insurer\'s archive');
  assert.equal(rows.filter((r: string[]) => r[0] === 'petvold').length, 1, 'the archived attachment is listed once');
  const letter = list.body.items.find((x: any) => x.type === 'notice');
  assert.deepEqual([letter.source, letter.noticeType, letter.archiveId, letter.channel], ['insurer', 'claim-decision', 'arch-2026-000777', 'digital-mailbox']);
  assert.equal((await call('GET', '/v1/parties/pty_owner001/documents', 'clinic')).status, 403, 'a clinic has no parties:read');
});

test('a notice becomes a PDF from the template, with the recipient and the reasons in words, and the document service sees it (ADR 0038)', async () => {
  const html: string[] = [];
  let now = '2026-11-20T10:00:00.000Z';
  const clock = { now: () => now };
  const inst = await compose({
    databases: {},
    engineVersion: 'test',
    clock,
    documents: { key: Buffer.alloc(32, 1).toString('base64'), renderer: { render: async (i) => (html.push(i.html), new TextEncoder().encode('%PDF-1.7 rendered')) } },
  });
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  const post = (path: string, token: string) =>
    app.request(path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': `key-${path}-${token}` }, body: '{}' });
  const [n] = await inst.deps.communications!.list({ type: 'claim-decision', policyId: 'pol_bella' });
  assert.equal((await post(`/v1/notices/${n!.id}/documents`, 'handler')).status, 403, 'notices:deliver is needed');
  const res = await post(`/v1/notices/${n!.id}/documents`, 'docs');
  assert.equal(res.status, 201);
  const doc = (await res.json()) as any;
  valid('Document', doc);
  assert.deepEqual([doc.kind, doc.template.name, doc.owner.noticeId, doc.partyIds], ['generated', 'claim-decision', n!.id, ['pty_owner001']]);
  assert.match(html[0]!, /Anna/, 'the recipient\'s name, read when the PDF is made');
  assert.doesNotMatch(html[0]!, /decision\.(approved|partial)/, 'the reasons in words, not keys');
  const listed = await app.request(`/v1/documents?noticeId=${n!.id}`, { headers: { authorization: 'Bearer docs' } });
  assert.deepEqual(((await listed.json()) as any).items.map((x: any) => x.id), [doc.id]);
  now = '2026-11-20T10:01:00.000Z';
  const without = await setup();
  while ((await without.inst.relay.tick()) > 0);
  const [m] = (await without.call('GET', '/v1/notices?type=claim-decision', 'docs')).body.items;
  assert.equal((await without.call('POST', `/v1/notices/${m.id}/documents`, 'docs', {})).status, 503, 'no renderer');
});

test('with the setting petvold the relay makes the PDF when the notice is made; the report names only channel and time (ADR 0038 step 4)', async () => {
  let rendered = 0;
  let now = '2026-11-20T10:00:00.000Z';
  const clock = { now: () => now };
  const inst = await compose({
    databases: {},
    engineVersion: 'test',
    clock,
    documents: { key: Buffer.alloc(32, 1).toString('base64'), renderer: { render: async () => (rendered++, new TextEncoder().encode('%PDF-1.7 rendered')) } },
  });
  const communications = inst.deps.communications!;
  const v = (await communications.settings()).version;
  await communications.changeSettings({ markets: { SE: { documentMaker: 'petvold' } }, basedOnVersion: v, reason: 'Petvold makes the letters' }, 'compliance');
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  // Invoices (ADR 0040): the run makes them, and the relay their notices and PDFs.
  await inst.deps.billing!.invoicingRun({ market: 'SE', onDate: '2027-11-01', dryRun: false }, 'scheduler');
  while ((await inst.relay.tick()) > 0);
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  const get = async (path: string) => (await app.request(path, { headers: { authorization: 'Bearer docs' } })).json() as Promise<any>;

  const notices = (await get('/v1/notices?limit=200')).items as any[];
  const made = notices.filter((x) => x.documentMaker === 'petvold');
  const templated = ['claim-decision', 'policy-confirmation', 'invoice'];
  assert.ok(made.length >= 3, 'claims decisions, policy confirmations and invoices');
  assert.ok(made.some((x) => x.type === 'invoice'));
  assert.ok(made.every((x) => templated.includes(x.type) && x.document?.madeBy === 'petvold'));
  assert.ok(notices.filter((x) => !templated.includes(x.type)).every((x) => x.documentMaker === 'insurer' && !x.document));
  assert.equal(rendered, made.length, 'one PDF per notice, also when the relay runs again');
  const n = made[0];
  valid('Notice', n);
  const doc = await get(`/v1/documents/${n.document.id}`);
  assert.deepEqual([doc.owner.noticeId, doc.sha256], [n.id, n.document.sha256]);

  now = '2026-11-20T11:00:00.000Z';
  const report = (body: unknown) =>
    app.request(`/v1/notices/${n.id}/deliveries`, { method: 'POST', headers: { authorization: 'Bearer docs', 'content-type': 'application/json', 'idempotency-key': `k-${JSON.stringify(body)}` }, body: JSON.stringify(body) });
  const sent = { outcome: 'sent', channel: 'digital-mailbox', sentAt: '2026-11-20T10:30:00Z' };
  assert.equal((await report({ ...sent, documentId: 'arch-1', sha256: 'a'.repeat(64) })).status, 422, 'another document than Petvold made');
  const res = await report(sent);
  assert.equal(res.status, 201);
  const after = (await res.json()) as any;
  assert.deepEqual([after.status, after.deliveries[0].documentId, after.deliveries[0].sha256], ['sent', n.document.id, n.document.sha256]);

  // The customer's list has the PDF once, from Petvold's archive.
  const list = (await (await app.request(`/v1/parties/${n.recipientPartyId}/documents`, { headers: { authorization: 'Bearer handler' } })).json()) as any;
  const rows = list.items.filter((x: any) => x.noticeId === n.id);
  assert.deepEqual(rows.map((x: any) => [x.source, x.documentId, x.noticeType]), [['petvold', n.document.id, n.type]]);
  rows.forEach((x: any) => valid('CustomerDocument', x));
});
