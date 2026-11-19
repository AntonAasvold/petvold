/**
 * SchedulingStore against the Postgres schema `scheduling` (migration 0038),
 * with the module's own role. A lease is taken or renewed in one statement, so
 * two servers never both get it.
 */
import type pg from 'pg';
import type { Timestamp } from '@petvold/common';
import { JobConflictError, JobError, type DeadLetterRecord, type JobControl, type JobPause, type JobRun, type JobSetting, type RunFilter, type ScheduleChange, type SchedulingStore } from './index.ts';

/** A timestamp as an ISO string, whether pg gave a Date or another module set a parser that gives a string. */
const iso = (v: Date | string | null): string | undefined => (v === null ? undefined : new Date(v).toISOString());

export class PostgresSchedulingStore implements SchedulingStore {
  constructor(private readonly pool: pg.Pool) {}

  async tryLease(key: string, holder: string, until: Timestamp, now: Timestamp): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `insert into scheduling.lease (key, holder, expires_at) values ($1, $2, $3)
       on conflict (key) do update set holder = excluded.holder, expires_at = excluded.expires_at
         where scheduling.lease.expires_at < $4 or scheduling.lease.holder = excluded.holder`,
      [key, holder, until, now],
    );
    return rowCount === 1;
  }

  async releaseLease(key: string, holder: string): Promise<void> {
    await this.pool.query('delete from scheduling.lease where key = $1 and holder = $2', [key, holder]);
  }

  async startRun(r: JobRun): Promise<void> {
    await this.pool.query(
      `insert into scheduling.run (id, job, market, trigger, started_by, started_at, scheduled_for, dry_run, status, finished_at, result, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [r.id, r.job, r.market, r.trigger, r.startedBy, r.startedAt, r.scheduledFor ?? null, r.dryRun, r.status, r.finishedAt ?? null, r.result === undefined ? null : JSON.stringify(r.result), r.error ?? null],
    );
  }

  async finishRun(id: string, o: Parameters<SchedulingStore['finishRun']>[1]): Promise<void> {
    const { rowCount } = await this.pool.query(
      `update scheduling.run set status = $2, finished_at = $3, result = $4, error = $5 where id = $1 and status = 'running'`,
      [id, o.status, o.finishedAt, o.result === undefined ? null : JSON.stringify(o.result), o.error ?? null],
    );
    if (rowCount !== 1) throw new Error(`Run ${id} is not running`);
  }

  async lastScheduledRun(job: string, market: string): Promise<JobRun | null> {
    const { rows } = await this.pool.query(
      `select * from scheduling.run where job = $1 and market = $2 and trigger = 'schedule' order by started_at desc, id desc limit 1`,
      [job, market],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async listRuns(f: RunFilter): Promise<JobRun[]> {
    const { rows } = await this.pool.query(
      `select * from scheduling.run
       where ($1::text is null or job = $1) and ($2::text is null or market = $2)
       order by started_at desc, id desc limit $3`,
      [f.job ?? null, f.market ?? null, f.limit ?? 100],
    );
    return rows.map(toRun);
  }

  async pruneRuns(before: Timestamp): Promise<number> {
    const { rowCount } = await this.pool.query('delete from scheduling.run where started_at < $1', [before]);
    return rowCount ?? 0;
  }

  async pause(p: JobPause, log: JobControl): Promise<void> {
    await this.tx(async (db) => {
      const { rowCount } = await db.query(
        `insert into scheduling.job_pause (job, paused_by, paused_at, reason) values ($1, $2, $3, $4) on conflict (job) do nothing`,
        [p.job, p.pausedBy, p.pausedAt, p.reason],
      );
      if (rowCount !== 1) throw new JobConflictError(`${p.job} is paused already`);
      await insertControl(db, log);
    });
  }

  async resume(job: string, log: JobControl): Promise<void> {
    await this.tx(async (db) => {
      const { rowCount } = await db.query('delete from scheduling.job_pause where job = $1', [job]);
      if (rowCount !== 1) throw new JobConflictError(`${job} is not paused`);
      await insertControl(db, log);
    });
  }

  async pauses(): Promise<JobPause[]> {
    const { rows } = await this.pool.query('select * from scheduling.job_pause order by job');
    return rows.map((r) => ({ job: r.job, pausedBy: r.paused_by, pausedAt: iso(r.paused_at)!, reason: r.reason }));
  }

  async controls(job: string, limit: number): Promise<JobControl[]> {
    const { rows } = await this.pool.query('select * from scheduling.job_control where job = $1 order by at desc, id desc limit $2', [job, limit]);
    return rows.map((r) => ({ id: r.id, job: r.job, action: r.action, by: r.by_whom, at: iso(r.at)!, reason: r.reason }));
  }

  async proposeChange(c: ScheduleChange): Promise<void> {
    try {
      await this.pool.query(
        `insert into scheduling.job_schedule_change (id, job, at, enabled, reason, proposed_by, proposed_at, status) values ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
        [c.id, c.job, c.at, c.enabled, c.reason, c.proposedBy, c.proposedAt],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new JobConflictError(`${c.job} already has a change waiting for approval`);
      throw e;
    }
  }

  async getChange(id: string): Promise<ScheduleChange | null> {
    const { rows } = await this.pool.query('select * from scheduling.job_schedule_change where id = $1', [id]);
    return rows[0] ? toChange(rows[0]) : null;
  }

  async changes(job: string, limit: number): Promise<ScheduleChange[]> {
    const { rows } = await this.pool.query('select * from scheduling.job_schedule_change where job = $1 order by proposed_at desc, id desc limit $2', [job, limit]);
    return rows.map(toChange);
  }

  async approveChange(id: string, by: string, at: Timestamp): Promise<JobSetting> {
    let setting!: JobSetting;
    await this.tx(async (db) => {
      const { rows } = await db.query('select * from scheduling.job_schedule_change where id = $1 for update', [id]);
      const c = rows[0] ? toChange(rows[0]) : null;
      if (!c || c.status !== 'pending') throw new JobConflictError(`Change ${id} is not waiting for approval`);
      if (c.proposedBy === by) throw new JobError('forbidden', 'Someone else must approve the change');
      await db.query(`update scheduling.job_schedule_change set status = 'approved', decided_by = $2, decided_at = $3 where id = $1`, [id, by, at]);
      const { rows: s } = await db.query(
        `insert into scheduling.job_setting (job, at, enabled, version, reason, proposed_by, approved_by, changed_at) values ($1, $2, $3, 1, $4, $5, $6, $7)
         on conflict (job) do update set at = excluded.at, enabled = excluded.enabled, version = scheduling.job_setting.version + 1,
           reason = excluded.reason, proposed_by = excluded.proposed_by, approved_by = excluded.approved_by, changed_at = excluded.changed_at
         returning *`,
        [c.job, c.at, c.enabled, c.reason, c.proposedBy, by, at],
      );
      setting = toSetting(s[0]);
    });
    return setting;
  }

  async rejectChange(id: string, by: string, at: Timestamp, reason: string): Promise<ScheduleChange> {
    const { rows } = await this.pool.query(
      `update scheduling.job_schedule_change set status = 'rejected', decided_by = $2, decided_at = $3, decision_reason = $4 where id = $1 and status = 'pending' returning *`,
      [id, by, at, reason],
    );
    if (!rows[0]) throw new JobConflictError(`Change ${id} is not waiting for approval`);
    return toChange(rows[0]);
  }

  async settings(): Promise<JobSetting[]> {
    const { rows } = await this.pool.query('select * from scheduling.job_setting order by job');
    return rows.map(toSetting);
  }

  private async tx(fn: (db: pg.PoolClient) => Promise<void>): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      await fn(db);
      await db.query('commit');
    } catch (e) {
      await db.query('rollback');
      throw e;
    } finally {
      db.release();
    }
  }

  async saveDeadLetter(d: DeadLetterRecord): Promise<void> {
    await this.pool.query(
      `insert into scheduling.relay_dead_letter (source, event_id, attempts, last_error, dead_at) values ($1, $2, $3, $4, $5)
       on conflict (source, event_id) do update set attempts = excluded.attempts, last_error = excluded.last_error, dead_at = excluded.dead_at`,
      [d.source, d.eventId, d.attempts, d.lastError, d.deadAt],
    );
  }

  async deadLetters(): Promise<DeadLetterRecord[]> {
    const { rows } = await this.pool.query('select * from scheduling.relay_dead_letter order by dead_at, source, event_id');
    return rows.map((r) => ({ source: r.source, eventId: r.event_id, attempts: r.attempts, lastError: r.last_error, deadAt: iso(r.dead_at)! }));
  }

  async removeDeadLetter(source: string, eventId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('delete from scheduling.relay_dead_letter where source = $1 and event_id = $2', [source, eventId]);
    return rowCount === 1;
  }
}

function toChange(r: Record<string, any>): ScheduleChange {
  return {
    id: r.id,
    job: r.job,
    at: r.at,
    enabled: r.enabled,
    reason: r.reason,
    proposedBy: r.proposed_by,
    proposedAt: iso(r.proposed_at)!,
    status: r.status,
    ...(r.decided_by === null ? {} : { decidedBy: r.decided_by }),
    ...(r.decided_at === null ? {} : { decidedAt: iso(r.decided_at)! }),
    ...(r.decision_reason === null ? {} : { decisionReason: r.decision_reason }),
  };
}

function toSetting(r: Record<string, any>): JobSetting {
  return { job: r.job, at: r.at, enabled: r.enabled, version: r.version, reason: r.reason, proposedBy: r.proposed_by, approvedBy: r.approved_by, changedAt: iso(r.changed_at)! };
}

async function insertControl(db: pg.PoolClient, c: JobControl): Promise<void> {
  await db.query('insert into scheduling.job_control (id, job, action, by_whom, at, reason) values ($1, $2, $3, $4, $5, $6)', [c.id, c.job, c.action, c.by, c.at, c.reason]);
}

function toRun(r: Record<string, any>): JobRun {
  const finishedAt = iso(r.finished_at);
  return {
    id: r.id,
    job: r.job,
    market: r.market,
    trigger: r.trigger,
    startedBy: r.started_by,
    startedAt: iso(r.started_at)!,
    ...(r.scheduled_for === null ? {} : { scheduledFor: dateOnly(r.scheduled_for) }),
    dryRun: r.dry_run,
    status: r.status,
    ...(finishedAt ? { finishedAt } : {}),
    ...(r.result === null ? {} : { result: r.result }),
    ...(r.error === null ? {} : { error: r.error }),
  };
}

/** A date column as YYYY-MM-DD, whatever time zone the driver read it in. */
function dateOnly(v: Date | string): string {
  if (typeof v === 'string') return v.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
}
