/**
 * Runs (ADR 0037): when Petvold's background work runs, one server at a time,
 * and what each run did. The jobs themselves live in their modules; the
 * composition root registers them here by name, so this module knows nothing
 * of renewals or retention. It never reads another module's tables (ADR 0001).
 */
import { MARKET_TIME_ZONES, marketDate, type ISODate, type Timestamp } from '@petvold/common';

/**
 * When a job runs: daily at a time of day in each market's time zone, once per
 * market; or every so many seconds. No cron expressions: they are hard to read
 * and change in an interface (ADR 0037).
 */
export type Schedule = { kind: 'daily'; at: string } | { kind: 'interval'; seconds: number };

/** Counts and ids, never personal data: the history is kept for 400 days and shown to anyone with jobs:read. */
export type JobResult = Record<string, unknown>;

export interface JobContext {
  /** The market the run is for. */
  market: string;
  /** The market's date when the run started. */
  onDate: ISODate;
  dryRun: boolean;
  /** Who started it: 'scheduler', or the person who pressed "Run now". */
  by: string;
}

export interface JobDefinition {
  /** e.g. 'policies.renewal'. */
  name: string;
  /** The default; an installation's own schedule comes with ADR 0037 step 4. */
  schedule: Schedule;
  run(ctx: JobContext): Promise<JobResult>;
}

export type RunTrigger = 'schedule' | 'manual' | 'api';
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

export interface JobRun {
  id: string;
  job: string;
  market: string;
  trigger: RunTrigger;
  startedBy: string;
  startedAt: Timestamp;
  /** The market's day a scheduled run was for: a day runs once, also after a restart. */
  scheduledFor?: ISODate;
  dryRun: boolean;
  status: RunStatus;
  finishedAt?: Timestamp;
  result?: JobResult;
  error?: string;
}

export interface RunFilter {
  job?: string;
  market?: string;
  limit?: number;
}

/** An event the relay set aside after too many attempts (ADR 0037). Kept until someone sends it again. */
export interface DeadLetterRecord {
  /** The outbox, e.g. 'claims' or 'policies'. */
  source: string;
  eventId: string;
  attempts: number;
  lastError: string;
  deadAt: Timestamp;
}

export interface SchedulingStore {
  /**
   * Takes or renews the lease on `key` until `until`, if it is free, has run
   * out by `now`, or is already held by `holder`. Atomic: two servers never both
   * get it. Returns whether `holder` holds it now.
   */
  tryLease(key: string, holder: string, until: Timestamp, now: Timestamp): Promise<boolean>;
  /** Lets go of the lease, if `holder` holds it. */
  releaseLease(key: string, holder: string): Promise<void>;
  startRun(run: JobRun): Promise<void>;
  finishRun(id: string, outcome: { status: Exclude<RunStatus, 'running'>; finishedAt: Timestamp; result?: JobResult; error?: string }): Promise<void>;
  /** The latest scheduled run of the job in the market, or null. */
  lastScheduledRun(job: string, market: string): Promise<JobRun | null>;
  /** Runs, newest first. */
  listRuns(filter: RunFilter): Promise<JobRun[]>;
  /** Removes runs that started before `before`. Returns how many. */
  pruneRuns(before: Timestamp): Promise<number>;
  /** Keeps a dead letter; the same event again replaces it. */
  saveDeadLetter(d: DeadLetterRecord): Promise<void>;
  /** Every dead letter, oldest first. */
  deadLetters(): Promise<DeadLetterRecord[]>;
  /** Forgets a dead letter, so the relay tries the event again. Returns whether there was one. */
  removeDeadLetter(source: string, eventId: string): Promise<boolean>;
}

/** How long run history is kept (ADR 0037): a whole year can be compared with the one before. */
export const HISTORY_DAYS = 400;

/** The local time of day, HH:MM in 24 hours, at a point in time in a time zone. Pure. */
export function timeOfDay(at: Timestamp, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('hour')}:${get('minute')}`;
}

/**
 * Whether a daily job is due in a market: its time has come on the market's
 * day, and no scheduled run was made for that day. A time that does not exist
 * one night, e.g. 02:30 when the clocks go forward, runs at the next time that
 * does. A server that was down runs the day once when it starts again. Pure.
 */
export function dailyDue(at: string, market: string, now: Timestamp, last: { scheduledFor?: ISODate } | null): ISODate | null {
  const zone = MARKET_TIME_ZONES[market] ?? 'UTC';
  const today = marketDate(market, now);
  if (timeOfDay(now, zone) < at) return null;
  if (last?.scheduledFor && last.scheduledFor >= today) return null;
  return today;
}

/** A schedule's time of day must be HH:MM. */
export function validSchedule(s: Schedule): boolean {
  return s.kind === 'daily' ? /^([01]\d|2[0-3]):[0-5]\d$/.test(s.at) : Number.isInteger(s.seconds) && s.seconds >= 1;
}

export interface SchedulerDeps {
  store: SchedulingStore;
  clock: { now(): Timestamp };
  jobs: JobDefinition[];
  /** The installation's markets; a daily job runs once per market. */
  markets(): Promise<string[]>;
  /** This server, e.g. its host name and process id, so a lease shows who holds it. */
  holder: string;
  ids?: () => string;
  log?: (line: string) => void;
  /** How long a lease lasts before it must be renewed. Default 10 minutes. */
  leaseMs?: number;
}

/**
 * Runs the daily jobs when they are due, one server at a time per job and
 * market, and keeps the history. The interval jobs (the relay and the webhook
 * worker) come with ADR 0037 step 2.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking: Promise<void> | null = null;
  private prunedOn: ISODate | null = null;
  private readonly leaseMs: number;
  private readonly ids: () => string;

  constructor(private readonly d: SchedulerDeps) {
    for (const j of d.jobs) if (!validSchedule(j.schedule)) throw new Error(`Job ${j.name} has an invalid schedule`);
    this.leaseMs = d.leaseMs ?? 10 * 60_000;
    this.ids = d.ids ?? (() => `run_${crypto.randomUUID().replaceAll('-', '')}`);
  }

  get jobs(): readonly JobDefinition[] {
    return this.d.jobs;
  }

  /** One round: every daily job that is due in a market runs there. Returns the runs it made. */
  async tick(): Promise<JobRun[]> {
    const now = this.d.clock.now();
    const out: JobRun[] = [];
    const markets = await this.d.markets();
    for (const job of this.d.jobs) {
      if (job.schedule.kind !== 'daily') continue;
      for (const market of markets) {
        const day = dailyDue(job.schedule.at, market, now, await this.d.store.lastScheduledRun(job.name, market));
        if (!day) continue;
        const run = await this.run(job, market, { trigger: 'schedule', by: 'scheduler', dryRun: false, scheduledFor: day });
        if (run) out.push(run);
      }
    }
    await this.prune(now);
    return out;
  }

  /**
   * Runs a job in a market now, holding its lease. Returns the run, or null if
   * another server holds the lease: then nothing is stored for a scheduled run,
   * and a manual one is recorded as skipped.
   */
  async run(job: JobDefinition, market: string, how: { trigger: RunTrigger; by: string; dryRun: boolean; scheduledFor?: ISODate }): Promise<JobRun | null> {
    const key = `${job.name}:${market}`;
    const started = this.d.clock.now();
    const run: JobRun = {
      id: this.ids(),
      job: job.name,
      market,
      trigger: how.trigger,
      startedBy: how.by,
      startedAt: started,
      ...(how.scheduledFor ? { scheduledFor: how.scheduledFor } : {}),
      dryRun: how.dryRun,
      status: 'running',
    };
    if (!(await this.d.store.tryLease(key, this.d.holder, this.until(started), started))) {
      if (how.trigger === 'schedule') return null;
      const skipped: JobRun = { ...run, status: 'skipped', finishedAt: started, error: 'Another server is running it' };
      await this.d.store.startRun(skipped);
      return skipped;
    }
    // Renew the lease while the job runs, so a long run keeps it.
    const renew = setInterval(() => void this.d.store.tryLease(key, this.d.holder, this.until(this.d.clock.now()), this.d.clock.now()).catch(() => {}), this.leaseMs / 3);
    try {
      await this.d.store.startRun(run);
      try {
        const result = await job.run({ market, onDate: marketDate(market, started), dryRun: how.dryRun, by: how.by });
        const done = { status: 'succeeded' as const, finishedAt: this.d.clock.now(), result };
        await this.d.store.finishRun(run.id, done);
        return { ...run, ...done };
      } catch (e) {
        const error = String((e as Error).message ?? e).slice(0, 2000);
        const failed = { status: 'failed' as const, finishedAt: this.d.clock.now(), error };
        await this.d.store.finishRun(run.id, failed);
        this.d.log?.(`job ${job.name} in ${market} failed: ${error}`);
        return { ...run, ...failed };
      }
    } finally {
      clearInterval(renew);
      await this.d.store.releaseLease(key, this.d.holder);
    }
  }

  /** Checks once a minute by default; a round never overlaps the one before. */
  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.ticking) return;
      this.ticking = this.tick()
        .then(() => undefined)
        .catch((e: Error) => this.d.log?.(`scheduler: ${e.message}`))
        .finally(() => (this.ticking = null));
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.ticking;
  }

  private until(from: Timestamp): Timestamp {
    return new Date(Date.parse(from) + this.leaseMs).toISOString();
  }

  /** Once a day: history older than HISTORY_DAYS goes. */
  private async prune(now: Timestamp): Promise<void> {
    const today = marketDate(undefined, now);
    if (this.prunedOn === today) return;
    this.prunedOn = today;
    await this.d.store.pruneRuns(new Date(Date.parse(now) - HISTORY_DAYS * 86_400_000).toISOString());
  }
}

/** The store in memory: for tests and the development server. */
export class InMemorySchedulingStore implements SchedulingStore {
  private leases = new Map<string, { holder: string; expiresAt: Timestamp }>();
  private runs: JobRun[] = [];
  private dead = new Map<string, DeadLetterRecord>();

  async tryLease(key: string, holder: string, until: Timestamp, now: Timestamp): Promise<boolean> {
    const l = this.leases.get(key);
    if (l && l.holder !== holder && l.expiresAt >= now) return false;
    this.leases.set(key, { holder, expiresAt: until });
    return true;
  }

  async releaseLease(key: string, holder: string): Promise<void> {
    if (this.leases.get(key)?.holder === holder) this.leases.delete(key);
  }

  async startRun(run: JobRun): Promise<void> {
    if (this.runs.some((r) => r.id === run.id)) throw new Error(`Run ${run.id} exists`);
    this.runs.push(structuredClone(run));
  }

  async finishRun(id: string, outcome: Parameters<SchedulingStore['finishRun']>[1]): Promise<void> {
    const r = this.runs.find((x) => x.id === id);
    if (!r || r.status !== 'running') throw new Error(`Run ${id} is not running`);
    Object.assign(r, structuredClone(outcome));
  }

  async lastScheduledRun(job: string, market: string): Promise<JobRun | null> {
    const found = this.newestFirst().find((r) => r.job === job && r.market === market && r.trigger === 'schedule');
    return found ? structuredClone(found) : null;
  }

  async listRuns(f: RunFilter): Promise<JobRun[]> {
    return this.newestFirst()
      .filter((r) => (!f.job || r.job === f.job) && (!f.market || r.market === f.market))
      .slice(0, f.limit ?? 100)
      .map((r) => structuredClone(r));
  }

  async pruneRuns(before: Timestamp): Promise<number> {
    const n = this.runs.length;
    this.runs = this.runs.filter((r) => r.startedAt >= before);
    return n - this.runs.length;
  }

  async saveDeadLetter(d: DeadLetterRecord): Promise<void> {
    this.dead.set(`${d.source}:${d.eventId}`, structuredClone(d));
  }

  async deadLetters(): Promise<DeadLetterRecord[]> {
    return [...this.dead.values()].sort((a, b) => (a.deadAt < b.deadAt ? -1 : a.deadAt > b.deadAt ? 1 : 0)).map((d) => structuredClone(d));
  }

  async removeDeadLetter(source: string, eventId: string): Promise<boolean> {
    return this.dead.delete(`${source}:${eventId}`);
  }

  private newestFirst(): JobRun[] {
    return [...this.runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : a.id < b.id ? 1 : -1));
  }
}
