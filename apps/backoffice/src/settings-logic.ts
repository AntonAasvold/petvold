/** Settings in the back office: roles and limits, retention and notice texts (ADR 0020, 0028, 0032). Pure; tested with node:test. */

/** Minor units per major unit for a currency, e.g. 100 for SEK. */
export const minorPerMajor = (currency: string): number => 10 ** (new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2);

/** "25 000" or "25000,50" in major units to minor units, or null if it is not an amount. */
export function toMinorUnits(text: string, currency: string): number | null {
  const s = text.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const minor = Math.round(Number(s) * minorPerMajor(currency));
  return Number.isSafeInteger(minor) ? minor : null;
}

export type RoleDefinitions = Record<string, { permissions: string[]; bindsTo?: 'clinic' | 'policies'; decisionLimits?: Record<string, number>; approvalLimits?: Record<string, number> }>;

/**
 * The roles with one limit changed. null removes the currency; a role that then
 * has no limits of that kind loses the field, which means no limit (ADR 0019).
 */
export function withLimit(roles: RoleDefinitions, role: string, kind: 'decisionLimits' | 'approvalLimits', currency: string, minor: number | null): RoleDefinitions {
  const out = structuredClone(roles);
  const def = out[role];
  if (!def) return out;
  const limits = { ...(def[kind] ?? {}) };
  if (minor === null) delete limits[currency];
  else limits[currency] = minor;
  if (Object.keys(limits).length) def[kind] = limits;
  else delete def[kind];
  return out;
}

/** What stops a change of the retention settings, as message ids. */
export function retentionProblems(rows: { market: string; years: string }[], reason: string): string[] {
  const out: string[] = [];
  if (rows.some((r) => !/^[A-Z]{2}$/.test(r.market))) out.push('settings.badMarket');
  if (rows.some((r) => !/^\d+$/.test(r.years) || Number(r.years) < 1 || Number(r.years) > 100)) out.push('settings.badYears');
  if (new Set(rows.map((r) => r.market)).size !== rows.length) out.push('settings.repeatedMarket');
  if (!reason.trim()) out.push('settings.needReason');
  return out;
}

export interface NoticeMarketForm {
  promptlyDays: string;
  disabledTypes: string[];
  texts: Record<string, { sender: string; review: string }>;
}

/** What stops a change of the notice settings, as message ids. */
export function noticeSettingsProblems(f: NoticeMarketForm, reason: string): string[] {
  const out: string[] = [];
  if (f.promptlyDays && (!/^\d+$/.test(f.promptlyDays) || Number(f.promptlyDays) < 1 || Number(f.promptlyDays) > 30)) out.push('settings.badPromptly');
  if (!reason.trim()) out.push('settings.needReason');
  return out;
}

/** A market's notice settings from the form: empty fields are left out. */
export function noticeMarketSettings(f: NoticeMarketForm): { promptlyDays?: number; disabledTypes?: string[]; texts?: Record<string, { sender?: string; review?: string }> } {
  const texts = Object.fromEntries(
    Object.entries(f.texts)
      .map(([lang, t]) => [lang, { ...(t.sender.trim() ? { sender: t.sender.trim() } : {}), ...(t.review.trim() ? { review: t.review.trim() } : {}) }] as const)
      .filter(([, t]) => Object.keys(t).length),
  );
  return {
    ...(f.promptlyDays ? { promptlyDays: Number(f.promptlyDays) } : {}),
    ...(f.disabledTypes.length ? { disabledTypes: [...f.disabledTypes].sort() } : {}),
    ...(Object.keys(texts).length ? { texts } : {}),
  };
}
