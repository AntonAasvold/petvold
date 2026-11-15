/**
 * The shared ClaimsStore suite against real Postgres (layer 4, ADR 0012).
 * The store connects as the service role claims_service, so the suite also
 * proves the grants in 0002 are sufficient. The owner empties the tables before each test.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtures } from '@petvold/claims-store-memory';
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
    `truncate claims.journal_line, claims.journal, claims.deductible_period, claims.decision_evidence, claims.review_request, claims.decision_proposal, claims.decision,
              claims.claim_line, claims.claim, claims.outbox, claims.idempotency`,
  );
  return { store: new PostgresClaimsStore(pool) };
});

test('the outbox keeps its order across a digit boundary in the id sequence (9 before 10)', async () => {
  await owner.query(
    `truncate claims.journal_line, claims.journal, claims.deductible_period, claims.decision_evidence, claims.review_request,
              claims.decision_proposal, claims.decision, claims.claim_line, claims.claim, claims.outbox, claims.idempotency`,
  );
  await owner.query(`select setval(pg_get_serial_sequence('claims.outbox', 'id'), 8)`);
  const store = new PostgresClaimsStore(pool);
  for (const id of ['clm_9', 'clm_10', 'clm_11']) {
    const c = fixtures.otitisClaim({ id, claimNo: id });
    await store.saveClaim(c, [{ type: 'claim.registered', occurredAt: c.receivedAt, claim: c }]);
  }
  const pending = await store.pendingEvents(10);
  assert.deepEqual(pending.map((e) => e.id), ['9', '10', '11']);
});
