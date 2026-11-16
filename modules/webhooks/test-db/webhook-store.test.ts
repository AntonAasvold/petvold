/** The shared WebhookStore suite against Postgres, as the service role webhooks_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresWebhookStore } from '../src/postgres.ts';
import { delivery, subscription, webhookStoreSuite } from '../test-suites/webhook-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.WEBHOOKS_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or WEBHOOKS_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await admin.end();
});
const clean = () => admin.query('truncate webhooks.delivery, webhooks.subscription cascade');

webhookStoreSuite('PostgresWebhookStore', async () => {
  await clean();
  return { store: new PostgresWebhookStore(pool) };
});

test('two workers never claim the same delivery', async () => {
  await clean();
  const store = new PostgresWebhookStore(pool);
  await store.createSubscription(subscription(1));
  await store.enqueue(Array.from({ length: 20 }, (_, i) => delivery(i + 1)));
  const now = '2026-11-16T10:00:00.000Z';
  const lease = '2026-11-16T10:01:00.000Z';
  const [a, b] = await Promise.all([store.claimDue(now, 15, lease), store.claimDue(now, 15, lease)]);
  const ids = [...a, ...b].map((d) => d.id);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
  await assert.rejects(pool.query(`delete from webhooks.delivery`), /permission denied/);
});
