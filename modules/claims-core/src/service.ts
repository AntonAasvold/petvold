import { routingOf, type Routing } from './routing.ts';
import { CALCULATION_MODEL, assess, deductibleScope, validateClaim } from './assess.ts';
import { StoreConflictError, type ClaimsEvent, type ClaimsStore, type Clock, type IdGenerator, type PolicyPort, type RulesPort } from './ports.ts';
import type {
  ClaimFilter,
  ClaimSummary,
  Assessment,
  AssessmentInput,
  Claim,
  NewClaim,
  ClaimClosure,
  DismissalReason,
  ClaimDecision,
  ClaimsRules,
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
  DecisionProposal,
  Outcome,
  PayoutOrder,
  Timestamp,
} from './types.ts';
import { assertDate, marketDate } from '@petvold/common';
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
   * The caller's limits for deciding alone (ADR 0019). A payout above the limit in
   * the claim's currency becomes a proposal that someone else must approve.
   * Omitted or null: no limit.
   */
  decisionLimits?: AmountLimits | null;
  /**
   * inputHash from the assessment the handler looked at. If the basis has
   * changed since then (new policy version, another claim decided), the
   * decision is rejected with 'conflict' instead of being made on stale data.
   */
  expectedInputHash?: string;
}

/** Highest payout per currency, in the smallest unit. A currency that is missing has the limit 0. */
export type AmountLimits = Partial<Record<CurrencyCode, MinorUnits>>;

/** The limit in a currency. null or undefined limits mean no limit. */
export function limitIn(limits: AmountLimits | null | undefined, currency: CurrencyCode): number {
  return limits ? (limits[currency] ?? 0) : Number.POSITIVE_INFINITY;
}

/** A handler decision is made at once, or proposed for approval when it exceeds the handler's limit. */
export type DecideResult = { decision: ClaimDecision; proposal?: never } | { proposal: DecisionProposal; decision?: never };

export interface ApproveCommand {
  approvedBy: string;
  /** The approver's limits (ADR 0019). Omitted or null: no limit. */
  approvalLimits?: AmountLimits | null;
}

export interface ReturnProposalCommand {
  returnedBy: string;
  reason: string;
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
  /** The claim number's prefix per market, e.g. { SE: 'S' } (ADR 0036). 'S' when a market has none. */
  claimNumberPrefix?: Readonly<Record<string, string>>;
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
  approvedBy?: string;
  proposalId?: string;
}

/** The rules for a claim without a policy: none of them are used, only the market is checked. */
function noPolicyRules(claim: Claim): ClaimsRules {
  return {
    rulesVersion: 'none',
    market: claim.market,
    vatReimbursable: false,
    nonReimbursableCategories: [],
    diagnosisGroups: {},
    autoSettleMax: 0,
  };
}

/** Outcome and payout of a decision with this action on this assessment. */
function decisionAmounts(assessment: Assessment, action: 'accept' | 'reject'): { outcome: Outcome; payout: MinorUnits } {
  const outcome = action === 'reject' ? 'rejected' : assessment.proposedOutcome;
  return { outcome, payout: outcome === 'rejected' ? 0 : (assessment.calculation?.payout ?? 0) };
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

  /**
   * Registers a claim, assesses it and settles it automatically if the rules
   * allow. Without an id or a claim number, the server gives them (ADR 0036);
   * they are given before the assessment, since the claim is part of its input.
   */
  async registerClaim(input: NewClaim): Promise<{ claim: Claim; assessment: Assessment; decision: ClaimDecision | null }> {
    const claim: Claim = { ...input, id: input.id ?? this.d.ids.next('clm'), claimNo: input.claimNo ?? '' };
    try {
      validateClaim(claim);
    } catch (e) {
      throw new DomainError('validation', (e as Error).message);
    }
    const existing = await this.d.store.getClaim(claim.id);
    if (existing) throw new DomainError('conflict', `Claim ${claim.id} already exists`);
    if (input.claimNo === undefined) claim.claimNo = await this.nextClaimNo(claim);
    else if (await this.d.store.claimNoTaken(claim.claimNo)) throw new DomainError('conflict', `Claim number ${claim.claimNo} is already in use`);

    // The claim is assessed before it is stored: the assessment never counts the
    // claim itself, so the result is the same, and a reserve can be booked with it.
    const assessed = await this.assessInternal(claim, undefined, claim.id);
    const { assessment } = assessed;
    const now = this.d.clock.now();
    const reserve = assessment.mode === 'manual' ? this.reserveJournal(claim, assessment, now) : null;
    await asConflict(this.d.store.saveClaim(claim, [{ type: 'claim.registered', occurredAt: now, claim }], reserve ? [reserve] : []));
    const decision =
      assessment.mode === 'auto'
        ? await this.commit(claim, assessed, assessment.proposedOutcome === 'rejected' ? 'reject' : 'accept', 'auto', {
            deviatesFromProposal: false,
            automated: true,
          })
        : null;
    return { claim, assessment, decision };
  }

  /**
   * The next free claim number, e.g. S-2026-000123: the prefix for the market,
   * the year the claim was received in the market's time zone, and the series.
   * A number a client already chose is skipped.
   */
  private async nextClaimNo(claim: Claim): Promise<string> {
    const year = Number(marketDate(claim.market, claim.receivedAt).slice(0, 4));
    const prefix = this.d.claimNumberPrefix?.[claim.market] ?? 'S';
    for (;;) {
      const n = await this.d.store.nextClaimNumber(year);
      const claimNo = `${prefix}-${year}-${String(n).padStart(6, '0')}`;
      if (!(await this.d.store.claimNoTaken(claimNo))) return claimNo;
    }
  }

  /** Assesses an existing claim without storing anything. */
  async assessClaim(claimId: string, knownAt?: Timestamp): Promise<Assessment> {
    const claim = await this.requireClaim(claimId);
    return (await this.assessInternal(claim, knownAt, claim.id)).assessment;
  }

  /** The assessment and why the claim needs a claims handler, from the rules in force. Not stored. */
  async assessWithRouting(claimId: string, knownAt?: Timestamp): Promise<Assessment & { routing: Routing }> {
    const claim = await this.requireClaim(claimId);
    const { assessment, input } = await this.assessInternal(claim, knownAt, claim.id);
    return { ...assessment, routing: routingOf(assessment, input.rules.autoSettleMax) };
  }

  /**
   * Pre-approval, e.g. at the clinic's checkout. The claim is not stored and
   * no deductible periods or amounts are reserved.
   */
  async preview(input: NewClaim): Promise<Assessment> {
    // Nothing is stored, so a preview gets no id or claim number of its own.
    const draft: Claim = { ...input, id: input.id ?? 'clm_preview', claimNo: input.claimNo ?? 'preview' };
    try {
      validateClaim(draft);
    } catch (e) {
      throw new DomainError('validation', (e as Error).message);
    }
    return (await this.assessInternal(draft, undefined, undefined)).assessment;
  }

  /**
   * Claims handler decision. If the claim has an open request for human review,
   * this decision is the review and closes the request (ADR 0018). If the payout
   * exceeds the handler's limit, nothing is decided: a proposal is stored for
   * someone else to approve (ADR 0019).
   */
  async decide(claimId: string, cmd: DecideCommand): Promise<DecideResult> {
    const claim = await this.requireClaim(claimId);
    if (await this.d.store.getClosure(claimId)) throw new DomainError('conflict', `Claim ${claimId} is closed and cannot be decided`);
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
    await this.assertNoOpenProposal(claimId);
    const motivation = {
      deviatesFromProposal: deviates,
      ...(cmd.reason ? { reason: cmd.reason } : {}),
      ...(deviates && cmd.reasonCode ? { reasonCode: cmd.reasonCode } : {}),
    };
    const { outcome, payout } = decisionAmounts(assessment, cmd.action);
    const limit = limitIn(cmd.decisionLimits, claim.currency);
    if (payout > limit) {
      const now = this.d.clock.now();
      const proposal: DecisionProposal = {
        id: this.d.ids.next('prp'),
        claimId,
        action: cmd.action,
        outcome,
        payout,
        currency: claim.currency,
        inputHash: assessment.inputHash,
        proposedBy: cmd.decidedBy,
        proposedAt: now,
        ...motivation,
        proposerLimit: limit,
        status: 'open',
      };
      await this.d.store.saveProposal(proposal, [{ type: 'claim.decision_proposed', occurredAt: now, proposal }]).catch((e: unknown) => {
        if (e instanceof StoreConflictError) throw new DomainError('conflict', 'The claim already has an open proposal');
        throw e;
      });
      return { proposal };
    }
    const review = await this.openReviewRequest(claimId);
    return {
      decision: await this.commit(claim, assessed, cmd.action, cmd.decidedBy, {
        ...motivation,
        automated: false,
        ...(review ? { reviewRequestId: review.id } : {}),
      }),
    };
  }

  /**
   * Approves an open proposal (ADR 0019): someone other than the proposer,
   * within the approver's limit, on exactly the basis the proposal was made on.
   * The approval becomes the decision, booked as usual.
   */
  async approveProposal(claimId: string, proposalId: string, cmd: ApproveCommand): Promise<ClaimDecision> {
    const claim = await this.requireClaim(claimId);
    const p = await this.requireOpenProposal(claimId, proposalId);
    if (cmd.approvedBy === p.proposedBy) throw new DomainError('forbidden', 'The proposer cannot approve their own proposal (four eyes)');
    if (p.payout > limitIn(cmd.approvalLimits, p.currency)) {
      throw new DomainError('forbidden', 'The payout exceeds the approver\'s limit');
    }
    const assessed = await this.assessInternal(claim, undefined, claim.id);
    if (assessed.assessment.inputHash !== p.inputHash) {
      throw new DomainError('conflict', 'The basis has changed since the proposal. Return it and make a new decision.');
    }
    const review = await this.openReviewRequest(claimId);
    return this.commit(claim, assessed, p.action, p.proposedBy, {
      deviatesFromProposal: p.deviatesFromProposal,
      ...(p.reason ? { reason: p.reason } : {}),
      ...(p.reasonCode ? { reasonCode: p.reasonCode } : {}),
      automated: false,
      ...(review ? { reviewRequestId: review.id } : {}),
      approvedBy: cmd.approvedBy,
      proposalId: p.id,
    });
  }

  /** Sends an open proposal back without a decision (ADR 0019). */
  async returnProposal(claimId: string, proposalId: string, cmd: ReturnProposalCommand): Promise<DecisionProposal> {
    const p = await this.requireOpenProposal(claimId, proposalId);
    const reason = cmd.reason.trim();
    if (!reason) throw new DomainError('validation', 'A returned proposal needs a reason');
    const now = this.d.clock.now();
    const returned: DecisionProposal = { ...p, status: 'returned', closedBy: cmd.returnedBy, closedAt: now, returnReason: reason };
    await this.d.store
      .returnProposal(p.id, cmd.returnedBy, now, reason, [{ type: 'claim.proposal_returned', occurredAt: now, proposal: returned }])
      .catch((e: unknown) => {
        if (e instanceof StoreConflictError) throw new DomainError('conflict', 'The proposal is no longer open');
        throw e;
      });
    return returned;
  }

  async getProposals(claimId: string): Promise<DecisionProposal[]> {
    await this.requireClaim(claimId);
    return this.d.store.getProposals(claimId);
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

  /**
   * After a change of the policy, e.g. a cancellation back in time (ADR 0029):
   * reassesses every claim whose latest decision was made on one of the
   * superseded versions. A claim whose basis did not change gets no new
   * decision. Safe to run twice for the same versions.
   */
  async reassessForPolicyChange(policyVersionIds: string[], reason: string, decidedBy: string): Promise<{ claimId: string; decision: ClaimDecision | null }[]> {
    const out: { claimId: string; decision: ClaimDecision | null }[] = [];
    for (const claimId of await this.d.store.claimsDecidedOnPolicyVersions(policyVersionIds)) {
      out.push({ claimId, decision: await this.reassess(claimId, decidedBy, reason) });
    }
    return out;
  }

  /** For retention (ADR 0028): whether a claim on the policy treated in [from, to) is still open, and the latest activity. */
  claimActivity(policyId: string, from: ISODate, to: ISODate): Promise<{ open: boolean; lastAt?: Timestamp }> {
    return this.d.store.claimActivity(policyId, from, to);
  }

  /** Claims for a list or a work queue, e.g. those awaiting a handler's decision. */
  listClaims(filter: ClaimFilter = {}): Promise<ClaimSummary[]> {
    return this.d.store.listClaims(filter);
  }

  /** The claim, with its closure when it was withdrawn or dismissed (ADR 0036). */
  async getClaim(claimId: string): Promise<Claim & { closure?: ClaimClosure }> {
    const claim = await this.requireClaim(claimId);
    const closure = await this.d.store.getClosure(claimId);
    return closure ? { ...claim, closure } : claim;
  }

  /** The customer withdraws the claim before it is decided (ADR 0036). */
  async withdraw(claimId: string, cmd: { reason: string }, by: string): Promise<ClaimClosure> {
    return this.close(claimId, { kind: 'withdrawn', reason: cmd.reason }, by);
  }

  /**
   * The claim is dismissed before it is decided, e.g. as a duplicate (ADR 0036).
   * Not a rejection: no decision, explanation or review.
   */
  async dismiss(claimId: string, cmd: { reasonCode: DismissalReason; reason: string; duplicateOf?: string }, by: string): Promise<ClaimClosure> {
    if (cmd.reasonCode === 'duplicate') {
      if (!cmd.duplicateOf) throw new DomainError('validation', 'A duplicate names the claim it duplicates (duplicateOf)');
      if (cmd.duplicateOf === claimId) throw new DomainError('validation', 'A claim cannot duplicate itself');
      if (!(await this.d.store.getClaim(cmd.duplicateOf))) throw new DomainError('validation', `Claim ${cmd.duplicateOf} does not exist`);
    } else if (cmd.duplicateOf) {
      throw new DomainError('validation', 'duplicateOf is only for reasonCode duplicate');
    }
    return this.close(claimId, { kind: 'dismissed', reasonCode: cmd.reasonCode, reason: cmd.reason, ...(cmd.duplicateOf ? { duplicateOf: cmd.duplicateOf } : {}) }, by);
  }

  /**
   * Closes a claim without a decision: open proposals go back with the reason,
   * and the reserve is released, in one transaction. Nothing of the limit is
   * consumed and no deductible period opens.
   */
  private async close(claimId: string, what: Pick<ClaimClosure, 'kind' | 'reasonCode' | 'reason' | 'duplicateOf'>, by: string): Promise<ClaimClosure> {
    const claim = await this.requireClaim(claimId);
    const reason = what.reason.trim();
    if (!reason) throw new DomainError('validation', 'A reason is required');
    if (await this.d.store.getClosure(claimId)) throw new DomainError('conflict', `Claim ${claimId} is closed already`);
    if ((await this.d.store.getDecisions(claimId)).length) throw new DomainError('conflict', `Claim ${claimId} has a decision: correct or reassess it instead`);
    const now = this.d.clock.now();
    const closure: ClaimClosure = { id: this.d.ids.next('cls'), claimId, ...what, reason, closedBy: by, closedAt: now };
    const journals: LedgerJournal[] = [];
    const reserved = -(await this.d.store.getBalance(accounts.claimReserve(claim.currency, claim.id)));
    if (reserved !== 0) {
      journals.push({
        id: this.d.ids.next('jrn'),
        sourceType: 'claim_reserve',
        sourceId: closure.id,
        claimId,
        currency: claim.currency,
        bookedAt: now,
        lines: [
          { account: accounts.claimReserve(claim.currency, claim.id), amount: reserved },
          { account: accounts.reserveExpense(claim.currency, claim.id), amount: -reserved },
        ],
      });
    }
    const returned = (await this.d.store.getProposals(claimId))
      .filter((p) => p.status === 'open')
      .map((p): ClaimsEvent => ({ type: 'claim.proposal_returned', occurredAt: now, proposal: { ...p, status: 'returned', closedBy: by, closedAt: now, returnReason: reason } }));
    await asConflict(this.d.store.closeClaim(closure, [...returned, { type: closure.kind === 'withdrawn' ? 'claim.withdrawn' : 'claim.dismissed', occurredAt: now, closure }], journals));
    return closure;
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

  /**
   * Stored decisions with their evidence, for simulating rules (ADR 0018): each
   * claim's latest decision made in [from, to). At most `limit`.
   */
  async decisionsForSimulation(from: Timestamp, to: Timestamp, limit = 5_000) {
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from >= to) {
      throw new DomainError('validation', 'from and to must be points in time with from before to');
    }
    return this.d.store.latestDecisionsWithEvidence(new Date(from).toISOString(), new Date(to).toISOString(), limit);
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

  /** The annual limit of the policy's animal on a date. A policy covers one animal (ADR 0007). */
  async getLimits(policyId: string, onDate: ISODate): Promise<LimitsView> {
    try {
      assertDate(onDate, 'onDate');
    } catch (e) {
      throw new DomainError('validation', (e as Error).message);
    }
    const policy = await this.d.policies.getPolicyAt(policyId, onDate);
    if (!policy || !policy.vetCare) {
      throw new DomainError('not_found', 'No vet care cover in force for the animal on that date');
    }
    const animalId = policy.animalId;
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
    // Without a policy the claim is rejected before any product rule is used.
    const rules = policy ? await this.d.rules.getRules(policy.productVersion, claim.treatmentFrom) : noPolicyRules(claim);
    if (!rules) {
      throw new DomainError('conflict', `No published rules for ${policy!.productVersion} on ${claim.treatmentFrom}`);
    }
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
    const { outcome, payout } = decisionAmounts(assessment, action);

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
      ...(motivation.approvedBy ? { approvedBy: motivation.approvedBy } : {}),
      ...(motivation.proposalId ? { proposalId: motivation.proposalId } : {}),
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

    // The decision releases whatever reserve is open, in the same transaction.
    const reserved = -(await this.d.store.getBalance(accounts.claimReserve(claim.currency, claim.id)));
    if (reserved !== 0) {
      const cur = claim.currency;
      journals.push({
        id: this.d.ids.next('jrn'),
        sourceType: 'claim_reserve',
        sourceId: decision.id,
        claimId: claim.id,
        currency: cur,
        bookedAt: now,
        lines: [
          { account: accounts.claimReserve(cur, claim.id), amount: reserved },
          { account: accounts.reserveExpense(cur, claim.id), amount: -reserved },
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
    // An increase in the payout is ordered for payment (ADR 0019). A decrease is not a negative order.
    if (diff > 0 && policy) {
      const order: PayoutOrder = {
        id: this.d.ids.next('po'),
        claimId: claim.id,
        decisionId: decision.id,
        policyId: claim.policyId,
        amount: diff,
        currency: claim.currency,
        channel: claim.channel,
        ...(claim.clinicId ? { clinicId: claim.clinicId } : {}),
      };
      events.push({ type: 'claim.payout_ordered', occurredAt: now, order });
    }
    await asConflict(
      this.d.store.commitDecision({
        decision,
        journals,
        deductiblePeriod,
        evidence,
        events,
        ...(motivation.reviewRequestId ? { closesReviewRequestId: motivation.reviewRequestId } : {}),
        ...(motivation.proposalId ? { closesProposalId: motivation.proposalId } : {}),
      }),
    );
    return decision;
  }

  /**
   * The reserve for a claim that goes to a handler: the payout the assessment
   * expects. None when the assessment proposes rejection.
   */
  private reserveJournal(claim: Claim, assessment: Assessment, at: Timestamp): LedgerJournal | null {
    const amount = assessment.proposedOutcome === 'rejected' ? 0 : (assessment.calculation?.payout ?? 0);
    if (amount <= 0) return null;
    const cur = claim.currency;
    return {
      id: this.d.ids.next('jrn'),
      sourceType: 'claim_reserve',
      sourceId: claim.id,
      claimId: claim.id,
      currency: cur,
      bookedAt: at,
      lines: [
        { account: accounts.reserveExpense(cur, claim.id), amount },
        { account: accounts.claimReserve(cur, claim.id), amount: -amount },
      ],
    };
  }

  private async requireOpenProposal(claimId: string, proposalId: string): Promise<DecisionProposal> {
    await this.requireClaim(claimId);
    const p = (await this.d.store.getProposals(claimId)).find((x) => x.id === proposalId);
    if (!p) throw new DomainError('not_found', `Proposal ${proposalId} does not exist`);
    if (p.status !== 'open') throw new DomainError('conflict', `Proposal ${proposalId} is ${p.status}`);
    return p;
  }

  private async assertNoOpenProposal(claimId: string): Promise<void> {
    if ((await this.d.store.getProposals(claimId)).some((p) => p.status === 'open')) {
      throw new DomainError('conflict', 'The claim has an open proposal awaiting approval');
    }
  }

  private async openReviewRequest(claimId: string): Promise<ReviewRequest | undefined> {
    return (await this.d.store.getReviewRequests(claimId)).find((r) => !r.closedAt);
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
