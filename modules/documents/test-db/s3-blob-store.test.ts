/** The archive against S3: SeaweedFS in docker compose (ADR 0038). Files never change. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { S3BlobStore, s3ConfigFromEnv } from '../src/s3.ts';

const config = s3ConfigFromEnv(process.env);
if (!config) throw new Error('PETVOLD_DOCUMENTS_BUCKET and the S3 settings are required. Copy .env.example to .env and run npm run dev:up.');

test('a file is stored and read back, a missing one is null, and a stored one is never overwritten', async () => {
  const s3 = new S3BlobStore(config);
  try {
    const key = `doc_test_${randomUUID().replaceAll('-', '')}`;
    const bytes = new TextEncoder().encode('%PDF-1.7 test');
    await s3.put(key, bytes, 'application/pdf');
    assert.deepEqual(await s3.get(key), bytes);
    assert.equal(await s3.get(`${key}_missing`), null);
    await assert.rejects(s3.put(key, new TextEncoder().encode('%PDF-1.7 changed'), 'application/pdf'));
    assert.deepEqual(await s3.get(key), bytes);
    await s3.ping();
  } finally {
    s3.destroy();
  }
});
