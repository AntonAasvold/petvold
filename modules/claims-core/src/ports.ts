import type {
  ClaimDecision,
  DecisionEvidence,
  ClaimsRules,
  DeductiblePeriod,
  ISODate,
  LedgerJournal,
  MinorUnits,
  PolicySnapshot,
  ReviewRequest,
  Timestamp,
  Claim,
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

/** The product's claims rules per product version. */
export interface RulesPort {
  getRules(productVersion: string): Promise<ClaimsRules>;
}

/** The claims engine's own state. Postgres in production, in memory in tests. */
export interface ClaimsStore {
  /**
   * Stores the claim and writes `events` to the outbox in the same transaction.
   * Throws StoreConflictError('claim_exists') if the id already exists; then
   * nothing is stored and no event is written.
   */
  saveClaim(claim: Claim, events: ClaimsEvent[]): Promise<void>;
  getClaim(claimId: string): Promise<Claim | null>;

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
}

/**
 * The store rejects a change that conflicts with existing state.
 * Every implementation throws this error in the same situations, so that
 * the service can answer 409 instead of 500 (see test-suites/claims-store.ts).
 */
export class StoreConflictError extends Error {
  constructor(
    public readonly reason: 'claim_exists' | 'decision_exists' | 'period_overlaps' | 'review_open',
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
  | { type: 'claim.review_requested'; occurredAt: Timestamp; request: ReviewRequest };

/** The claim an event concerns: the aggregate it belongs to in the outbox. */
export function eventClaimId(e: ClaimsEvent): string {
  switch (e.type) {
    case 'claim.registered':
      return e.claim.id;
    case 'claim.decided':
      return e.decision.claimId;
    case 'claim.review_requested':
      return e.request.claimId;
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
