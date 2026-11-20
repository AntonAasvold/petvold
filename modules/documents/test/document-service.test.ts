import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentError, DocumentService, InMemoryBlobStore, InMemoryDocumentStore, MAX_UPLOAD_BYTES, sha256 } from '../src/index.ts';

const pdf = new TextEncoder().encode('%PDF-1.7\n% a tiny test file\n');
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

function setup() {
  let now = '2026-11-20T10:00:00.000Z';
  let n = 0;
  const store = new InMemoryDocumentStore();
  const blobs = new InMemoryBlobStore();
  const s = new DocumentService({
    store,
    blobs,
    clock: { now: () => now },
    ids: { next: (p) => `${p}_${++n}` },
    signingKey: new Uint8Array(32).fill(7),
    publicBaseUrl: 'https://petvold.example.test/',
  });
  const upload = (o: Partial<Parameters<DocumentService['upload']>[0]> = {}) =>
    s.upload({ bytes: pdf, mediaType: 'application/pdf', filename: 'invoice.pdf', owner: { claimId: 'clm_1', policyId: 'pol_1' }, partyIds: ['pty_anna', 'pty_anna'], market: 'SE', ...o }, 'h@example.test');
  return { s, store, blobs, upload, at: (iso: string) => (now = iso) };
}

const code = (c: string) => (e: unknown) => e instanceof DocumentError && e.code === c;
const tokenOf = (url: string) => url.split('/d/')[1]!;

test('an upload keeps the file in the archive with the checksum Petvold computed (ADR 0038)', async () => {
  const { upload, blobs } = setup();
  const d = await upload({ filename: ' ../../invoice.pdf ' });
  assert.deepEqual([d.kind, d.mediaType, d.size, d.sha256, d.filename, d.partyIds], ['uploaded', 'application/pdf', pdf.length, sha256(pdf), '....invoice.pdf', ['pty_anna']]);
  assert.deepEqual(await blobs.get(d.id), pdf);
});

test('an upload is an allowed media type, matches its content, and is at most 25 MB', async () => {
  const { upload } = setup();
  await assert.rejects(upload({ mediaType: 'text/html' }), code('validation'));
  await assert.rejects(upload({ mediaType: 'image/png' }), code('validation'), 'a PDF is not a PNG');
  await assert.rejects(upload({ bytes: new Uint8Array() }), code('validation'));
  await assert.rejects(upload({ bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1) }), code('validation'));
  await assert.rejects(upload({ owner: {} }), code('validation'));
  assert.equal((await upload({ bytes: png, mediaType: 'image/png' })).mediaType, 'image/png');
  assert.equal((await upload({ mediaType: 'Application/PDF; charset=binary' })).mediaType, 'application/pdf');
});

test('a link opens the document until it expires, logs every opening, and names neither document nor customer', async () => {
  const { s, upload, at } = setup();
  const d = await upload();
  const { link, url } = await s.createLink(d.id, { audience: 'internal' }, 'h@example.test');
  assert.match(url, /^https:\/\/petvold\.example\.test\/d\/lnk_[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/);
  assert.ok(!url.includes(d.id) && !url.includes('pty_') && !url.includes('clm_'));
  assert.equal(link.expiresAt, '2026-11-20T10:15:00.000Z', 'internal: 15 minutes');
  const opened = await s.open(tokenOf(url));
  assert.deepEqual(opened.bytes, pdf);
  at('2026-11-20T10:14:00.000Z');
  await s.open(tokenOf(url));
  assert.deepEqual((await s.links(d.id))[0]!.accesses, ['2026-11-20T10:00:00.000Z', '2026-11-20T10:14:00.000Z']);
  at('2026-11-20T10:15:00.000Z');
  await assert.rejects(s.open(tokenOf(url)), code('gone'));
});

test('a customer link lasts at most 7 days; a revoked or tampered link does not work', async () => {
  const { s, upload } = setup();
  const d = await upload();
  await assert.rejects(s.createLink(d.id, { audience: 'customer', seconds: 8 * 24 * 3600 }, 'h'), code('validation'));
  await assert.rejects(s.createLink(d.id, { audience: 'internal', seconds: 3600 }, 'h'), code('validation'), 'a person here gets 15 minutes');
  const week = await s.createLink(d.id, { audience: 'customer', seconds: 7 * 24 * 3600 }, 'portal');
  assert.equal(week.link.expiresAt, '2026-11-27T10:00:00.000Z');
  const token = tokenOf(week.url);
  await assert.rejects(s.open(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`), code('gone'), 'another signature');
  await assert.rejects(s.open(token.replace(/^lnk_./, 'lnk_Z')), code('gone'), 'another link id');
  await assert.rejects(s.open('doc_1'), code('gone'));
  const revoked = await s.revokeLink(d.id, week.link.id, 'h2');
  assert.equal(revoked.revokedBy, 'h2');
  await assert.rejects(s.open(token), code('gone'));
  await assert.rejects(s.revokeLink(d.id, week.link.id, 'h2'), code('conflict'));
  await assert.rejects(s.revokeLink('doc_other', week.link.id, 'h2'), code('not_found'));
});

test('a file that no longer matches its checksum is never handed out', async () => {
  const { s, upload, blobs } = setup();
  const d = await upload();
  const { url } = await s.createLink(d.id, { audience: 'internal' }, 'h');
  (blobs as unknown as { files: Map<string, Uint8Array> }).files.set(d.id, new TextEncoder().encode('%PDF-changed'));
  await assert.rejects(s.open(tokenOf(url)), /does not match its checksum/);
});

test('documents are listed per party, claim or policy, never all at once', async () => {
  const { s, upload } = setup();
  await upload();
  await upload({ partyIds: ['pty_bo'], owner: { policyId: 'pol_2' } });
  assert.equal((await s.list({ partyId: 'pty_anna' })).length, 1);
  await assert.rejects(s.list({}), code('validation'));
});
