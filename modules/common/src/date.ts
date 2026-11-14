/** Calendar date 'YYYY-MM-DD' without time or time zone. */
export type ISODate = string;
/** ISO 8601 timestamp with time zone. */
export type Timestamp = string;

/** Half-open date range [from, to). Without `to` it is open-ended. */
export interface DateRange {
  from: ISODate;
  to?: ISODate;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for dates that exist in the calendar: '2026-02-30' is not a date. */
export function isISODate(d: string): d is ISODate {
  if (!DATE_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

export function assertDate(d: ISODate, field: string): void {
  if (!isISODate(d)) throw new Error(`${field}: invalid date '${d}', expected YYYY-MM-DD`);
}

/** Adds days to an ISO date, in UTC so that time zones never shift the day. */
export function addDays(d: ISODate, days: number): ISODate {
  const t = Date.parse(`${d}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** ISO dates compare correctly as strings. */
export const dateLt = (a: ISODate, b: ISODate) => a < b;
export const dateLte = (a: ISODate, b: ISODate) => a <= b;

export function assertDateRange(r: DateRange, field: string): void {
  assertDate(r.from, `${field}.from`);
  if (r.to !== undefined) {
    assertDate(r.to, `${field}.to`);
    if (!dateLt(r.from, r.to)) throw new Error(`${field}: from (${r.from}) must be before to (${r.to})`);
  }
}

export function rangeContains(r: DateRange, d: ISODate): boolean {
  return dateLte(r.from, d) && (r.to === undefined || dateLt(d, r.to));
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return (a.to === undefined || dateLt(b.from, a.to)) && (b.to === undefined || dateLt(a.from, b.to));
}
