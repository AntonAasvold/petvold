/** The DocumentStore suite against Postgres, as the service role documents_service (migration 0046). */
import { after } from 'node:test';
import pg from 'pg';
import { PostgresDocumentStore } from '../src/postgres.ts';
import { documentStoreSuite } from '../test-suites/document-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.DOCUMENTS_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL and DOCUMENTS_TEST_DATABASE_URL are required. Copy .env.example to .env and run npm run dev:up.');

const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 2 });
after(async () => {
  await pool.end();
  await owner.end();
});

documentStoreSuite('PostgresDocumentStore', async () => {
  await owner.query('truncate documents.link_access, documents.link, documents.document');
  return { store: new PostgresDocumentStore(pool) };
});
