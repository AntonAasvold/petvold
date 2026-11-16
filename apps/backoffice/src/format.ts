/** Formatting for people, by locale. Pure; tested with node:test. */

/** An amount in minor units, e.g. 150000 SEK -> "1 500,00 kr" in Swedish. */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 10 ** digits);
}

/** A calendar date (YYYY-MM-DD), shown as the date it is everywhere. */
export function formatDate(date: string, locale: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** A point in time, in the viewer's time zone unless one is given. */
export function formatDateTime(at: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(at));
}
