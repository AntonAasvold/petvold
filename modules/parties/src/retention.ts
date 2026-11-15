/**
 * Retention (ADR 0028): how long a party is kept after its last relation, per
 * market, as versioned settings; and a run that asks for every party whose
 * retention has ended to be anonymized. Someone else still approves each one.
 *
 * Other modules tell when a party last had a relation through ActivitySource,
 * so this module never reads their tables (ADR 0001).
 */
import { PartyConflictError, PartyError, type ISODate, type PartyService } from './index.ts';

export interface RetentionRule {
  /** Whole years after the last relation. */
  years: number;
}

export interface RetentionSettings {
  /** 1, 2, 3 … Version 1 comes from the installation's defaults. */
  version: number;
  /** Market -> rule. A market without a rule is never erased automatically. */
  markets: Record<string, RetentionRule>;
  changedBy: string;
  changedAt: string;
  reason: string;
}

/**
 * Petvold's suggestion; the insurer is responsible for the values.
 * Sweden: ten years, the time limit for claims in the Insurance Contracts Act
 * (2005:104) chapter 7 section 4, which also covers the seven years of the
 * Accounting Act (1999:1078) chapter 7 section 2.
 */
export const DEFAULT_RETENTION: Record<string, RetentionRule> = { SE: { years: 10 } };

export interface RetentionStore {
  current(): Promise<RetentionSettings | null>;
  /** Oldest first. */
  versions(): Promise<RetentionSettings[]>;
  /** Throws PartyConflictError unless it is the next version. */
  append(settings: RetentionSettings): Promise<void>;
}

/**
 * A party's relations in one module: still ongoing (e.g. owns an animal today),
 * ended on a date, or none.
 */
export type Activity = { ongoing: true } | { lastDate: ISODate } | null;

export interface ActivitySource {
  /** For the run's report, e.g. 'animals'. */
  name: string;
  activityOf(partyId: string): Promise<Activity>;
}

export interface RetentionRunResult {
  onDate: ISODate;
  dryRun: boolean;
  settingsVersion: number;
  checked: number;
  /** Parties whose retention has ended. With dryRun false, each got a request. */
  due: { partyId: string; market: string; lastActivity: ISODate; retainedUntil: ISODate; requestId?: string }[];
  /** Parties kept because a relation is ongoing. */
  ongoing: number;
  /** Parties kept because the retention has not ended. */
  withinRetention: number;
  /** Parties skipped because they already have an undecided request. */
  pendingRequest: number;
  /** Markets with parties but no retention rule. */
  marketsWithoutRule: string[];
}

export interface RetentionDeps {
  parties: PartyService;
  settings: RetentionStore;
  sources: ActivitySource[];
  clock: { now(): string };
  /** Version 1 when nothing is stored. Defaults to DEFAULT_RETENTION. */
  defaults?: Record<string, RetentionRule>;
}

/** The date `years` whole years later. 29 February moves to 1 March. Pure. */
export function addYears(date: ISODate, years: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** The latest of the activities, or ongoing if any is. Pure. */
export function combine(activities: Activity[]): Activity {
  if (activities.some((a) => a !== null && 'ongoing' in a)) return { ongoing: true };
  const dates = activities.flatMap((a) => (a && 'lastDate' in a ? [a.lastDate] : [])).sort();
  return dates.length ? { lastDate: dates.at(-1)! } : null;
}

export class RetentionService {
  constructor(private readonly d: RetentionDeps) {}

  async current(): Promise<RetentionSettings> {
    const cur = await this.d.settings.current();
    if (cur) return cur;
    const first: RetentionSettings = {
      version: 1,
      markets: structuredClone(this.d.defaults ?? DEFAULT_RETENTION),
      changedBy: 'petvold-defaults',
      changedAt: this.d.clock.now(),
      reason: 'Petvold default retention (ADR 0028)',
    };
    await this.d.settings.append(first).catch((e: unknown) => {
      if (!(e instanceof PartyConflictError)) throw e; // someone else stored version 1 first
    });
    return (await this.d.settings.current())!;
  }

  async versions(): Promise<RetentionSettings[]> {
    await this.current();
    return this.d.settings.versions();
  }

  async change(input: { markets: Record<string, RetentionRule>; basedOnVersion: number; reason: string }, by: string): Promise<RetentionSettings> {
    const cur = await this.current();
    if (cur.version !== input.basedOnVersion) throw new PartyError('conflict', `The retention settings are at version ${cur.version}, not ${input.basedOnVersion}`);
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new PartyError('validation', 'A reason is required');
    for (const [market, rule] of Object.entries(input.markets ?? {})) {
      if (!/^[A-Z]{2}$/.test(market)) throw new PartyError('validation', `Invalid market '${market}'`);
      if (!Number.isInteger(rule?.years) || rule.years < 1 || rule.years > 100) {
        throw new PartyError('validation', `Retention for ${market} must be 1-100 whole years`);
      }
    }
    const next: RetentionSettings = {
      version: cur.version + 1,
      markets: structuredClone(input.markets),
      changedBy: by,
      changedAt: this.d.clock.now(),
      reason,
    };
    await this.d.settings.append(next).catch((e: unknown) => {
      if (e instanceof PartyConflictError) throw new PartyError('conflict', e.message);
      throw e;
    });
    return next;
  }

  /** When the party last had a relation anywhere, including changes to the party itself. */
  async activityOf(partyId: string): Promise<Activity> {
    const p = await this.d.parties.get(partyId);
    const own: Activity = { lastDate: p.changedAt.slice(0, 10) };
    return combine([own, ...(await Promise.all(this.d.sources.map((s) => s.activityOf(partyId))))]);
  }

  /**
   * Finds every party in `markets` whose retention has ended and, unless dryRun,
   * asks for it to be anonymized as `by`. Someone else approves each request.
   */
  async run(input: { dryRun: boolean; markets: '*' | ReadonlySet<string> }, by: string): Promise<RetentionRunResult> {
    const settings = await this.current();
    const onDate = this.d.clock.now().slice(0, 10);
    const pending = new Set((await this.d.parties.listErasureRequests({ pending: true })).map((r) => r.partyId));
    const result: RetentionRunResult = {
      onDate,
      dryRun: input.dryRun,
      settingsVersion: settings.version,
      checked: 0,
      due: [],
      ongoing: 0,
      withinRetention: 0,
      pendingRequest: 0,
      marketsWithoutRule: [],
    };
    const without = new Set<string>();
    for (const id of await this.d.parties.partyIds()) {
      const p = await this.d.parties.get(id);
      if (p.anonymized || (input.markets !== '*' && !input.markets.has(p.market))) continue;
      result.checked++;
      const rule = settings.markets[p.market];
      if (!rule) {
        without.add(p.market);
        continue;
      }
      if (pending.has(id)) {
        result.pendingRequest++;
        continue;
      }
      const activity = await this.activityOf(id);
      if (activity && 'ongoing' in activity) {
        result.ongoing++;
        continue;
      }
      const lastActivity = activity?.lastDate ?? p.changedAt.slice(0, 10);
      const retainedUntil = addYears(lastActivity, rule.years);
      if (retainedUntil >= onDate) {
        result.withinRetention++;
        continue;
      }
      const due: RetentionRunResult['due'][number] = { partyId: id, market: p.market, lastActivity, retainedUntil };
      if (!input.dryRun) {
        const r = await this.d.parties.requestErasure(
          id,
          { basis: 'retention-expired', reason: `Retention of ${rule.years} years after ${lastActivity} ended ${retainedUntil} (settings version ${settings.version})` },
          by,
        );
        due.requestId = r.id;
      }
      result.due.push(due);
    }
    result.marketsWithoutRule = [...without].sort();
    return result;
  }
}

export class InMemoryRetentionStore implements RetentionStore {
  private list: RetentionSettings[] = [];

  async current() {
    return structuredClone(this.list.at(-1) ?? null);
  }

  async versions() {
    return structuredClone(this.list);
  }

  async append(s: RetentionSettings) {
    if (s.version !== (this.list.at(-1)?.version ?? 0) + 1) throw new PartyConflictError(`Retention settings version ${s.version} is not the next`);
    this.list.push(structuredClone(s));
  }
}
