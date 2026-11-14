/** The shared RoleConfigStore suite against Postgres, as the service role access_service. */
import { after } from 'node:test';
import pg from 'pg';
import { PostgresRoleConfigStore } from '../src/postgres.ts';
import { roleConfigStoreSuite } from '../test-suites/role-config-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.ACCESS_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or ACCESS_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await owner.end();
});

roleConfigStoreSuite('PostgresRoleConfigStore', async () => {
  await owner.query('truncate access.role_config');
  return { store: new PostgresRoleConfigStore(pool) };
});
