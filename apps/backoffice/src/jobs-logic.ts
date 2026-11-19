/**
 * The runs in the back office (ADR 0037): the rows of the list, a run's result
 * in a line, and what pausing needs. Pure; tested with node:test. The API
 * decides every call.
 */
import type { Me } from './permissions.ts';

export interface JobLike {
  id: string;
  schedule: { kind: 'daily' | 'interval'; at?: string; seconds?: number; enabled?: boolean };
  paused?: { pausedBy: string; pausedAt: string; reason: string };
  markets: { market: string; nextRunAt?: string; lastRun?: { status: string; startedAt: string; finishedAt?: string } }[];
}

/** One row per job and market, jobs in the order the API gave and markets as they come. */
export function jobRows<J extends JobLike>(jobs: J[]): (J['markets'][number] & { job: J })[] {
  return jobs.flatMap((job) => (job.markets.length ? job.markets.map((m) => ({ ...m, job })) : [{ market: '–', job }]));
}

/** A run's result in a line: "renewed 3 · checked 10". Lists become their length; ids are left out. */
export function resultLine(result: Record<string, unknown> | undefined): string {
  if (!result) return '';
  return Object.entries(result)
    .filter(([k]) => !k.endsWith('Ids'))
    .map(([k, v]) => `${k} ${Array.isArray(v) ? v.length : typeof v === 'object' && v !== null ? '…' : String(v)}`)
    .join(' · ');
}

/** Whether the caller may run, pause and resume jobs and send dead letters again. */
export const mayOperateJobs = (me: Me | null): boolean => !!me?.permissions.includes('jobs:operate');

/** What a pause or a resume needs, as message ids. */
export function controlProblems(reason: string): string[] {
  return reason.trim() ? [] : ['settings.needReason'];
}

/** A scheduled run is late when its time passed more than a few minutes ago: the scheduler checks once a minute. */
export function isLate(nextRunAt: string, now: string): boolean {
  return Date.parse(now) - Date.parse(nextRunAt) > 5 * 60_000;
}

/** Whether the caller may propose and approve schedule changes (four eyes are the API's check). */
export const mayConfigureJobs = (me: Me | null): boolean => !!me?.permissions.includes('jobs:configure');

/** Whether the caller may approve a change: with jobs:configure, and not their own (four eyes). */
export const mayApproveChange = (me: Me | null, change: { proposedBy: string; status: string }): boolean =>
  mayConfigureJobs(me) && change.status === 'pending' && change.proposedBy !== me!.subject;

/** What a schedule change needs, as message ids. */
export function scheduleChangeProblems(f: { at: string; reason: string }): string[] {
  const out: string[] = [];
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.at)) out.push('jobs.badTime');
  if (!f.reason.trim()) out.push('settings.needReason');
  return out;
}
