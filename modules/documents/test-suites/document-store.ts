/**
 * The DocumentStore port as tests (ADR 0038). Every implementation runs it with
 * its own factory, and a new one is done when it passes.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentConflictError, type DocumentLink, type DocumentStore, type StoredDocument } from '../src/index.ts';

export type StoreFactory = () => Promise<{ store: DocumentStore; cleanup?: () => Promise<void> }>;

const doc = (id: string, o: Partial<StoredDocument> = {}): StoredDocument => ({
  id,
  kind: 'uploaded',
  mediaType: 'application/pdf',
  size: 1024,
  sha256: 'a'.repeat(64),
  filename: 'invoice.pdf',
  owner: { claimId: 'clm_1', policyId: 'pol_1' },
  partyIds: ['pty_anna'],
  market: 'SE',
  createdBy: 'h@example.test',
  createdAt: '2026-11-20T10:00:00.000Z',
  ...o,
});
const link = (id: string, documentId: string, o: Partial<DocumentLink> = {}): DocumentLink => ({
  id,
  documentId,
  audience: 'internal',
  createdBy: 'h@example.test',
  createdAt: '2026-11-20T10:05:00.000Z',
  expiresAt: '2026-11-20T10:20:00.000Z',
  accesses: [],
  ...o,
});
const lnk = (n: number) => `lnk_${String(n).padStart(24, 'x')}`;

export function documentStoreSuite(name: string, factory: StoreFactory): void {
  describe(`DocumentStore: ${name}`, () => {
    const it = (title: string, fn: (s: DocumentStore) => Promise<void>) =>
      test(title, async () => {
        const h = await factory();
        try {
          await fn(h.store);
        } finally {
          await h.cleanup?.();
        }
      });

    it('a document is read back unchanged, once per id', async (s) => {
      const d = doc('doc_1');
      await s.save(d);
      assert.deepEqual(await s.get('doc_1'), d);
      assert.equal(await s.get('doc_none'), null);
      await assert.rejects(s.save(d), (e: unknown) => e instanceof DocumentConflictError);
      const bare = doc('doc_2', { filename: undefined, owner: { noticeId: 'ntc_1' }, partyIds: [] });
      delete bare.filename;
      await s.save(bare);
      assert.deepEqual(await s.get('doc_2'), bare);
    });

    it('documents are listed per party, claim or policy, newest first', async (s) => {
      await s.save(doc('doc_1'));
      await s.save(doc('doc_2', { createdAt: '2026-11-20T11:00:00.000Z', partyIds: ['pty_anna', 'pty_bo'], owner: { policyId: 'pol_2' } }));
      await s.save(doc('doc_3', { partyIds: ['pty_bo'], owner: { claimId: 'clm_2' } }));
      const ids = async (f: Parameters<DocumentStore['list']>[0]) => (await s.list(f)).map((d) => d.id);
      assert.deepEqual(await ids({ partyId: 'pty_anna' }), ['doc_2', 'doc_1']);
      assert.deepEqual(await ids({ partyId: 'pty_bo' }), ['doc_2', 'doc_3']);
      assert.deepEqual(await ids({ claimId: 'clm_1' }), ['doc_1']);
      assert.deepEqual(await ids({ policyId: 'pol_2' }), ['doc_2']);
      assert.deepEqual(await ids({ partyId: 'pty_none' }), []);
    });

    it('a link keeps every time it was opened, and is revoked once', async (s) => {
      await s.save(doc('doc_1'));
      const l = link(lnk(1), 'doc_1');
      await s.saveLink(l);
      await s.saveLink(link(lnk(2), 'doc_1', { audience: 'customer', createdAt: '2026-11-20T10:06:00.000Z', expiresAt: '2026-11-27T10:06:00.000Z' }));
      await s.logAccess(l.id, '2026-11-20T10:07:00.000Z');
      await s.logAccess(l.id, '2026-11-20T10:08:00.000Z');
      assert.deepEqual(await s.getLink(l.id), { ...l, accesses: ['2026-11-20T10:07:00.000Z', '2026-11-20T10:08:00.000Z'] });
      assert.deepEqual((await s.links('doc_1')).map((x) => x.id), [lnk(2), lnk(1)]);
      await s.revokeLink(l.id, 'h2@example.test', '2026-11-20T10:09:00.000Z');
      const revoked = (await s.getLink(l.id))!;
      assert.deepEqual([revoked.revokedBy, revoked.revokedAt], ['h2@example.test', '2026-11-20T10:09:00.000Z']);
      await assert.rejects(s.revokeLink(l.id, 'h', '2026-11-20T10:10:00.000Z'), (e: unknown) => e instanceof DocumentConflictError);
      assert.equal(await s.getLink(lnk(9)), null);
    });
  });
}
