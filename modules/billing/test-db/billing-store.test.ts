/** The shared BillingStore suite against Postgres, as the service role billing_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresBillingStore } from '../src/postgres.ts';
import { billingStoreSuite, payer, planRecord } from '../test-suites/billing-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.BILLING_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or BILLING_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await admin.end();
});
const clean = () => admin.query('truncate billing.premium_plan, billing.payer_account cascade');

billingStoreSuite('PostgresBillingStore', async () => {
  await clean();
  return { store: new PostgresBillingStore(pool) };
});

test('accounts and plans never change', async () => {
  await clean();
  const store = new PostgresBillingStore(pool);
  await store.addPlan(payer(), planRecord());
  await assert.rejects(pool.query(`update billing.premium_plan set term_no = 2`), /permission denied/);
  await assert.rejects(pool.query(`delete from billing.payer_account`), /permission denied/);
  await assert.rejects(pool.query(`insert into billing.payer_account (account_id, party_id, market, currency, payment_method, created_at) values ('bac_x', 'pty_x', 'SE', 'SEK', 'cash', now())`), /check/);
});
