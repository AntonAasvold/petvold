/**
 * Domain types for the claims engine.
 *
 * Conventions (see @petvold/common):
 * - Amounts are integers in the smallest currency unit. Never floats for money.
 * - Dates are ISO dates 'YYYY-MM-DD' without time. Points in time are ISO timestamps.
 */
import type { CurrencyCode, ISODate, MarketCode, MinorUnits, Timestamp } from '@petvold/common';

export type { CurrencyCode, ISODate, MarketCode, MinorUnits, Timestamp };

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

export type ClaimChannel = 'clinic_direct' | 'customer';

export interface ClaimLine {
  id: string;
  description: string;
  /** Category per the product's claims rules, e.g. 'examination', 'surgery', 'food'. */
  category: string;
  /** Diagnosis code for the line if it differs from the claim's main diagnosis. */
  diagnosisCode?: string;
  /** Amount including VAT, in the claim's currency. */
  amount: MinorUnits;
  /** The VAT part of amount, if the invoice states it. */
  vat?: MinorUnits;
}

export interface Claim {
  id: string;
  claimNo: string;
  policyId: string;
  animalId: string;
  market: MarketCode;
  currency: CurrencyCode;
  channel: ClaimChannel;
  /** The clinic that submitted the claim, taken from the caller's token (ADR 0016). Never from the request body. */
  clinicId?: string;
  treatmentFrom: ISODate;
  treatmentTo: ISODate;
  /** Main diagnosis for the claim. */
  diagnosisCode: string;
  lines: ClaimLine[];
  receivedAt: Timestamp;
}

/** Where a claim is in its handling, for work queues. */
export type ClaimState = 'awaiting-decision' | 'awaiting-approval' | 'review-requested' | 'decided';

/** A claim in a list: the claim without its lines, its state and its latest decision. */
export interface ClaimSummary {
  id: string;
  claimNo: string;
  policyId: string;
  animalId: string;
  market: MarketCode;
  currency: CurrencyCode;
  channel: ClaimChannel;
  clinicId?: string;
  treatmentFrom: ISODate;
  diagnosisCode: string;
  receivedAt: Timestamp;
  /** awaiting-approval (an open proposal) wins over review-requested, which wins over awaiting-decision. */
  state: ClaimState;
  latestDecision?: { seq: number; outcome: Outcome; payout: MinorUnits; decidedAt: Timestamp };
}

export interface ClaimFilter {
  state?: ClaimState;
  market?: MarketCode;
  policyId?: string;
  animalId?: string;
  clinicId?: string;
}

// ---------------------------------------------------------------------------
// Policy data the claims engine reads (contract with the policy core)
// ---------------------------------------------------------------------------

/**
 * Deductible model. Covers the common European variants:
 * - 'period': fixed deductible once per deductible period and diagnosis group (e.g. the Nordics)
 * - 'claim':  fixed deductible on every claim
 * - 'policy_year': fixed deductible once per policy year
 * plus a variable deductible that can increase with the animal's age.
 */
export interface DeductibleTerms {
  fixed: MinorUnits;
  fixedPer: 'period' | 'claim' | 'policy_year';
  /** Required when fixedPer is 'period'. */
  periodDays?: number;
  /**
   * Only for fixedPer 'period'. false (default): a period runs its full length,
   * also past the renewal into the next policy year, so one illness costs one
   * fixed deductible. true: the period ends when the policy year ends, and a
   * claim after the renewal is charged a new fixed deductible.
   * The terms in force when the period opens decide its end.
   */
  periodEndsAtRenewal?: boolean;
  /** Variable deductible in basis points: 2500 = 25 %. */
  variableBp: number;
  /** Higher variable deductible from a given age; the highest applicable step wins. */
  variableBpByAge?: Array<{ fromAgeYears: number; bp: number }>;
}

export interface VetCareTerms {
  code: 'vet_care';
  /** Annual limit per policy year. */
  annualLimit: MinorUnits;
  deductible: DeductibleTerms;
  /** Waiting period from the policy's inception date. */
  waitingPeriodDays: number;
}

export interface Rider {
  id: string;
  description: string;
  /** Diagnosis codes excluded for this particular animal. */
  diagnosisCodes: string[];
  validFrom: ISODate;
  validTo?: ISODate;
  /** Where it came from (ADR 0031): the underwriting rules at application, or set by a person. Omitted: older riders. */
  source?: 'underwriting' | 'manual';
  /** For a rider from underwriting: the application and the question it answers. */
  applicationId?: string;
  question?: string;
}

/**
 * The policy as it applied on a given date (valid time), according to what
 * the policy core knew at a given point in time (system time).
 */
export interface PolicySnapshot {
  policyId: string;
  /** Id of the bitemporal version this snapshot is based on. */
  policyVersionId: string;
  market: MarketCode;
  currency: CurrencyCode;
  animalId: string;
  animalBirthDate: ISODate;
  productVersion: string;
  status: 'active' | 'cancelled';
  /** The version's validity range, validTo exclusive. */
  validFrom: ISODate;
  validTo?: ISODate;
  /** The policy's original inception date, for the waiting period. */
  inceptionDate: ISODate;
  /** The policy year the treatment date falls in, end exclusive. */
  policyYearStart: ISODate;
  policyYearEnd: ISODate;
  vetCare?: VetCareTerms;
  riders: Rider[];
}

// ---------------------------------------------------------------------------
// The product's claims rules (versioned configuration)
// ---------------------------------------------------------------------------

export interface ClaimsRules {
  /** e.g. 'SE-HUND-VV@3': the rule series and version (ADR 0021). */
  rulesVersion: string;
  /** sha256 of the published rule set's content (ADR 0021). Omitted for rules that are not from the decisioning module. */
  rulesChecksum?: string;
  market: MarketCode;
  /** Is VAT on vet invoices reimbursed? Varies between markets and customer types. */
  vatReimbursable: boolean;
  /** Categories that are never reimbursed, e.g. food. */
  nonReimbursableCategories: string[];
  /** Diagnosis code -> diagnosis group. Drives deductible periods and rider matching. */
  diagnosisGroups: Record<string, string>;
  /** Highest payout that may be settled without a claims handler. */
  autoSettleMax: MinorUnits;
}

// ---------------------------------------------------------------------------
// State owned by the claims engine
// ---------------------------------------------------------------------------

export interface DeductiblePeriod {
  id: string;
  animalId: string;
  /** Diagnosis group, or '*' for a period covering the whole policy year. */
  diagnosisGroup: string;
  validFrom: ISODate;
  /** Exclusive end date. */
  validTo: ISODate;
  openedByClaimId: string;
}

// ---------------------------------------------------------------------------
// Assessment and decision
// ---------------------------------------------------------------------------

export type RuleStatus = 'pass' | 'fail' | 'review' | 'info';

export type RuleCode =
  | 'POLICY_FOUND'
  | 'POLICY_ACTIVE'
  | 'ANIMAL_MATCHES'
  | 'MARKET_CURRENCY'
  | 'WAITING_PERIOD'
  | 'COVERAGE'
  | 'RIDER'
  | 'DIAGNOSIS_KNOWN'
  | 'LIMIT';

/**
 * Rule outcome without text: `reason` is a stable key and `params` the values.
 * Text in the customer's or handler's language is produced at the edge (API, UI).
 * Amounts in params are in the smallest currency unit, with the currency in `currency`.
 */
export interface RuleResult {
  code: RuleCode;
  status: RuleStatus;
  reason: string;
  params: Record<string, string | number>;
}

export interface Calculation {
  billed: MinorUnits;
  nonReimbursable: MinorUnits;
  base: MinorUnits;
  currency: CurrencyCode;
  vatExcluded: MinorUnits;
  /** true if the claim charges the fixed deductible and opens a new period (for 'period' and 'policy_year'). */
  opensDeductiblePeriod: boolean;
  deductibleVariableBp: number;
  deductibleFixed: MinorUnits;
  deductibleVariable: MinorUnits;
  payableBeforeLimit: MinorUnits;
  annualLimit: MinorUnits;
  consumedBefore: MinorUnits;
  remainingBefore: MinorUnits;
  payout: MinorUnits;
  /** What the customer pays themselves of the billed amount. */
  customerShare: MinorUnits;
  cappedByLimit: boolean;
}

export type Outcome = 'approved' | 'partial' | 'rejected';
export type DecisionMode = 'auto' | 'manual';

export interface Assessment {
  claimId: string;
  market: MarketCode;
  currency: CurrencyCode;
  policyVersionId: string | null;
  productVersion: string | null;
  rulesVersion: string;
  rules: RuleResult[];
  calculation: Calculation | null;
  proposedOutcome: Outcome;
  mode: DecisionMode;
  diagnosisGroup: string | null;
  inputHash: string;
}

/** Why a handler decided against the assessment's proposal. */
export type DeviationReasonCode = 'pre_existing_condition' | 'not_covered' | 'insufficient_documentation' | 'incorrect_invoice' | 'other';

export interface ClaimDecision {
  id: string;
  claimId: string;
  /** 1, 2, 3 … – a new row per decision or reassessment, never an update. */
  seq: number;
  outcome: Outcome;
  payout: MinorUnits;
  assessment: Assessment;
  decidedBy: string;
  decidedAt: Timestamp;
  reason?: string;
  /** True if the handler decided against the proposal. Then reasonCode and reason are set. */
  deviatesFromProposal: boolean;
  reasonCode?: DeviationReasonCode;
  /**
   * True if no person judged the outcome: automatic settlement and reassessment.
   * The customer may request a human review of an automated decision (ADR 0018, GDPR art. 22).
   */
  automated: boolean;
  /** Set when this decision is the human review of a request (ReviewRequest.id). */
  reviewRequestId?: string;
  /** Set when the decision needed approval (ADR 0019): who approved it, never the same as decidedBy. */
  approvedBy?: string;
  /** The proposal the approval turned into this decision. */
  proposalId?: string;
}

/**
 * A handler's decision whose payout exceeds the handler's limit (ADR 0019).
 * Nothing is booked until someone else approves it; the approval becomes a ClaimDecision.
 */
export interface DecisionProposal {
  id: string;
  claimId: string;
  action: 'accept' | 'reject';
  outcome: Outcome;
  payout: MinorUnits;
  currency: CurrencyCode;
  /** The basis the proposal was made on. An approval requires exactly the same basis. */
  inputHash: string;
  proposedBy: string;
  proposedAt: Timestamp;
  reason?: string;
  reasonCode?: DeviationReasonCode;
  deviatesFromProposal: boolean;
  /** The proposer's limit in the claim's currency, which the payout exceeded. */
  proposerLimit: MinorUnits;
  status: 'open' | 'approved' | 'returned';
  /** Who approved or returned it, and when. Set when status is not 'open'. */
  closedBy?: string;
  closedAt?: Timestamp;
  /** The decision the approval became. Set when status is 'approved'. */
  decisionId?: string;
  /** Why it was returned. Set when status is 'returned'. */
  returnReason?: string;
}

/**
 * An order to pay out an increase in a claim's payout (ADR 0019). Written as an
 * event with the decision; the payments module chooses the payee (ADR 0017).
 */
export interface PayoutOrder {
  id: string;
  claimId: string;
  decisionId: string;
  policyId: string;
  /** The increase in the claim's payout. Always positive. */
  amount: MinorUnits;
  currency: CurrencyCode;
  channel: ClaimChannel;
  clinicId?: string;
}

/**
 * A request for human review of an automated decision (ADR 0018, GDPR art. 22).
 * Open until a claims handler decides the claim; that decision closes it.
 */
export interface ReviewRequest {
  id: string;
  claimId: string;
  /** The automated decision the customer wants reviewed. */
  decisionId: string;
  decisionSeq: number;
  /** Who made the request, e.g. the customer channel or a handler on the customer's behalf. */
  requestedBy: string;
  /** The customer's view, in their own words. */
  statement?: string;
  requestedAt: Timestamp;
  /** The human decision that closed the request. Set together with closedAt. */
  closedByDecisionId?: string;
  closedAt?: Timestamp;
}

/** Everything the assessment needs. Pure data in, pure data out: no calls, no clock, no text. */
export interface AssessmentInput {
  claim: Claim;
  policy: PolicySnapshot | null;
  rules: ClaimsRules;
  /**
   * The deductible period in force for the claim's scope (see deductibleScope),
   * or null if there is none. Ignored when the deductible is charged per claim.
   */
  openDeductiblePeriod: DeductiblePeriod | null;
  /** Limit consumed before this claim, for the same policy year. */
  consumedBefore: MinorUnits;
}


/**
 * What a decision was based on (ADR 0018). Stored with the decision and never
 * changed, so the decision can be proven and recalculated later.
 */
export interface DecisionEvidence {
  decisionId: string;
  /** Exactly what the engine assessed. sha256(input) equals the assessment's inputHash. */
  input: AssessmentInput;
  /** The calculation model that produced the result, e.g. 'vet-care.v1'. */
  calculationModel: string;
  /** Petvold's version and commit, e.g. '0.1.0+abc1234'. */
  engineVersion: string;
}

// ---------------------------------------------------------------------------
// Ledger (double-entry, append-only)
// ---------------------------------------------------------------------------

export interface LedgerLine {
  account: string;
  /** + debit, − credit. Every journal sums to zero. */
  amount: MinorUnits;
}

export interface LedgerJournal {
  id: string;
  /**
   * claim_decision: the decision's payout (sourceId = the decision).
   * claim_reserve: a reserve set when the claim goes to a handler (sourceId = the
   * claim) or released by a decision (sourceId = the decision).
   */
  sourceType: 'claim_decision' | 'claim_reserve';
  sourceId: string;
  claimId: string;
  /** All lines in the journal are in this currency (ADR 0014). */
  currency: CurrencyCode;
  bookedAt: Timestamp;
  lines: LedgerLine[];
}
