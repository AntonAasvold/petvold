/**
 * The contract every SchedulingStore keeps (ADR 0037): run against memory in
 * test/ and against Postgres in test-db/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { JobRun, SchedulingStore } from '../src/index.ts';

export type StoreFactory = () => Promise<{ store: SchedulingStore; cleanup?: () => Promise<void> }>;

const run = (id: string, o: Partial<JobRun> = {}): JobRun => ({
  id,
  job: 'policies.renewal',
  market: 'SE',
  trigger: 'schedule',
  startedBy: 'scheduler',
  startedAt: '2026-11-19T01:00:00.000Z',
  scheduledFor: '2026-11-19',
  dryRun: false,
  status: 'running',
  ...o,
});

export function schedulingStoreSuite(name: string, factory: StoreFactory): void {
  describe(`SchedulingStore: ${name}`, () => {
    const it = (title: string, fn: (s: SchedulingStore) => Promise<void>) =>
      test(title, async () => {
        const h = await factory();
        try {
          await fn(h.store);
        } finally {
          await h.cleanup?.();
        }
      });

    it('a lease goes to one holder until it runs out or is let go', async (s) => {
      const now = '2026-11-19T01:00:00.000Z';
      assert.equal(await s.tryLease('policies.renewal:SE', 'a', '2026-11-19T01:10:00.000Z', now), true);
      assert.equal(await s.tryLease('policies.renewal:SE', 'b', '2026-11-19T01:10:00.000Z', now), false, 'held by a');
      assert.equal(await s.tryLease('policies.renewal:SE', 'a', '2026-11-19T01:20:00.000Z', now), true, 'a renews it');
      assert.equal(await s.tryLease('policies.renewal:NO', 'b', '2026-11-19T01:10:00.000Z', now), true, 'another key');
      assert.equal(await s.tryLease('policies.renewal:SE', 'b', '2026-11-19T01:40:00.000Z', '2026-11-19T01:30:00.000Z'), true, 'run out');
      await s.releaseLease('policies.renewal:SE', 'a');
      assert.equal(await s.tryLease('policies.renewal:SE', 'c', '2026-11-19T01:40:00.000Z', '2026-11-19T01:31:00.000Z'), false, 'a cannot let go of what b holds');
      await s.releaseLease('policies.renewal:SE', 'b');
      assert.equal(await s.tryLease('policies.renewal:SE', 'c', '2026-11-19T01:40:00.000Z', '2026-11-19T01:31:00.000Z'), true);
    });

    it('two holders at once never both get a lease', async (s) => {
      const now = '2026-11-19T01:00:00.000Z';
      const got = await Promise.all(Array.from({ length: 8 }, (_, i) => s.tryLease('k', `h${i}`, '2026-11-19T01:10:00.000Z', now)));
      assert.equal(got.filter(Boolean).length, 1);
    });

    it('a run is read back as started and as finished, with its result', async (s) => {
      const r = run('run_1');
      await s.startRun(r);
      assert.deepEqual(await s.listRuns({}), [r]);
      const done = { status: 'succeeded' as const, finishedAt: '2026-11-19T01:00:05.000Z', result: { renewed: 3, needsDecision: ['pol_a'] } };
      await s.finishRun('run_1', done);
      assert.deepEqual(await s.listRuns({ job: 'policies.renewal' }), [{ ...r, ...done }]);
      await assert.rejects(s.finishRun('run_1', done), 'a run finishes once');
      const failed = run('run_2', { trigger: 'manual', startedBy: 'drift@example.test', scheduledFor: undefined, dryRun: true, startedAt: '2026-11-19T02:00:00.000Z' });
      delete failed.scheduledFor;
      await s.startRun(failed);
      await s.finishRun('run_2', { status: 'failed', finishedAt: '2026-11-19T02:00:01.000Z', error: 'Rules missing' });
      const [latest] = await s.listRuns({ limit: 1 });
      assert.deepEqual([latest!.id, latest!.status, latest!.error, latest!.dryRun, 'scheduledFor' in latest!], ['run_2', 'failed', 'Rules missing', true, false]);
    });

    it('the latest scheduled run is per job and market, and manual runs do not count', async (s) => {
      await s.startRun(run('run_a', { scheduledFor: '2026-11-18', startedAt: '2026-11-18T01:00:00.000Z' }));
      await s.startRun(run('run_b', { scheduledFor: '2026-11-19', startedAt: '2026-11-19T01:00:00.000Z' }));
      await s.startRun(run('run_c', { market: 'NO', scheduledFor: '2026-11-19' }));
      const manual = run('run_d', { trigger: 'manual', startedAt: '2026-11-19T03:00:00.000Z' });
      delete manual.scheduledFor;
      await s.startRun(manual);
      assert.equal((await s.lastScheduledRun('policies.renewal', 'SE'))?.id, 'run_b');
      assert.equal((await s.lastScheduledRun('policies.renewal', 'DK')), null);
      assert.deepEqual((await s.listRuns({ market: 'SE' })).map((r) => r.id), ['run_d', 'run_b', 'run_a']);
    });

    it('a job is paused once and resumed once, and both are in the trail', async (s) => {
      const pause = { job: 'parties.retention', pausedBy: 'drift@example.test', pausedAt: '2026-11-19T08:00:00.000Z', reason: 'Wrong rule for NO' };
      await s.pause(pause, { id: 'ctl_1', job: pause.job, action: 'pause', by: pause.pausedBy, at: pause.pausedAt, reason: pause.reason });
      assert.deepEqual(await s.pauses(), [pause]);
      await assert.rejects(s.pause(pause, { id: 'ctl_x', job: pause.job, action: 'pause', by: 'b', at: pause.pausedAt, reason: 'again' }), /paused already/);
      await s.resume(pause.job, { id: 'ctl_2', job: pause.job, action: 'resume', by: 'b@example.test', at: '2026-11-19T09:00:00.000Z', reason: 'Rule fixed' });
      await assert.rejects(s.resume(pause.job, { id: 'ctl_y', job: pause.job, action: 'resume', by: 'b', at: '2026-11-19T09:00:00.000Z', reason: 'x' }), /not paused/);
      assert.deepEqual(await s.pauses(), []);
      assert.deepEqual((await s.controls(pause.job, 10)).map((c) => [c.id, c.action, c.by, c.reason]), [
        ['ctl_2', 'resume', 'b@example.test', 'Rule fixed'],
        ['ctl_1', 'pause', 'drift@example.test', 'Wrong rule for NO'],
      ]);
      assert.deepEqual(await s.controls('policies.renewal', 10), []);
    });

    it('a dead letter is kept until it is removed, and the same event replaces it', async (s) => {
      await s.saveDeadLetter({ source: 'claims', eventId: '7', attempts: 10, lastError: 'timeout', deadAt: '2026-11-19T10:00:00.000Z' });
      await s.saveDeadLetter({ source: 'policies', eventId: '3', attempts: 10, lastError: 'boom', deadAt: '2026-11-19T09:00:00.000Z' });
      await s.saveDeadLetter({ source: 'claims', eventId: '7', attempts: 12, lastError: 'still timeout', deadAt: '2026-11-19T11:00:00.000Z' });
      assert.deepEqual(await s.deadLetters(), [
        { source: 'policies', eventId: '3', attempts: 10, lastError: 'boom', deadAt: '2026-11-19T09:00:00.000Z' },
        { source: 'claims', eventId: '7', attempts: 12, lastError: 'still timeout', deadAt: '2026-11-19T11:00:00.000Z' },
      ]);
      assert.equal(await s.removeDeadLetter('claims', '7'), true);
      assert.equal(await s.removeDeadLetter('claims', '7'), false);
      assert.deepEqual((await s.deadLetters()).map((d) => d.eventId), ['3']);
    });

    it('history before a point in time is pruned', async (s) => {
      await s.startRun(run('run_old', { startedAt: '2025-10-01T01:00:00.000Z', scheduledFor: '2025-10-01' }));
      await s.startRun(run('run_new'));
      assert.equal(await s.pruneRuns('2025-10-15T00:00:00.000Z'), 1);
      assert.deepEqual((await s.listRuns({})).map((r) => r.id), ['run_new']);
    });
  });
}
