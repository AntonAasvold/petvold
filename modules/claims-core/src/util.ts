import { createHash } from 'node:crypto';
import type { ISODate, Ore } from './types.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(d: ISODate, field: string): void {
  if (!DATE_RE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) {
    throw new Error(`${field}: ogiltigt datum '${d}', förväntar YYYY-MM-DD`);
  }
}

export function assertOre(n: Ore, field: string): void {
  if (!Number.isSafeInteger(n)) throw new Error(`${field}: belopp måste vara heltal i öre, fick ${n}`);
}

/** Lägger till dagar på ett ISO-datum, i UTC så att tidszoner inte flyttar dagen. */
export function addDays(d: ISODate, days: number): ISODate {
  const t = Date.parse(`${d}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** ISO-datum jämförs korrekt som strängar. */
export const dateLt = (a: ISODate, b: ISODate) => a < b;
export const dateLte = (a: ISODate, b: ISODate) => a <= b;

/** Halvt uppåt avrundning av ett icke-negativt heltal × baspunkter. */
export function applyBp(amount: Ore, bp: number): Ore {
  if (amount < 0) throw new Error('applyBp förväntar icke-negativt belopp');
  return Math.floor((amount * bp + 5_000) / 10_000);
}

/** Deterministisk JSON (sorterade nycklar) för hash av indata. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Formaterar öre som kronor för meddelanden: 1216500 -> '12 165 kr'. */
export function kr(ore: Ore): string {
  const sign = ore < 0 ? '−' : '';
  const abs = Math.abs(ore);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const cents = abs % 100;
  return `${sign}${whole}${cents ? ',' + String(cents).padStart(2, '0') : ''} kr`;
}
