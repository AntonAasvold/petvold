/** Formatting for people, by locale. Pure; tested with node:test. */

/**
 * An amount in minor units, as the design system writes it: "1 500 kr" in
 * Swedish (minor units only when there are any), "SEK 1,500.00" in English.
 */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const whole = minor % 10 ** digits === 0;
  const sv = locale.startsWith('sv');
  return new Intl.NumberFormat(locale, { style: 'currency', currency, ...(sv && whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}) }).format(minor / 10 ** digits);
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

/** A time as logs show it, "2026-11-13 14:32" in local time: ISO order, the same in every language. */
export function formatLogTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
