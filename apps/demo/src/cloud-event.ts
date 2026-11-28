/**
 * The events as Petvold sends them: CloudEvents 1.0 (ADR 0033, asyncapi.yaml).
 * Reading one, its short type, and the fields worth a glance in a list. Pure.
 */
import type { components } from './api/schema.d.ts';

export type CloudEvent = components['schemas']['CloudEvent'] & { sequence?: string };

/** The event, or why the body is not one Petvold sends. */
export function parseCloudEvent(body: string): CloudEvent | string {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return 'The body is not JSON';
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'The body is not an object';
  const e = v as Record<string, unknown>;
  if (e.specversion !== '1.0') return 'specversion is not 1.0';
  for (const k of ['id', 'source', 'type', 'subject', 'time', 'market'] as const) {
    if (typeof e[k] !== 'string' || !e[k]) return `${k} is missing`;
  }
  if (Number.isNaN(Date.parse(e.time as string))) return 'time is not a time';
  if (!e.data || typeof e.data !== 'object' || Array.isArray(e.data)) return 'data is not an object';
  return e as unknown as CloudEvent;
}

/** petvold.policy.issued.v1 → policy.issued. */
export function shortType(type: string): string {
  return type.replace(/^petvold\./, '').replace(/\.v\d+$/, '');
}

/** The full type for a filter: policy.issued or policy.* as a SQL LIKE pattern on the stored type. */
export function typePattern(filter: string): string {
  const f = filter.trim().replace(/^petvold\./, '').replace(/\.v\d+$/, '');
  const escaped = f.replace(/[\\%_]/g, (c) => `\\${c}`);
  return escaped.endsWith('.*') ? `petvold.${escaped.slice(0, -1)}%` : `petvold.${escaped}.v%`;
}

export interface Field {
  key: string;
  value: string;
}

const MONEY_KEYS = /^(amount|payout|refund|premium|premiumAdjustment|total|credited|paid|balance|termPremium|annualPremium)$/;
const ID = /^[a-z]{2,5}_[A-Za-z0-9_]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An amount in minor units in the currency, e.g. 41 200 kr for 4120000 SEK. */
export function formatMoney(amount: number, currency: string): string {
  const f = new Intl.NumberFormat('sv-SE', { style: 'currency', currency });
  return f.format(amount / 10 ** f.resolvedOptions().maximumFractionDigits!);
}

/**
 * Up to `max` fields of the event's data for a list: amounts with their
 * currency, dates, and codes such as a reason. Ids are left out, as the
 * subject already names the object.
 */
export function summary(data: unknown, max = 4): Field[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  const currency = typeof d.currency === 'string' ? d.currency : undefined;
  const out: Field[] = [];
  for (const [key, v] of Object.entries(d)) {
    if (out.length >= max) break;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const m = v as Record<string, unknown>;
      if (Number.isInteger(m.amount) && typeof m.currency === 'string') out.push({ key, value: formatMoney(m.amount as number, m.currency) });
      continue;
    }
    if (typeof v === 'number' && Number.isInteger(v) && currency && MONEY_KEYS.test(key)) {
      out.push({ key, value: formatMoney(v, currency) });
      continue;
    }
    if (typeof v === 'string' && DATE.test(v)) {
      out.push({ key, value: v });
      continue;
    }
    if (typeof v === 'string' && /^(reason|status|outcome|channel|purpose|kind|interval|paymentInterval)$/.test(key) && !ID.test(v)) {
      out.push({ key, value: v });
    }
  }
  return out;
}
