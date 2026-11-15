/** The shared ProductStore suite against Postgres, as the service role catalog_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresProductStore } from '../src/postgres.ts';
import { productStoreSuite, version } from '../test-suites/product-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.CATALOG_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or CATALOG_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await owner.end();
});

productStoreSuite('PostgresProductStore', async () => {
  await owner.query('truncate catalog.product_version');
  return { store: new PostgresProductStore(pool) };
});

const published = (v: string, salesFrom: string, salesTo?: string) =>
  version(v, {
    status: 'published',
    salesFrom,
    ...(salesTo ? { salesTo } : {}),
    checksum: 'abc',
    submittedBy: 'a@example.test',
    submittedAt: '2026-11-02T10:00:00.000Z',
    publishedBy: 'b@example.test',
    publishedAt: '2026-11-03T10:00:00.000Z',
    revision: 2,
  });

test('the database allows one version of a product on sale per day, and four eyes', async () => {
  await owner.query('truncate catalog.product_version');
  const store = new PostgresProductStore(pool);
  await store.create(version('2026.1', { salesTo: '2026-07-01' }));
  await store.update(published('2026.1', '2026-01-01', '2026-07-01'));
  await store.create(version('2026.2', { salesFrom: '2026-06-01' }));
  await assert.rejects(store.update(published('2026.2', '2026-06-01')), /on sale in the same period/);
  await store.update(published('2026.2', '2026-07-01', '2027-01-01'));
  await store.create(version('2026.3', { salesFrom: '2027-01-01' }));
  await assert.rejects(store.update({ ...published('2026.3', '2027-01-01'), publishedBy: 'a@example.test' }), /product_four_eyes/);
  await assert.rejects(pool.query('delete from catalog.product_version'), /permission denied/);
});
