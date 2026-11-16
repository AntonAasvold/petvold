/** Policies, applications and proposals in the back office (ADR 0029, 0031, 0035). Pure; tested with node:test. */
import type { Me } from './permissions.ts';

/**
 * What a search box holds: an id by its prefix, a Swedish personal number, or a
 * microchip. A personal number is searched with POST, never in an address.
 */
export type Search =
  | { kind: 'policy'; id: string }
  | { kind: 'animal'; id: string }
  | { kind: 'party'; id: string }
  | { kind: 'personal-number'; value: string }
  | { kind: 'microchip'; value: string }
  | { kind: 'unknown' };

export function parseSearch(input: string): Search {
  const s = input.trim();
  if (/^pol_[A-Za-z0-9]+$/.test(s)) return { kind: 'policy', id: s };
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
