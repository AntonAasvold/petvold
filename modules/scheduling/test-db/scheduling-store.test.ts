/** The shared SchedulingStore suite against Postgres, as the service role scheduling_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresSchedulingStore } from '../src/postgres.ts';
import { schedulingStoreSuite } from '../test-suites/scheduling-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.SCHEDULING_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or SCHEDULING_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 8 });
after(async () => {
  await pool.end();
  await admin.end();
});

schedulingStoreSuite('PostgresSchedulingStore', async () => {
  await admin.query('truncate scheduling.lease, scheduling.run, scheduling.relay_dead_letter, scheduling.job_pause, scheduling.job_control, scheduling.job_setting, scheduling.job_schedule_change');
  return { store: new PostgresSchedulingStore(pool) };
});

test('the service role cannot change what a run was, only how it finished', async () => {
  await admin.query('truncate scheduling.run');
  const store = new PostgresSchedulingStore(pool);
  await store.startRun({ id: 'run_x', job: 'policies.renewal', market: 'SE', trigger: 'manual', startedBy: 'h', startedAt: '2026-11-19T01:00:00Z', dryRun: false, status: 'running' });
  await assert.rejects(pool.query(`update scheduling.run set started_by = 'someone else' where id = 'run_x'`), /permission denied/);
  await assert.rejects(pool.query(`update scheduling.run set trigger = 'schedule' where id = 'run_x'`), /permission denied/);
  // A finished run must say when; a scheduled one must say for which day.
  await assert.rejects(pool.query(`update scheduling.run set status = 'succeeded' where id = 'run_x'`), /run_finished/);
  await assert.rejects(
    store.startRun({ id: 'run_y', job: 'x', market: 'SE', trigger: 'schedule', startedBy: 'scheduler', startedAt: '2026-11-19T01:00:00Z', dryRun: false, status: 'running' }),
    /run_scheduled_day/,
  );
});
