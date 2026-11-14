import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPool, PostgresIdempotencyStore } from '../src/index.ts';

const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
const pool = createPool(process.env.CLAIMS_TEST_DATABASE_URL!, { max: 2 });
after(async () => {
  await pool.end();
  await owner.end();
});
beforeEach(() => owner.query('truncate claims.idempotency'));

test('a stored response is read back unchanged', async () => {
  const store = new PostgresIdempotencyStore(pool);
  const value = { fingerprint: '{"a":1}', status: 201, body: { claim: { id: 'clm_1' }, decision: null } };
  await store.put('klinik-001:POST:/v1/claims:key-1', value);
  assert.deepEqual(await store.get('klinik-001:POST:/v1/claims:key-1'), value);
});

test('an unknown key gives null', async () => {
  assert.equal(await new PostgresIdempotencyStore(pool).get('missing'), null);
});

test('the first response for a key wins', async () => {
  const store = new PostgresIdempotencyStore(pool);
  await store.put('k', { fingerprint: 'f1', status: 201, body: { n: 1 } });
  await store.put('k', { fingerprint: 'f2', status: 409, body: { n: 2 } });
  assert.deepEqual(await store.get('k'), { fingerprint: 'f1', status: 201, body: { n: 1 } });
});

test('an empty body (204) is stored as null', async () => {
  const store = new PostgresIdempotencyStore(pool);
  await store.put('k204', { fingerprint: 'f', status: 204, body: null });
  assert.deepEqual(await store.get('k204'), { fingerprint: 'f', status: 204, body: null });
});
