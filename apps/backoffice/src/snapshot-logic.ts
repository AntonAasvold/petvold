/**
 * A policy's snapshot in the back office (ADR 0006): the policy as the claims
 * engine sees it on a day, as it was known at a time. Pure, so it is tested
 * without a browser.
 */

/** A datetime-local value ("2026-11-20T14:30") in the browser's zone as ISO UTC, or null if empty or not a time. */
export function knownAtIso(local: string): string | null {
  if (!local.trim()) return null;
  const t = new Date(local);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** The query for GET /v1/policies/{id}/snapshot, or the problem with the form. */
export function snapshotQuery(date: string, knownAt: string): { date: string; knownAt?: string } | 'date' | 'knownAt' {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'date';
  if (!knownAt.trim()) return { date };
  const iso = knownAtIso(knownAt);
  return iso ? { date, knownAt: iso } : 'knownAt';
}

export interface DeductibleTerms {
  fixed: number;
  fixedPer: 'period' | 'claim' | 'policy_year';
  periodDays?: number;
  variableBp: number;
}

/** "Fixed 2,000.00 per 125-day period, then 25 %": the deductible in parts, the money formatted by the caller. */
export function deductibleParts(d: DeductibleTerms): { fixed: number; per: DeductibleTerms['fixedPer']; periodDays?: number; variablePercent: number } {
  return { fixed: d.fixed, per: d.fixedPer, ...(d.periodDays ? { periodDays: d.periodDays } : {}), variablePercent: d.variableBp / 100 };
}
