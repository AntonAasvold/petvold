import { assess, deductibleScope, validateClaim } from './assess.ts';
import type { ClaimsStore, Clock, EventSink, IdGenerator, PolicyPort, RulesPort } from './ports.ts';
import type {
  Assessment,
  Claim,
  ClaimDecision,
  DeductiblePeriod,
  CurrencyCode,
  ISODate,
  LedgerJournal,
  MarketCode,
  Ore,
  Timestamp,
} from './types.ts';
import { assertDate } from './util.ts';

export type DomainErrorCode = 'not_found' | 'validation' | 'conflict';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface DecideCommand {
  /** accept = fatta beslut enligt bedömningens förslag; reject = avslå. */
  action: 'accept' | 'reject';
  decidedBy: string;
  reason?: string;
  /**
   * inputHash från bedömningen handläggaren tittade på. Har underlaget
   * ändrats sedan dess (ny policyversion, annat ärende fått beslut) avvisas
   * beslutet med 'conflict' i stället för att fattas på inaktuell data.
   */
  expectedInputHash?: string;
}

export interface LimitsView {
  animalId: string;
  policyId: string;
  market: MarketCode;
  currency: CurrencyCode;
  coverage: 'vet_care';
  policyYearStart: ISODate;
  policyYearEnd: ISODate;
  annualLimit: Ore;
  consumed: Ore;
  remaining: Ore;
}

export interface ClaimsServiceDeps {
  policies: PolicyPort;
  rules: RulesPort;
  store: ClaimsStore;
  clock: Clock;
  ids: IdGenerator;
  events?: EventSink;
}

const COVERAGE = 'vet_care';

/** Skademotorns applikationstjänst. Det enda HTTP-lagret pratar med. */
export class ClaimsService {
  constructor(private readonly d: ClaimsServiceDeps) {}

  /** Registrerar ett ärende, bedömer det och reglerar automatiskt om reglerna tillåter. */
  async registerClaim(claim: Claim): Promise<{ claim: Claim; assessment: Assessment; decision: ClaimDecision | null }> {
    try {
      validateClaim(claim);
    } catch (e) {
      throw new DomainError('validation', (e as Error).message);
    }
    const existing = await this.d.store.getClaim(claim.id);
    if (existing) throw new DomainError('conflict', `Skadeärendet ${claim.id} finns redan`);

    await this.d.store.saveClaim(claim);
    await this.d.events?.publish({ type: 'claim.registered', occurredAt: this.d.clock.now(), claim });
    const assessment = await this.assessClaim(claim.id);
    const decision =
      assessment.mode === 'auto' ? await this.commit(claim, assessment, assessment.proposedOutcome === 'rejected' ? 'reject' : 'accept', 'auto') : null;
    return { claim, assessment, decision };
  }

  /** Bedömer ett befintligt ärende utan att spara något. */
  async assessClaim(claimId: string, knownAt?: Timestamp): Promise<Assessment> {
    const claim = await this.requireClaim(claimId);
    return this.assessInternal(claim, knownAt, claim.id);
  }

  /**
   * Förhandsbesked, t.ex. i klinikens kassa. Ärendet sparas inte och inga
   * självriskperioder eller belopp reserveras.
   */
  async preview(draft: Claim): Promise<Assessment> {
    try {
      validateClaim(draft);
    } catch (e) {
      throw new DomainError('validation', (e as Error).message);
    }
    return this.assessInternal(draft, undefined, undefined);
  }

  /** Handläggarbeslut. */
  async decide(claimId: string, cmd: DecideCommand): Promise<ClaimDecision> {
    const claim = await this.requireClaim(claimId);
    const assessment = await this.assessInternal(claim, undefined, claim.id);
    if (cmd.expectedInputHash && cmd.expectedInputHash !== assessment.inputHash) {
      throw new DomainError('conflict', 'Underlaget har ändrats sedan bedömningen. Hämta en ny bedömning och försök igen.');
    }
    if (cmd.action === 'accept' && assessment.proposedOutcome === 'rejected') {
      throw new DomainError('validation', 'Bedömningen föreslår avslag och kan inte godkännas. Avslå eller åtgärda underlaget.');
    }
    return this.commit(claim, assessment, cmd.action, cmd.decidedBy, cmd.reason);
  }

  /**
   * Omprövning, t.ex. efter en retroaktiv policyändring. Skapar ett nytt beslut
   * om utfallet ändrats; ledgern bokar bara skillnaden.
   */
  async reassess(claimId: string, decidedBy: string, reason: string): Promise<ClaimDecision | null> {
    const claim = await this.requireClaim(claimId);
    const prev = await this.latestDecision(claimId);
    if (!prev) throw new DomainError('conflict', 'Ärendet har inget beslut att ompröva');
    const assessment = await this.assessInternal(claim, undefined, claim.id);
    if (assessment.inputHash === prev.assessment.inputHash) return null;
    const action = assessment.proposedOutcome === 'rejected' ? 'reject' : 'accept';
    const next = await this.commit(claim, assessment, action, decidedBy, reason);
    return next;
  }

  async getClaim(claimId: string): Promise<Claim> {
    return this.requireClaim(claimId);
  }

  async getDecisions(claimId: string): Promise<ClaimDecision[]> {
    await this.requireClaim(claimId);
    return this.d.store.getDecisions(claimId);
  }

  async getLimits(policyId: string, animalId: string, onDate: ISODate): Promise<LimitsView> {
    try {
      assertDate(onDate, 'onDate');
    } catch (e) {
      throw new DomainError('validation', (e as Error).message);
    }
    const policy = await this.d.policies.getPolicyAt(policyId, onDate);
    if (!policy || policy.animalId !== animalId || !policy.vetCare) {
      throw new DomainError('not_found', 'Ingen gällande veterinärvårdsförsäkring för djuret på datumet');
    }
    const consumed = await this.d.store.getConsumed(animalId, COVERAGE, policy.policyYearStart);
    return {
      animalId,
      policyId,
      market: policy.market,
      currency: policy.currency,
      coverage: COVERAGE,
      policyYearStart: policy.policyYearStart,
      policyYearEnd: policy.policyYearEnd,
      annualLimit: policy.vetCare.annualLimit,
      consumed,
      remaining: Math.max(0, policy.vetCare.annualLimit - consumed),
    };
  }

  // -------------------------------------------------------------------------

  private async assessInternal(claim: Claim, knownAt: Timestamp | undefined, ownClaimId: string | undefined): Promise<Assessment> {
    const policy = await this.d.policies.getPolicyAt(claim.policyId, claim.treatmentFrom, knownAt);
    const rules = await this.d.rules.getRules(policy?.productVersion ?? 'default');
    const group = rules.diagnosisGroups[claim.diagnosisCode] ?? null;
    const scope = policy ? deductibleScope(claim, policy, group) : null;
    const openDeductiblePeriod = scope
      ? await this.d.store.findDeductiblePeriod(claim.animalId, scope.diagnosisGroup, claim.treatmentFrom, ownClaimId)
      : null;
    const consumedBefore = policy
      ? await this.d.store.getConsumed(claim.animalId, COVERAGE, policy.policyYearStart, ownClaimId)
      : 0;
    return assess({ claim, policy, rules, openDeductiblePeriod, consumedBefore });
  }

  private async commit(
    claim: Claim,
    assessment: Assessment,
    action: 'accept' | 'reject',
    decidedBy: string,
    reason?: string,
  ): Promise<ClaimDecision> {
    const prev = await this.latestDecision(claim.id);
    const now = this.d.clock.now();
    const outcome = action === 'reject' ? 'rejected' : assessment.proposedOutcome;
    const payout = outcome === 'rejected' ? 0 : (assessment.calculation?.payout ?? 0);

    const decision: ClaimDecision = {
      id: this.d.ids.next('dec'),
      claimId: claim.id,
      seq: (prev?.seq ?? 0) + 1,
      outcome,
      payout,
      assessment,
      decidedBy,
      decidedAt: now,
      ...(reason ? { reason } : {}),
    };

    const journals: LedgerJournal[] = [];
    const diff = payout - (prev?.payout ?? 0);
    const policy = await this.d.policies.getPolicyAt(claim.policyId, claim.treatmentFrom);
    if (diff !== 0) {
      if (!policy) throw new DomainError('conflict', 'Policyn kunde inte läsas vid bokföring');
      const limitKey = `${claim.animalId}:${COVERAGE}:${policy.policyYearStart}`;
      const cur = claim.currency;
      journals.push({
        id: this.d.ids.next('jrn'),
        sourceType: 'claim_decision',
        sourceId: decision.id,
        claimId: claim.id,
        bookedAt: now,
        lines: [
          { account: `limit_consumed:${limitKey}`, amount: diff },
          { account: `limit_available:${limitKey}`, amount: -diff },
          { account: `claim_expense:${cur}:${claim.id}`, amount: diff },
          { account: `claim_payable:${cur}:${claim.id}`, amount: -diff },
        ],
      });
    }

    let deductiblePeriod: DeductiblePeriod | null = null;
    const calc = assessment.calculation;
    const scope = policy ? deductibleScope(claim, policy, assessment.diagnosisGroup) : null;
    if (outcome !== 'rejected' && calc?.opensDeductiblePeriod && scope) {
      deductiblePeriod = { id: this.d.ids.next('dp'), animalId: claim.animalId, ...scope, openedByClaimId: claim.id };
    }

    await this.d.store.commitDecision({ decision, journals, deductiblePeriod });
    await this.d.events?.publish({ type: 'claim.decided', occurredAt: now, decision });
    return decision;
  }

  private async latestDecision(claimId: string): Promise<ClaimDecision | null> {
    const all = await this.d.store.getDecisions(claimId);
    return all.length ? all.reduce((a, b) => (b.seq > a.seq ? b : a)) : null;
  }

  private async requireClaim(claimId: string): Promise<Claim> {
    const claim = await this.d.store.getClaim(claimId);
    if (!claim) throw new DomainError('not_found', `Skadeärendet ${claimId} finns inte`);
    return claim;
  }
}
