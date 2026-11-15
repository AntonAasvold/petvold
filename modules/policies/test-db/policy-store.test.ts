/** The shared PolicyStore suite against Postgres, as the service role policies_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresPolicyStore } from '../src/postgres.ts';
import { issued, policyStoreSuite } from '../test-suites/policy-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.POLICIES_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or POLICIES_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await admin.end();
});
const clean = () => admin.query('truncate policies.proposal_decision, policies.proposal, policies.outbox, policies.policy_version, policies.term, policies.policy_transaction, policies.policy cascade');

policyStoreSuite('PostgresPolicyStore', async () => {
  await clean();
  return { store: new PostgresPolicyStore(pool) };
});

test('the database keeps terms and versions', async () => {
  await clean();
  const store = new PostgresPolicyStore(pool);
  const t = issued();
  await store.issue(t.policy, t.term, t.version, t.transaction, []);
  await assert.rejects(pool.query(`update policies.term set premium = 1`), /permission denied/);
  await assert.rejects(pool.query(`delete from policies.policy_version`), /permission denied/);
  await assert.rejects(pool.query(`update policies.policy_version set sys_to = sys_from`), /check/);
  await pool.query(`update policies.policy_version set sys_to = sys_from + interval '1 day'`);
  await assert.rejects(pool.query(`update policies.policy_version set sys_to = sys_from + interval '2 days'`), /Only the end of a version/);
});
