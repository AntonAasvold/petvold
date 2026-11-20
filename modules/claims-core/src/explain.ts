/**
 * Explanation per decision (ADR 0018, GDPR art. 13–15 and 22).
 *
 * Built from the stored decision and its evidence only, so the same
 * explanation can be shown to the customer, the handler and an auditor, now
 * and later. Pure and without text: every part is a stable reason key with
 * params, and the edge (API, UI) renders it in the reader's language.
 */
import type { ClaimDecision, CurrencyCode, DecisionEvidence, MinorUnits, Outcome, ReviewRequest, RuleResult, Timestamp } from './types.ts';

/** A reason key with its values, rendered to text at the edge. */
export interface Reason {
  reason: string;
  params: Record<string, string | number>;
}

export type ExplanationStepCode =
  | 'billed'
  | 'non_reimbursable'
  | 'vat_excluded'
  | 'deductible_fixed'
  | 'deductible_fixed_in_period'
  | 'deductible_variable'
  | 'limit_capped'
  | 'payout';

/** One step of the calculation. Reductions have negative amounts, so the steps add up to the payout. */
export interface ExplanationStep extends Reason {
  step: ExplanationStepCode;
  amount: MinorUnits;
}

export interface DecisionExplanation {
  claimId: string;
  decisionId: string;
  seq: number;
  outcome: Outcome;
  payout: MinorUnits;
  currency: CurrencyCode;
  decidedAt: Timestamp;
  automated: boolean;
  /** The one reason that best explains the outcome. */
  mainReason: Reason;
  /** Every rule the engine checked, in the order it checked them. */
  rules: RuleResult[];
  /** The calculation step by step. Empty when the claim was rejected. */
  steps: ExplanationStep[];
  /** Set when a handler decided against the proposal: the reason code and the handler's motivation. */
  deviation?: { reasonCode: string; reason: string };
  /** Set when this decision answers a request for human review. */
  reviewRequestId?: string;
  humanReview: {
    /** The customer may request a human review of this decision now. */
    available: boolean;
    /** An open request for the claim, if there is one. */
    openRequestId?: string;
  };
  /** What makes the decision traceable and recalculable. */
  basis: {
    rulesVersion: string;
    productVersion: string | null;
    policyVersionId: string | null;
    inputHash: string;
    calculationModel: string | null;
    engineVersion: string | null;
    /** The attachments the decision was made with (ADR 0036). Omitted for decisions made before they were kept. */
    attachments?: { id: string; sha256: string }[];
  };
}

export interface ExplainContext {
  /** null for decisions made before evidence was stored. */
  evidence: DecisionEvidence | null;
  /** True if no later decision has replaced this one. */
  isLatest: boolean;
  /** All review requests for the claim. */
  reviewRequests: ReviewRequest[];
}

/** Explains a stored decision. Pure. */
export function explainDecision(decision: ClaimDecision, ctx: ExplainContext): DecisionExplanation {
  const a = decision.assessment;
  const open = ctx.reviewRequests.find((r) => !r.closedAt);
  return {
    claimId: decision.claimId,
    decisionId: decision.id,
    seq: decision.seq,
    outcome: decision.outcome,
    payout: decision.payout,
    currency: a.currency,
    decidedAt: decision.decidedAt,
    automated: decision.automated,
    mainReason: mainReason(decision),
    rules: a.rules,
    steps: decision.outcome === 'rejected' ? [] : steps(decision, ctx.evidence),
    ...(decision.deviatesFromProposal && decision.reasonCode
      ? { deviation: { reasonCode: decision.reasonCode, reason: decision.reason ?? '' } }
      : {}),
    ...(decision.reviewRequestId ? { reviewRequestId: decision.reviewRequestId } : {}),
    humanReview: {
      available: decision.automated && ctx.isLatest && !open,
      ...(open ? { openRequestId: open.id } : {}),
    },
    basis: {
      rulesVersion: a.rulesVersion,
      productVersion: a.productVersion,
      policyVersionId: a.policyVersionId,
      inputHash: a.inputHash,
      calculationModel: ctx.evidence?.calculationModel ?? null,
      engineVersion: ctx.evidence?.engineVersion ?? null,
      ...(ctx.evidence?.attachments ? { attachments: ctx.evidence.attachments } : {}),
    },
  };
}

/**
 * The main reason, in order of precedence: a handler's deviation, the first
 * failed rule, a payout of zero, a reduced payout, or an approval in full.
 */
function mainReason(d: ClaimDecision): Reason {
  const a = d.assessment;
  const currency = a.currency;
  if (d.deviatesFromProposal && d.reasonCode) return { reason: `deviation.${d.reasonCode}`, params: {} };
  const failed = a.rules.find((r) => r.status === 'fail');
  if (d.outcome === 'rejected' && failed) return { reason: failed.reason, params: failed.params };
  if (d.outcome === 'rejected') return { reason: 'decision.nothing_payable', params: {} };
  const reason = d.outcome === 'partial' ? 'decision.partial' : 'decision.approved';
  return { reason, params: { payout: d.payout, currency } };
}

function steps(d: ClaimDecision, evidence: DecisionEvidence | null): ExplanationStep[] {
  const c = d.assessment.calculation;
  if (!c) return [];
  const currency = c.currency;
  const out: ExplanationStep[] = [];
  const add = (step: ExplanationStepCode, amount: MinorUnits, params: Reason['params'] = {}) =>
    out.push({ step, amount, reason: `step.${step}`, params: { ...params, currency } });

  add('billed', c.billed);
  if (c.nonReimbursable > 0) add('non_reimbursable', -c.nonReimbursable);
  if (c.vatExcluded > 0) add('vat_excluded', -c.vatExcluded);
  const period = evidence?.input.openDeductiblePeriod;
  if (c.deductibleFixed > 0) add('deductible_fixed', -c.deductibleFixed);
  else if (!c.opensDeductiblePeriod && period) {
    add('deductible_fixed_in_period', 0, { validFrom: period.validFrom, validTo: period.validTo });
  }
  if (c.deductibleVariable > 0) add('deductible_variable', -c.deductibleVariable, { percent: c.deductibleVariableBp / 100 });
  if (c.cappedByLimit) add('limit_capped', c.payout - c.payableBeforeLimit, { remaining: c.remainingBefore });
  add('payout', c.payout);
  return out;
}
