import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySchedulingStore, Scheduler, dailyDue, timeOfDay, validSchedule, type JobDefinition } from '../src/index.ts';

test("the time of day is the market's, also across summer time", () => {
  assert.equal(timeOfDay('2026-11-19T01:30:00Z', 'Europe/Stockholm'), '02:30');
  assert.equal(timeOfDay('2026-07-01T00:30:00Z', 'Europe/Stockholm'), '02:30');
});

test('a daily job is due once a day after its time; a missed day runs once; a time that does not exist runs at the next', () => {
  // 02:00 in Stockholm on 19 November is 01:00 UTC.
  assert.equal(dailyDue('02:00', 'SE', '2026-11-19T00:59:00Z', null), null);
  assert.equal(dailyDue('02:00', 'SE', '2026-11-19T01:00:00Z', null), '2026-11-19');
  assert.equal(dailyDue('02:00', 'SE', '2026-11-19T05:00:00Z', { scheduledFor: '2026-11-19' }), null, 'already run today');
  assert.equal(dailyDue('02:00', 'SE', '2026-11-19T05:00:00Z', { scheduledFor: '2026-11-15' }), '2026-11-19', 'down for days: runs today, once');
  // 29 March 2026: Stockholm goes from 02:00 to 03:00, so 02:30 never comes. At 03:00 (01:00 UTC) it is due.
  assert.equal(dailyDue('02:30', 'SE', '2026-03-29T00:59:00Z', { scheduledFor: '2026-03-28' }), null);
  assert.equal(dailyDue('02:30', 'SE', '2026-03-29T01:00:00Z', { scheduledFor: '2026-03-28' }), '2026-03-29');
});

test('a schedule is a time of day or a number of seconds', () => {
  assert.equal(validSchedule({ kind: 'daily', at: '02:30' }), true);
  assert.equal(validSchedule({ kind: 'daily', at: '24:00' }), false);
  assert.equal(validSchedule({ kind: 'interval', seconds: 0 }), false);
});

function setup(now: { t: string }, jobs: JobDefinition[], holder = 'server-a', store = new InMemorySchedulingStore()) {
  let n = 0;
  const scheduler = new Scheduler({ store, clock: { now: () => now.t }, jobs, markets: async () => ['SE', 'NO'], holder, ids: () => `run_${holder}_${++n}` });
  return { scheduler, store };
}

test('due jobs run once per market and day, and the history says what they did', async () => {
  const now = { t: '2026-11-19T01:30:00Z' };
  const calls: string[] = [];
  const job: JobDefinition = {
    name: 'policies.renewal',
    schedule: { kind: 'daily', at: '02:00' },
    run: async (ctx) => (calls.push(`${ctx.market} ${ctx.onDate} ${ctx.by} ${ctx.dryRun}`), { renewed: 1 }),
  };
  const { scheduler, store } = setup(now, [job]);
  const first = await scheduler.tick();
  assert.deepEqual(calls, ['SE 2026-11-19 scheduler false', 'NO 2026-11-19 scheduler false']);
  assert.deepEqual(first.map((r) => [r.market, r.status, r.scheduledFor, r.result]), [
    ['SE', 'succeeded', '2026-11-19', { renewed: 1 }],
    ['NO', 'succeeded', '2026-11-19', { renewed: 1 }],
  ]);
  now.t = '2026-11-19T09:00:00Z';
  assert.deepEqual(await scheduler.tick(), [], 'once a day');
  assert.equal((await store.listRuns({})).length, 2);
});

test('two servers: only the one with the lease runs a job, and a manual run while it is held is recorded as skipped', async () => {
  const now = { t: '2026-11-19T01:30:00Z' };
  const store = new InMemorySchedulingStore();
  let release!: () => void;
  const slow: JobDefinition = { name: 'parties.retention', schedule: { kind: 'daily', at: '02:00' }, run: () => new Promise((r) => (release = () => r({ due: 0 }))) };
  const a = setup(now, [slow], 'server-a', store).scheduler;
  const b = setup(now, [slow], 'server-b', store).scheduler;
  const running = a.run(slow, 'SE', { trigger: 'schedule', by: 'scheduler', dryRun: false, scheduledFor: '2026-11-19' });
  await new Promise((r) => setImmediate(r));
  assert.equal(await b.run(slow, 'SE', { trigger: 'schedule', by: 'scheduler', dryRun: false, scheduledFor: '2026-11-19' }), null);
  const manual = await b.run(slow, 'SE', { trigger: 'manual', by: 'drift@example.test', dryRun: true });
  assert.deepEqual([manual?.status, manual?.error], ['skipped', 'Another server is running it']);
  release();
  assert.equal((await running)?.status, 'succeeded');
  assert.equal(await store.tryLease('parties.retention:SE', 'server-b', '2026-11-19T02:00:00Z', now.t), true, 'the lease is let go after the run');
});

test('a job that fails is recorded with its error, and the next market still runs', async () => {
  const now = { t: '2026-11-19T01:30:00Z' };
  const job: JobDefinition = {
    name: 'policies.application-expiry',
    schedule: { kind: 'daily', at: '02:00' },
    run: async (ctx) => {
      if (ctx.market === 'SE') throw new Error('No published rules');
      return { expired: 0 };
    },
  };
  const { scheduler } = setup(now, [job]);
  const runs = await scheduler.tick();
  assert.deepEqual(runs.map((r) => [r.market, r.status, r.error]), [
    ['SE', 'failed', 'No published rules'],
    ['NO', 'succeeded', undefined],
  ]);
});

test('history older than 400 days goes once a day', async () => {
  const now = { t: '2026-11-19T01:30:00Z' };
  const store = new InMemorySchedulingStore();
  await store.startRun({ id: 'run_old', job: 'x', market: 'SE', trigger: 'manual', startedBy: 'h', startedAt: '2025-10-01T00:00:00Z', dryRun: false, status: 'skipped', finishedAt: '2025-10-01T00:00:00Z' });
  const { scheduler } = setup(now, [], 'server-a', store);
  await scheduler.tick();
  assert.deepEqual(await store.listRuns({}), []);
});

test("the next run is today at the job's time in the market, or tomorrow when today's is done", async () => {
  const { nextDailyRun, zonedTime } = await import('../src/index.ts');
  assert.equal(zonedTime('2026-11-19', '02:00', 'Europe/Stockholm'), '2026-11-19T01:00:00.000Z');
  assert.equal(zonedTime('2026-07-01', '02:00', 'Europe/Stockholm'), '2026-07-01T00:00:00.000Z');
  assert.equal(nextDailyRun('02:00', 'SE', '2026-11-19T00:30:00.000Z', { scheduledFor: '2026-11-18' }), '2026-11-19T01:00:00.000Z');
  assert.equal(nextDailyRun('02:00', 'SE', '2026-11-19T05:00:00.000Z', { scheduledFor: '2026-11-19' }), '2026-11-20T01:00:00.000Z');
  assert.equal(nextDailyRun('02:00', 'SE', '2026-11-19T05:00:00.000Z', null), '2026-11-19T01:00:00.000Z', 'late: the time it should have run');
});

test('a paused job is skipped by the scheduler until it is resumed', async () => {
  const now = { t: '2026-11-19T01:30:00Z' };
  const calls: string[] = [];
  const job: JobDefinition = { name: 'parties.retention', schedule: { kind: 'daily', at: '02:00' }, run: async (ctx) => (calls.push(ctx.market), {}) };
  const { scheduler, store } = setup(now, [job]);
  await store.pause({ job: job.name, pausedBy: 'd', pausedAt: now.t, reason: 'x' }, { id: 'c1', job: job.name, action: 'pause', by: 'd', at: now.t, reason: 'x' });
  assert.deepEqual(await scheduler.tick(), []);
  await store.resume(job.name, { id: 'c2', job: job.name, action: 'resume', by: 'd', at: now.t, reason: 'y' });
  assert.equal((await scheduler.tick()).length, 2);
  assert.deepEqual(calls, ['SE', 'NO']);
});

test("an approved schedule moves the job's time, and a job turned off is not run", async () => {
  const now = { t: '2026-11-19T01:30:00Z' }; // 02:30 in Stockholm
  const calls: string[] = [];
  const job: JobDefinition = { name: 'policies.renewal', schedule: { kind: 'daily', at: '02:00' }, run: async (ctx) => (calls.push(ctx.market), {}) };
  const { scheduler, store } = setup(now, [job]);
  await store.proposeChange({ id: 'jsc_1', job: job.name, at: '04:00', enabled: true, reason: 'After the batch', proposedBy: 'a', proposedAt: now.t, status: 'pending' });
  await store.approveChange('jsc_1', 'b', now.t);
  assert.deepEqual(await scheduler.schedule(job.name), { kind: 'daily', at: '04:00', enabled: true, version: 1 });
  assert.deepEqual(await scheduler.tick(), [], '04:00 has not come');
  await store.proposeChange({ id: 'jsc_2', job: job.name, at: '04:00', enabled: false, reason: 'Off', proposedBy: 'a', proposedAt: now.t, status: 'pending' });
  await store.approveChange('jsc_2', 'b', now.t);
  now.t = '2026-11-19T05:00:00Z';
  assert.deepEqual(await scheduler.tick(), [], 'turned off');
  assert.deepEqual(calls, []);
});

test('a failed run is told of, and the health shows failed, late and paused jobs', async () => {
  const now = { t: '2026-11-19T01:30:00Z' };
  const failedRuns: string[] = [];
  const store = new InMemorySchedulingStore();
  const failing: JobDefinition = { name: 'policies.renewal', schedule: { kind: 'daily', at: '02:00' }, run: async () => Promise.reject(new Error('No rules')) };
  const late: JobDefinition = { name: 'parties.retention', schedule: { kind: 'daily', at: '01:00' }, run: async () => ({}) };
  const scheduler = new Scheduler({ store, clock: { now: () => now.t }, jobs: [failing, late], markets: async () => ['SE'], holder: 'a', onFailed: async (r) => void failedRuns.push(r.job) });
  await scheduler.run(failing, 'SE', { trigger: 'manual', by: 'd', dryRun: false });
  assert.deepEqual(failedRuns, ['policies.renewal']);
  // 01:00 in Stockholm was 00:00 UTC; at 01:30 UTC it is 90 minutes late.
  const h = await scheduler.health();
  assert.deepEqual(h.failed.map((f) => f.job), ['policies.renewal']);
  assert.deepEqual(h.late.map((l) => [l.job, l.market]), [['parties.retention', 'SE']]);
  await store.pause({ job: 'parties.retention', pausedBy: 'd', pausedAt: now.t, reason: 'x' }, { id: 'c', job: 'parties.retention', action: 'pause', by: 'd', at: now.t, reason: 'x' });
  const paused = await scheduler.health();
  assert.deepEqual([paused.paused, paused.late], [['parties.retention'], []], 'paused is not also late');
});
