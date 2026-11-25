/**
 * The overview, the back office's start page: what waits for a person, per
 * queue the caller may see, and how operations and the bookkeeping stand.
 * Pure, so it is tested without a browser. The counts come from the queues'
 * own lists, as the menu counts them.
 */
import { can, type Me } from './permissions.ts';

export interface Queue {
  key: string;
  /** Where the queue opens in the back office. */
  href: string;
  /** The list call and its filter that gives what waits. */
  api: string;
  query: Record<string, string | boolean>;
  permission: string;
  /** The group on the page. */
  group: 'claims' | 'policies' | 'money' | 'operations';
}

/** Every queue, in the order the work usually comes. */
export const QUEUES: Queue[] = [
  { key: 'claims.decide', href: '/claims?tab=awaiting-decision', api: '/v1/claims', query: { status: 'awaiting-decision' }, permission: 'claims:read', group: 'claims' },
  { key: 'claims.approve', href: '/claims?tab=awaiting-approval', api: '/v1/claims', query: { status: 'awaiting-approval' }, permission: 'claims:approve', group: 'claims' },
  { key: 'claims.review', href: '/claims?tab=review-requested', api: '/v1/claims', query: { status: 'review-requested' }, permission: 'claims:read', group: 'claims' },
  { key: 'applications', href: '/applications', api: '/v1/applications', query: { status: 'referred' }, permission: 'policies:read', group: 'policies' },
  { key: 'proposals', href: '/proposals', api: '/v1/policy-proposals', query: { status: 'pending' }, permission: 'policies:read', group: 'policies' },
  { key: 'notices', href: '/notices', api: '/v1/notices', query: { attention: true }, permission: 'notices:read', group: 'policies' },
  { key: 'money.unmatched', href: '/money?tab=unmatched', api: '/v1/received-payments', query: { status: 'unmatched' }, permission: 'billing:read', group: 'money' },
  { key: 'money.held', href: '/money?tab=held', api: '/v1/payouts', query: { status: 'held' }, permission: 'payments:read', group: 'money' },
  { key: 'money.awaiting', href: '/money?tab=awaiting', api: '/v1/payouts', query: { status: 'awaiting-details' }, permission: 'payments:read', group: 'money' },
  { key: 'money.proposals', href: '/money?tab=proposals', api: '/v1/credit-proposals', query: { status: 'proposed' }, permission: 'billing:read', group: 'money' },
  { key: 'money.recoveries', href: '/money?tab=recoveries', api: '/v1/recoveries', query: { status: 'proposed' }, permission: 'billing:read', group: 'money' },
  { key: 'erasures', href: '/erasures', api: '/v1/erasure-requests', query: { status: 'pending' }, permission: 'parties:privacy', group: 'operations' },
  { key: 'webhooks', href: '/webhooks', api: '/v1/webhook-deliveries', query: { status: 'dead' }, permission: 'webhooks:read', group: 'operations' },
  { key: 'jobs', href: '/jobs', api: '/v1/relay-dead-letters', query: {}, permission: 'jobs:read', group: 'operations' },
];

/** The queues the caller may see, in order. */
export const queuesFor = (me: Me | null): Queue[] => QUEUES.filter((q) => can(me, q.permission));

/** Queues with something waiting first, each group kept in its order otherwise. A count of '' (unknown) counts as nothing. Pure. */
export function ordered<T extends { queue: Queue; count: string }>(rows: readonly T[]): T[] {
  const waiting = (c: string) => c !== '' && c !== '0';
  return [...rows].sort((a, b) => Number(waiting(b.count)) - Number(waiting(a.count)));
}

/** The jobs whose last run failed in some market, with the markets. Pure. */
export function failedJobs(jobs: readonly { id: string; markets: readonly { market: string; lastRun?: { status: string } }[] }[]): { id: string; markets: string[] }[] {
  return jobs.flatMap((j) => {
    const markets = j.markets.filter((m) => m.lastRun?.status === 'failed').map((m) => m.market);
    return markets.length ? [{ id: j.id, markets }] : [];
  });
}

/** The tab a URL asks for, if it is one of the view's. Pure. */
export function tabFromUrl<T extends string>(search: string, tabs: readonly T[]): T | null {
  const t = new URLSearchParams(search).get('tab');
  return t && (tabs as readonly string[]).includes(t) ? (t as T) : null;
}
