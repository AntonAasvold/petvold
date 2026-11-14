import { CALCULATION_MODEL, assess, deductibleScope, validateClaim } from './assess.ts';
import { StoreConflictError, type ClaimsEvent, type ClaimsStore, type Clock, type IdGenerator, type PolicyPort, type RulesPort } from './ports.ts';
import type {
  Assessment,
  AssessmentInput,
  Claim,
  ClaimDecision,
  DeductiblePeriod,
  DeviationReasonCode,
  DecisionEvidence,
  CurrencyCode,
  ISODate,
  LedgerJournal,
  MarketCode,
  MinorUnits,
  PolicySnapshot,
  ReviewRequest,
  Timestamp,
} from './types.ts';
import { assertDate } from '@petvold/common';
import { accounts, type LimitKey } from './ledger.ts';
import { replay, type ReplayResult } from './replay.ts';
import { explainDecision, type DecisionExplanation } from './explain.ts';


export type DomainErrorCode = 'not_found' | 'validation' | 'conflict' | 'forbidden';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface DecideCommand {
  /** accept = decide as the assessment proposes; reject = reject the claim. */
  action: 'accept' | 'reject';
  decidedBy: string;
  reason?: string;
  /** Required, with reason, when the decision goes against the proposal (ADR 0018). */
  reasonCode?: DeviationReasonCode;
  /** Whether the caller may decide against the proposal (permission claims:override). */
  mayOverride?: boolean;
  /**
   * inputHash from the assessment the handler looked at. If the basis has
   * changed since then (new policy version, another claim decided), the
   * decision is rejected with 'conflict' instead of being made on stale data.
   */
  expectedInputHash?: string;
}

export interface ReviewRequestCommand {
  requestedBy: string;
  /** The customer's view, in their own words. */
  statement?: string;
}

export interface LimitsView {
  animalId: string;
  policyId: string;
  market: MarketCode;
  currency: CurrencyCode;
  coverage: 'vet_care';
  policyYearStart: ISODate;
  policyYearEnd: ISODate;
  annualLimit: MinorUnits;
  consumed: MinorUnits;
  remaining: MinorUnits;
}

export interface ClaimsServiceDeps {
  policies: PolicyPort;
  rules: RulesPort;
  store: ClaimsStore;
  clock: Clock;
  ids: IdGenerator;
  /** Petvold's version and commit, stored with every decision (ADR 0018). */
  engineVersion?: string;
}

/** An assessment together with exactly the input it was made from. */
interface Assessed {
  assessment: Assessment;
  input: AssessmentInput;
}

/** How a decision came about: the motivation when it deviates, whether a person judged it, and the review it answers. */
interface Motivation {
  reason?: string;
  reasonCode?: DeviationReasonCode;
  deviatesFromProposal: boolean;
  automated: boolean;
  reviewRequestId?: string;
}

const COVERAGE = 'vet_care';

function limitKey(animalId: string, policy: PolicySnapshot): LimitKey {
  return { animalId, coverage: COVERAGE, policyYearStart: policy.policyYearStart, currency: policy.currency };
}

/**
 * A clash in the store means someone else got there first, e.g. two concurrent
 * decisions on the same claim. It becomes 'conflict' (409), not an internal error.
 */
async function asConflict<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (e) {
    if (e instanceof StoreConflictError) throw new DomainError('conflict', e.message);
    throw e;
  }
}

/** The claims engine's application service. The only thing the HTTP layer talks to. */
export class ClaimsService {
  constructor(private readonly d: ClaimsServiceDeps) {}

  /** Registers a claim, assesses it and settles it automatically if the rules allow. */
  async registerClaim(claim: Claim): Promise<{ claim: Claim; assessment: Assessment; decision: ClaimDecision | null }> {
    try {
      validateClaim(claim);
    } catch (e) {
      throw new DomainError('validation', (e as Error).message);
    }
    const existing = await this.d.store.getClaim(claim.id);
    if (existing) throw new DomainError('conflict', `Claim ${claim.id} already exists`);

    await asConflict(this.d.store.saveClaim(claim, [{ type: 'claim.registered', occurredAt: this.d.clock.now(), claim }]));
    const assessed = await this.assessInternal(claim, undefined, claim.id);
    const { assessment } = assessed;
    const decision =
      assessment.mode === 'auto'
        ? await this.commit(claim, assessed, assessment.proposedOutcome === 'rejected' ? 'reject' : 'accept', 'auto', {
            deviatesFromProposal: false,
            automated: true,
          })
        : null;
    return { claim, assessment, decision };
  }

  /** Assesses an existing claim without storing anything. */
  async assessClaim(claimId: string, knownAt?: Timestamp): Promise<Assessment> {
    const claim = await this.requireClaim(claimId);
    return (await this.assessInternal(claim, knownAt, claim.id)).assessment;
  }

  /**
   * Pre-approval, e.g. at the clinic's checkout. The claim is not stored and
   * no deductible periods or amounts are reserved.
   */
  async preview(draft: Claim): Promise<Assessment> {
    try {
      validateClaim(draft);
    } catch (e) {
      throw new DomainError('validation', (e as Error).message);
    }
    return (await this.assessInternal(draft, undefined, undefined)).assessment;
  }

  /**
   * Claims handler decision. If the claim has an open request for human review,
   * this decision is the review and closes the request (ADR 0018).
   */
  async decide(claimId: string, cmd: DecideCommand): Promise<ClaimDecision> {
    const claim = await this.requireClaim(claimId);
    const assessed = await this.assessInternal(claim, undefined, claim.id);
    const { assessment } = assessed;
    if (cmd.expectedInputHash && cmd.expectedInputHash !== assessment.inputHash) {
      throw new DomainError('conflict', 'The basis has changed since the assessment. Fetch a new assessment and try again.');
    }
    if (cmd.action === 'accept' && assessment.proposedOutcome === 'rejected') {
      throw new DomainError('validation', 'The assessment proposes rejection and cannot be accepted. Reject, or correct the basis.');
    }
    // Rejecting a proposal to approve is a deviation (ADR 0018): it needs the
    // right to override and a motivation that can be followed up.
    const deviates = cmd.action === 'reject' && assessment.proposedOutcome !== 'rejected';
    if (deviates) {
      if (!cmd.mayOverride) throw new DomainError('forbidden', 'Deciding against the proposal requires the permission claims:override');
      if (!cmd.reasonCode || !cmd.reason?.trim()) {
        throw new DomainError('validation', 'Deciding against the proposal requires reasonCode and reason');
      }
    }
    const open = (await this.d.store.getReviewRequests(claimId)).find((r) => !r.closedAt);
    return this.commit(claim, assessed, cmd.action, cmd.decidedBy, {
      deviatesFromProposal: deviates,
      automated: false,
      ...(cmd.reason ? { reason: cmd.reason } : {}),
      ...(deviates && cmd.reasonCode ? { reasonCode: cmd.reasonCode } : {}),
      ...(open ? { reviewRequestId: open.id } : {}),
    });
  }

  /**
   * Reassessment, e.g. after a retroactive policy change. Creates a new decision
   * if the basis has changed; the ledger books only the difference. The new
   * decision follows the proposal without anyone judging it, so it is automated,
   * and it does not close an open review request.
   */
  async reassess(claimId: string, decidedBy: string, reason: string): Promise<ClaimDecision | null> {
    const claim = await this.requireClaim(claimId);
    const prev = await this.latestDecision(claimId);
    if (!prev) throw new DomainError('conflict', 'The claim has no decision to reassess');
    const assessed = await this.assessInternal(claim, undefined, claim.id);
    if (assessed.assessment.inputHash === prev.assessment.inputHash) return null;
    const action = assessed.assessment.proposedOutcome === 'rejected' ? 'reject' : 'accept';
    return this.commit(claim, assessed, action, decidedBy, { reason, deviatesFromProposal: false, automated: true });
  }

  async getClaim(claimId: string): Promise<Claim> {
    return this.requireClaim(claimId);
  }

  async getDecisions(claimId: string): Promise<ClaimDecision[]> {
    await this.requireClaim(claimId);
    return this.d.store.getDecisions(claimId);
  }

  /** The evidence for a decision (ADR 0018). */
  async getEvidence(claimId: string, seq: number): Promise<DecisionEvidence> {
    return (await this.decisionWithEvidence(claimId, seq)).evidence;
  }

  /** Recalculates a stored decision from its evidence and compares (ADR 0018). Stores nothing. */
  async replayDecision(claimId: string, seq: number): Promise<ReplayResult> {
    const { decision, evidence } = await this.decisionWithEvidence(claimId, seq);
    return replay(evidence, decision.assessment, this.d.engineVersion ?? 'unknown');
  }

  /** Explanation of a stored decision for the customer, the handler or an auditor (ADR 0018). */
  async explainDecision(claimId: string, seq: number): Promise<DecisionExplanation> {
    const decisions = await this.getDecisions(claimId);
    const decision = decisions.find((d) => d.seq === seq);
    if (!decision) throw new DomainError('not_found', `Decision ${claimId}#${seq} does not exist`);
    return explainDecision(decision, {
      evidence: await this.d.store.getEvidence(decision.id),
      isLatest: decisions.every((d) => d.seq <= seq),
      reviewRequests: await this.d.store.getReviewRequests(claimId),
    });
  }

  /**
   * The customer asks for a person to review an automated decision (ADR 0018,
   * GDPR art. 22). Only the latest decision, only if it is automated, and one
   * open request per claim. The review is the next handler decision.
   */
  async requestReview(claimId: string, seq: number, cmd: ReviewRequestCommand): Promise<ReviewRequest> {
    const decisions = await this.getDecisions(claimId);
    const decision = decisions.find((d) => d.seq === seq);
    if (!decision) throw new DomainError('not_found', `Decision ${claimId}#${seq} does not exist`);
    if (decisions.some((d) => d.seq > seq)) throw new DomainError('conflict', 'A later decision has replaced this one');
    if (!decision.automated) throw new DomainError('conflict', 'The decision was made by a person and is not open for review here');
    const now = this.d.clock.now();
    const statement = cmd.statement?.trim();
    const request: ReviewRequest = {
      id: this.d.ids.next('rvw'),
      claimId,
      decisionId: decision.id,
      decisionSeq: decision.seq,
      requestedBy: cmd.requestedBy,
      ...(statement ? { statement } : {}),
      requestedAt: now,
    };
    await this.d.store
      .saveReviewRequest(request, [{ type: 'claim.review_requested', occurredAt: now, request }])
      .catch((e: unknown) => {
        if (e instanceof StoreConflictError) throw new DomainError('conflict', 'The claim already has an open review request');
        throw e;
      });
    return request;
  }

  async getReviewRequests(claimId: string): Promise<ReviewRequest[]> {
    await this.requireClaim(claimId);
    return this.d.store.getReviewRequests(claimId);
  }

  private async decisionWithEvidence(claimId: string, seq: number): Promise<{ decision: ClaimDecision; evidence: DecisionEvidence }> {
    const decision = (await this.getDecisions(claimId)).find((d) => d.seq === seq);
    const evidence = decision ? await this.d.store.getEvidence(decision.id) : null;
    if (!decision || !evidence) throw new DomainError('not_found', `No evidence for decision ${claimId}#${seq}`);
    return { decision, evidence };
  }

  async getLimits(policyId: string, animalId: string, onDate: ISODate): Promise<LimitsView> {
    try {
      assertDate(onDate, 'onDate');
    } catch (e) {
      throw new DomainError('validation', (e as Error).message);
    }
    const policy = await this.d.policies.getPolicyAt(policyId, onDate);
    if (!policy || policy.animalId !== animalId || !policy.vetCare) {
      throw new DomainError('not_found', 'No vet care cover in force for the animal on that date');
    }
    const consumed = await this.d.store.getConsumed(limitKey(animalId, policy));
    return {
      animalId,
      policyId,
      market: policy.market,
      currency: policy.currency,
      coverage: COVERAGE,
      policyYearStart: policy.policyYearStart,
      policyYearEnd: policy.policyYearEnd,
      annualLimit: policy.vetCare.annualLimit,
      consumed,
      remaining: Math.max(0, policy.vetCare.annualLimit - consumed),
    };
  }

  // -------------------------------------------------------------------------

  private async assessInternal(claim: Claim, knownAt: Timestamp | undefined, ownClaimId: string | undefined): Promise<Assessed> {
    const policy = await this.d.policies.getPolicyAt(claim.policyId, claim.treatmentFrom, knownAt);
    const rules = await this.d.rules.getRules(policy?.productVersion ?? 'default');
    const group = rules.diagnosisGroups[claim.diagnosisCode] ?? null;
    const scope = policy ? deductibleScope(claim, policy, group) : null;
    const openDeductiblePeriod = scope
      ? await this.d.store.findDeductiblePeriod(claim.animalId, scope.diagnosisGroup, claim.treatmentFrom, ownClaimId)
      : null;
    const consumedBefore = policy
      ? await this.d.store.getConsumed(limitKey(claim.animalId, policy), ownClaimId)
      : 0;
    const input: AssessmentInput = { claim, policy, rules, openDeductiblePeriod, consumedBefore };
    return { assessment: assess(input), input };
  }

  private async commit(
    claim: Claim,
    { assessment, input }: Assessed,
    action: 'accept' | 'reject',
    decidedBy: string,
    motivation: Motivation,
  ): Promise<ClaimDecision> {
    const prev = await this.latestDecision(claim.id);
    const now = this.d.clock.now();
    const outcome = action === 'reject' ? 'rejected' : assessment.proposedOutcome;
    const payout = outcome === 'rejected' ? 0 : (assessment.calculation?.payout ?? 0);

    const decision: ClaimDecision = {
      id: this.d.ids.next('dec'),
      claimId: claim.id,
      seq: (prev?.seq ?? 0) + 1,
      outcome,
      payout,
      assessment,
      decidedBy,
      decidedAt: now,
      ...(motivation.reason ? { reason: motivation.reason } : {}),
      deviatesFromProposal: motivation.deviatesFromProposal,
      ...(motivation.reasonCode ? { reasonCode: motivation.reasonCode } : {}),
      automated: motivation.automated,
      ...(motivation.reviewRequestId ? { reviewRequestId: motivation.reviewRequestId } : {}),
    };
    const evidence: DecisionEvidence = {
      decisionId: decision.id,
      input,
      calculationModel: CALCULATION_MODEL,
      engineVersion: this.d.engineVersion ?? 'unknown',
    };

    const journals: LedgerJournal[] = [];
    const diff = payout - (prev?.payout ?? 0);
    const policy = await this.d.policies.getPolicyAt(claim.policyId, claim.treatmentFrom);
    if (diff !== 0) {
      if (!policy) throw new DomainError('conflict', 'The policy could not be read when booking');
      const cur = claim.currency;
      // One currency per journal: a claim in another currency than the policy is
      // rejected by the assessment and never gets here with an amount.
      if (policy.currency !== cur) throw new DomainError('conflict', 'The claim and the policy have different currencies');
      const limit = limitKey(claim.animalId, policy);
      journals.push({
        id: this.d.ids.next('jrn'),
        sourceType: 'claim_decision',
        sourceId: decision.id,
        claimId: claim.id,
        currency: cur,
        bookedAt: now,
        lines: [
          { account: accounts.limitConsumed(limit), amount: diff },
          { account: accounts.limitAvailable(limit), amount: -diff },
          { account: accounts.claimExpense(cur, claim.id), amount: diff },
          { account: accounts.claimPayable(cur, claim.id), amount: -diff },
        ],
      });
    }

    let deductiblePeriod: DeductiblePeriod | null = null;
    const calc = assessment.calculation;
    const scope = policy ? deductibleScope(claim, policy, assessment.diagnosisGroup) : null;
    if (outcome !== 'rejected' && calc?.opensDeductiblePeriod && scope) {
      deductiblePeriod = { id: this.d.ids.next('dp'), animalId: claim.animalId, ...scope, openedByClaimId: claim.id };
    }

    const events: ClaimsEvent[] = [{ type: 'claim.decided', occurredAt: now, decision }];
    await asConflict(
      this.d.store.commitDecision({
        decision,
        journals,
        deductiblePeriod,
        evidence,
        events,
        ...(motivation.reviewRequestId ? { closesReviewRequestId: motivation.reviewRequestId } : {}),
      }),
    );
    return decision;
  }

  private async latestDecision(claimId: string): Promise<ClaimDecision | null> {
    const all = await this.d.store.getDecisions(claimId);
    return all.length ? all.reduce((a, b) => (b.seq > a.seq ? b : a)) : null;
  }

  private async requireClaim(claimId: string): Promise<Claim> {
    const claim = await this.d.store.getClaim(claimId);
    if (!claim) throw new DomainError('not_found', `Claim ${claimId} does not exist`);
    return claim;
  }
}
