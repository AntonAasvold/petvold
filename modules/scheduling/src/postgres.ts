/**
 * SchedulingStore against the Postgres schema `scheduling` (migration 0038),
 * with the module's own role. A lease is taken or renewed in one statement, so
 * two servers never both get it.
 */
import type pg from 'pg';
import type { Timestamp } from '@petvold/common';
import type { DeadLetterRecord, JobRun, RunFilter, SchedulingStore } from './index.ts';

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
