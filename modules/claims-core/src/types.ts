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
  /**
   * 1 as registered, then one more for each correction (ADR 0036). Omitted: 1.
   * Not part of the assessment's input, so a correction that changes nothing
   * the rules read gives the same inputHash.
   */
  revision?: number;
}

/** What a correction may change (ADR 0036). Policy, animal, market and currency never change: a claim on the wrong policy is dismissed and registered anew. */
export const CORRECTABLE_FIELDS = ['channel', 'treatmentFrom', 'treatmentTo', 'diagnosisCode', 'lines'] as const;
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];
export type ClaimData = Pick<Claim, CorrectableField>;

/**
 * A correction of a claim's details (ADR 0036). The claim gets a new revision;
 * earlier revisions are kept, and each decision names the revision it was made on.
 */
export interface ClaimCorrection {
  id: string;
  claimId: string;
  /** The revision the correction made, 2 or more. */
  revision: number;
  /** The fields that changed. */
  fields: CorrectableField[];
  reason: string;
  correctedBy: string;
  correctedAt: Timestamp;
  /**
   * The claim waits for a new decision by a person: the latest decision was a
   * person's, or the machine's but the corrected claim now needs a handler.
   * A later decision on this revision or after closes it.
   */
  reopens: boolean;
}

/** A revision of a claim: its details then, and the correction that made it (none for revision 1). */
export interface ClaimRevision {
  revision: number;
  data: ClaimData;
  correction?: ClaimCorrection;
}

/** A claim as registered: the server gives the id and the claim number when the client leaves them out (ADR 0036). */
export type NewClaim = Omit<Claim, 'id' | 'claimNo'> & { id?: string; claimNo?: string };

/**
 * Where a claim is in its handling, for work queues. withdrawn and dismissed are
 * closed without a decision; awaiting-information has an open request for more
 * information (ADR 0036).
 */
export const CLAIM_STATES = ['awaiting-decision', 'awaiting-approval', 'awaiting-information', 'review-requested', 'decided', 'withdrawn', 'dismissed'] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export const DISMISSAL_REASONS = ['duplicate', 'registered-in-error', 'not-a-claim'] as const;
export type DismissalReason = (typeof DISMISSAL_REASONS)[number];

/**
 * A claim closed without a decision (ADR 0036): withdrawn by the customer, or
 * dismissed, e.g. as a duplicate. Only before any decision; it cannot be undone.
 * Dismissal is not rejection: no decision, no explanation, no review.
 */
export interface ClaimClosure {
  id: string;
  claimId: string;
  kind: 'withdrawn' | 'dismissed';
  /** For a dismissal. */
  reasonCode?: DismissalReason;
  reason: string;
  /** The claim this one duplicates, for reasonCode duplicate. */
  duplicateOf?: string;
  closedBy: string;
  closedAt: Timestamp;
}

export const INFORMATION_ITEMS = ['itemised-invoice', 'medical-record', 'referral', 'other'] as const;
export type InformationItem = (typeof INFORMATION_ITEMS)[number];
export type InformationRecipient = 'customer' | 'clinic';
/**
 * open: waiting for the recipient. answered: the information came in, also
 * after the due date. expired: the due date passed without it. cancelled: no
 * longer needed, or the claim was closed.
 */
export type InformationRequestStatus = 'open' | 'answered' | 'expired' | 'cancelled';

/**
 * A request for more information before the claim can be decided (ADR 0036).
 * The days to the reminder and the due date come from the product's claims
 * rules in force when the request was made, unless the handler chose a due date.
 * An expired request never rejects the claim: it goes back to a handler.
 */
export interface InformationRequest {
  id: string;
  claimId: string;
  recipient: InformationRecipient;
  items: InformationItem[];
  /** What is missing, in the handler's words. */
  note: string;
  /** The last day to answer, in the claim's market. The request expires the day after. */
  dueDate: ISODate;
  /** The day a reminder is sent if the request is still open. Omitted: no reminder, since it would fall on or after the due date. */
  remindOn?: ISODate;
  /** The rules the days came from, e.g. 'SE-HUND-VV@3', or 'default' without rules. */
  rulesVersion: string;
  requestedBy: string;
  requestedAt: Timestamp;
  status: InformationRequestStatus;
  remindedAt?: Timestamp;
  /** When the information came in, which may be before it was registered. Set when answered. */
  receivedAt?: Timestamp;
  /** Who closed it and when: the person who registered the answer or cancelled it, or 'system' on expiry. */
  closedBy?: string;
  closedAt?: Timestamp;
  /** The answer's or the cancellation's note. */
  closingNote?: string;
}

/** The days in the product's claims rules (ADR 0036). */
export interface InformationRequestRules {
  /** Days from the request to the reminder. Default 14. */
  reminderAfterDays: number;
  /** Days from the request to the due date. Default 30. */
  expiresAfterDays: number;
}

export const DEFAULT_INFORMATION_REQUEST_RULES: InformationRequestRules = { reminderAfterDays: 14, expiresAfterDays: 30 };

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
  /**
   * Closed (withdrawn, dismissed) wins over awaiting-approval (an open proposal),
   * then awaiting-information (an open request), review-requested, decided and
   * awaiting-decision.
   */
  state: ClaimState;
  latestDecision?: { seq: number; outcome: Outcome; payout: MinorUnits; decidedAt: Timestamp };
  /**
   * When the basis was complete, for FAL 7 kap. 1 § (ADR 0036): received, or the
   * latest answer or expiry of a request. Omitted while a request is open.
   */
  basisCompleteAt?: Timestamp;
  /** The latest request expired without an answer: "the information never came in". */
  informationMissing?: boolean;
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
  /** Days to the reminder and the due date of a request for information (ADR 0036). Omitted: 14 and 30. */
  informationRequest?: InformationRequestRules;
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
  /** The claim's revision the decision was made on (ADR 0036). Omitted: 1. */
  claimRevision?: number;
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
 * A decision that lowered the claim's payout (ADR 0040, punkt 8): the decrease,
 * for billing to propose recovery. Every change to a payout is either an order
 * (up) or a reduction (down), so their sum is always the payout decided.
 */
export interface PayoutReduction {
  id: string;
  claimId: string;
  decisionId: string;
  policyId: string;
  /** The decrease in the claim's payout. Always positive. */
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
  /**
   * The claim's attachments in force when the decision was made, by id and
   * checksum (ADR 0036). Not input to the rules, so not in inputHash. Omitted
   * for decisions made before attachments were kept.
   */
  attachments?: AttachmentRef[];
}

export const ATTACHMENT_KINDS = ['invoice', 'medical-record', 'referral', 'photo', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/**
 * A document on a claim, as a reference to the insurer's archive (ADR 0036):
 * Petvold keeps the address and the checksum, never the file. An attachment
 * never changes; a new one may replace it.
 */
export interface ClaimAttachment {
  id: string;
  claimId: string;
  kind: AttachmentKind;
  /** e.g. application/pdf. */
  mediaType: string;
  /** In bytes. */
  size: number;
  /** sha256 of the file, lowercase hex. */
  sha256: string;
  /** Where the file is in the archive: an https address or a URN. */
  url: string;
  /** The request for information it answers, if any. */
  informationRequestId?: string;
  /** The attachment it replaces, e.g. a better scan of the same invoice. */
  replaces?: string;
  addedBy: string;
  addedAt: Timestamp;
}

/** An attachment as a decision's evidence names it. */
export interface AttachmentRef {
  id: string;
  sha256: string;
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
