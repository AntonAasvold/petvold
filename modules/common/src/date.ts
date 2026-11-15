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

/**
 * The time zone each market's calendar follows (IANA names). "Today", deadlines
 * and notice periods count in the market's own days, not in UTC: at 00:30 in
 * Stockholm it is already the next day there, but not in UTC.
 */
export const MARKET_TIME_ZONES: Readonly<Record<string, string>> = {
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki',
  DE: 'Europe/Berlin',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  FR: 'Europe/Paris',
  ES: 'Europe/Madrid',
  IT: 'Europe/Rome',
  AT: 'Europe/Vienna',
  CH: 'Europe/Zurich',
  IE: 'Europe/Dublin',
  GB: 'Europe/London',
  PL: 'Europe/Warsaw',
};

/** The calendar date of a point in time in a time zone. Pure. */
export function dateInTimeZone(at: Timestamp, timeZone: string): ISODate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

/**
 * The market's date at a point in time. A market without a known time zone, or
 * none, counts in UTC. Pure.
 */
export function marketDate(market: string | undefined, at: Timestamp): ISODate {
  const zone = market ? MARKET_TIME_ZONES[market] : undefined;
  return zone ? dateInTimeZone(at, zone) : new Date(at).toISOString().slice(0, 10);
}
