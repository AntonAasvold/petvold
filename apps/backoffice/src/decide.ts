/**
 * What the claim view lets a person do, and what a decision needs (ADR 0018,
 * 0019). The API decides every call; this only shows the right form and stops
 * an incomplete one before it is sent. Pure; tested with node:test.
 */
import type { Me } from './permissions.ts';

export type Action = 'accept' | 'reject';
export type Outcome = 'approved' | 'partial' | 'rejected';
export const DEVIATION_CODES = ['pre_existing_condition', 'not_covered', 'insufficient_documentation', 'incorrect_invoice', 'other'] as const;
export type DeviationCode = (typeof DEVIATION_CODES)[number];

/** The action the assessment proposes. */
export const proposedAction = (o: Outcome): Action => (o === 'rejected' ? 'reject' : 'accept');

/** Whether deciding so goes against the proposal: then a reason code and a reason are needed, and claims:override. */
export const deviates = (action: Action, proposed: Outcome): boolean => action !== proposedAction(proposed);

export interface DecisionForm {
  action: Action;
  reasonCode?: DeviationCode | '';
  reason?: string;
}

/** A reason is needed to reject, and to go against the proposal. */
export const needsReason = (action: Action, proposed: Outcome): boolean => action === 'reject' || deviates(action, proposed);

/** What is missing or not allowed in a decision, as message ids. Empty: it may be sent. */
export function decisionProblems(f: DecisionForm, proposed: Outcome, me: Me | null): string[] {
  const out: string[] = [];
  if (deviates(f.action, proposed)) {
    if (!me?.permissions.includes('claims:override')) out.push('decide.noOverride');
    if (!f.reasonCode) out.push('decide.needCode');
  }
  if (needsReason(f.action, proposed) && !f.reason?.trim()) out.push('decide.needReason');
  return out;
}

/** A claim may be decided when it waits for a decision or a review, by someone with claims:decide. */
export const mayDecide = (me: Me | null, status: string): boolean =>
  !!me?.permissions.includes('claims:decide') && (status === 'awaiting-decision' || status === 'review-requested');

/** An open proposal may be approved or returned by someone with claims:approve who did not make it (four eyes). */
export const mayApprove = (me: Me | null, p: { status: string; proposedBy: string }): boolean =>
  !!me?.permissions.includes('claims:approve') && p.status === 'open' && p.proposedBy !== me.subject;

/** A review may be asked for on an automated decision that has no open request. */
export const mayRequestReview = (me: Me | null, latest: { automated: boolean } | undefined, openRequest: boolean): boolean =>
  !!me?.permissions.includes('claims:request-review') && !!latest?.automated && !openRequest;

/**
 * An idempotency key per action: the same key while the person retries the
 * same submission, a new one after it went through.
 */
export class IdempotencyKeys {
  private keys = new Map<string, string>();
  constructor(private readonly make: () => string = () => crypto.randomUUID()) {}
  for(action: string): string {
    let k = this.keys.get(action);
    if (!k) this.keys.set(action, (k = this.make()));
    return k;
  }
  done(action: string): void {
    this.keys.delete(action);
  }
}

/** The claim's status as the queue shows it, from what the claim view has loaded (the API's order: approval, review, decided). */
export function claimStatus(o: { openProposals: number; openReviews: number; decisions: number }): 'awaiting-approval' | 'review-requested' | 'decided' | 'awaiting-decision' {
  if (o.openProposals) return 'awaiting-approval';
  if (o.openReviews) return 'review-requested';
  return o.decisions ? 'decided' : 'awaiting-decision';
}

/** A reason the claim went to a claims handler, with the rule's own text when a rule sent it there. */
export function routingLines(
  reasons: { reason: string; params: Record<string, unknown>; message?: string }[],
  rules: { code: string; message?: string }[],
): string[] {
  return reasons.map((r) => {
    const rule = typeof r.params.code === 'string' ? rules.find((x) => x.code === r.params.code) : undefined;
    const text = r.message ?? r.reason;
    return rule?.message ? `${text}: ${rule.message}` : text;
  });
}
