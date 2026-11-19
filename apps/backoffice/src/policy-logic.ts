/** Policies, applications and proposals in the back office (ADR 0029, 0031, 0035). Pure; tested with node:test. */
import type { Me } from './permissions.ts';

/**
 * What a search box holds: an id by its prefix, a Swedish personal number, or a
 * microchip. A personal number is searched with POST, never in an address.
 */
export type Search =
  | { kind: 'policy'; id: string }
  | { kind: 'claim'; id: string }
  | { kind: 'application'; id: string }
  | { kind: 'notice'; id: string }
  | { kind: 'animal'; id: string }
  | { kind: 'party'; id: string }
  | { kind: 'personal-number'; value: string }
  | { kind: 'microchip'; value: string }
  | { kind: 'unknown' };

export function parseSearch(input: string): Search {
  const s = input.trim();
  if (/^pol_[A-Za-z0-9]+$/.test(s)) return { kind: 'policy', id: s };
  if (/^clm_[A-Za-z0-9_]+$/.test(s)) return { kind: 'claim', id: s };
  if (/^app_[A-Za-z0-9]+$/.test(s)) return { kind: 'application', id: s };
  if (/^ntc_[A-Za-z0-9]+$/.test(s)) return { kind: 'notice', id: s };
  if (/^ani_[A-Za-z0-9]+$/.test(s)) return { kind: 'animal', id: s };
  if (/^pty_[A-Za-z0-9]{1,64}$/.test(s)) return { kind: 'party', id: s };
  const digits = s.replace(/[\s-]/g, '');
  if (/^\d{15}$/.test(digits)) return { kind: 'microchip', value: digits };
  if (/^(\d{8}|\d{6})[-+]?\d{4}$/.test(s.replace(/\s/g, '')) && /^\d{10}(\d{2})?$/.test(digits)) return { kind: 'personal-number', value: s.replace(/\s/g, '') };
  return { kind: 'unknown' };
}

/** The version of a policy in force on a date, as known now, else the latest. */
export function versionOn<V extends { validFrom: string; validTo: string; sysTo?: string }>(versions: V[], date: string): V | undefined {
  const known = versions.filter((v) => !v.sysTo);
  return known.find((v) => v.validFrom <= date && date < v.validTo) ?? known.at(-1);
}

export interface ApplicationDecisionForm {
  outcome: 'accept' | 'decline';
  note: string;
  reason?: string;
  startDate?: string;
}

/** What stops a decision on a referred application, as message ids. */
export function applicationDecisionProblems(f: ApplicationDecisionForm, today: string): string[] {
  const out: string[] = [];
  if (!f.note.trim()) out.push('application.needNote');
  if (f.outcome === 'decline' && !/^[a-z][a-z0-9-]{1,63}$/.test(f.reason ?? '')) out.push('application.needReason');
  if (f.outcome === 'accept' && f.startDate && f.startDate < today) out.push('application.startInPast');
  return out;
}

export const mayUnderwrite = (me: Me | null, a: { status: string }): boolean => !!me?.permissions.includes('policies:underwrite') && a.status === 'referred';
export const mayWithdraw = (me: Me | null, a: { status: string }): boolean => !!me?.permissions.includes('policies:write') && a.status === 'referred';
export const mayAnswerProposal = (me: Me | null, p: { decision?: unknown }): boolean => !!me?.permissions.includes('policies:write') && !p.decision;

/**
 * Where a search from the top bar goes: a known id opens its page; anything
 * else is looked for among the policies. The query travels in the history
 * state, never in the address, because it may be a personal number.
 */
export function searchTarget(input: string): { path: string; query?: string } {
  const s = parseSearch(input);
  switch (s.kind) {
    case 'policy':
      return { path: `/policies/${encodeURIComponent(s.id)}` };
    case 'claim':
      return { path: `/claims/${encodeURIComponent(s.id)}` };
    case 'application':
      return { path: `/applications/${encodeURIComponent(s.id)}` };
    case 'notice':
      return { path: `/notices/${encodeURIComponent(s.id)}` };
    case 'party':
      return { path: `/parties/${encodeURIComponent(s.id)}` };
    case 'animal':
      return { path: `/animals/${encodeURIComponent(s.id)}` };
    default:
      return { path: '/policies', query: input.trim() };
  }
}

/** A party's name as a person reads it: given and family name, or the organisation's name. */
export function partyName(p: { givenName?: string; familyName?: string; name?: string } | null | undefined): string {
  if (!p) return '';
  return [p.givenName, p.familyName].filter(Boolean).join(' ') || p.name || '';
}
