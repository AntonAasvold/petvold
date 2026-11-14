/**
 * Den gemensamma sviten för ClaimsStore mot riktig Postgres (lager 4, ADR 0012).
 * Lagringen ansluter som tjänsterollen claims_service, så sviten bevisar också
 * att rättigheterna i 0002 räcker. Tabellerna töms före varje test av ägaren.
 */
import { after } from 'node:test';
import pg from 'pg';
import { claimsStoreSuite } from '@petvold/claims-core/test-suites/claims-store';
import { createPool, PostgresClaimsStore } from '../src/index.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.CLAIMS_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) {
  throw new Error('TEST_DATABASE_URL och CLAIMS_TEST_DATABASE_URL krävs. Kopiera .env.example till .env och kör npm run dev:up.');
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
