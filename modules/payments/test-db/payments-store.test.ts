/** The shared PaymentsStore suite against Postgres, as the service role payments_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresPaymentsStore } from '../src/postgres.ts';
import { succeeded } from '../src/index.ts';
import { paymentOf, paymentsStoreSuite } from '../test-suites/payments-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.PAYMENTS_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or PAYMENTS_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await admin.end();
});
const clean = () => admin.query('truncate payments.outbox, payments.payment cascade');

paymentsStoreSuite('PostgresPaymentsStore', async () => {
  await clean();
  return { store: new PostgresPaymentsStore(pool) };
});

test('a payment never changes, and the amount is above zero', async () => {
  await clean();
  const store = new PostgresPaymentsStore(pool);
  await store.addPayment(paymentOf(1), succeeded('evt_1', paymentOf(1)));
  await assert.rejects(pool.query(`update payments.payment set amount = 1`), /permission denied/);
  await assert.rejects(pool.query(`delete from payments.payment`), /permission denied/);
  await assert.rejects(pool.query(`update payments.outbox set data = '{}'`), /permission denied/);
  const zero = paymentOf(2, { amount: 0 });
  await assert.rejects(store.addPayment(zero, succeeded('evt_2', zero)), /check/);
  assert.equal((await store.pendingEvents(10)).length, 1);
});
