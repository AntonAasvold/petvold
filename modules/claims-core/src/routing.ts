/**
 * Why a claim needs a claims handler. Worked out from an assessment and the
 * product's limit for automatic settlement when the claim is read, and never
 * stored: stored assessments must recompute exactly as before (ADR 0018). Pure.
 */
import type { Reason } from './explain.ts';
import type { Assessment, MinorUnits } from './types.ts';

export interface Routing {
  mode: 'auto' | 'manual';
  /** Empty when the claim may be settled automatically. */
  reasons: Reason[];
}

export function routingOf(a: Assessment, autoSettleMax: MinorUnits): Routing {
  if (a.mode === 'auto') return { mode: 'auto', reasons: [] };
  const reasons: Reason[] = a.rules
    .filter((r) => r.status === 'review' || r.status === 'fail')
    .map((r) => ({ reason: `routing.rule_${r.status}`, params: { code: r.code, rule: r.reason } }));
  if (a.proposedOutcome === 'rejected' && !reasons.length) reasons.push({ reason: 'routing.proposal_rejected', params: {} });
  if (a.proposedOutcome !== 'rejected' && a.calculation && a.calculation.payout > autoSettleMax) {
    reasons.push({ reason: 'routing.above_auto_limit', params: { payout: a.calculation.payout, limit: autoSettleMax, currency: a.currency } });
  }
  return { mode: 'manual', reasons };
}
