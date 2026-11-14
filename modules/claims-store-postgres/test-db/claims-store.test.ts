/**
 * The shared ClaimsStore suite against real Postgres (layer 4, ADR 0012).
 * The store connects as the service role claims_service, so the suite also
 * proves the grants in 0002 are sufficient. The owner empties the tables before each test.
 */
import { after } from 'node:test';
import pg from 'pg';
import { claimsStoreSuite } from '@petvold/claims-core/test-suites/claims-store';
import { createPool, PostgresClaimsStore } from '../src/index.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.CLAIMS_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) {
  throw new Error('TEST_DATABASE_URL and CLAIMS_TEST_DATABASE_URL are required. Copy .env.example to .env and run npm run dev:up.');
}

const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = createPool(serviceUrl, { max: 4 });
after(async () => {
  await pool.end();
  await owner.end();
});

claimsStoreSuite('PostgresClaimsStore', async () => {
  await owner.query(
    `truncate claims.journal_line, claims.journal, claims.deductible_period, claims.decision,
              claims.claim_line, claims.claim, claims.outbox, claims.idempotency`,
  );
  return { store: new PostgresClaimsStore(pool) };
});
