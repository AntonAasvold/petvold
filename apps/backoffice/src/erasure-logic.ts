/**
 * Erasure in the back office (ADR 0028): who may decide a request, and what a
 * rejection needs. Four eyes: the one who asked never approves. A request from
 * the data subject that is rejected keeps the data restricted until a date
 * (GDPR article 17.3 and 18). Pure; tested with node:test.
 */
import type { Me } from './permissions.ts';

export interface RequestLike {
  basis: 'subject-request' | 'retention-expired';
  requestedBy: string;
  decision?: unknown;
}

/** Approving anonymizes for good: parties:erase, and not the one who asked. */
export const mayApprove = (me: Me | null, r: RequestLike): boolean => !r.decision && !!me?.permissions.includes('parties:erase') && me.subject !== r.requestedBy;

/** Rejecting needs parties:privacy. */
export const mayReject = (me: Me | null, r: RequestLike): boolean => !r.decision && !!me?.permissions.includes('parties:privacy');

/** What a rejection is missing: a reason, and for the data subject's own request a restriction after today. */
export function rejectionProblems(f: { reason: string; restrictUntil: string }, basis: RequestLike['basis'], today: string): string[] {
  const out: string[] = [];
  if (!f.reason.trim()) out.push('settings.needReason');
  if (basis === 'subject-request' && (!f.restrictUntil || f.restrictUntil <= today)) out.push('erasure.needRestriction');
  return out;
}

export function rejectionBody(f: { reason: string; restrictUntil: string }, basis: RequestLike['basis']) {
  return { reason: f.reason.trim(), ...(basis === 'subject-request' && f.restrictUntil ? { restrictUntil: f.restrictUntil } : {}) };
}
