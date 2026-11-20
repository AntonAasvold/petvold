import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentBody, attachmentProblems, emptyAttachment, formatSize, mayAddAttachment, replacedIds } from '../src/attachment-logic.ts';
import { claimHistory } from '../src/history.ts';

const me = (permissions: string[]) => ({ subject: 'h', roles: [], permissions, scope: { markets: '*' as const } });

test('an attachment needs an archive address, a sha256, a media type and a size (ADR 0036)', () => {
  assert.deepEqual(attachmentProblems({ ...emptyAttachment(), url: 'http://x', sha256: 'abc', mediaType: 'pdf', size: '0' }), [
    'attachment.badUrl',
    'attachment.badSha',
    'attachment.badMediaType',
    'attachment.badSize',
  ]);
  const f = { ...emptyAttachment(), url: ' urn:archive:7c1f ', sha256: 'A'.repeat(64), size: '1024' };
  assert.deepEqual(attachmentProblems(f), []);
  assert.deepEqual(attachmentBody(f), { kind: 'invoice', url: 'urn:archive:7c1f', sha256: 'a'.repeat(64), mediaType: 'application/pdf', size: 1024 });
  assert.equal(attachmentBody({ ...f, replaces: 'att_1' }).replaces, 'att_1');
});

test('who may add, which are replaced, sizes for people, and the history', () => {
  assert.equal(mayAddAttachment(me(['claims:register']), 'decided'), true);
  assert.equal(mayAddAttachment(me(['claims:register']), 'withdrawn'), false);
  assert.equal(mayAddAttachment(me(['claims:read']), 'decided'), false);
  assert.deepEqual([...replacedIds([{}, { replaces: 'att_1' }])], ['att_1']);
  assert.deepEqual([formatSize(900), formatSize(184_320), formatSize(3_500_000)], ['900 B', '180 kB', '3.3 MB']);
  const h = claimHistory({
    claim: { receivedAt: '2026-11-01T08:00:00Z', channel: 'customer' },
    decisions: [],
    proposals: [],
    reviews: [],
    attachments: [{ id: 'att_1', kind: 'invoice', addedBy: 'h', addedAt: '2026-11-02T08:00:00Z' }],
  });
  assert.deepEqual(h.map((e) => e.type), ['claim.attachment_added', 'claim.received']);
});
