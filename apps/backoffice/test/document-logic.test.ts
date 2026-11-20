import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UPLOAD_BYTES, archiveUrl, archivedDocumentId, openWith, uploadProblems } from '../src/document-logic.ts';

test('an upload is a PDF, JPEG, PNG or HEIC of at most 25 MB (ADR 0038)', () => {
  assert.deepEqual(uploadProblems(null), ['document.needFile']);
  assert.deepEqual(uploadProblems({ size: 1000, type: 'application/pdf' }), []);
  assert.deepEqual(uploadProblems({ size: MAX_UPLOAD_BYTES + 1, type: 'text/html' }), ['document.badType', 'document.tooLarge']);
  assert.deepEqual(uploadProblems({ size: 0, type: 'image/png' }), ['document.empty']);
});

test("a file in Petvold's archive has a urn, and a customer's document opens by where it is", () => {
  assert.equal(archiveUrl('doc_1'), 'urn:petvold:doc:doc_1');
  assert.equal(archivedDocumentId('urn:petvold:doc:doc_1'), 'doc_1');
  assert.equal(archivedDocumentId('https://archive.example.test/x'), null);
  assert.deepEqual(openWith({ source: 'petvold', type: 'attachment', documentId: 'doc_1' }), { kind: 'link', documentId: 'doc_1' });
  assert.deepEqual(openWith({ source: 'insurer', type: 'attachment', url: 'https://archive.example.test/x' }), { kind: 'address', url: 'https://archive.example.test/x' });
  assert.deepEqual(openWith({ source: 'insurer', type: 'attachment', url: 'urn:archive:7c1f' }), { kind: 'reference', id: 'urn:archive:7c1f' });
  assert.deepEqual(openWith({ source: 'insurer', type: 'notice', archiveId: 'arch-1' }), { kind: 'reference', id: 'arch-1' });
  assert.deepEqual(openWith({ source: 'petvold', type: 'attachment', documentId: 'doc_1', erased: true }), { kind: 'none' });
});
