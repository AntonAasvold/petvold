import { StoreConflictError, accounts } from '@petvold/claims-core';
import type {
  Claim,
  ClaimDecision,
  ClaimsEvent,
  ClaimsOutbox,
  ClaimsStore,
  OutboxEntry,
  DecisionCommit,
  DeductiblePeriod,
  ISODate,
  LedgerJournal,
  LimitKey,
  MinorUnits,
  PolicyPort,
  PolicySnapshot,
  RulesPort,
  ClaimsRules,
  Clock,
  IdGenerator,
  Timestamp,
} from '@petvold/claims-core';

/**
 * In-memory store with the same semantics as the Postgres schema: decisions
 * and journals are append-only, and every journal must balance.
 * For tests and local development.
 */
export class InMemoryClaimsStore implements ClaimsStore, ClaimsOutbox {
  private claims = new Map<string, Claim>();
  private decisions: ClaimDecision[] = [];
  private journals: LedgerJournal[] = [];
  private periods: DeductiblePeriod[] = [];
  private outbox: Array<OutboxEntry & { publishedAt?: Timestamp }> = [];
  private outboxSeq = 0;

  async saveClaim(claim: Claim, events: ClaimsEvent[]) {
    if (this.claims.has(claim.id)) throw new StoreConflictError('claim_exists', `Claim ${claim.id} already exists`);
    this.claims.set(claim.id, structuredClone(claim));
    this.appendEvents(events);
  }

  async getClaim(id: string) {
    const c = this.claims.get(id);
    return c ? structuredClone(c) : null;
  }

  async findDeductiblePeriod(animalId: string, group: string, onDate: ISODate, excludeClaimId?: string) {
    const hit = this.periods.find(
      (p) =>
        p.animalId === animalId &&
        p.diagnosisGroup === group &&
        p.validFrom <= onDate &&
        onDate < p.validTo &&
        p.openedByClaimId !== excludeClaimId,
    );
    return hit ? { ...hit } : null;
  }

  async getConsumed(limit: LimitKey, excludeClaimId?: string): Promise<MinorUnits> {
    const account = accounts.limitConsumed(limit);
    return this.journals
      .filter((j) => j.claimId !== excludeClaimId)
      .flatMap((j) => j.lines)
      .filter((l) => l.account === account)
      .reduce((s, l) => s + l.amount, 0);
  }

  async getDecisions(claimId: string) {
    return this.decisions
      .filter((d) => d.claimId === claimId)
      .sort((a, b) => a.seq - b.seq)
      .map((d) => structuredClone(d));
  }

  /** Checks everything first and then changes, so an error never leaves half a decision behind. */
  async commitDecision({ decision, journals, deductiblePeriod, events }: DecisionCommit) {
    if (!this.claims.has(decision.claimId)) throw new Error(`Claim ${decision.claimId} does not exist`);
    for (const j of journals) {
      const sum = j.lines.reduce((s, l) => s + l.amount, 0);
      if (sum !== 0) throw new Error(`Journal ${j.id} does not balance (${sum})`);
    }
    if (this.decisions.some((d) => d.claimId === decision.claimId && d.seq === decision.seq)) {
      throw new StoreConflictError('decision_exists', `Decision ${decision.claimId}#${decision.seq} already exists`);
    }
    const remaining = this.periods.filter((p) => p.openedByClaimId !== decision.claimId);
    if (deductiblePeriod) {
      const clash = remaining.find(
        (p) =>
          p.animalId === deductiblePeriod.animalId &&
          p.diagnosisGroup === deductiblePeriod.diagnosisGroup &&
          p.validFrom < deductiblePeriod.validTo &&
          deductiblePeriod.validFrom < p.validTo,
      );
      if (clash) throw new StoreConflictError('period_overlaps', `The deductible period clashes with ${clash.id}`);
    }
    this.decisions.push(structuredClone(decision));
    this.journals.push(...structuredClone(journals));
    this.periods = remaining;
    if (deductiblePeriod) this.periods.push({ ...deductiblePeriod });
    this.appendEvents(events);
  }

  async pendingEvents(limit: number): Promise<OutboxEntry[]> {
    return this.outbox
      .filter((e) => !e.publishedAt)
      .slice(0, limit)
      .map((e) => ({ id: e.id, event: structuredClone(e.event) }));
  }

  async markPublished(ids: string[], at: Timestamp): Promise<void> {
    for (const e of this.outbox) if (ids.includes(e.id) && !e.publishedAt) e.publishedAt = at;
  }

  private appendEvents(events: ClaimsEvent[]) {
    for (const event of events) this.outbox.push({ id: String(++this.outboxSeq), event: structuredClone(event) });
  }

  /** For tests and debugging only. */
  dump() {
    return { decisions: this.decisions, journals: this.journals, periods: this.periods, outbox: this.outbox };
  }
}

/**
 * In-memory policy port supporting bitemporal lookups: every version has
 * valid time and system time.
 */
export interface StoredPolicyVersion {
  snapshot: PolicySnapshot;
  /** When the version was recorded. */
  sysFrom: Timestamp;
  /** When the version was superseded; omitted = still current. */
  sysTo?: Timestamp;
}

export class InMemoryPolicyPort implements PolicyPort {
  constructor(private readonly versions: StoredPolicyVersion[] = []) {}

  add(v: StoredPolicyVersion) {
    this.versions.push(v);
  }

  /** Supersedes a version in system time (retroactive change). */
  supersede(policyVersionId: string, at: Timestamp) {
    const v = this.versions.find((x) => x.snapshot.policyVersionId === policyVersionId && !x.sysTo);
    if (!v) throw new Error(`No current version ${policyVersionId}`);
    v.sysTo = at;
  }

  async getPolicyAt(policyId: string, onDate: ISODate, knownAt?: Timestamp) {
    const known = (v: StoredPolicyVersion) =>
      knownAt === undefined ? !v.sysTo : v.sysFrom <= knownAt && (!v.sysTo || knownAt < v.sysTo);
    const hit = this.versions.find(
      (v) =>
        v.snapshot.policyId === policyId &&
        known(v) &&
        v.snapshot.validFrom <= onDate &&
        (!v.snapshot.validTo || onDate < v.snapshot.validTo),
    );
    return hit ? structuredClone(hit.snapshot) : null;
  }
}

export class StaticRulesPort implements RulesPort {
  constructor(private readonly byProduct: Record<string, ClaimsRules>, private readonly fallback: ClaimsRules) {}
  async getRules(productVersion: string) {
    return this.byProduct[productVersion] ?? this.fallback;
  }
}

export class FixedClock implements Clock {
  constructor(private t: Timestamp) {}
  now() {
    return this.t;
  }
  set(t: Timestamp) {
    this.t = t;
  }
}

export class SequentialIds implements IdGenerator {
  private n = 0;
  next(prefix: string) {
    this.n += 1;
    return `${prefix}_${String(this.n).padStart(6, '0')}`;
  }
}

export * as fixtures from './fixtures.ts';
