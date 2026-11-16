/**
 * Policies (ADR 0029): one animal, one policyholder, one product, and the whole
 * history.
 *
 * - A **term** is a period of insurance with its product version, chosen
 *   options, vet care terms and premium. It never changes.
 * - A **version** says who the policyholder is and whether the policy is in
 *   force for a validity period (valid time), as known from a point in time
 *   (system time, ADR 0006). A change never overwrites a version: it ends the
 *   old one in system time and adds new ones.
 * - A **transaction** records each change with its steps and who made it.
 *
 * Policies are issued, changed, renewed, transferred and cancelled, and a
 * cancellation can be reversed. A change of the choices during a term is a
 * TermChange from a date; the versions from that date point at it. Events from the animal register become proposals: a
 * transfer when the animal is sold, a cancellation when it dies. Every change writes events to an outbox in
 * the same transaction (ADR 0008).
 * A product with underwriting rules is applied for (ADR 0031): the application
 * is stored with its evidence, and an accepted one issues the policy in the
 * same transaction.
 * The module reads products, animals and parties only through ports (ADR 0001),
 * and implements the claims engine's PolicyPort.
 */
import type { ISODate, PolicyPort, PolicySnapshot, Rider, Timestamp, VetCareTerms } from '@petvold/claims-core';
import { marketDate } from '@petvold/common';
import { PricingError, price, type PriceInput, type PriceResult, type PriceTermsContent, type TariffContent, type TariffRef } from '@petvold/pricing-core';
import {
  underwrite,
  UnderwritingError,
  type Answer,
  type UnderwritingContent,
  type UnderwritingInput,
  type UnderwritingRef,
  type UnderwritingResult,
} from '@petvold/underwriting-core';

export type { ISODate };

/**
 * The law that applies per market (ADR 0029), shipped with Petvold. A product
 * can choose within it but never weaken it.
 */
export interface MarketProfile {
  market: string;
  /** The longest term without special reasons. */
  maxTermMonths: number;
  /** A policy never starts before the day it is issued. */
  retroactiveStart: false;
  /** Days the customer may withdraw from a contract made at a distance. */
  withdrawalDays: number;
  /** The insurer's notice before the term ends, to end the policy then. */
  insurerTermEndNoticeMonths: number;
  /** Days from sending until the insurer's cancellation during a term takes effect. */
  insurerMidTermNoticeDays: number;
  /** Days from sending until a cancellation for unpaid premium takes effect. */
  unpaidPremiumNoticeDays: number;
  sources: string[];
}

export const MARKET_PROFILES: Record<string, MarketProfile> = {
  SE: {
    market: 'SE',
    maxTermMonths: 12,
    retroactiveStart: false,
    withdrawalDays: 14,
    insurerTermEndNoticeMonths: 1,
    insurerMidTermNoticeDays: 14,
    unpaidPremiumNoticeDays: 14,
    sources: [
      'Insurance Contracts Act (2005:104) chapter 3 section 2: a term of at most one year',
      'Insurance Contracts Act chapter 3 section 3: the customer may cancel at the end of the term at any time; the insurer gives notice at least a month before',
      'Insurance Contracts Act chapter 3 section 6: the customer may cancel early when the need for insurance ceases; effect the day after notice',
      'Insurance Contracts Act chapter 3 section 7: the insurer may cancel during the term only on serious breach or exceptional reasons, fourteen days after sending',
      'Insurance Contracts Act chapter 5 section 2: unpaid premium, fourteen days after sending',
      'Insurance Contracts Act chapter 5 section 6: premium only for the time the insurer was liable',
      'Distance Contracts Act (2005:59) chapter 3 sections 13, 17 and 20: withdrawal within 14 days, paying for the time covered',
    ],
  },
};

/** Why a policy ends early or at the end of a term (ADR 0029). */
export const CANCELLATION_REASONS = [
  /** The customer, at the end of the term (always allowed). */
  'customer-term-end',
  /** The customer, the day after notice, with the rest of the premium refunded, if the product allows it. */
  'customer-immediate',
  /** Withdrawal within the withdrawal period (always allowed). */
  'withdrawal',
  /** The need for insurance ceased, e.g. the animal died. From that day, possibly in the past (always allowed). */
  'need-ceased',
  /** The insurer, at the end of the term, with notice. */
  'insurer-term-end',
  /** The insurer during the term, after serious breach or for exceptional reasons. */
  'insurer-breach',
  /** The insurer, for unpaid premium. */
  'unpaid-premium',
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export interface Policy {
  id: string;
  market: string;
  animalId: string;
  /** The first day of the first term. The waiting period counts from it. */
  inceptionDate: ISODate;
  createdBy: string;
  createdAt: Timestamp;
}

export interface Term {
  policyId: string;
  /** 1, 2, 3 … */
  termNo: number;
  startDate: ISODate;
  /** Exclusive. */
  endDate: ISODate;
  /** e.g. SE-HUND-VV-LIV@2026.2 (ADR 0023). */
  productVersion: string;
  currency: string;
  vetCare: VetCareTerms;
  /** The chosen deductible option, for display. */
  deductibleOption: string;
  /** The premium for the whole term, in minor units of `currency`. */
  premium: number;
  riders: Rider[];
  transactionId: string;
  /** Changes of the choices during the term, oldest first (ADR 0029). Each never changes. */
  changes?: TermChange[];
  /** How the premium was priced by the tariff, if the product has one (ADR 0030). */
  pricing?: TermPricing;
}

/**
 * The evidence for a premium (ADR 0030): the tariff's price with its inputs,
 * without the postal code (only its zone), so it can be recomputed. A manual
 * price keeps the computed one next to it.
 */
export interface TermPricing {
  result: PriceResult;
  /** What the price was computed from; the zone instead of the postal code. */
  input: Omit<PriceInput, 'postalCode'> & { zone: string };
  override?: { computedPremium: number; reason: string; by: string };
}

/** New choices from a day during a term. The versions from that day carry its changeNo. */
export interface TermChange {
  /** 1, 2, 3 … within the term. */
  changeNo: number;
  from: ISODate;
  vetCare: VetCareTerms;
  deductibleOption: string;
  /** The premium for a whole term at the new choices; the days from `from` are charged at this rate. */
  premium: number;
  transactionId: string;
  pricing?: TermPricing;
}

export interface PolicyVersion {
  id: string;
  policyId: string;
  /** Valid time, validTo exclusive. */
  validFrom: ISODate;
  validTo: ISODate;
  /** System time: when the version became known, and when it was superseded. */
  sysFrom: Timestamp;
  sysTo?: Timestamp;
  policyholderPartyId: string;
  status: 'active' | 'cancelled';
  termNo: number;
  /** The change of the term this version follows, if any. */
  changeNo?: number;
  transactionId: string;
}

export const TRANSACTION_STEPS = ['draft', 'priced', 'underwritten', 'issued'] as const;

export interface PolicyTransaction {
  id: string;
  policyId: string;
  type: 'issue' | 'cancel' | 'reinstate' | 'renew' | 'transfer' | 'change';
  steps: { step: (typeof TRANSACTION_STEPS)[number]; at: Timestamp; note?: string }[];
  requestedBy: string;
  requestedAt: Timestamp;
  /** The versions this transaction ended in system time. */
  supersedes?: string[];
  cancellation?: {
    reason: CancellationReason;
    /** The day the notice reached the insurer, or the insurer sent it. */
    receivedOn: ISODate;
    /** The first day the policy no longer applies. */
    effectiveDate: ISODate;
    /** Premium for the days that no longer apply, to be paid back (M5). */
    refund: { amount: number; currency: string };
    note?: string;
  };
  renewal?: {
    termNo: number;
    productVersion: string;
    premium: { amount: number; currency: string };
  };
  /** How the customer accepted at issue (ADR 0031), and the application it came from. Omitted: issued before ADR 0031. */
  issue?: { acceptance: Acceptance; applicationId?: string };
  transfer?: {
    fromPartyId: string;
    toPartyId: string;
    /** The first day the new policyholder holds the policy: the day of sale. */
    from: ISODate;
    acceptance: Acceptance;
    /** Premium for the days from the sale: back to the previous policyholder, and due from the new one (M5). */
    premium: { amount: number; currency: string };
  };
  change?: {
    termNo: number;
    changeNo: number;
    from: ISODate;
    annualLimit: number;
    deductibleOption: string;
    premium: { amount: number; currency: string };
    /** What the change costs for the rest of the term: positive to pay, negative to refund (M5). */
    premiumAdjustment: number;
    reason: string;
  };
  /** A reinstatement: the cancellation it reverses. */
  reverses?: string;
  note?: string;
}

/**
 * Policies grouped for a litter or a household (ADR 0007): one policyholder,
 * later one invoice and a group discount. A group never affects claims.
 */
export interface PolicyGroup {
  id: string;
  market: string;
  kind: 'litter' | 'household';
  /** Every member's policyholder while it is a member. */
  holderPartyId: string;
  /** For a litter: the litter in the animal register. */
  litterId?: string;
  createdBy: string;
  createdAt: Timestamp;
  members: GroupMembership[];
}

export interface GroupMembership {
  policyId: string;
  from: ISODate;
  /** The first day it is no longer a member. Omitted: still a member. */
  to?: ISODate;
  addedBy: string;
  addedAt: Timestamp;
  endedBy?: string;
  endedAt?: Timestamp;
  endReason?: string;
}

/** What a change stores besides versions, transaction and events, in the same transaction. */
export interface ApplyExtra {
  terms?: Term[];
  decision?: { proposalId: string; decision: ProposalDecision };
  changes?: (TermChange & { policyId: string; termNo: number })[];
  endMemberships?: { groupId: string; policyId: string; to: ISODate; endedBy: string; endedAt: Timestamp; reason: string }[];
}

/** How the policyholder accepted the terms (ADR 0029, 0031). */
export interface Acceptance {
  /** e.g. 'web', 'app', 'phone', 'paper'. */
  channel: string;
  /** e.g. a signing or recording reference in the channel. */
  reference?: string;
  /** When the customer accepted: as the channel says at issue, when Petvold recorded it at a transfer. */
  acceptedAt: Timestamp;
  /** At issue: when Petvold received it. */
  receivedAt?: Timestamp;
  /** The product's documents the channel showed the customer (ADR 0032). */
  documents?: AcceptedDocument[];
}

/** A product document the customer was shown, as the product version lists it (ADR 0032). */
export interface AcceptedDocument {
  /** terms, pre-contract or ipid. */
  type: string;
  /** ISO 639-1. */
  language: string;
  /** The document's checksum in the product version. */
  sha256: string;
}

/** The customer's acceptance as the channel gives it at issue (ADR 0031). */
export interface AcceptanceInput {
  channel: string;
  reference?: string;
  acceptedAt: Timestamp;
  /** Required for a product with documents: at least the terms and the pre-contract information (ADR 0032). */
  documents?: AcceptedDocument[];
}

/** The documents an acceptance must name for a product with documents (ADR 0032). */
export const REQUIRED_ACCEPTED_DOCUMENTS = ['terms', 'pre-contract'] as const;

/** accepted, referred or declined by the rules; a referred one becomes accepted, declined, withdrawn or expired by its decision. */
export type ApplicationStatus = 'accepted' | 'referred' | 'declined' | 'withdrawn' | 'expired';

/** What became of a referred application (ADR 0031): a person's decision, the channel's withdrawal or expiry. It never changes. */
export interface ApplicationDecision {
  outcome: 'accepted' | 'declined' | 'withdrawn' | 'expired';
  /** accepted: the riders the policy got. */
  riders?: Rider[];
  /** declined: the reason code the channel explains (FAL 7 kap. 6 §). */
  reason?: string;
  /** The person's grounds, or why it was withdrawn or expired. */
  note?: string;
  /** accepted: the policy issued. */
  policyId?: string;
  decidedBy: string;
  decidedAt: Timestamp;
}

/** A person's decision on a referred application. */
export interface ApplicationDecisionInput {
  outcome: 'accept' | 'decline';
  /** The grounds. Required. */
  note: string;
  /** decline: a reason code, e.g. 'ongoing-symptoms'. */
  reason?: string;
  /** accept: the riders, replacing the ones the rules proposed. Omitted: the rules' proposals. */
  riders?: { diagnosisCodes: string[]; description: string }[];
  /** accept: a later start, when the start applied for has passed. */
  startDate?: ISODate;
}

/**
 * An application for a policy on a product with underwriting rules (ADR 0031),
 * stored with what the rules were run on and what they gave, so the outcome can
 * be shown and recomputed (ADR 0018). It never changes.
 */
export interface Application {
  id: string;
  market: string;
  animalId: string;
  policyholderPartyId: string;
  productVersion: string;
  startDate: ISODate;
  /** The customer's choices as given. */
  vetCare?: { annualLimit?: number; deductible?: string };
  groupId?: string;
  campaignCode?: string;
  acceptance: Acceptance;
  /** The premium for the term the customer applied at. */
  premium: { amount: number; currency: string };
  /** The current status: the decision's outcome, else what the rules gave. */
  status: ApplicationStatus;
  /** A referred application: the last day for a decision. After it, the expiry run ends it. */
  deadline?: ISODate;
  decision?: ApplicationDecision;
  /** The evidence: the input with the answers, the result with every check, and the engine. */
  underwriting: { input: UnderwritingInput; result: UnderwritingResult; engineVersion: string };
  /** The policy it led to, at once or by a person's decision. */
  policyId?: string;
  receivedBy: string;
  receivedAt: Timestamp;
}

/** What an issue stores besides the policy, in the same transaction (ADR 0031). */
export interface IssueExtra {
  /** The application accepted at once. */
  application?: Application;
  /** A person's acceptance of a referred application. */
  decision?: { applicationId: string; decision: ApplicationDecision };
}

export interface ApplicationFilter {
  status?: ApplicationStatus;
  market?: string;
  animalId?: string;
  policyholderPartyId?: string;
}

/** What the policy module proposes after an event from the animal register (ADR 0029). */
export interface Proposal {
  id: string;
  policyId: string;
  market: string;
  kind: 'transfer' | 'cancel-death';
  sourceEventId: string;
  details: { fromPartyId: string; toPartyId: string; from: ISODate } | { deceasedOn: ISODate };
  /** A transfer the new owner has not accepted by this day ends the policy from the day of sale. */
  deadline?: ISODate;
  createdAt: Timestamp;
  decision?: ProposalDecision;
}

export interface ProposalDecision {
  outcome: 'accepted' | 'rejected' | 'expired';
  acceptance?: Acceptance;
  reason?: string;
  /** The change it led to, if any. */
  transactionId?: string;
  decidedBy: string;
  decidedAt: Timestamp;
}

/** An event from the animal register, as the policy module reads it. */
export interface AnimalEventInput {
  id: string;
  type: string;
  animalId: string;
  data: Record<string, unknown>;
}

/** What the policy module tells others, written in the same transaction as the change (ADR 0008). */
export interface PolicyEvent {
  id: string;
  type:
    | 'policy.issued'
    | 'policy.changed'
    | 'policy.renewed'
    | 'policy.transferred'
    | 'policy.cancelled'
    | 'policy.reinstated'
    | 'policy.version_superseded'
    | 'application.received'
    | 'application.referred'
    | 'application.accepted'
    | 'application.declined'
    | 'application.withdrawn'
    | 'application.expired';
  /** Omitted for an application that has not led to a policy. */
  policyId?: string;
  applicationId?: string;
  occurredAt: Timestamp;
  data: Record<string, unknown>;
}

/** A policy with its terms and current versions (what is known now). */
export interface PolicyRecord extends Policy {
  terms: Term[];
  versions: PolicyVersion[];
}

export interface PolicyStore {
  get(id: string): Promise<PolicyRecord | null>;
  /** Every version, superseded ones too, ordered by sysFrom then validFrom. */
  history(id: string): Promise<PolicyVersion[]>;
  transactions(id: string): Promise<PolicyTransaction[]>;
  /** The version valid on the date as known at `knownAt` (omitted: now). */
  versionAt(id: string, onDate: ISODate, knownAt?: Timestamp): Promise<PolicyVersion | null>;
  /** Policy ids for the animal, and for the policyholder in any current version. */
  findByAnimal(animalId: string): Promise<string[]>;
  findByPolicyholder(partyId: string): Promise<string[]>;
  /**
   * Stores a new policy with its first term, version and transaction, and the
   * application it came from, all or nothing. Throws PolicyConflictError if the
   * animal already has a policy whose current versions overlap the new one.
   */
  issue(policy: Policy, term: Term, version: PolicyVersion, tx: PolicyTransaction, events: PolicyEvent[], extra?: IssueExtra): Promise<void>;
  /** Stores the decision on a referred application with its events. Throws PolicyConflictError if it is already decided. */
  decideApplication(applicationId: string, decision: ApplicationDecision, events: PolicyEvent[]): Promise<void>;
  /** Stores an application that did not lead to a policy, with its events. */
  addApplication(a: Application, events: PolicyEvent[]): Promise<void>;
  getApplication(id: string): Promise<Application | null>;
  /** Oldest first. */
  listApplications(filter: ApplicationFilter): Promise<Application[]>;
  /**
   * Ends `supersede` in system time at tx.requestedAt and adds `add`, all or
   * nothing. Throws PolicyConflictError if any of them is no longer current.
   */
  apply(
    policyId: string,
    supersede: string[],
    add: PolicyVersion[],
    tx: PolicyTransaction,
    events: PolicyEvent[],
    extra?: ApplyExtra,
  ): Promise<void>;
  /** Stores a proposal unless one for the same source event exists. Returns whether it was stored. */
  addProposal(p: Proposal): Promise<boolean>;
  getProposal(id: string): Promise<Proposal | null>;
  /** Oldest first. */
  listProposals(filter: { policyId?: string; pending?: boolean }): Promise<Proposal[]>;
  /** Stores a decision that changes no policy. Throws PolicyConflictError if it is already decided. */
  decideProposal(proposalId: string, decision: ProposalDecision): Promise<void>;
  createGroup(group: PolicyGroup): Promise<void>;
  getGroup(id: string): Promise<PolicyGroup | null>;
  /** Groups for a policyholder, or with the policy as a member now or before. */
  findGroups(filter: { holderPartyId?: string; policyId?: string }): Promise<PolicyGroup[]>;
  /** Throws PolicyConflictError if the policy is already a member of a group. */
  addMember(groupId: string, m: GroupMembership): Promise<void>;
  /** Ends the open membership. Throws PolicyConflictError if there is none. */
  endMember(groupId: string, policyId: string, end: { to: ISODate; endedBy: string; endedAt: Timestamp; reason: string }): Promise<void>;
  /**
   * Policies with a current active version ending in [from, to] that no current
   * version follows: the ones that are up for renewal.
   */
  endingBetween(from: ISODate, to: ISODate): Promise<string[]>;
  /** Events not yet published, oldest first. */
  pendingEvents(limit: number): Promise<PolicyEvent[]>;
  markPublished(ids: string[], at: Timestamp): Promise<void>;
}

export class PolicyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyConflictError';
  }
}

export type PolicyErrorCode = 'not_found' | 'validation' | 'conflict' | 'forbidden';

export class PolicyError extends Error {
  constructor(
    public readonly code: PolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PolicyError';
  }
}

/** What the policy module needs to know about a product version on a date. */
export interface ProductOffer {
  /** The product, e.g. SE-HUND-VV-LIV, without the version. */
  product: string;
  market: string;
  currency: string;
  species: string[];
  onSale: boolean;
  /** Days a new owner has to accept a transferred policy. */
  transferAcceptanceDays: number;
  /** Days an application referred to a person may wait before it expires (ADR 0031). Omitted: 30. */
  applicationExpiryDays?: number;
  /** The tariff series that prices it (ADR 0030). Omitted: no tariff, the premium is given by hand. */
  tariffSeries?: string;
  /** The price terms series (ADR 0030). */
  priceTermsSeries?: string;
  /** The underwriting rules series (ADR 0031). Omitted: policies are issued directly, without questions. */
  underwritingSeries?: string;
  /** The product version's documents (ADR 0032). Omitted or empty: the acceptance names none. */
  documents?: AcceptedDocument[];
  /** The product's setting for the customer's cancellation during a term (ADR 0029). */
  midTermCancellation: 'term-end' | 'immediate';
  /** The length of a term in months. */
  termMonths: number;
  /** Days before a term ends that it is renewed. */
  renewalLeadDays: number;
  /** Throws on an option the product does not offer. */
  vetCareTermsFor(choice: { annualLimit?: number; deductible?: string }): VetCareTerms & { deductibleOption: string };
}

export interface ProductPort {
  /** The product version, e.g. SE-HUND-VV-LIV@2026.2, as offered on the date, or null if it does not exist. */
  offer(productVersion: string, onDate: ISODate): Promise<ProductOffer | null>;
  /** The version of the product on sale on the date, e.g. SE-HUND-VV-LIV@2027.1, or null. */
  versionOnSale(product: string, onDate: ISODate): Promise<string | null>;
}

/** Why the renewal run did not renew a policy that is up for renewal, so someone decides. */
export type RenewalIssue =
  | 'product-not-on-sale'
  | 'option-not-offered'
  | 'species-not-covered'
  | 'term-too-long'
  | 'animal-died'
  | 'policyholder-unavailable'
  | 'price-not-available';

export interface RenewalRunResult {
  onDate: ISODate;
  dryRun: boolean;
  checked: number;
  renewed: { policyId: string; termNo: number; startDate: ISODate; endDate: ISODate; productVersion: string; premium: number; transactionId?: string }[];
  /** Not renewed because a cancellation applies at the end of the term. */
  cancelled: number;
  /** Up for renewal later, by the product's lead time. */
  notYet: number;
  needsDecision: { policyId: string; issue: RenewalIssue; detail: string }[];
}

export interface AnimalPort {
  get(animalId: string): Promise<{ market: string; species: string; breed?: string; birthDate: ISODate; deceasedOn?: ISODate } | null>;
}

export interface PartyPort {
  /** The party's market, or null if it does not exist or may not get new relations (ADR 0028). */
  marketOf(partyId: string): Promise<string | null>;
  /** The postal code of the party's address, for the tariff's zone (ADR 0030). null: none. */
  postalCodeOf?(partyId: string): Promise<string | null>;
}

/** The tariff in force, from the decisioning module (ADR 0030). */
export interface TariffPort {
  tariffInForce(series: string, onDate: ISODate): Promise<{ content: TariffContent; ref: TariffRef } | null>;
  priceTermsInForce?(series: string, onDate: ISODate): Promise<{ content: PriceTermsContent; ref: TariffRef } | null>;
}

/** The underwriting rules in force, from the decisioning module (ADR 0031). */
export interface UnderwritingPort {
  underwritingInForce(series: string, onDate: ISODate): Promise<{ content: UnderwritingContent; ref: UnderwritingRef } | null>;
}

export interface QuoteInput {
  market: string;
  productVersion: string;
  startDate: ISODate;
  /** A registered animal, or the facts about one. */
  animalId?: string;
  animal?: { species: string; breed?: string; birthDate: ISODate };
  /** The policyholder, whose postal code gives the zone; or the postal code itself. Neither: the default zone. */
  policyholderPartyId?: string;
  postalCode?: string;
  vetCare?: { annualLimit?: number; deductible?: string };
  /** A group the policy would join (ADR 0007), for its discount; or the group's kind and the animal's place in it. */
  groupId?: string;
  group?: { kind: 'litter' | 'household'; memberNo: number };
  campaignCode?: string;
  /** Answers to the underwriting questions: the quote then says what an application would lead to (ADR 0031). */
  answers?: Answer[];
}

/** A price indication (ADR 0030). Nothing is stored. */
export interface Quote {
  market: string;
  productVersion: string;
  startDate: ISODate;
  endDate: ISODate;
  vetCare: VetCareTerms;
  deductibleOption: string;
  price: PriceResult;
  /** What an application with the answers would lead to, if answers were given. */
  underwriting?: UnderwritingResult;
}

export interface PolicyDeps {
  store: PolicyStore;
  products: ProductPort;
  animals: AnimalPort;
  parties: PartyPort;
  clock: { now(): string };
  ids: { next(prefix: string): string };
  profiles?: Record<string, MarketProfile>;
  /** Omitted: no product has a tariff, and quotes answer that. */
  tariffs?: TariffPort;
  /** Omitted: no underwriting rules are found, and applications are refused. */
  underwriting?: UnderwritingPort;
  /** Stored with every application's evidence (ADR 0018), e.g. the release version. */
  engineVersion?: string;
}

export interface IssueInput {
  market: string;
  animalId: string;
  policyholderPartyId: string;
  productVersion: string;
  startDate: ISODate;
  vetCare?: { annualLimit?: number; deductible?: string };
  /**
   * The premium for the term. Omitted: the product's tariff prices it (ADR 0030).
   * Given for a product with a tariff: a manual price, which needs priceOverride.
   */
  premium?: { amount: number; currency: string };
  /** Why the premium differs from the tariff's. Needs the permission policies:price-override. */
  priceOverride?: { reason: string };
  /** A group the policy joins from its start, for the group discount (ADR 0007). */
  groupId?: string;
  campaignCode?: string;
  /** How the customer accepted the offer (ADR 0031). */
  acceptance: AcceptanceInput;
}

/** An application (ADR 0031): what an issue takes, and the answers to the underwriting questions. */
export interface ApplicationInput extends IssueInput {
  answers: Answer[];
}

/** What the caller may do beyond the operation itself. */
export interface CallerRights {
  /** May set a premium other than the tariff's (policies:price-override). */
  mayOverridePrice?: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The date `months` later; the 31st becomes the last day of a shorter month. Pure. */
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/** The day after. Pure. */
export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days from `from` to `to`, `to` exclusive. Pure. */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The premium for the days from `from` that were active and no longer are:
 * the term's premium per day, rounded to the nearest minor unit (FAL 5 kap. 6 §). Pure.
 */
export function refundFor(terms: Term[], activeBefore: PolicyVersion[], from: ISODate): number {
  let total = 0;
  for (const t of terms) {
    const termDays = daysBetween(t.startDate, t.endDate);
    let lost = 0;
    for (const v of activeBefore.filter((x) => x.status === 'active' && x.termNo === t.termNo)) {
      const start = v.validFrom > from ? v.validFrom : from;
      if (start < v.validTo) lost += effectiveTerms(t, v).premium * daysBetween(start, v.validTo);
    }
    total += Math.round(lost / termDays);
  }
  return total;
}

/** The documents of an acceptance, checked for form and sorted. Throws a validation error. Pure. */
function acceptedDocumentsOf(docs: AcceptedDocument[]): AcceptedDocument[] {
  if (!Array.isArray(docs)) throw new PolicyError('validation', 'acceptance.documents must be a list');
  const out: AcceptedDocument[] = [];
  for (const d of docs) {
    if (typeof d?.type !== 'string' || typeof d.language !== 'string' || typeof d.sha256 !== 'string') {
      throw new PolicyError('validation', 'Each of acceptance.documents needs type, language and sha256');
    }
    if (out.some((o) => o.type === d.type && o.language === d.language)) throw new PolicyError('validation', `acceptance.documents names ${d.type} in '${d.language}' twice`);
    out.push({ type: d.type, language: d.language, sha256: d.sha256.toLowerCase() });
  }
  return out.sort((a, b) => (a.type + a.language < b.type + b.language ? -1 : 1));
}

/**
 * The documents an acceptance names must be the product version's, with the
 * same checksum, and a product with documents needs the terms and the
 * pre-contract information (ADR 0032). Pure.
 */
export function checkAcceptedDocuments(acceptance: Pick<Acceptance, 'documents'>, offer: Pick<ProductOffer, 'documents'>, productVersion: string): void {
  const product = offer.documents ?? [];
  const named = acceptance.documents ?? [];
  for (const d of named) {
    const p = product.find((x) => x.type === d.type && x.language === d.language);
    if (!p) throw new PolicyError('validation', `${productVersion} has no ${d.type} document in '${d.language}'`);
    if (p.sha256 !== d.sha256) throw new PolicyError('validation', `The ${d.type} document in '${d.language}' is not the one ${productVersion} has: its checksum differs`);
  }
  if (!product.length) return;
  const missing = REQUIRED_ACCEPTED_DOCUMENTS.filter((t) => !named.some((d) => d.type === t));
  if (missing.length) throw new PolicyError('validation', `acceptance.documents must name the ${missing.join(' and ')} the customer was shown`);
}

/** The choices and premium a version follows: the term's, or a change's. Pure. */
export function effectiveTerms(t: Term, v: Pick<PolicyVersion, 'changeNo'>): { vetCare: VetCareTerms; deductibleOption: string; premium: number } {
  const c = v.changeNo === undefined ? undefined : t.changes?.find((x) => x.changeNo === v.changeNo);
  return c ? { vetCare: c.vetCare, deductibleOption: c.deductibleOption, premium: c.premium } : { vetCare: t.vetCare, deductibleOption: t.deductibleOption, premium: t.premium };
}

/** The claims engine's view of a version: the term it belongs to and the policy year. Pure. */
export function toSnapshot(p: Policy, term: Term, v: PolicyVersion, animalBirthDate: ISODate): PolicySnapshot {
  return {
    policyId: p.id,
    policyVersionId: v.id,
    market: p.market,
    currency: term.currency,
    animalId: p.animalId,
    animalBirthDate,
    productVersion: term.productVersion,
    status: v.status,
    validFrom: v.validFrom,
    validTo: v.validTo,
    inceptionDate: p.inceptionDate,
    policyYearStart: term.startDate,
    policyYearEnd: term.endDate,
    vetCare: structuredClone(effectiveTerms(term, v).vetCare),
    riders: structuredClone(term.riders),
  };
}

export class PolicyService implements PolicyPort {
  constructor(private readonly d: PolicyDeps) {}

  async get(id: string): Promise<PolicyRecord> {
    const p = await this.d.store.get(id);
    if (!p) throw new PolicyError('not_found', `Policy ${id} does not exist`);
    return p;
  }

  async history(id: string): Promise<{ versions: PolicyVersion[]; transactions: PolicyTransaction[] }> {
    await this.get(id);
    return { versions: await this.d.store.history(id), transactions: await this.d.store.transactions(id) };
  }

  async findByAnimal(animalId: string): Promise<PolicyRecord[]> {
    return Promise.all((await this.d.store.findByAnimal(animalId)).map((id) => this.get(id)));
  }

  async findByPolicyholder(partyId: string): Promise<PolicyRecord[]> {
    return Promise.all((await this.d.store.findByPolicyholder(partyId)).map((id) => this.get(id)));
  }

  /** The claims engine's PolicyPort: the policy on the date, as known at `knownAt`. */
  async getPolicyAt(policyId: string, onDate: ISODate, knownAt?: Timestamp): Promise<PolicySnapshot | null> {
    const p = await this.d.store.get(policyId);
    if (!p) return null;
    const v = await this.d.store.versionAt(policyId, onDate, knownAt);
    if (!v) return null;
    const term = p.terms.find((t) => t.termNo === v.termNo);
    const animal = await this.d.animals.get(p.animalId);
    if (!term || !animal) return null;
    return toSnapshot(p, term, v, animal.birthDate);
  }

  async transactions(id: string): Promise<PolicyTransaction[]> {
    await this.get(id);
    return this.d.store.transactions(id);
  }

  /**
   * Ends the policy from the date the reason gives (ADR 0029). The market
   * profile decides notice and timing, the product whether the customer may
   * end it during a term. Versions from that date are superseded by a
   * cancelled one, and the premium for the days lost is to be refunded.
   */
  async cancel(
    policyId: string,
    input: { reason: CancellationReason; receivedOn?: ISODate; effectiveDate?: ISODate; note?: string },
    by: string,
    decision?: { proposalId: string; decision: ProposalDecision },
  ): Promise<PolicyTransaction> {
    const p = await this.get(policyId);
    const profile = this.profile(p.market);
    const today = marketDate(p.market, this.d.clock.now());
    if (!(CANCELLATION_REASONS as readonly string[]).includes(input.reason)) throw new PolicyError('validation', `Unknown reason '${input.reason}'`);
    const receivedOn = input.receivedOn ?? today;
    if (!validDate(receivedOn) || receivedOn > today) throw new PolicyError('validation', 'receivedOn must be a date not after today');
    if (input.effectiveDate !== undefined && !validDate(input.effectiveDate)) throw new PolicyError('validation', 'effectiveDate must be YYYY-MM-DD');
    const note = input.note?.trim();
    const active = p.versions.filter((v) => v.status === 'active');
    if (!active.length) throw new PolicyError('conflict', `Policy ${policyId} is already cancelled from ${p.versions[0]!.validFrom}`);
    const first = active[0]!.validFrom;
    const last = active.at(-1)!.validTo;
    const term = p.terms.find((t) => t.startDate <= receivedOn && receivedOn < t.endDate) ?? (receivedOn < p.terms[0]!.startDate ? p.terms[0]! : p.terms.at(-1)!);
    const dayAfter = addDays(receivedOn, 1);

    let effective: ISODate;
    switch (input.reason) {
      case 'customer-term-end':
      case 'insurer-term-end':
        if (input.reason === 'insurer-term-end' && receivedOn > addMonths(term.endDate, -profile.insurerTermEndNoticeMonths)) {
          throw new PolicyError('validation', `The insurer must give notice at least ${profile.insurerTermEndNoticeMonths} month before the term ends ${term.endDate}`);
        }
        effective = term.endDate;
        break;
      case 'customer-immediate': {
        const offer = await this.d.products.offer(term.productVersion, receivedOn);
        if (offer?.midTermCancellation !== 'immediate') {
          throw new PolicyError('validation', `${term.productVersion} keeps the term: the customer can cancel to ${term.endDate}, or when the need for insurance ceases`);
        }
        effective = input.effectiveDate ?? dayAfter;
        if (effective < dayAfter) throw new PolicyError('validation', `The cancellation applies at the earliest from ${dayAfter}, the day after notice`);
        break;
      }
      case 'withdrawal': {
        const issued = (await this.d.store.transactions(policyId)).find((t) => t.type === 'issue')!.requestedAt.slice(0, 10);
        if (receivedOn > addDays(issued, profile.withdrawalDays)) {
          throw new PolicyError('validation', `The withdrawal period of ${profile.withdrawalDays} days from ${issued} has ended`);
        }
        effective = dayAfter;
        break;
      }
      case 'need-ceased':
        if (!input.effectiveDate) throw new PolicyError('validation', 'effectiveDate is required: the day the need for insurance ceased');
        if (input.effectiveDate > dayAfter) throw new PolicyError('validation', 'The need for insurance must have ceased by the day after notice');
        if (!note) throw new PolicyError('validation', 'A note on why the need ceased is required, e.g. that the animal died');
        effective = input.effectiveDate;
        break;
      case 'insurer-breach':
        if (!note) throw new PolicyError('validation', 'A note on the breach or the exceptional reasons is required');
        effective = addDays(receivedOn, profile.insurerMidTermNoticeDays);
        break;
      case 'unpaid-premium':
        effective = addDays(receivedOn, profile.unpaidPremiumNoticeDays);
        break;
    }
    if (effective < first) effective = first; // before the start: nothing applies
    if (effective > last) effective = last;
    const earlier = (await this.cancellationsInForce(policyId)).find((c) => c.cancellation!.effectiveDate <= effective);
    if (earlier) throw new PolicyError('conflict', `Policy ${policyId} is already cancelled from ${earlier.cancellation!.effectiveDate}`);

    const now = this.d.clock.now();
    const txId = this.d.ids.next('ptx');
    // At the end of the last term nothing changes now: the cancellation stops the renewal.
    const affected = p.versions.filter((v) => v.validTo > effective);
    const add: PolicyVersion[] = [];
    if (affected.length) {
      const before = affected.find((v) => v.validFrom < effective);
      if (before) add.push({ ...before, id: this.d.ids.next('pv'), validTo: effective, sysFrom: now, transactionId: txId });
      const lastTerm = p.terms.find((t) => t.startDate <= effective && effective < t.endDate) ?? p.terms.at(-1)!;
      add.push({
        id: this.d.ids.next('pv'),
        policyId,
        validFrom: effective,
        validTo: p.versions.at(-1)!.validTo,
        sysFrom: now,
        policyholderPartyId: (before ?? affected[0]!).policyholderPartyId,
        status: 'cancelled',
        termNo: lastTerm.termNo,
        transactionId: txId,
      });
      for (const v of add) delete (v as { sysTo?: string }).sysTo;
    }
    const refund = { amount: refundFor(p.terms, affected, effective), currency: term.currency };
    const tx: PolicyTransaction = {
      id: txId,
      policyId,
      type: 'cancel',
      steps: [{ step: 'issued', at: now }],
      requestedBy: by,
      requestedAt: now,
      supersedes: affected.map((v) => v.id),
      cancellation: { reason: input.reason, receivedOn, effectiveDate: effective, refund, ...(note ? { note } : {}) },
    };
    await this.d.store
      .apply(
        policyId,
        tx.supersedes!,
        add,
        tx,
        [
          this.event('policy.cancelled', policyId, now, { transactionId: txId, reason: input.reason, effectiveDate: effective, refund }),
          ...this.superseded(policyId, now, tx.supersedes!, add),
        ],
        { ...(decision ? { decision: { proposalId: decision.proposalId, decision: { ...decision.decision, transactionId: txId } } } : {}) },
      )
      .catch(this.translate);
    return tx;
  }

  /**
   * Reverses the latest transaction if it is a cancellation, e.g. a death that
   * was registered by mistake. The versions it superseded apply again.
   */
  async reinstate(policyId: string, input: { cancellationId: string; note: string }, by: string): Promise<PolicyTransaction> {
    const p = await this.get(policyId);
    const txs = await this.d.store.transactions(policyId);
    const cancel = txs.at(-1);
    if (!cancel || cancel.id !== input.cancellationId || cancel.type !== 'cancel') {
      throw new PolicyError('conflict', `Only the latest transaction can be reversed, and it must be a cancellation`);
    }
    const note = (input.note ?? '').trim();
    if (!note) throw new PolicyError('validation', 'A note is required');
    const history = await this.d.store.history(policyId);
    const now = this.d.clock.now();
    const txId = this.d.ids.next('ptx');
    const remove = p.versions.filter((v) => v.transactionId === cancel.id).map((v) => v.id);
    const add = history
      .filter((v) => cancel.supersedes!.includes(v.id))
      .map((v) => {
        const { sysTo: _s, ...rest } = v;
        return { ...rest, id: this.d.ids.next('pv'), sysFrom: now, transactionId: txId };
      });
    const tx: PolicyTransaction = {
      id: txId,
      policyId,
      type: 'reinstate',
      steps: [{ step: 'issued', at: now }],
      requestedBy: by,
      requestedAt: now,
      supersedes: remove,
      reverses: cancel.id,
      note,
    };
    await this.d.store
      .apply(policyId, remove, add, tx, [
        this.event('policy.reinstated', policyId, now, { transactionId: txId, reverses: cancel.id, refundReversed: cancel.cancellation!.refund }),
        ...this.superseded(policyId, now, remove, add),
      ])
      .catch(this.translate);
    return tx;
  }

  /**
   * Renews the policy with its next term from the day the last one ends: the
   * product's version on sale that day, the same choices, and (until the tariff
   * exists, M4) the same premium unless one is given. Throws a validation error
   * with the RenewalIssue in the message when it cannot.
   */
  async renew(
    policyId: string,
    input: { productVersion?: string; premium?: { amount: number; currency: string }; priceOverride?: { reason: string } },
    by: string,
    rights: CallerRights = {},
  ): Promise<PolicyTransaction> {
    const plan = await this.planRenewal(await this.get(policyId), input, rights, by);
    if ('issue' in plan) throw new PolicyError('validation', `${plan.issue}: ${plan.detail}`);
    const now = this.d.clock.now();
    const txId = this.d.ids.next('ptx');
    const term: Term = { ...plan.term, transactionId: txId };
    const version: PolicyVersion = {
      id: this.d.ids.next('pv'),
      policyId,
      validFrom: term.startDate,
      validTo: term.endDate,
      sysFrom: now,
      policyholderPartyId: plan.policyholderPartyId,
      status: 'active',
      termNo: term.termNo,
      transactionId: txId,
    };
    const tx: PolicyTransaction = {
      id: txId,
      policyId,
      type: 'renew',
      steps: [
        { step: 'draft', at: now },
        { step: 'priced', at: now, note: term.pricing ? this.pricedNote(term.pricing) : input.premium ? 'Premium given by the caller' : 'Same premium as the last term (the product has no tariff)' },
        { step: 'underwritten', at: now, note: 'No new underwriting at renewal (ADR 0031)' },
        { step: 'issued', at: now },
      ],
      requestedBy: by,
      requestedAt: now,
      supersedes: [],
      renewal: { termNo: term.termNo, productVersion: term.productVersion, premium: { amount: term.premium, currency: term.currency } },
    };
    await this.d.store
      .apply(
        policyId,
        [],
        [version],
        tx,
        [
          this.event('policy.renewed', policyId, now, {
            transactionId: txId,
            termNo: term.termNo,
            startDate: term.startDate,
            endDate: term.endDate,
            productVersion: term.productVersion,
            premium: { amount: term.premium, currency: term.currency },
          }),
        ],
        { terms: [term] },
      )
      .catch(this.translate);
    return tx;
  }

  /**
   * The renewal run (ADR 0029): every policy in `markets` whose term ends within
   * its product's lead time is renewed, unless a cancellation applies at the end
   * of the term. Policies that cannot be renewed as they are are listed for a decision.
   */
  async renewalRun(input: { dryRun: boolean; markets: '*' | ReadonlySet<string> }, by: string): Promise<RenewalRunResult> {
    const now = this.d.clock.now();
    // Candidates by the UTC date, one day wider; each policy then counts in its market's date.
    const utc = marketDate(undefined, now);
    const result: RenewalRunResult = { onDate: utc, dryRun: input.dryRun, checked: 0, renewed: [], cancelled: 0, notYet: 0, needsDecision: [] };
    for (const id of await this.d.store.endingBetween(addDays(utc, -1), addDays(utc, 121))) {
      const p = await this.get(id);
      if (input.markets !== '*' && !input.markets.has(p.market)) continue;
      const today = marketDate(p.market, now);
      if (p.versions.at(-1)!.validTo < today) continue;
      result.checked++;
      const last = p.versions.at(-1)!;
      if ((await this.cancellationsInForce(id)).some((c) => c.cancellation!.effectiveDate <= last.validTo)) {
        result.cancelled++;
        continue;
      }
      const term = p.terms.find((t) => t.termNo === last.termNo)!;
      const lead = (await this.d.products.offer(term.productVersion, today))?.renewalLeadDays ?? 45;
      if (addDays(today, lead) < last.validTo) {
        result.notYet++;
        continue;
      }
      const plan = await this.planRenewal(p, {}, {}, by);
      if ('issue' in plan) {
        result.needsDecision.push({ policyId: id, issue: plan.issue, detail: plan.detail });
        continue;
      }
      const row: RenewalRunResult['renewed'][number] = {
        policyId: id,
        termNo: plan.term.termNo,
        startDate: plan.term.startDate,
        endDate: plan.term.endDate,
        productVersion: plan.term.productVersion,
        premium: plan.term.premium,
      };
      if (!input.dryRun) row.transactionId = (await this.renew(id, {}, by)).id;
      result.renewed.push(row);
    }
    return result;
  }

  private async planRenewal(
    p: PolicyRecord,
    input: { productVersion?: string; premium?: { amount: number; currency: string }; priceOverride?: { reason: string } },
    rights: CallerRights = {},
    by = 'renewal',
  ): Promise<{ term: Omit<Term, 'transactionId'>; policyholderPartyId: string } | { issue: RenewalIssue; detail: string }> {
    const last = p.versions.at(-1)!;
    if (last.status !== 'active') throw new PolicyError('conflict', `Policy ${p.id} is cancelled from ${last.validFrom}`);
    const prev = p.terms.find((t) => t.termNo === last.termNo)!;
    if (last.validTo !== prev.endDate) throw new PolicyError('conflict', `Policy ${p.id} ends ${last.validTo}, before its term`);
    const current = effectiveTerms(prev, last);
    const start = prev.endDate;
    const ending = (await this.cancellationsInForce(p.id)).find((c) => c.cancellation!.effectiveDate <= start);
    if (ending) throw new PolicyError('conflict', `Policy ${p.id} is cancelled from ${ending.cancellation!.effectiveDate}`);
    const profile = this.profile(p.market);
    const animal = await this.d.animals.get(p.animalId);
    if (!animal || animal.deceasedOn) return { issue: 'animal-died', detail: `The animal ${p.animalId} has died or is gone` };
    if ((await this.d.parties.marketOf(last.policyholderPartyId)) !== p.market) {
      return { issue: 'policyholder-unavailable', detail: `The policyholder ${last.policyholderPartyId} is gone, restricted or in another market` };
    }
    const prevOffer = await this.d.products.offer(prev.productVersion, start);
    const product = prevOffer?.product ?? prev.productVersion.split('@')[0]!;
    const productVersion = input.productVersion ?? (await this.d.products.versionOnSale(product, start));
    if (!productVersion) return { issue: 'product-not-on-sale', detail: `No version of ${product} is on sale on ${start}` };
    const offer = await this.d.products.offer(productVersion, start);
    if (!offer || !offer.onSale || offer.market !== p.market) return { issue: 'product-not-on-sale', detail: `${productVersion} is not on sale in ${p.market} on ${start}` };
    if (!offer.species.includes(animal.species)) return { issue: 'species-not-covered', detail: `${productVersion} does not cover ${animal.species}` };
    if (offer.termMonths > profile.maxTermMonths) return { issue: 'term-too-long', detail: `${productVersion} has terms of ${offer.termMonths} months` };
    let vetCare: VetCareTerms & { deductibleOption: string };
    try {
      vetCare = offer.vetCareTermsFor({ annualLimit: current.vetCare.annualLimit, deductible: current.deductibleOption });
    } catch (e) {
      return { issue: 'option-not-offered', detail: (e as Error).message };
    }
    const { deductibleOption, ...terms } = vetCare;
    const end = addMonths(start, offer.termMonths);
    // A product with a tariff gets a new price: the tariff in force on the renewal day and the animal's new age.
    let premium: { amount: number; pricing?: TermPricing };
    try {
      const postalCode = (await this.d.parties.postalCodeOf?.(last.policyholderPartyId)) ?? undefined;
      const group = await this.placeInGroup(p.id, last.validFrom);
      const pricing = await this.priceFor(offer, {
        market: p.market,
        productVersion,
        startDate: start,
        endDate: end,
        animal,
        ...(postalCode ? { postalCode } : {}),
        ...(group ? { group } : {}),
        newPolicy: false,
        annualLimit: terms.annualLimit,
        deductibleOption,
      });
      premium = pricing
        ? this.premiumFor(pricing, input.premium, input.priceOverride, rights, by, offer.currency)
        : this.premiumFor(null, input.premium ?? { amount: current.premium, currency: prev.currency }, undefined, rights, by, offer.currency);
    } catch (e) {
      if (e instanceof PolicyError && (e.code === 'conflict' || e.code === 'validation') && !input.premium) {
        return { issue: 'price-not-available', detail: e.message };
      }
      throw e;
    }
    return {
      policyholderPartyId: last.policyholderPartyId,
      term: {
        policyId: p.id,
        termNo: prev.termNo + 1,
        startDate: start,
        endDate: end,
        productVersion,
        currency: offer.currency,
        vetCare: terms,
        deductibleOption,
        premium: premium.amount,
        riders: structuredClone(prev.riders),
        ...(premium.pricing ? { pricing: premium.pricing } : {}),
      },
    };
  }

  /**
   * Turns an event from the animal register into a proposal (ADR 0029):
   * a sale into a transfer of the policy in force on the day of sale, a death
   * into a cancellation. Returns the proposal, or null if no policy is affected
   * or the event was handled before.
   */
  async handleAnimalEvent(e: AnimalEventInput): Promise<Proposal | null> {
    const now = this.d.clock.now();
    if (e.type === 'animal.ownership_changed') {
      const from = String(e.data.from);
      const toPartyId = String(e.data.toPartyId);
      const p = await this.policyInForce(e.animalId, from);
      if (!p) return null;
      const v = p.versions.find((x) => x.status === 'active' && x.validFrom <= from && from < x.validTo) ?? p.versions.find((x) => x.status === 'active' && x.validFrom >= from)!;
      if (v.policyholderPartyId === toPartyId) return null;
      const term = p.terms.find((t) => t.termNo === v.termNo)!;
      const days = (await this.d.products.offer(term.productVersion, from))?.transferAcceptanceDays ?? 30;
      const proposal: Proposal = {
        id: this.d.ids.next('ppr'),
        policyId: p.id,
        market: p.market,
        kind: 'transfer',
        sourceEventId: e.id,
        details: { fromPartyId: v.policyholderPartyId, toPartyId, from },
        deadline: addDays(from > marketDate(p.market, now) ? from : marketDate(p.market, now), days),
        createdAt: now,
      };
      return (await this.d.store.addProposal(proposal)) ? proposal : null;
    }
    if (e.type === 'animal.died') {
      const deceasedOn = String(e.data.deceasedOn);
      const p = await this.policyInForce(e.animalId, deceasedOn);
      if (!p) return null;
      const proposal: Proposal = { id: this.d.ids.next('ppr'), policyId: p.id, market: p.market, kind: 'cancel-death', sourceEventId: e.id, details: { deceasedOn }, createdAt: now };
      return (await this.d.store.addProposal(proposal)) ? proposal : null;
    }
    return null;
  }

  /** The animal's policy with an active version on or after the date. */
  private async policyInForce(animalId: string, date: ISODate): Promise<PolicyRecord | null> {
    for (const p of await this.findByAnimal(animalId)) {
      if (p.versions.some((v) => v.status === 'active' && v.validTo > date)) return p;
    }
    return null;
  }

  async getProposal(id: string): Promise<Proposal> {
    const p = await this.d.store.getProposal(id);
    if (!p) throw new PolicyError('not_found', `Proposal ${id} does not exist`);
    return p;
  }

  listProposals(filter: { policyId?: string; pending?: boolean } = {}): Promise<Proposal[]> {
    return this.d.store.listProposals(filter);
  }

  /**
   * Accepts a proposal. A transfer needs the new policyholder's acceptance of
   * the terms, by the deadline: the policy then changes policyholder from the
   * day of sale, as a new version, so the history shows both. A death cancels
   * the policy from the day of death.
   */
  async acceptProposal(id: string, input: { channel: string; reference?: string }, by: string): Promise<Proposal> {
    const pr = await this.pendingProposal(id);
    const now = this.d.clock.now();
    if (pr.kind === 'cancel-death') {
      const { deceasedOn } = pr.details as { deceasedOn: ISODate };
      await this.cancel(pr.policyId, { reason: 'need-ceased', effectiveDate: deceasedOn, note: `The animal died (${pr.sourceEventId})` }, by, {
        proposalId: id,
        decision: { outcome: 'accepted', decidedBy: by, decidedAt: now },
      });
      return this.getProposal(id);
    }
    const channel = (input.channel ?? '').trim();
    if (!channel) throw new PolicyError('validation', 'The channel the new policyholder accepted in is required');
    if (pr.deadline! < marketDate(pr.market, now)) throw new PolicyError('conflict', `The proposal expired ${pr.deadline}`);
    const d = pr.details as { fromPartyId: string; toPartyId: string; from: ISODate };
    const p = await this.get(pr.policyId);
    if ((await this.d.parties.marketOf(d.toPartyId)) !== p.market) {
      throw new PolicyError('validation', `The party ${d.toPartyId} does not exist in market ${p.market}`);
    }
    const affected = p.versions.filter((v) => v.status === 'active' && v.validTo > d.from && v.policyholderPartyId === d.fromPartyId);
    if (!affected.length) throw new PolicyError('conflict', `Policy ${p.id} has no active version held by ${d.fromPartyId} after ${d.from}`);
    const txId = this.d.ids.next('ptx');
    const add: PolicyVersion[] = [];
    for (const v of affected) {
      const { sysTo: _s, ...rest } = v;
      if (v.validFrom < d.from) add.push({ ...rest, id: this.d.ids.next('pv'), validTo: d.from, sysFrom: now, transactionId: txId });
      add.push({ ...rest, id: this.d.ids.next('pv'), validFrom: v.validFrom > d.from ? v.validFrom : d.from, policyholderPartyId: d.toPartyId, sysFrom: now, transactionId: txId });
    }
    const acceptance: Acceptance = { channel, ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}), acceptedAt: now };
    const term = p.terms.find((t) => t.termNo === affected[0]!.termNo)!;
    const premium = { amount: refundFor(p.terms, affected, d.from), currency: term.currency };
    const tx: PolicyTransaction = {
      id: txId,
      policyId: p.id,
      type: 'transfer',
      steps: [{ step: 'issued', at: now }],
      requestedBy: by,
      requestedAt: now,
      supersedes: affected.map((v) => v.id),
      transfer: { fromPartyId: d.fromPartyId, toPartyId: d.toPartyId, from: d.from, acceptance, premium },
    };
    await this.d.store
      .apply(
        p.id,
        tx.supersedes!,
        add,
        tx,
        [
          this.event('policy.transferred', p.id, now, { transactionId: txId, fromPartyId: d.fromPartyId, toPartyId: d.toPartyId, from: d.from, premium }),
          ...this.superseded(p.id, now, tx.supersedes!, add),
        ],
        {
          decision: { proposalId: id, decision: { outcome: 'accepted', acceptance, transactionId: txId, decidedBy: by, decidedAt: now } },
          // The policy leaves the previous policyholder's group from the day of sale.
          endMemberships: (await this.d.store.findGroups({ policyId: p.id })).flatMap((g) =>
            g.members
              .filter((m) => m.policyId === p.id && !m.to && g.holderPartyId === d.fromPartyId)
              .map((m) => ({ groupId: g.id, policyId: p.id, to: d.from > m.from ? d.from : m.from, endedBy: by, endedAt: now, reason: 'The animal was sold' })),
          ),
        },
      )
      .catch(this.translate);
    return this.getProposal(id);
  }

  /**
   * Rejects a proposal. A rejected transfer (the new owner does not want the
   * policy) ends the policy from the day of sale, since the need ceased then. A
   * rejected death, e.g. registered on the wrong animal, changes nothing.
   */
  async rejectProposal(id: string, input: { reason: string }, by: string): Promise<Proposal> {
    const pr = await this.pendingProposal(id);
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new PolicyError('validation', 'A reason is required');
    const decision: ProposalDecision = { outcome: 'rejected', reason, decidedBy: by, decidedAt: this.d.clock.now() };
    if (pr.kind === 'transfer') {
      const { from } = pr.details as { from: ISODate };
      await this.cancel(pr.policyId, { reason: 'need-ceased', effectiveDate: from, note: `The animal was sold; the new owner did not take over the policy (${pr.sourceEventId})` }, by, { proposalId: id, decision });
    } else {
      await this.d.store.decideProposal(id, decision).catch(this.translate);
    }
    return this.getProposal(id);
  }

  /** Ends every policy whose transfer was not accepted by its deadline, from the day of sale. */
  async expireProposals(markets: '*' | ReadonlySet<string>, by: string): Promise<Proposal[]> {
    const now = this.d.clock.now();
    const out: Proposal[] = [];
    for (const pr of await this.d.store.listProposals({ pending: true })) {
      if (pr.kind !== 'transfer' || pr.deadline! >= marketDate(pr.market, now) || (markets !== '*' && !markets.has(pr.market))) continue;
      const { from } = pr.details as { from: ISODate };
      await this.cancel(pr.policyId, { reason: 'need-ceased', effectiveDate: from, note: `The animal was sold; the new owner did not accept by ${pr.deadline} (${pr.sourceEventId})` }, by, {
        proposalId: pr.id,
        decision: { outcome: 'expired', reason: `Not accepted by ${pr.deadline}`, decidedBy: by, decidedAt: this.d.clock.now() },
      });
      out.push(await this.getProposal(pr.id));
    }
    return out;
  }

  private async pendingProposal(id: string): Promise<Proposal> {
    const pr = await this.getProposal(id);
    if (pr.decision) throw new PolicyError('conflict', `Proposal ${id} is already ${pr.decision.outcome}`);
    return pr;
  }

  /**
   * Changes the choices from a day during the term, e.g. a higher deductible
   * (ADR 0029). Not back in time, and only in the policy's latest term. The
   * versions from that day are superseded by ones that follow the change.
   * `premium` is the premium for a whole term at the new choices (given by the
   * caller until the tariff exists, M4); the days left are charged at the new rate.
   */
  async change(
    policyId: string,
    input: {
      from: ISODate;
      vetCare: { annualLimit?: number; deductible?: string };
      /** Omitted: the tariff prices the term at the new choices. */
      premium?: { amount: number; currency: string };
      priceOverride?: { reason: string };
      reason: string;
    },
    by: string,
    rights: CallerRights = {},
  ): Promise<PolicyTransaction> {
    const p = await this.get(policyId);
    const today = marketDate(p.market, this.d.clock.now());
    if (!validDate(input.from)) throw new PolicyError('validation', 'from must be YYYY-MM-DD');
    if (input.from < today) throw new PolicyError('validation', 'A change cannot apply before today');
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new PolicyError('validation', 'A reason is required');
    const term = p.terms.find((t) => t.startDate <= input.from && input.from < t.endDate);
    if (!term) throw new PolicyError('validation', `Policy ${policyId} has no term on ${input.from}`);
    if (term.termNo !== p.terms.at(-1)!.termNo) {
      throw new PolicyError('conflict', `Policy ${policyId} is already renewed to term ${p.terms.at(-1)!.termNo}; change it from ${p.terms.at(-1)!.startDate} instead`);
    }
    const affected = p.versions.filter((v) => v.termNo === term.termNo && v.status === 'active' && v.validTo > input.from);
    if (!affected.some((v) => v.validFrom <= input.from)) throw new PolicyError('conflict', `Policy ${policyId} is not in force on ${input.from}`);
    const offer = await this.d.products.offer(term.productVersion, input.from);
    if (!offer) throw new PolicyError('validation', `The product version ${term.productVersion} does not exist`);
    let vetCare: VetCareTerms & { deductibleOption: string };
    try {
      vetCare = offer.vetCareTermsFor(input.vetCare ?? {});
    } catch (e) {
      throw new PolicyError('validation', (e as Error).message);
    }
    const holderAt = affected.find((v) => v.validFrom <= input.from)!;
    const before = effectiveTerms(term, holderAt);
    const { deductibleOption, ...terms } = vetCare;
    // The tariff prices the whole term at the new choices, with the animal's age at the term's start.
    const animal = await this.d.animals.get(p.animalId);
    if (!animal) throw new PolicyError('conflict', `The animal ${p.animalId} is gone`);
    const postalCode = (await this.d.parties.postalCodeOf?.(holderAt.policyholderPartyId)) ?? undefined;
    const group = await this.placeInGroup(policyId, input.from);
    const pricing = await this.priceFor(offer, {
      market: p.market,
      productVersion: term.productVersion,
      startDate: term.startDate,
      endDate: term.endDate,
      animal,
      ...(postalCode ? { postalCode } : {}),
      ...(group ? { group } : {}),
      newPolicy: false,
      annualLimit: terms.annualLimit,
      deductibleOption,
    });
    const newPremium = this.premiumFor(pricing, input.premium, input.priceOverride, rights, by, term.currency);
    if (deductibleOption === before.deductibleOption && terms.annualLimit === before.vetCare.annualLimit && newPremium.amount === before.premium) {
      throw new PolicyError('conflict', 'The change changes nothing');
    }

    const now = this.d.clock.now();
    const txId = this.d.ids.next('ptx');
    const changeNo = (term.changes?.at(-1)?.changeNo ?? 0) + 1;
    const change: TermChange = {
      changeNo,
      from: input.from,
      vetCare: terms,
      deductibleOption,
      premium: newPremium.amount,
      transactionId: txId,
      ...(newPremium.pricing ? { pricing: newPremium.pricing } : {}),
    };
    const add: PolicyVersion[] = [];
    for (const v of affected) {
      const { sysTo: _s, ...rest } = v;
      if (v.validFrom < input.from) add.push({ ...rest, id: this.d.ids.next('pv'), validTo: input.from, sysFrom: now, transactionId: txId });
      add.push({ ...rest, id: this.d.ids.next('pv'), validFrom: v.validFrom > input.from ? v.validFrom : input.from, changeNo, sysFrom: now, transactionId: txId });
    }
    const termDays = daysBetween(term.startDate, term.endDate);
    const adjustment = affected.reduce((sum, v) => {
      const start = v.validFrom > input.from ? v.validFrom : input.from;
      return sum + (newPremium.amount - effectiveTerms(term, v).premium) * daysBetween(start, v.validTo);
    }, 0);
    const premiumAdjustment = Math.round(adjustment / termDays);
    const tx: PolicyTransaction = {
      id: txId,
      policyId,
      type: 'change',
      steps: [
        { step: 'draft', at: now },
        { step: 'priced', at: now, note: this.pricedNote(newPremium.pricing) },
        { step: 'underwritten', at: now, note: 'No underwriting for a change of choices (ADR 0031)' },
        { step: 'issued', at: now },
      ],
      requestedBy: by,
      requestedAt: now,
      supersedes: affected.map((v) => v.id),
      change: {
        termNo: term.termNo,
        changeNo,
        from: input.from,
        annualLimit: terms.annualLimit,
        deductibleOption,
        premium: { amount: newPremium.amount, currency: term.currency },
        premiumAdjustment,
        reason,
      },
    };
    await this.d.store
      .apply(
        policyId,
        tx.supersedes!,
        add,
        tx,
        [
          this.event('policy.changed', policyId, now, { transactionId: txId, termNo: term.termNo, changeNo, from: input.from, premiumAdjustment, currency: term.currency }),
          ...this.superseded(policyId, now, tx.supersedes!, add),
        ],
        { changes: [{ ...change, policyId, termNo: term.termNo }] },
      )
      .catch(this.translate);
    return tx;
  }

  /** A group for a litter or a household (ADR 0007). */
  async createGroup(input: { market: string; kind: 'litter' | 'household'; holderPartyId: string; litterId?: string }, by: string): Promise<PolicyGroup> {
    if (!['litter', 'household'].includes(input.kind)) throw new PolicyError('validation', `Unknown kind '${input.kind}'`);
    this.profile(input.market);
    if ((await this.d.parties.marketOf(input.holderPartyId)) !== input.market) {
      throw new PolicyError('validation', `The party ${input.holderPartyId} does not exist in market ${input.market}`);
    }
    if (input.kind === 'litter' && !/^lit_[A-Za-z0-9]+$/.test(input.litterId ?? '')) throw new PolicyError('validation', 'A litter group needs the litterId');
    if (input.kind === 'household' && input.litterId !== undefined) throw new PolicyError('validation', 'A household group has no litterId');
    const group: PolicyGroup = {
      id: this.d.ids.next('pgr'),
      market: input.market,
      kind: input.kind,
      holderPartyId: input.holderPartyId,
      ...(input.litterId ? { litterId: input.litterId } : {}),
      createdBy: by,
      createdAt: this.d.clock.now(),
      members: [],
    };
    await this.d.store.createGroup(group);
    return this.getGroup(group.id);
  }

  async getGroup(id: string): Promise<PolicyGroup> {
    const g = await this.d.store.getGroup(id);
    if (!g) throw new PolicyError('not_found', `Policy group ${id} does not exist`);
    return g;
  }

  findGroups(filter: { holderPartyId?: string; policyId?: string }): Promise<PolicyGroup[]> {
    return this.d.store.findGroups(filter);
  }

  /**
   * Adds a policy to the group from a day (default today, or the policy's start
   * if later). The group's policyholder must hold the policy that day, and a
   * policy is in one group at a time.
   */
  async addMember(groupId: string, input: { policyId: string; from?: ISODate }, by: string): Promise<PolicyGroup> {
    const g = await this.getGroup(groupId);
    const p = await this.get(input.policyId);
    if (p.market !== g.market) throw new PolicyError('validation', `Policy ${p.id} is not in market ${g.market}`);
    const today = marketDate(p.market, this.d.clock.now());
    const first = p.versions.find((v) => v.status === 'active')?.validFrom;
    const from = input.from ?? (first && first > today ? first : today);
    if (!validDate(from)) throw new PolicyError('validation', 'from must be YYYY-MM-DD');
    const v = p.versions.find((x) => x.status === 'active' && x.validFrom <= from && from < x.validTo);
    if (!v) throw new PolicyError('validation', `Policy ${p.id} is not in force on ${from}`);
    if (v.policyholderPartyId !== g.holderPartyId) throw new PolicyError('validation', `Policy ${p.id} is held by another party on ${from}`);
    await this.d.store.addMember(groupId, { policyId: p.id, from, addedBy: by, addedAt: this.d.clock.now() }).catch(this.translate);
    return this.getGroup(groupId);
  }

  async endMember(groupId: string, policyId: string, input: { to?: ISODate; reason: string }, by: string): Promise<PolicyGroup> {
    const g = await this.getGroup(groupId);
    const m = g.members.find((x) => x.policyId === policyId && !x.to);
    if (!m) throw new PolicyError('conflict', `Policy ${policyId} is not a member of group ${groupId}`);
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new PolicyError('validation', 'A reason is required');
    const to = input.to ?? marketDate(g.market, this.d.clock.now());
    if (!validDate(to) || to < m.from) throw new PolicyError('validation', `to must be a date from ${m.from}`);
    await this.d.store.endMember(groupId, policyId, { to, endedBy: by, endedAt: this.d.clock.now(), reason }).catch(this.translate);
    return this.getGroup(groupId);
  }

  /**
   * A price indication (ADR 0030): what the policy would cost from the start
   * date with these choices. Uses the same tariff and function as issue will.
   * Nothing is stored, and the postal code is not returned, only its zone.
   */
  async quote(input: QuoteInput): Promise<Quote> {
    const profile = this.profile(input.market);
    const today = marketDate(input.market, this.d.clock.now());
    if (!validDate(input.startDate)) throw new PolicyError('validation', 'startDate must be YYYY-MM-DD');
    if (input.startDate < today) throw new PolicyError('validation', 'A policy cannot start before today');
    if ((input.animalId === undefined) === (input.animal === undefined)) throw new PolicyError('validation', 'Give either animalId or animal');
    if (input.policyholderPartyId !== undefined && input.postalCode !== undefined) throw new PolicyError('validation', 'Give policyholderPartyId or postalCode, not both');
    if (input.groupId !== undefined && input.group !== undefined) throw new PolicyError('validation', 'Give groupId or group, not both');
    let group = input.group;
    if (input.groupId !== undefined) {
      const g = await this.getGroup(input.groupId);
      if (g.market !== input.market) throw new PolicyError('validation', `The group ${g.id} is not in market ${input.market}`);
      if (input.policyholderPartyId !== undefined && g.holderPartyId !== input.policyholderPartyId) {
        throw new PolicyError('validation', `The group ${g.id} belongs to another policyholder`);
      }
      group = { kind: g.kind, memberNo: g.members.filter((m) => !m.to).length + 1 };
    }
    if (group && (!['litter', 'household'].includes(group.kind) || !Number.isSafeInteger(group.memberNo) || group.memberNo < 1)) {
      throw new PolicyError('validation', 'group needs kind litter or household, and memberNo 1 or more');
    }
    let animal: { species: string; breed?: string; birthDate: ISODate };
    if (input.animalId !== undefined) {
      const a = await this.d.animals.get(input.animalId);
      if (!a || a.market !== input.market) throw new PolicyError('validation', `The animal ${input.animalId} does not exist in market ${input.market}`);
      if (a.deceasedOn) throw new PolicyError('validation', `The animal ${input.animalId} has died`);
      animal = { species: a.species, ...(a.breed ? { breed: a.breed } : {}), birthDate: a.birthDate };
    } else {
      animal = input.animal!;
      if (!animal.species || !validDate(animal.birthDate)) throw new PolicyError('validation', 'animal needs species and birthDate');
    }
    let postalCode = input.postalCode;
    if (input.policyholderPartyId !== undefined) {
      if ((await this.d.parties.marketOf(input.policyholderPartyId)) !== input.market) {
        throw new PolicyError('validation', `The party ${input.policyholderPartyId} does not exist in market ${input.market}`);
      }
      postalCode = (await this.d.parties.postalCodeOf?.(input.policyholderPartyId)) ?? undefined;
    }
    const offer = await this.d.products.offer(input.productVersion, input.startDate);
    if (!offer) throw new PolicyError('validation', `The product version ${input.productVersion} does not exist`);
    if (!offer.onSale) throw new PolicyError('validation', `${input.productVersion} is not on sale on ${input.startDate}`);
    if (offer.market !== input.market) throw new PolicyError('validation', `${input.productVersion} is not sold in market ${input.market}`);
    if (!offer.species.includes(animal.species)) throw new PolicyError('validation', `${input.productVersion} does not cover ${animal.species}`);
    if (offer.termMonths > profile.maxTermMonths) throw new PolicyError('validation', `${input.productVersion} has terms longer than ${input.market} allows`);
    let chosen: VetCareTerms & { deductibleOption: string };
    try {
      chosen = offer.vetCareTermsFor(input.vetCare ?? {});
    } catch (e) {
      throw new PolicyError('validation', (e as Error).message);
    }
    if (!offer.tariffSeries) throw new PolicyError('conflict', `${input.productVersion} has no tariff; its premium is given by hand`);
    const endDate = addMonths(input.startDate, offer.termMonths);
    const { deductibleOption, ...vetCare } = chosen;
    const pricing = (await this.priceFor(offer, {
      market: input.market,
      productVersion: input.productVersion,
      startDate: input.startDate,
      endDate,
      animal,
      ...(postalCode ? { postalCode } : {}),
      ...(group ? { group } : {}),
      ...(input.campaignCode ? { campaignCode: input.campaignCode } : {}),
      newPolicy: true,
      annualLimit: vetCare.annualLimit,
      deductibleOption,
    }))!;
    let underwriting: UnderwritingResult | undefined;
    if (input.answers !== undefined) {
      if (!offer.underwritingSeries) throw new PolicyError('validation', `${input.productVersion} has no underwriting rules, so no answers`);
      underwriting = (await this.underwriteFor(offer.underwritingSeries, today, input.market, animal, input.startDate, input.answers)).result;
    }
    return {
      market: input.market,
      productVersion: input.productVersion,
      startDate: input.startDate,
      endDate,
      vetCare,
      deductibleOption,
      price: pricing.result,
      ...(underwriting ? { underwriting } : {}),
    };
  }

  /**
   * Prices a term with the product's tariff and price terms (ADR 0030), or null
   * when the product has no tariff. The evidence keeps the zone, not the postal code.
   */
  private async priceFor(
    offer: ProductOffer,
    a: {
      market: string;
      productVersion: string;
      startDate: ISODate;
      endDate: ISODate;
      animal: { species: string; breed?: string; birthDate: ISODate };
      postalCode?: string;
      group?: { kind: 'litter' | 'household'; memberNo: number };
      campaignCode?: string;
      newPolicy: boolean;
      annualLimit: number;
      deductibleOption: string;
    },
  ): Promise<TermPricing | null> {
    if (!offer.tariffSeries) {
      if (a.campaignCode) throw new PolicyError('validation', `${a.productVersion} has no tariff, so no campaign codes`);
      return null;
    }
    const tariff = await this.d.tariffs?.tariffInForce(offer.tariffSeries, a.startDate);
    if (!tariff) throw new PolicyError('conflict', `The tariff series ${offer.tariffSeries} has no published version in force on ${a.startDate}`);
    let terms: { content: PriceTermsContent; ref: TariffRef } | null = null;
    if (offer.priceTermsSeries) {
      terms = (await this.d.tariffs?.priceTermsInForce?.(offer.priceTermsSeries, a.startDate)) ?? null;
      if (!terms) throw new PolicyError('conflict', `The price terms series ${offer.priceTermsSeries} has no published version in force on ${a.startDate}`);
    } else if (a.campaignCode) {
      throw new PolicyError('validation', `${a.productVersion} has no price terms, so no campaign codes`);
    }
    const input: PriceInput = {
      market: a.market,
      species: a.animal.species,
      ...(a.animal.breed ? { breed: a.animal.breed } : {}),
      birthDate: a.animal.birthDate,
      startDate: a.startDate,
      endDate: a.endDate,
      annualLimit: a.annualLimit,
      deductibleOption: a.deductibleOption,
      ...(a.postalCode ? { postalCode: a.postalCode } : {}),
      ...(a.group ? { group: a.group } : {}),
      ...(a.campaignCode ? { campaignCode: a.campaignCode } : {}),
      newPolicy: a.newPolicy,
    };
    try {
      const result = price(tariff, input, terms ?? undefined);
      const { postalCode: _p, ...kept } = input;
      return { result, input: { ...kept, zone: result.facts.zone } };
    } catch (e) {
      if (e instanceof PricingError) throw new PolicyError('validation', e.message);
      throw e;
    }
  }

  /**
   * The premium to store: the tariff's, or a manual one. A manual premium on a
   * product with a tariff needs a reason and the right to set it; the computed
   * premium is kept next to it.
   */
  private premiumFor(
    pricing: TermPricing | null,
    given: { amount: number; currency: string } | undefined,
    override: { reason: string } | undefined,
    rights: CallerRights,
    by: string,
    currency: string,
  ): { amount: number; pricing?: TermPricing } {
    if (given && (given.currency !== currency || !Number.isSafeInteger(given.amount) || given.amount < 0)) {
      throw new PolicyError('validation', `The premium must be a whole number of minor units in ${currency}`);
    }
    if (!pricing) {
      if (!given) throw new PolicyError('validation', 'premium is required: the product has no tariff');
      return { amount: given.amount };
    }
    if (!given || given.amount === pricing.result.termPremium) return { amount: pricing.result.termPremium, pricing };
    if (!rights.mayOverridePrice) throw new PolicyError('forbidden', 'A premium other than the tariff\'s needs the permission policies:price-override');
    const reason = override?.reason?.trim();
    if (!reason) throw new PolicyError('validation', 'A manual premium needs priceOverride.reason');
    return { amount: given.amount, pricing: { ...pricing, override: { computedPremium: pricing.result.termPremium, reason, by } } };
  }

  /** The policy's group and its place there on the date, for the group discount. */
  private async placeInGroup(policyId: string, onDate: ISODate): Promise<{ kind: 'litter' | 'household'; memberNo: number } | undefined> {
    const inForce = (m: GroupMembership) => m.from <= onDate && (!m.to || onDate < m.to);
    for (const g of await this.d.store.findGroups({ policyId })) {
      const members = g.members.filter(inForce).sort((a, b) => (a.from === b.from ? (a.policyId < b.policyId ? -1 : 1) : a.from < b.from ? -1 : 1));
      const i = members.findIndex((m) => m.policyId === policyId);
      if (i >= 0) return { kind: g.kind, memberNo: i + 1 };
    }
    return undefined;
  }

  /** The note on the transaction's priced step. */
  private pricedNote(p: TermPricing | undefined): string {
    if (!p) return 'Premium given by the caller (the product has no tariff)';
    const ref = p.result.tariff ? `${p.result.tariff.series}@${p.result.tariff.version}` : 'the tariff';
    return p.override ? `Manual premium (${p.override.reason}); the tariff ${ref} gave ${p.override.computedPremium}` : `Priced by ${ref}`;
  }

  /** Cancellations that have not been reversed. */
  async cancellationsInForce(policyId: string): Promise<PolicyTransaction[]> {
    const txs = await this.d.store.transactions(policyId);
    const reversed = new Set(txs.flatMap((t) => (t.reverses ? [t.reverses] : [])));
    return txs.filter((t) => t.type === 'cancel' && !reversed.has(t.id));
  }

  private event(type: PolicyEvent['type'], policyId: string, at: Timestamp, data: Record<string, unknown>): PolicyEvent {
    return { id: this.d.ids.next('pev'), type, policyId, occurredAt: at, data };
  }

  private appEvent(type: PolicyEvent['type'], applicationId: string, policyId: string | undefined, at: Timestamp, data: Record<string, unknown>): PolicyEvent {
    return { id: this.d.ids.next('pev'), type, ...(policyId ? { policyId } : {}), applicationId, occurredAt: at, data };
  }

  /** One event per superseded version, so the claims engine can reassess claims on it. */
  private superseded(policyId: string, at: Timestamp, ids: string[], by: PolicyVersion[]): PolicyEvent[] {
    return ids.map((versionId) => this.event('policy.version_superseded', policyId, at, { versionId, supersededBy: by.map((v) => v.id) }));
  }

  private profile(market: string): MarketProfile {
    const profile = (this.d.profiles ?? MARKET_PROFILES)[market];
    if (!profile) throw new PolicyError('validation', `Petvold has no market profile for '${market}'`);
    return profile;
  }

  private translate = (e: unknown): never => {
    if (e instanceof PolicyConflictError) throw new PolicyError('conflict', e.message);
    throw e;
  };

  /**
   * Issues a policy on a product without underwriting rules: the first term and
   * version in one transaction through the steps draft, priced, underwritten
   * and issued, with the customer's acceptance (ADR 0031). A product with
   * underwriting rules is applied for instead (`apply`).
   */
  async issue(input: IssueInput, by: string, rights: CallerRights = {}): Promise<PolicyRecord> {
    const plan = await this.planIssue(input, by, rights);
    if (plan.offer.underwritingSeries) {
      throw new PolicyError('validation', `${input.productVersion} has underwriting rules: send an application with the answers to its questions`);
    }
    return this.commitIssue(plan, input, by, { riders: [], note: 'Accepted (the product has no underwriting rules)', events: [] });
  }

  /**
   * An application for a product with underwriting rules (ADR 0031). The rules
   * in force today decide; the application is stored with the evidence. An
   * accepted one, with or without riders, issues the policy in the same
   * transaction. A referred one waits for a person; a declined one keeps its reasons.
   */
  async apply(input: ApplicationInput, by: string, rights: CallerRights = {}): Promise<Application> {
    const plan = await this.planIssue(input, by, rights);
    const series = plan.offer.underwritingSeries;
    if (!series) throw new PolicyError('validation', `${input.productVersion} has no underwriting rules: issue the policy directly`);
    const { result, input: uwInput } = await this.underwriteFor(series, plan.today, input.market, plan.animal, input.startDate, input.answers);
    const id = this.d.ids.next('app');
    const status: ApplicationStatus = result.outcome === 'decline' ? 'declined' : result.outcome === 'refer' ? 'referred' : 'accepted';
    const application: Application = {
      id,
      market: input.market,
      animalId: input.animalId,
      policyholderPartyId: input.policyholderPartyId,
      productVersion: input.productVersion,
      startDate: input.startDate,
      ...(input.vetCare ? { vetCare: structuredClone(input.vetCare) } : {}),
      ...(input.groupId ? { groupId: input.groupId } : {}),
      ...(input.campaignCode ? { campaignCode: input.campaignCode } : {}),
      acceptance: plan.acceptance,
      premium: { amount: plan.premium.amount, currency: plan.offer.currency },
      status,
      ...(status === 'referred' ? { deadline: addDays(plan.today, plan.offer.applicationExpiryDays ?? 30) } : {}),
      underwriting: { input: uwInput, result, engineVersion: this.d.engineVersion ?? 'unknown' },
      receivedBy: by,
      receivedAt: plan.now,
    };
    const received = this.appEvent('application.received', id, undefined, plan.now, { market: input.market, animalId: input.animalId, productVersion: input.productVersion });
    if (status !== 'accepted') {
      await this.d.store
        .addApplication(application, [received, this.appEvent(`application.${status}`, id, undefined, plan.now, { outcome: result.outcome, reasons: result.reasons })])
        .catch(this.translate);
      return application;
    }
    const riders: Rider[] = result.riders.map((r) => ({
      id: this.d.ids.next('rdr'),
      description: r.description,
      diagnosisCodes: [...r.diagnosisCodes],
      validFrom: input.startDate,
      source: 'underwriting',
      applicationId: id,
      question: r.question,
    }));
    const accepted: Application = { ...application, policyId: plan.policyId };
    const ref = result.rules ? `${result.rules.series}@${result.rules.version}` : 'the underwriting rules';
    await this.commitIssue(plan, input, by, {
      riders,
      application: accepted,
      applicationId: id,
      note: riders.length ? `Accepted with ${riders.length} rider(s) by ${ref} (${id})` : `Accepted by ${ref} (${id})`,
      events: [received, this.appEvent('application.accepted', id, plan.policyId, plan.now, { outcome: result.outcome, riders: riders.length })],
    });
    return accepted;
  }

  async getApplication(id: string): Promise<Application> {
    const a = await this.d.store.getApplication(id);
    if (!a) throw new PolicyError('not_found', `Application ${id} does not exist`);
    return a;
  }

  listApplications(filter: ApplicationFilter = {}): Promise<Application[]> {
    return this.d.store.listApplications(filter);
  }

  /**
   * A person's decision on a referred application (ADR 0031), with the
   * permission policies:underwrite. Accept issues the policy at the premium the
   * customer applied at, with the rules' riders or the person's own. Decline
   * needs a reason code. Both need the grounds.
   */
  async decideApplication(id: string, input: ApplicationDecisionInput, by: string): Promise<Application> {
    const a = await this.waitingApplication(id);
    const now = this.d.clock.now();
    const note = (input.note ?? '').trim();
    if (!note) throw new PolicyError('validation', 'The grounds for the decision (note) are required');
    if (input.outcome === 'decline') {
      if (!/^[a-z][a-z0-9-]{1,63}$/.test(input.reason ?? '')) throw new PolicyError('validation', 'A decline needs a reason code, e.g. ongoing-symptoms');
      if (input.riders !== undefined || input.startDate !== undefined) throw new PolicyError('validation', 'riders and startDate are only for accept');
      const decision: ApplicationDecision = { outcome: 'declined', reason: input.reason!, note, decidedBy: by, decidedAt: now };
      await this.d.store
        .decideApplication(id, decision, [this.appEvent('application.declined', id, undefined, now, { reason: input.reason, decidedBy: by })])
        .catch(this.translate);
      return this.getApplication(id);
    }
    if (input.outcome !== 'accept') throw new PolicyError('validation', `Unknown outcome '${input.outcome}'`);
    if (input.reason !== undefined) throw new PolicyError('validation', 'reason is only for decline');
    const today = marketDate(a.market, now);
    const startDate = input.startDate ?? a.startDate;
    if (!validDate(startDate)) throw new PolicyError('validation', 'startDate must be YYYY-MM-DD');
    if (startDate < today) throw new PolicyError('validation', `The start date ${startDate} has passed: give a later startDate`);
    for (const r of input.riders ?? []) {
      if (!Array.isArray(r.diagnosisCodes) || !r.diagnosisCodes.length || r.diagnosisCodes.some((c) => typeof c !== 'string' || !c)) {
        throw new PolicyError('validation', 'A rider needs diagnosis codes');
      }
      if (!r.description?.trim()) throw new PolicyError('validation', 'A rider needs a description');
    }
    const issueInput: IssueInput = {
      market: a.market,
      animalId: a.animalId,
      policyholderPartyId: a.policyholderPartyId,
      productVersion: a.productVersion,
      startDate,
      ...(a.vetCare ? { vetCare: a.vetCare } : {}),
      ...(a.groupId ? { groupId: a.groupId } : {}),
      ...(a.campaignCode ? { campaignCode: a.campaignCode } : {}),
      // The customer accepted this premium; a different price from the tariff today is kept as a manual one with its reason.
      premium: a.premium,
      priceOverride: { reason: `The premium the customer applied at (${a.id})` },
      acceptance: {
        channel: a.acceptance.channel,
        ...(a.acceptance.reference ? { reference: a.acceptance.reference } : {}),
        acceptedAt: a.acceptance.acceptedAt,
        ...(a.acceptance.documents ? { documents: a.acceptance.documents } : {}),
      },
    };
    const plan = { ...(await this.planIssue(issueInput, by, { mayOverridePrice: true })), acceptance: a.acceptance };
    const base = { validFrom: startDate, applicationId: id };
    const riders: Rider[] = input.riders
      ? input.riders.map((r) => ({ id: this.d.ids.next('rdr'), description: r.description.trim(), diagnosisCodes: [...r.diagnosisCodes].sort(), ...base, source: 'manual' }))
      : a.underwriting.result.riders.map((r) => ({ id: this.d.ids.next('rdr'), description: r.description, diagnosisCodes: [...r.diagnosisCodes], ...base, source: 'underwriting', question: r.question }));
    const decision: ApplicationDecision = { outcome: 'accepted', riders, note, policyId: plan.policyId, decidedBy: by, decidedAt: now };
    await this.commitIssue(plan, issueInput, by, {
      riders,
      applicationId: id,
      decision: { applicationId: id, decision },
      note: `Accepted by ${by} after manual underwriting (${id}): ${note}`,
      events: [this.appEvent('application.accepted', id, plan.policyId, now, { decidedBy: by, riders: riders.length })],
    });
    return this.getApplication(id);
  }

  /** The channel withdraws an application that waits for a person, e.g. when the customer no longer wants it. */
  async withdrawApplication(id: string, input: { reason?: string }, by: string): Promise<Application> {
    await this.waitingApplication(id);
    const now = this.d.clock.now();
    const note = input.reason?.trim();
    const decision: ApplicationDecision = { outcome: 'withdrawn', ...(note ? { note } : {}), decidedBy: by, decidedAt: now };
    await this.d.store.decideApplication(id, decision, [this.appEvent('application.withdrawn', id, undefined, now, { by })]).catch(this.translate);
    return this.getApplication(id);
  }

  /** Ends every referred application whose deadline has passed in its market (ADR 0031). */
  async expireApplications(markets: '*' | ReadonlySet<string>, by: string): Promise<Application[]> {
    const now = this.d.clock.now();
    const out: Application[] = [];
    for (const a of await this.d.store.listApplications({ status: 'referred' })) {
      if ((markets !== '*' && !markets.has(a.market)) || !a.deadline || a.deadline >= marketDate(a.market, now)) continue;
      const decision: ApplicationDecision = { outcome: 'expired', note: `Not decided by ${a.deadline}`, decidedBy: by, decidedAt: now };
      await this.d.store.decideApplication(a.id, decision, [this.appEvent('application.expired', a.id, undefined, now, { deadline: a.deadline })]).catch(this.translate);
      out.push(await this.getApplication(a.id));
    }
    return out;
  }

  /** A referred application that has not been decided, withdrawn or expired. */
  private async waitingApplication(id: string): Promise<Application> {
    const a = await this.getApplication(id);
    if (a.status !== 'referred') throw new PolicyError('conflict', `Application ${id} is ${a.status}, not waiting for a decision`);
    if (a.deadline && a.deadline < marketDate(a.market, this.d.clock.now())) throw new PolicyError('conflict', `Application ${id} expired after ${a.deadline}`);
    return a;
  }

  /** Runs the underwriting rules in force on the application date (ADR 0031). */
  private async underwriteFor(
    series: string,
    onDate: ISODate,
    market: string,
    animal: { species: string; breed?: string; birthDate: ISODate },
    startDate: ISODate,
    answers: Answer[] | undefined,
  ): Promise<{ result: UnderwritingResult; input: UnderwritingInput }> {
    const rules = await this.d.underwriting?.underwritingInForce(series, onDate);
    if (!rules) throw new PolicyError('conflict', `The underwriting series ${series} has no published version in force on ${onDate}`);
    const input: UnderwritingInput = {
      market,
      species: animal.species,
      ...(animal.breed ? { breed: animal.breed } : {}),
      birthDate: animal.birthDate,
      startDate,
      answers: structuredClone(answers ?? []),
    };
    try {
      return { result: underwrite(rules, input), input };
    } catch (e) {
      if (e instanceof UnderwritingError) throw new PolicyError('validation', e.message);
      throw e;
    }
  }

  /** Everything an issue checks and computes before anything is stored. */
  private async planIssue(input: IssueInput, by: string, rights: CallerRights) {
    const profile = this.profile(input.market);
    const now = this.d.clock.now();
    const today = marketDate(input.market, now);
    if (!validDate(input.startDate)) throw new PolicyError('validation', 'startDate must be YYYY-MM-DD');
    if (input.startDate < today) throw new PolicyError('validation', 'A policy cannot start before the day it is issued');
    const acceptance = this.acceptanceOf(input.acceptance, now);

    const animal = await this.d.animals.get(input.animalId);
    if (!animal || animal.market !== input.market) throw new PolicyError('validation', `The animal ${input.animalId} does not exist in market ${input.market}`);
    if (animal.deceasedOn) throw new PolicyError('validation', `The animal ${input.animalId} has died`);
    if ((await this.d.parties.marketOf(input.policyholderPartyId)) !== input.market) {
      throw new PolicyError('validation', `The party ${input.policyholderPartyId} does not exist in market ${input.market}`);
    }

    const offer = await this.d.products.offer(input.productVersion, input.startDate);
    if (!offer) throw new PolicyError('validation', `The product version ${input.productVersion} does not exist`);
    if (offer.termMonths > profile.maxTermMonths) {
      throw new PolicyError('validation', `${input.productVersion} has terms of ${offer.termMonths} months; ${input.market} allows at most ${profile.maxTermMonths}`);
    }
    if (!offer.onSale) throw new PolicyError('validation', `${input.productVersion} is not on sale on ${input.startDate}`);
    if (offer.market !== input.market) throw new PolicyError('validation', `${input.productVersion} is not sold in market ${input.market}`);
    if (!offer.species.includes(animal.species)) throw new PolicyError('validation', `${input.productVersion} does not cover ${animal.species}`);
    checkAcceptedDocuments(acceptance, offer, input.productVersion);
    let vetCare: VetCareTerms & { deductibleOption: string };
    try {
      vetCare = offer.vetCareTermsFor(input.vetCare ?? {});
    } catch (e) {
      throw new PolicyError('validation', (e as Error).message);
    }
    const endDate = addMonths(input.startDate, offer.termMonths);
    const { deductibleOption, ...terms } = vetCare;
    let group: { kind: 'litter' | 'household'; memberNo: number } | undefined;
    if (input.groupId !== undefined) {
      const g = await this.getGroup(input.groupId);
      if (g.market !== input.market || g.holderPartyId !== input.policyholderPartyId) {
        throw new PolicyError('validation', `The group ${g.id} belongs to another policyholder or market`);
      }
      group = { kind: g.kind, memberNo: g.members.filter((m) => m.from <= input.startDate && (!m.to || input.startDate < m.to)).length + 1 };
    }
    const postalCode = (await this.d.parties.postalCodeOf?.(input.policyholderPartyId)) ?? undefined;
    const pricing = await this.priceFor(offer, {
      market: input.market,
      productVersion: input.productVersion,
      startDate: input.startDate,
      endDate,
      animal,
      ...(postalCode ? { postalCode } : {}),
      ...(group ? { group } : {}),
      ...(input.campaignCode ? { campaignCode: input.campaignCode } : {}),
      newPolicy: true,
      annualLimit: terms.annualLimit,
      deductibleOption,
    });
    const premium = this.premiumFor(pricing, input.premium, input.priceOverride, rights, by, offer.currency);
    return { now, today, animal, offer, endDate, terms, deductibleOption, premium, acceptance, policyId: this.d.ids.next('pol') };
  }

  /** Stores a planned issue: the policy, its first term and version, and the application it came from, in one transaction. */
  private async commitIssue(
    plan: Awaited<ReturnType<PolicyService['planIssue']>>,
    input: IssueInput,
    by: string,
    u: { riders: Rider[]; note: string; events: PolicyEvent[]; application?: Application; applicationId?: string; decision?: IssueExtra['decision'] },
  ): Promise<PolicyRecord> {
    const { now, policyId, offer, endDate, premium } = plan;
    const txId = this.d.ids.next('ptx');
    const policy: Policy = { id: policyId, market: input.market, animalId: input.animalId, inceptionDate: input.startDate, createdBy: by, createdAt: now };
    const term: Term = {
      policyId,
      termNo: 1,
      startDate: input.startDate,
      endDate,
      productVersion: input.productVersion,
      currency: offer.currency,
      vetCare: plan.terms,
      deductibleOption: plan.deductibleOption,
      premium: premium.amount,
      riders: u.riders,
      transactionId: txId,
      ...(premium.pricing ? { pricing: premium.pricing } : {}),
    };
    const version: PolicyVersion = {
      id: this.d.ids.next('pv'),
      policyId,
      validFrom: input.startDate,
      validTo: endDate,
      sysFrom: now,
      policyholderPartyId: input.policyholderPartyId,
      status: 'active',
      termNo: 1,
      transactionId: txId,
    };
    const tx: PolicyTransaction = {
      id: txId,
      policyId,
      type: 'issue',
      steps: [
        { step: 'draft', at: now },
        { step: 'priced', at: now, note: this.pricedNote(premium.pricing) },
        { step: 'underwritten', at: now, note: u.note },
        { step: 'issued', at: now },
      ],
      requestedBy: by,
      requestedAt: now,
      issue: { acceptance: plan.acceptance, ...(u.applicationId ? { applicationId: u.applicationId } : {}) },
    };
    await this.d.store
      .issue(
        policy,
        term,
        version,
        tx,
        [
          ...u.events,
          this.event('policy.issued', policyId, now, {
            transactionId: txId,
            animalId: input.animalId,
            policyholderPartyId: input.policyholderPartyId,
            productVersion: input.productVersion,
            startDate: input.startDate,
            endDate,
            premium: { amount: premium.amount, currency: offer.currency },
            ...(u.applicationId ? { applicationId: u.applicationId } : {}),
          }),
        ],
        { ...(u.application ? { application: u.application } : {}), ...(u.decision ? { decision: u.decision } : {}) },
      )
      .catch(this.translate);
    if (input.groupId !== undefined) await this.addMember(input.groupId, { policyId, from: input.startDate }, by);
    return this.get(policyId);
  }

  /** The customer's acceptance at issue (ADR 0031): a channel, and a time that is not in the future. */
  private acceptanceOf(a: AcceptanceInput | undefined, now: Timestamp): Acceptance {
    const channel = (a?.channel ?? '').trim();
    if (!channel) throw new PolicyError('validation', 'acceptance.channel is required: where the customer accepted the offer');
    const at = Date.parse(a?.acceptedAt ?? '');
    if (Number.isNaN(at)) throw new PolicyError('validation', 'acceptance.acceptedAt must be a timestamp');
    // A few minutes for clocks that differ between the channel and Petvold.
    if (at > Date.parse(now) + 5 * 60_000) throw new PolicyError('validation', 'acceptance.acceptedAt cannot be in the future');
    const reference = a?.reference?.trim();
    const documents = a?.documents === undefined ? undefined : acceptedDocumentsOf(a.documents);
    return { channel, ...(reference ? { reference } : {}), acceptedAt: new Date(at).toISOString(), receivedAt: now, ...(documents?.length ? { documents } : {}) };
  }

  /** The periods the party held a policy, as known now: for retention, to find the party's claims (ADR 0028). */
  async holderPeriods(partyId: string): Promise<{ policyId: string; from: ISODate; to: ISODate }[]> {
    return (await this.findByPolicyholder(partyId)).flatMap((p) =>
      p.versions.filter((v) => v.policyholderPartyId === partyId).map((v) => ({ policyId: p.id, from: v.validFrom, to: v.validTo })),
    );
  }

  /**
   * For retention (ADR 0028), as an ActivitySource: ongoing while the party is
   * the policyholder of a version that has not ended, else the end of the last one.
   */
  async activityOf(partyId: string): Promise<{ ongoing: true } | { lastDate: ISODate } | null> {
    const now = this.d.clock.now();
    const ends: ISODate[] = [];
    for (const p of await this.findByPolicyholder(partyId)) {
      const today = marketDate(p.market, now);
      for (const v of p.versions.filter((x) => x.policyholderPartyId === partyId && x.status === 'active')) {
        if (v.validTo > today) return { ongoing: true };
        ends.push(v.validTo);
      }
    }
    // An application is a relation too: a referred one is ongoing, the others count from the day they were received.
    for (const a of await this.d.store.listApplications({ policyholderPartyId: partyId })) {
      if (a.status === 'referred') return { ongoing: true };
      ends.push(marketDate(a.market, a.decision?.decidedAt ?? a.receivedAt));
    }
    const last = ends.sort().at(-1);
    return last ? { lastDate: last } : null;
  }
}

/** In-memory store, for tests and the dev server without a database. */
export class InMemoryPolicyStore implements PolicyStore {
  private policies: Policy[] = [];
  private terms: Term[] = [];
  private versions: PolicyVersion[] = [];
  private txs: PolicyTransaction[] = [];
  private outbox: (PolicyEvent & { publishedAt?: string })[] = [];
  private proposals: Proposal[] = [];
  private groups: PolicyGroup[] = [];
  private applications: Application[] = [];

  async addApplication(a: Application, events: PolicyEvent[]) {
    if (this.applications.some((x) => x.id === a.id)) throw new PolicyConflictError(`Application ${a.id} exists`);
    this.applications.push(structuredClone(a));
    this.outbox.push(...structuredClone(events));
  }

  private applicationDecisions = new Map<string, ApplicationDecision>();

  /** The application as read: its decision, if any, sets the status and the policy. */
  private viewOf(a: Application): Application {
    const d = this.applicationDecisions.get(a.id);
    return structuredClone(d ? { ...a, status: d.outcome, decision: d, ...(d.policyId ? { policyId: d.policyId } : {}) } : a);
  }

  async decideApplication(applicationId: string, decision: ApplicationDecision, events: PolicyEvent[]) {
    this.checkDecidable(applicationId);
    this.applicationDecisions.set(applicationId, structuredClone(decision));
    this.outbox.push(...structuredClone(events));
  }

  private checkDecidable(applicationId: string) {
    const a = this.applications.find((x) => x.id === applicationId);
    if (!a || a.status !== 'referred' || this.applicationDecisions.has(applicationId)) throw new PolicyConflictError(`Application ${applicationId} is not waiting for a decision`);
  }

  async getApplication(id: string) {
    const a = this.applications.find((x) => x.id === id);
    return a ? this.viewOf(a) : null;
  }

  async listApplications(f: ApplicationFilter) {
    return this.applications.map((a) => this.viewOf(a)).filter(
        (a) =>
          (!f.status || a.status === f.status) &&
          (!f.market || a.market === f.market) &&
          (!f.animalId || a.animalId === f.animalId) &&
          (!f.policyholderPartyId || a.policyholderPartyId === f.policyholderPartyId),
      );
  }

  async createGroup(g: PolicyGroup) {
    this.groups.push(structuredClone(g));
  }

  async getGroup(id: string) {
    const g = this.groups.find((x) => x.id === id);
    return g ? structuredClone(g) : null;
  }

  async findGroups(filter: { holderPartyId?: string; policyId?: string }) {
    return structuredClone(
      this.groups.filter(
        (g) => (!filter.holderPartyId || g.holderPartyId === filter.holderPartyId) && (!filter.policyId || g.members.some((m) => m.policyId === filter.policyId)),
      ),
    );
  }

  async addMember(groupId: string, m: GroupMembership) {
    if (this.groups.some((g) => g.members.some((x) => x.policyId === m.policyId && !x.to))) {
      throw new PolicyConflictError(`Policy ${m.policyId} is already a member of a group`);
    }
    this.groups.find((g) => g.id === groupId)!.members.push(structuredClone(m));
  }

  async endMember(groupId: string, policyId: string, end: { to: ISODate; endedBy: string; endedAt: string; reason: string }) {
    const m = this.groups.find((g) => g.id === groupId)?.members.find((x) => x.policyId === policyId && !x.to);
    if (!m) throw new PolicyConflictError(`Policy ${policyId} is not a member of group ${groupId}`);
    Object.assign(m, { to: end.to, endedBy: end.endedBy, endedAt: end.endedAt, endReason: end.reason });
  }

  async addProposal(p: Proposal) {
    if (this.proposals.some((x) => x.sourceEventId === p.sourceEventId)) return false;
    this.proposals.push(structuredClone(p));
    return true;
  }

  async getProposal(id: string) {
    const p = this.proposals.find((x) => x.id === id);
    return p ? structuredClone(p) : null;
  }

  async listProposals(filter: { policyId?: string; pending?: boolean }) {
    return structuredClone(
      this.proposals.filter((p) => (!filter.policyId || p.policyId === filter.policyId) && (filter.pending === undefined || filter.pending === !p.decision)),
    );
  }

  async decideProposal(proposalId: string, decision: ProposalDecision) {
    const p = this.proposals.find((x) => x.id === proposalId);
    if (!p || p.decision) throw new PolicyConflictError(`Proposal ${proposalId} is already decided`);
    p.decision = structuredClone(decision);
  }

  async get(id: string): Promise<PolicyRecord | null> {
    const p = this.policies.find((x) => x.id === id);
    if (!p) return null;
    return structuredClone({
      ...p,
      terms: this.terms.filter((t) => t.policyId === id).sort((a, b) => a.termNo - b.termNo),
      versions: this.versions.filter((v) => v.policyId === id && !v.sysTo).sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1)),
    });
  }

  async history(id: string) {
    return structuredClone(
      this.versions
        .filter((v) => v.policyId === id)
        .sort((a, b) => (a.sysFrom === b.sysFrom ? (a.validFrom < b.validFrom ? -1 : 1) : a.sysFrom < b.sysFrom ? -1 : 1)),
    );
  }

  async transactions(id: string) {
    return structuredClone(this.txs.filter((t) => t.policyId === id));
  }

  async versionAt(id: string, onDate: ISODate, knownAt?: Timestamp) {
    const known = (v: PolicyVersion) => (knownAt === undefined ? !v.sysTo : v.sysFrom <= knownAt && (!v.sysTo || knownAt < v.sysTo));
    const v = this.versions.find((x) => x.policyId === id && known(x) && x.validFrom <= onDate && onDate < x.validTo);
    return v ? structuredClone(v) : null;
  }

  async findByAnimal(animalId: string) {
    return this.policies.filter((p) => p.animalId === animalId).map((p) => p.id).sort();
  }

  async findByPolicyholder(partyId: string) {
    return [...new Set(this.versions.filter((v) => !v.sysTo && v.policyholderPartyId === partyId).map((v) => v.policyId))].sort();
  }

  async endingBetween(from: ISODate, to: ISODate) {
    const current = this.versions.filter((v) => !v.sysTo);
    return [
      ...new Set(
        current
          .filter((v) => v.status === 'active' && from <= v.validTo && v.validTo <= to)
          .filter((v) => !current.some((n) => n.policyId === v.policyId && n.validFrom === v.validTo))
          .map((v) => v.policyId),
      ),
    ].sort();
  }

  async apply(
    policyId: string,
    supersede: string[],
    add: PolicyVersion[],
    tx: PolicyTransaction,
    events: PolicyEvent[],
    { terms = [], decision, changes = [], endMemberships = [] }: ApplyExtra = {},
  ) {
    if (decision && this.proposals.find((x) => x.id === decision.proposalId)?.decision) throw new PolicyConflictError(`Proposal ${decision.proposalId} is already decided`);
    if (terms.some((t) => this.terms.some((x) => x.policyId === t.policyId && x.termNo === t.termNo))) throw new PolicyConflictError(`Policy ${policyId} has changed`);
    const current = supersede.map((id) => this.versions.find((v) => v.id === id && v.policyId === policyId && !v.sysTo));
    if (current.some((v) => !v)) throw new PolicyConflictError(`Policy ${policyId} has changed`);
    for (const v of current) v!.sysTo = tx.requestedAt;
    this.terms.push(...structuredClone(terms));
    for (const { policyId: pid, termNo, ...c } of structuredClone(changes)) {
      const t = this.terms.find((x) => x.policyId === pid && x.termNo === termNo)!;
      t.changes = [...(t.changes ?? []), c];
    }
    this.versions.push(...structuredClone(add));
    this.txs.push(structuredClone(tx));
    this.outbox.push(...structuredClone(events));
    if (decision) this.proposals.find((x) => x.id === decision.proposalId)!.decision = structuredClone(decision.decision);
    for (const e of endMemberships) {
      const m = this.groups.find((g) => g.id === e.groupId)?.members.find((x) => x.policyId === e.policyId && !x.to);
      if (m) Object.assign(m, { to: e.to, endedBy: e.endedBy, endedAt: e.endedAt, endReason: e.reason });
    }
  }

  async pendingEvents(limit: number) {
    return structuredClone(this.outbox.filter((e) => !e.publishedAt).slice(0, limit)).map(({ publishedAt: _p, ...e }) => e);
  }

  async markPublished(ids: string[], at: string) {
    for (const e of this.outbox) if (ids.includes(e.id)) e.publishedAt = at;
  }

  async issue(policy: Policy, term: Term, version: PolicyVersion, tx: PolicyTransaction, events: PolicyEvent[], { application, decision }: IssueExtra = {}) {
    if (this.policies.some((p) => p.id === policy.id)) throw new PolicyConflictError(`Policy ${policy.id} exists`);
    if (application && this.applications.some((x) => x.id === application.id)) throw new PolicyConflictError(`Application ${application.id} exists`);
    if (decision) this.checkDecidable(decision.applicationId);
    const others = new Set(this.policies.filter((p) => p.animalId === policy.animalId).map((p) => p.id));
    const overlap = this.versions.some(
      (v) => others.has(v.policyId) && !v.sysTo && v.status === 'active' && v.validFrom < version.validTo && version.validFrom < v.validTo,
    );
    if (overlap) throw new PolicyConflictError(`The animal ${policy.animalId} already has a policy for that period`);
    this.policies.push(structuredClone(policy));
    this.terms.push(structuredClone(term));
    this.versions.push(structuredClone(version));
    this.txs.push(structuredClone(tx));
    this.outbox.push(...structuredClone(events));
    if (application) this.applications.push(structuredClone(application));
    if (decision) this.applicationDecisions.set(decision.applicationId, structuredClone(decision.decision));
  }
}
