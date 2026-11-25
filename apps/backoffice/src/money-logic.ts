/**
 * The money queues in the back office (ADR 0040, steg 8): payments that came
 * in without a usable reference, payouts held for new payee details, and
 * credit notes and write-offs above the proposer's limit. Pure, so it is
 * tested without a browser. The API decides every call; this only hides what
 * would be refused and checks a form before it is sent.
 */
import { can, type Me } from './permissions.ts';

export type MoneyTab = 'unmatched' | 'held' | 'awaiting' | 'proposals' | 'clinics' | 'files';

const TAB_PERMISSION: Record<MoneyTab, string> = { unmatched: 'billing:read', held: 'payments:read', awaiting: 'payments:read', proposals: 'billing:read', clinics: 'payments:read', files: 'payments:read' };

/** The tabs the caller may read, in order. */
export const moneyTabs = (me: Me | null): MoneyTab[] => (['unmatched', 'held', 'awaiting', 'proposals', 'clinics', 'files'] as const).filter((t) => can(me, TAB_PERMISSION[t]));

export interface MatchForm {
  /** A payer account (bac_…) or an invoice (inv_…). */
  target: string;
  note: string;
}

export type MatchProblem = 'target' | 'note';

/** What is wrong with a match before it is sent. */
export function matchProblems(form: MatchForm): MatchProblem[] {
  const out: MatchProblem[] = [];
  if (!/^(bac|inv)_[A-Za-z0-9]+$/.test(form.target.trim())) out.push('target');
  if (form.note.trim().length > 2000) out.push('note');
  return out;
}

/** The body of POST /v1/received-payments/{id}/matches. */
export function matchBody(form: MatchForm): { accountId?: string; invoiceId?: string; note?: string } {
  const target = form.target.trim();
  const note = form.note.trim();
  return { ...(target.startsWith('inv_') ? { invoiceId: target } : { accountId: target }), ...(note ? { note } : {}) };
}

/** A payout may be released when it is held and the caller has payments:release. Whether they gave the details, the API decides. */
export const mayRelease = (p: { status: string }, me: Me | null): boolean => p.status === 'held' && can(me, 'payments:release');

/** When the payout was held, from its last held step. */
export function heldSince(p: { steps: readonly { status: string; at: string }[] }): string | undefined {
  return [...p.steps].reverse().find((s) => s.status === 'held')?.at;
}

/** A proposal may be approved or returned by someone with billing:credit who did not propose it (four eyes). Their limit, the API decides. */
export const mayDecideProposal = (p: { status: string; proposedBy: string }, me: Me | null): boolean =>
  p.status === 'proposed' && can(me, 'billing:credit') && p.proposedBy !== me?.subject;

/** A returned proposal needs a reason, at most 2,000 characters. */
export const returnReasonOk = (reason: string): boolean => reason.trim().length > 0 && reason.trim().length <= 2000;
