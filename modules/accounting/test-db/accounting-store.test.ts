/** The shared AccountingStore suite against Postgres, as the service role accounting_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresAccountingStore } from '../src/postgres.ts';
import { accountingStoreSuite, verificationOf } from '../test-suites/accounting-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.ACCOUNTING_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or ACCOUNTING_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await admin.end();
});
const clean = () => admin.query('truncate accounting.verification_line, accounting.verification, accounting.verification_number_series cascade');

accountingStoreSuite('PostgresAccountingStore', async () => {
  await clean();
  return { store: new PostgresAccountingStore(pool) };
});

test('a verification never changes, and a line is debit or credit', async () => {
  await clean();
  const store = new PostgresAccountingStore(pool);
  await store.add('SE', 2026, (no) => verificationOf(no));
  await assert.rejects(pool.query(`update accounting.verification set text = 'x'`), /permission denied/);
  await assert.rejects(pool.query(`delete from accounting.verification_line`), /permission denied/);
  await assert.rejects(store.add('SE', 2026, (no) => verificationOf(no, { id: 'ver_bad', source: { ...verificationOf(1).source, eventId: 'e_bad' }, lines: [{ account: 'bank', debit: 5, credit: 5 }] })), /check/);
});
