import type {
  Claim,
  ClaimDecision,
  ClaimsStore,
  DecisionCommit,
  DeductiblePeriod,
  ISODate,
  LedgerJournal,
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
 * Lagring i minnet med samma semantik som Postgres-schemat: beslut och
 * journaler läggs bara till, och varje journal måste balansera.
 * För tester och lokal utveckling.
 */
export class InMemoryClaimsStore implements ClaimsStore {
  private claims = new Map<string, Claim>();
  private decisions: ClaimDecision[] = [];
  private journals: LedgerJournal[] = [];
  private periods: DeductiblePeriod[] = [];

  async saveClaim(claim: Claim) {
    this.claims.set(claim.id, structuredClone(claim));
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

  async getConsumed(animalId: string, coverage: string, policyYearStart: ISODate, excludeClaimId?: string): Promise<MinorUnits> {
    const account = `limit_consumed:${animalId}:${coverage}:${policyYearStart}`;
    return this.journals
      .filter((j) => j.claimId !== excludeClaimId)
      .flatMap((j) => j.lines)
      .filter((l) => l.account === account)
      .reduce((s, l) => s + l.amount, 0);
  }

  async getDecisions(claimId: string) {
    return this.decisions.filter((d) => d.claimId === claimId).map((d) => structuredClone(d));
  }

  async commitDecision({ decision, journals, deductiblePeriod }: DecisionCommit) {
    for (const j of journals) {
      const sum = j.lines.reduce((s, l) => s + l.amount, 0);
      if (sum !== 0) throw new Error(`Journal ${j.id} balanserar inte (${sum})`);
    }
    if (this.decisions.some((d) => d.claimId === decision.claimId && d.seq === decision.seq)) {
      throw new Error(`Beslut ${decision.claimId}#${decision.seq} finns redan`);
    }
    this.decisions.push(structuredClone(decision));
    this.journals.push(...structuredClone(journals));
    this.periods = this.periods.filter((p) => p.openedByClaimId !== decision.claimId);
    if (deductiblePeriod) this.periods.push({ ...deductiblePeriod });
  }

  /** Endast för tester och felsökning. */
  dump() {
    return { decisions: this.decisions, journals: this.journals, periods: this.periods };
  }
}

/**
 * Policyport i minnet som stöder bitemporala uppslag: varje version har
 * giltighetstid och registreringstid.
 */
export interface StoredPolicyVersion {
  snapshot: PolicySnapshot;
  /** När versionen registrerades. */
  sysFrom: Timestamp;
  /** När versionen ersattes; utelämnad = fortfarande aktuell. */
  sysTo?: Timestamp;
}

export class InMemoryPolicyPort implements PolicyPort {
  constructor(private readonly versions: StoredPolicyVersion[] = []) {}

  add(v: StoredPolicyVersion) {
    this.versions.push(v);
  }

  /** Ersätter en version i registreringstid (retroaktiv ändring). */
  supersede(policyVersionId: string, at: Timestamp) {
    const v = this.versions.find((x) => x.snapshot.policyVersionId === policyVersionId && !x.sysTo);
    if (!v) throw new Error(`Ingen aktuell version ${policyVersionId}`);
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
