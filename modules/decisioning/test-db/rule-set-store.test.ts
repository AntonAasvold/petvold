/** The shared RuleSetStore suite against Postgres, as the service role decisioning_service. */
import { after } from 'node:test';
import pg from 'pg';
import { PostgresRuleSetStore } from '../src/postgres.ts';
import { ruleSetStoreSuite } from '../test-suites/rule-set-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.DECISIONING_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or DECISIONING_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await owner.end();
});

ruleSetStoreSuite('PostgresRuleSetStore', async () => {
  await owner.query('truncate decisioning.rule_set_version');
  return { store: new PostgresRuleSetStore(pool) };
});
