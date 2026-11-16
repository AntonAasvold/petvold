/** The shared NoticeStore suite against Postgres, as the service role communications_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresNoticeStore } from '../src/postgres.ts';
import { notice, noticeStoreSuite, sent } from '../test-suites/notice-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.COMMUNICATIONS_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or COMMUNICATIONS_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await admin.end();
});
const clean = () => admin.query('truncate communications.delivery, communications.notice cascade');

noticeStoreSuite('PostgresNoticeStore', async () => {
  await clean();
  return { store: new PostgresNoticeStore(pool) };
});

test('notices and deliveries never change, and a delivery must be complete', async () => {
  await clean();
  const store = new PostgresNoticeStore(pool);
  await store.add(notice());
  await store.addDelivery('ntc_1', sent(1));
  await assert.rejects(pool.query(`update communications.notice set due_by = '2027-01-01'`), /permission denied/);
  await assert.rejects(pool.query(`delete from communications.delivery`), /permission denied/);
  await assert.rejects(
    pool.query(`insert into communications.delivery (delivery_id, notice_id, outcome, reported_by, reported_at) values ('ndl_x', 'ntc_1', 'sent', 'x', now())`),
    /check/,
  );
  await assert.rejects(store.add(notice(2, { policyId: undefined })), /check/);
});
