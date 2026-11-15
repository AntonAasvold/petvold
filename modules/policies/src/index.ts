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
 * Policies are issued, renewed and cancelled, and a cancellation can be
 * reversed. Transfer comes next. Every change writes events to an outbox in
 * the same transaction (ADR 0008).
 * The module reads products, animals and parties only through ports (ADR 0001),
 * and implements the claims engine's PolicyPort.
 */
import type { ISODate, PolicyPort, PolicySnapshot, Rider, Timestamp, VetCareTerms } from '@petvold/claims-core';

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
  transactionId: string;
}

export const TRANSACTION_STEPS = ['draft', 'priced', 'underwritten', 'issued'] as const;

export interface PolicyTransaction {
  id: string;
  policyId: string;
  type: 'issue' | 'cancel' | 'reinstate' | 'renew';
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
  /** A reinstatement: the cancellation it reverses. */
  reverses?: string;
  note?: string;
}

/** What the policy module tells others, written in the same transaction as the change (ADR 0008). */
export interface PolicyEvent {
  id: string;
  type: 'policy.issued' | 'policy.renewed' | 'policy.cancelled' | 'policy.reinstated' | 'policy.version_superseded';
  policyId: string;
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
   * Stores a new policy with its first term, version and transaction, all or
   * nothing. Throws PolicyConflictError if the animal already has a policy
   * whose current versions overlap the new one.
   */
  issue(policy: Policy, term: Term, version: PolicyVersion, tx: PolicyTransaction, events: PolicyEvent[]): Promise<void>;
  /**
   * Ends `supersede` in system time at tx.requestedAt and adds `add`, all or
   * nothing. Throws PolicyConflictError if any of them is no longer current.
   */
  apply(policyId: string, supersede: string[], add: PolicyVersion[], tx: PolicyTransaction, events: PolicyEvent[], terms?: Term[]): Promise<void>;
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

export type PolicyErrorCode = 'not_found' | 'validation' | 'conflict';

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
  | 'policyholder-unavailable';

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
  get(animalId: string): Promise<{ market: string; species: string; birthDate: ISODate; deceasedOn?: ISODate } | null>;
}

export interface PartyPort {
  /** The party's market, or null if it does not exist or may not get new relations (ADR 0028). */
  marketOf(partyId: string): Promise<string | null>;
}

export interface PolicyDeps {
  store: PolicyStore;
  products: ProductPort;
  animals: AnimalPort;
  parties: PartyPort;
  clock: { now(): string };
  ids: { next(prefix: string): string };
  profiles?: Record<string, MarketProfile>;
}

export interface IssueInput {
  market: string;
  animalId: string;
  policyholderPartyId: string;
  productVersion: string;
  startDate: ISODate;
  vetCare?: { annualLimit?: number; deductible?: string };
  /** The premium for the term. Given by the caller until the tariff exists (M4). */
  premium: { amount: number; currency: string };
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
      if (start < v.validTo) lost += daysBetween(start, v.validTo);
    }
    total += Math.round((t.premium * lost) / termDays);
  }
  return total;
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
    vetCare: structuredClone(term.vetCare),
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

  /**
   * Issues a policy: the first term and version in one transaction through the
   * steps draft, priced, underwritten and issued. Until the tariff and the
   * underwriting rules exist (M4), the caller gives the premium and every
   * application is accepted.
   */
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
  ): Promise<PolicyTransaction> {
    const p = await this.get(policyId);
    const profile = this.profile(p.market);
    const today = this.d.clock.now().slice(0, 10);
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
      .apply(policyId, tx.supersedes!, add, tx, [
        this.event('policy.cancelled', policyId, now, { transactionId: txId, reason: input.reason, effectiveDate: effective, refund }),
        ...this.superseded(policyId, now, tx.supersedes!, add),
      ])
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
  async renew(policyId: string, input: { productVersion?: string; premium?: { amount: number; currency: string } }, by: string): Promise<PolicyTransaction> {
    const plan = await this.planRenewal(await this.get(policyId), input);
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
        { step: 'priced', at: now, note: input.premium ? 'Premium given by the caller' : 'Same premium as the last term (no tariff yet, M4)' },
        { step: 'underwritten', at: now, note: 'Accepted (no underwriting rules yet, M4)' },
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
        [term],
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
    const today = this.d.clock.now().slice(0, 10);
    const result: RenewalRunResult = { onDate: today, dryRun: input.dryRun, checked: 0, renewed: [], cancelled: 0, notYet: 0, needsDecision: [] };
    for (const id of await this.d.store.endingBetween(today, addDays(today, 120))) {
      const p = await this.get(id);
      if (input.markets !== '*' && !input.markets.has(p.market)) continue;
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
      const plan = await this.planRenewal(p, {});
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
    input: { productVersion?: string; premium?: { amount: number; currency: string } },
  ): Promise<{ term: Omit<Term, 'transactionId'>; policyholderPartyId: string } | { issue: RenewalIssue; detail: string }> {
    const last = p.versions.at(-1)!;
    if (last.status !== 'active') throw new PolicyError('conflict', `Policy ${p.id} is cancelled from ${last.validFrom}`);
    const prev = p.terms.find((t) => t.termNo === last.termNo)!;
    if (last.validTo !== prev.endDate) throw new PolicyError('conflict', `Policy ${p.id} ends ${last.validTo}, before its term`);
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
      vetCare = offer.vetCareTermsFor({ annualLimit: prev.vetCare.annualLimit, deductible: prev.deductibleOption });
    } catch (e) {
      return { issue: 'option-not-offered', detail: (e as Error).message };
    }
    const premium = input.premium ?? { amount: prev.premium, currency: prev.currency };
    if (premium.currency !== offer.currency || !Number.isSafeInteger(premium.amount) || premium.amount < 0) {
      throw new PolicyError('validation', `The premium must be a whole number of minor units in ${offer.currency}`);
    }
    const { deductibleOption, ...terms } = vetCare;
    return {
      policyholderPartyId: last.policyholderPartyId,
      term: {
        policyId: p.id,
        termNo: prev.termNo + 1,
        startDate: start,
        endDate: addMonths(start, offer.termMonths),
        productVersion,
        currency: offer.currency,
        vetCare: terms,
        deductibleOption,
        premium: premium.amount,
        riders: structuredClone(prev.riders),
      },
    };
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

  async issue(input: IssueInput, by: string): Promise<PolicyRecord> {
    const profile = this.profile(input.market);
    const today = this.d.clock.now().slice(0, 10);
    if (!validDate(input.startDate)) throw new PolicyError('validation', 'startDate must be YYYY-MM-DD');
    if (input.startDate < today) throw new PolicyError('validation', 'A policy cannot start before the day it is issued');

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
    let vetCare: VetCareTerms & { deductibleOption: string };
    try {
      vetCare = offer.vetCareTermsFor(input.vetCare ?? {});
    } catch (e) {
      throw new PolicyError('validation', (e as Error).message);
    }
    const premium = input.premium;
    if (!premium || premium.currency !== offer.currency) throw new PolicyError('validation', `The premium must be in ${offer.currency}`);
    if (!Number.isSafeInteger(premium.amount) || premium.amount < 0) throw new PolicyError('validation', 'The premium is a whole number of minor units, at least 0');

    const now = this.d.clock.now();
    const policyId = this.d.ids.next('pol');
    const txId = this.d.ids.next('ptx');
    const endDate = addMonths(input.startDate, offer.termMonths);
    const { deductibleOption, ...terms } = vetCare;
    const policy: Policy = { id: policyId, market: input.market, animalId: input.animalId, inceptionDate: input.startDate, createdBy: by, createdAt: now };
    const term: Term = {
      policyId,
      termNo: 1,
      startDate: input.startDate,
      endDate,
      productVersion: input.productVersion,
      currency: offer.currency,
      vetCare: terms,
      deductibleOption,
      premium: premium.amount,
      riders: [],
      transactionId: txId,
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
        { step: 'priced', at: now, note: 'Premium given by the caller (no tariff yet, M4)' },
        { step: 'underwritten', at: now, note: 'Accepted (no underwriting rules yet, M4)' },
        { step: 'issued', at: now },
      ],
      requestedBy: by,
      requestedAt: now,
    };
    await this.d.store
      .issue(policy, term, version, tx, [
        this.event('policy.issued', policyId, now, {
          transactionId: txId,
          animalId: input.animalId,
          policyholderPartyId: input.policyholderPartyId,
          productVersion: input.productVersion,
          startDate: input.startDate,
          endDate,
        }),
      ])
      .catch(this.translate);
    return this.get(policyId);
  }

  /**
   * For retention (ADR 0028), as an ActivitySource: ongoing while the party is
   * the policyholder of a version that has not ended, else the end of the last one.
   */
  async activityOf(partyId: string): Promise<{ ongoing: true } | { lastDate: ISODate } | null> {
    const today = this.d.clock.now().slice(0, 10);
    const ends: ISODate[] = [];
    for (const p of await this.findByPolicyholder(partyId)) {
      for (const v of p.versions.filter((x) => x.policyholderPartyId === partyId && x.status === 'active')) {
        if (v.validTo > today) return { ongoing: true };
        ends.push(v.validTo);
      }
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

  async apply(policyId: string, supersede: string[], add: PolicyVersion[], tx: PolicyTransaction, events: PolicyEvent[], terms: Term[] = []) {
    if (terms.some((t) => this.terms.some((x) => x.policyId === t.policyId && x.termNo === t.termNo))) throw new PolicyConflictError(`Policy ${policyId} has changed`);
    const current = supersede.map((id) => this.versions.find((v) => v.id === id && v.policyId === policyId && !v.sysTo));
    if (current.some((v) => !v)) throw new PolicyConflictError(`Policy ${policyId} has changed`);
    for (const v of current) v!.sysTo = tx.requestedAt;
    this.terms.push(...structuredClone(terms));
    this.versions.push(...structuredClone(add));
    this.txs.push(structuredClone(tx));
    this.outbox.push(...structuredClone(events));
  }

  async pendingEvents(limit: number) {
    return structuredClone(this.outbox.filter((e) => !e.publishedAt).slice(0, limit)).map(({ publishedAt: _p, ...e }) => e);
  }

  async markPublished(ids: string[], at: string) {
    for (const e of this.outbox) if (ids.includes(e.id)) e.publishedAt = at;
  }

  async issue(policy: Policy, term: Term, version: PolicyVersion, tx: PolicyTransaction, events: PolicyEvent[]) {
    if (this.policies.some((p) => p.id === policy.id)) throw new PolicyConflictError(`Policy ${policy.id} exists`);
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
  }
}
