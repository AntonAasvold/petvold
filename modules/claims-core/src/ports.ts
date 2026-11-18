import type {
  ClaimDecision,
  ClaimFilter,
  ClaimSummary,
  DecisionEvidence,
  ClaimsRules,
  DeductiblePeriod,
  ISODate,
  LedgerJournal,
  MinorUnits,
  PolicySnapshot,
  ReviewRequest,
  DecisionProposal,
  PayoutOrder,
  Timestamp,
  Claim,
  ClaimClosure,
} from './types.ts';
import type { LimitKey } from './ledger.ts';

/**
 * All the claims engine knows about the policy core. Implemented as a thin
 * anti-corruption layer towards an external policy system or Petvold's own.
 */
export interface PolicyPort {
  /**
   * The policy as it applied on `onDate`, according to what the policy core
   * knew at `knownAt` (omitted = now). null if no version applied on that date.
   */
  getPolicyAt(policyId: string, onDate: ISODate, knownAt?: Timestamp): Promise<PolicySnapshot | null>;
}

/** The product's claims rules (ADR 0021). Implemented by the decisioning module, or statically in tests. */
export interface RulesPort {
  /** The rules in force for the product version on the treatment date, or null if none is published. */
  getRules(productVersion: string, onDate: ISODate): Promise<ClaimsRules | null>;
}

/** The claims engine's own state. Postgres in production, in memory in tests. */
export interface ClaimsStore {
  /**
   * Stores the claim and writes `events` to the outbox and `journals` (e.g. the
   * reserve) to the ledger in the same transaction. Throws
   * StoreConflictError('claim_exists') if the id already exists; then nothing is
   * stored. A journal that does not balance is rejected with a plain error.
   */
  saveClaim(claim: Claim, events: ClaimsEvent[], journals?: LedgerJournal[]): Promise<void>;
  /** The balance of a ledger account: debits positive, credits negative. 0 for an unknown account. */
  getBalance(account: string): Promise<MinorUnits>;
  getClaim(claimId: string): Promise<Claim | null>;
  /** Whether a claim already has this claim number. */
  claimNoTaken(claimNo: string): Promise<boolean>;
  /**
   * The next number in the year's series, 1, 2, 3 … (ADR 0036). Atomic: two
   * callers never get the same number, also on separate instances.
   */
  nextClaimNumber(year: number): Promise<number>;

  /**
   * Deductible period for the animal and diagnosis group that covers `onDate`.
   * Periods opened by `excludeClaimId` are ignored, so that a reassessment
   * calculates the same way as the original decision.
   */
  findDeductiblePeriod(
    animalId: string,
    diagnosisGroup: string,
    onDate: ISODate,
    excludeClaimId?: string,
  ): Promise<DeductiblePeriod | null>;

  /**
   * Consumed amount of the limit, according to the ledger (the balance of
   * `accounts.limitConsumed(limit)`). Only amounts in the limit's currency count.
   * The claim's own previously consumed amount is excluded on reassessment.
   */
  getConsumed(limit: LimitKey, excludeClaimId?: string): Promise<MinorUnits>;

  /** The claim's decisions in ascending sequence. Empty list if there are none. */
  getDecisions(claimId: string): Promise<ClaimDecision[]>;
  /** The evidence stored with a decision, unchanged. null for unknown decisions and decisions made before evidence was stored. */
  getEvidence(decisionId: string): Promise<DecisionEvidence | null>;
  /**
   * For simulation (ADR 0018): each claim's latest decision, if it was made in
   * [from, to) and has evidence, with that evidence. Oldest first, at most `limit`.
   */
  latestDecisionsWithEvidence(from: Timestamp, to: Timestamp, limit: number): Promise<Array<{ decision: ClaimDecision; evidence: DecisionEvidence }>>;
  /**
   * For retention (ADR 0028): the claims on the policy treated in [from, to).
   * open: any of them has no decision yet, an open review request or an open
   * decision proposal. lastAt: the latest a claim was received or decided.
   */
  claimActivity(policyId: string, from: ISODate, to: ISODate): Promise<{ open: boolean; lastAt?: Timestamp }>;
  /** Claims matching the filter, oldest received first (work queues). */
  listClaims(filter: ClaimFilter): Promise<ClaimSummary[]>;
  /** Claims whose latest decision was made on one of the policy versions, e.g. ones that were just superseded. */
  claimsDecidedOnPolicyVersions(policyVersionIds: string[]): Promise<string[]>;
  /**
   * Stores the decision, its evidence, journals and changed deductible periods atomically
   * (one database transaction in production). Periods the claim opened earlier
   * are replaced by `deductiblePeriod` (or removed if it is null).
   *
   * All or nothing: on error, nothing is stored. Throws StoreConflictError with
   * 'decision_exists' (same claim and sequence) or 'period_overlaps' (clash
   * with another claim's deductible period). A journal that does not balance
   * a decision for an unknown claim, or evidence for another decision is
   * rejected with a plain error.
   */
  commitDecision(commit: DecisionCommit): Promise<void>;

  /**
   * Stores a request for human review and writes `events` to the outbox in the
   * same transaction. Throws StoreConflictError('review_open') if the claim
   * already has an open request; then nothing is stored.
   */
  saveReviewRequest(request: ReviewRequest, events: ClaimsEvent[]): Promise<void>;
  /** The claim's review requests, oldest first. */
  getReviewRequests(claimId: string): Promise<ReviewRequest[]>;

  /**
   * Stores an open decision proposal (ADR 0019) and writes `events` in the same
   * transaction. Throws StoreConflictError('proposal_open') if the claim already
   * has an open proposal; then nothing is stored.
   */
  saveProposal(proposal: DecisionProposal, events: ClaimsEvent[]): Promise<void>;
  /**
   * Closes a claim without a decision (ADR 0036), in one transaction: stores
   * the closure, returns the claim's open proposals with the closure's reason,
   * books `journals` (the released reserve) and writes `events`. Throws
   * StoreConflictError('claim_closed') if the claim is closed already, and
   * ('claim_decided') if it has a decision.
   */
  closeClaim(closure: ClaimClosure, events: ClaimsEvent[], journals: LedgerJournal[]): Promise<void>;
  /** The claim's closure, or null while it is open. */
  getClosure(claimId: string): Promise<ClaimClosure | null>;
  /** The claim's proposals, oldest first. */
  getProposals(claimId: string): Promise<DecisionProposal[]>;
  /**
   * Returns an open proposal without a decision, and writes `events` in the same
   * transaction. Throws StoreConflictError('proposal_closed') if it is not open.
   */
  returnProposal(proposalId: string, closedBy: string, closedAt: Timestamp, reason: string, events: ClaimsEvent[]): Promise<void>;
}

/**
 * The store rejects a change that conflicts with existing state.
 * Every implementation throws this error in the same situations, so that
 * the service can answer 409 instead of 500 (see test-suites/claims-store.ts).
 */
export class StoreConflictError extends Error {
  constructor(
    public readonly reason: 'claim_exists' | 'decision_exists' | 'period_overlaps' | 'review_open' | 'proposal_open' | 'proposal_closed' | 'claim_closed' | 'claim_decided',
    message: string,
  ) {
    super(message);
    this.name = 'StoreConflictError';
  }
}

export interface DecisionCommit {
  decision: ClaimDecision;
  journals: LedgerJournal[];
  deductiblePeriod: DeductiblePeriod | null;
  /** What the decision was based on (ADR 0018). `evidence.decisionId` must be `decision.id`. */
  evidence: DecisionEvidence;
  /**
   * The open review request this decision answers. Closed in the same transaction
   * (closedByDecisionId = decision.id, closedAt = decision.decidedAt). A request
   * that is unknown, for another claim or already closed is rejected with a plain error.
   */
  closesReviewRequestId?: string;
  /**
   * The open proposal this decision approves (ADR 0019). Closed in the same
   * transaction (status 'approved', closedBy = decision.approvedBy, closedAt =
   * decision.decidedAt, decisionId = decision.id). If it is no longer open,
   * StoreConflictError('proposal_closed') is thrown and nothing is stored.
   */
  closesProposalId?: string;
  /** Written to the outbox in the same transaction as the decision (ADR 0008). */
  events: ClaimsEvent[];
}

export interface Clock {
  now(): Timestamp;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export type ClaimsEvent =
  | { type: 'claim.registered'; occurredAt: Timestamp; claim: Claim }
  | { type: 'claim.decided'; occurredAt: Timestamp; decision: ClaimDecision }
  | { type: 'claim.review_requested'; occurredAt: Timestamp; request: ReviewRequest }
  | { type: 'claim.decision_proposed'; occurredAt: Timestamp; proposal: DecisionProposal }
  | { type: 'claim.proposal_returned'; occurredAt: Timestamp; proposal: DecisionProposal }
  | { type: 'claim.payout_ordered'; occurredAt: Timestamp; order: PayoutOrder }
  | { type: 'claim.withdrawn' | 'claim.dismissed'; occurredAt: Timestamp; closure: ClaimClosure };

/** The claim an event concerns: the aggregate it belongs to in the outbox. */
export function eventClaimId(e: ClaimsEvent): string {
  switch (e.type) {
    case 'claim.registered':
      return e.claim.id;
    case 'claim.decided':
      return e.decision.claimId;
    case 'claim.review_requested':
      return e.request.claimId;
    case 'claim.decision_proposed':
    case 'claim.proposal_returned':
      return e.proposal.claimId;
    case 'claim.payout_ordered':
      return e.order.claimId;
    case 'claim.withdrawn':
    case 'claim.dismissed':
      return e.closure.claimId;
  }
}

/**
 * Where the relay publishes events, e.g. a message broker or a webhook.
 * Delivery is at least once: a consumer must tolerate duplicates.
 */
export interface EventSink {
  publish(event: ClaimsEvent): Promise<void>;
}

/** An event in the outbox, waiting to be published. */
export interface OutboxEntry {
  /** Increasing per store; the order events were written in. */
  id: string;
  event: ClaimsEvent;
}

/**
 * The outbox the store writes events to (ADR 0008). Read by the relay, which
 * publishes the events and then marks them as published.
 */
export interface ClaimsOutbox {
  /** Unpublished events, oldest first, at most `limit`. */
  pendingEvents(limit: number): Promise<OutboxEntry[]>;
  /** Marks the events as published. Unknown or already published ids are ignored. */
  markPublished(ids: string[], at: Timestamp): Promise<void>;
}
