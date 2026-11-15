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
 * This first part issues policies. Cancellation, renewal and transfer come next.
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
  sources: string[];
}

export const MARKET_PROFILES: Record<string, MarketProfile> = {
  SE: {
    market: 'SE',
    maxTermMonths: 12,
    retroactiveStart: false,
    sources: ['Insurance Contracts Act (2005:104) chapter 3 section 2: a term of at most one year'],
  },
};

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
  type: 'issue';
  steps: { step: (typeof TRANSACTION_STEPS)[number]; at: Timestamp; note?: string }[];
  requestedBy: string;
  requestedAt: Timestamp;
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
  issue(policy: Policy, term: Term, version: PolicyVersion, tx: PolicyTransaction): Promise<void>;
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
  market: string;
  currency: string;
  species: string[];
  onSale: boolean;
  /** Throws on an option the product does not offer. */
  vetCareTermsFor(choice: { annualLimit?: number; deductible?: string }): VetCareTerms & { deductibleOption: string };
}

export interface ProductPort {
  /** The product version, e.g. SE-HUND-VV-LIV@2026.2, as offered on the date, or null if it does not exist. */
  offer(productVersion: string, onDate: ISODate): Promise<ProductOffer | null>;
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
  async issue(input: IssueInput, by: string): Promise<PolicyRecord> {
    const profile = (this.d.profiles ?? MARKET_PROFILES)[input.market];
    if (!profile) throw new PolicyError('validation', `Petvold has no market profile for '${input.market}'`);
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
    const endDate = addMonths(input.startDate, profile.maxTermMonths);
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
    await this.d.store.issue(policy, term, version, tx).catch((e: unknown) => {
      if (e instanceof PolicyConflictError) throw new PolicyError('conflict', e.message);
      throw e;
    });
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

  async issue(policy: Policy, term: Term, version: PolicyVersion, tx: PolicyTransaction) {
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
  }
}
