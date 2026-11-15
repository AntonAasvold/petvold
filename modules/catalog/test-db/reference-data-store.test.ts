/** The shared ReferenceDataStore suite against Postgres, as the service role catalog_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresReferenceDataStore } from '../src/postgres.ts';
import { item, referenceDataStoreSuite } from '../test-suites/reference-data-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.CATALOG_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or CATALOG_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await owner.end();
});

referenceDataStoreSuite('PostgresReferenceDataStore', async () => {
  await owner.query('truncate catalog.reference_item');
  return { store: new PostgresReferenceDataStore(pool) };
});

test('the database keeps the history: the service role cannot change or delete a revision', async () => {
  await owner.query('truncate catalog.reference_item');
  const store = new PostgresReferenceDataStore(pool);
  await store.append(item());
  await assert.rejects(pool.query(`update catalog.reference_item set labels = '{"en":"Wolf"}'`), /permission denied/);
  await assert.rejects(pool.query('delete from catalog.reference_item'), /permission denied/);
});

test('the database refuses a breed without an existing species, and a changed species', async () => {
  await owner.query('truncate catalog.reference_item');
  const store = new PostgresReferenceDataStore(pool);
  const breed = item({ kind: 'breed', code: 'dog-beagle', parent: 'dog', labels: { en: 'Beagle' } });
  await assert.rejects(store.append(breed), /Species dog does not exist/);
  await store.append(item());
  await store.append(item({ code: 'cat', labels: { en: 'Cat' } }));
  await store.append(breed);
  await assert.rejects(store.append({ ...breed, revision: 2, parent: 'cat', reason: 'Wrong' }), /cannot change/);
  await assert.rejects(store.append(item({ kind: 'sex', code: 'male', parent: 'dog', labels: { en: 'Male' } })), /reference_item_parent/);
});
