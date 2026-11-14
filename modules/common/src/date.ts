/** Kalenderdatum 'YYYY-MM-DD' utan tid och tidszon. */
export type ISODate = string;
/** ISO 8601-tidsstämpel med tidszon. */
export type Timestamp = string;

/** Halvöppet datumintervall [from, to). Utan `to` gäller det tills vidare. */
export interface DateRange {
  from: ISODate;
  to?: ISODate;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Sant bara för datum som finns i kalendern: '2026-02-30' är inte ett datum. */
export function isISODate(d: string): d is ISODate {
  if (!DATE_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

export function assertDate(d: ISODate, field: string): void {
  if (!isISODate(d)) throw new Error(`${field}: ogiltigt datum '${d}', förväntar YYYY-MM-DD`);
}

/** Lägger till dagar på ett ISO-datum, i UTC så att tidszoner inte flyttar dagen. */
export function addDays(d: ISODate, days: number): ISODate {
  const t = Date.parse(`${d}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** ISO-datum jämförs korrekt som strängar. */
export const dateLt = (a: ISODate, b: ISODate) => a < b;
export const dateLte = (a: ISODate, b: ISODate) => a <= b;

export function assertDateRange(r: DateRange, field: string): void {
  assertDate(r.from, `${field}.from`);
  if (r.to !== undefined) {
    assertDate(r.to, `${field}.to`);
    if (!dateLt(r.from, r.to)) throw new Error(`${field}: from (${r.from}) måste vara före to (${r.to})`);
  }
}

export function rangeContains(r: DateRange, d: ISODate): boolean {
  return dateLte(r.from, d) && (r.to === undefined || dateLt(d, r.to));
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return (a.to === undefined || dateLt(b.from, a.to)) && (b.to === undefined || dateLt(a.from, b.to));
}
