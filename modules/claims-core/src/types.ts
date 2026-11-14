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
  treatmentFrom: ISODate;
  treatmentTo: ISODate;
  /** Main diagnosis for the claim. */
  diagnosisCode: string;
  lines: ClaimLine[];
  receivedAt: Timestamp;
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
  /** e.g. 'SE-HUND-2026.2' */
  rulesVersion: string;
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
  sourceType: 'claim_decision';
  sourceId: string;
  claimId: string;
  /** All lines in the journal are in this currency (ADR 0014). */
  currency: CurrencyCode;
  bookedAt: Timestamp;
  lines: LedgerLine[];
}
