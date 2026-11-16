/** Notices and webhooks in the back office (ADR 0032, 0033). Pure; tested with node:test. */
import type { Me } from './permissions.ts';

/** Splits a comma or space separated list, without empties or repeats. */
export function parseList(input: string): string[] {
  return [...new Set(input.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
}

export interface SubscriptionForm {
  url: string;
  eventTypes: string;
  markets: string;
  description?: string;
}

/** What stops a subscription before it is sent, as message ids. The API checks it again, e.g. private addresses. */
export function subscriptionProblems(f: SubscriptionForm): string[] {
  const out: string[] = [];
  let url: URL | null = null;
  try {
    url = new URL(f.url.trim());
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) out.push('webhooks.needHttps');
  const types = parseList(f.eventTypes);
  if (!types.length || !types.every((t) => /^(\*|[a-z]+\.(\*|[a-z_]+))$/.test(t))) out.push('webhooks.needTypes');
  const markets = parseList(f.markets);
  if (!(markets.length === 1 && markets[0] === '*') && (!markets.length || !markets.every((m) => /^[A-Z]{2}$/.test(m)))) out.push('webhooks.needMarkets');
  return out;
}

/** The request body for a subscription form. */
export function subscriptionBody(f: SubscriptionForm): { url: string; eventTypes: string[]; markets: string[] | '*'; description?: string } {
  const markets = parseList(f.markets);
  return {
    url: f.url.trim(),
    eventTypes: parseList(f.eventTypes),
    markets: markets.length === 1 && markets[0] === '*' ? '*' : markets,
    ...(f.description?.trim() ? { description: f.description.trim() } : {}),
  };
}

/** The flags of a notice that need a person, in the order they matter. */
export function noticeFlags(n: { status: string; overdue?: boolean; late?: boolean; incomplete?: string[] }): ('failed' | 'overdue' | 'incomplete' | 'late')[] {
  return [
    ...(n.status === 'failed' ? (['failed'] as const) : []),
    ...(n.overdue ? (['overdue'] as const) : []),
    ...(n.incomplete?.length && n.status !== 'sent' ? (['incomplete'] as const) : []),
    ...(n.late ? (['late'] as const) : []),
  ];
}

export const mayManageWebhooks = (me: Me | null): boolean => !!me?.permissions.includes('webhooks:manage');
export const mayReportDelivery = (me: Me | null): boolean => !!me?.permissions.includes('notices:deliver');
