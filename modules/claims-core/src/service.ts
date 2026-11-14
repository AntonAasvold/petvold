import { assess, deductibleScope, validateClaim } from './assess.ts';
import { StoreConflictError, type ClaimsEvent, type ClaimsStore, type Clock, type IdGenerator, type PolicyPort, type RulesPort } from './ports.ts';
import type {
  Assessment,
  Claim,
  ClaimDecision,
  DeductiblePeriod,
  CurrencyCode,
  ISODate,
  LedgerJournal,
  MarketCode,
  MinorUnits,
  Timestamp,
} from './types.ts';
import { assertDate } from '@petvold/common';

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
  /** accept = decide as the assessment proposes; reject = reject the claim. */
  action: 'accept' | 'reject';
  decidedBy: string;
  reason?: string;
  /**
   * inputHash from the assessment the handler looked at. If the basis has
   * changed since then (new policy version, another claim decided), the
   * decision is rejected with 'conflict' instead of being made on stale data.
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
  annualLimit: MinorUnits;
  consumed: MinorUnits;
  remaining: MinorUnits;
}

export interface ClaimsServiceDeps {
  policies: PolicyPort;
  rules: RulesPort;
  store: ClaimsStore;
  clock: Clock;
  ids: IdGenerator;
}

const COVERAGE = 'vet_care';

/**
 * A clash in the store means someone else got there first, e.g. two concurrent
 * decisions on the same claim. It becomes 'conflict' (409), not an internal error.
 */
async function asConflict<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (e) {
    if (e instanceof StoreConflictError) throw new DomainError('conflict', e.message);
    throw e;
  }
}

/** The claims engine's application service. The only thing the HTTP layer talks to. */
export class ClaimsService {
  constructor(private readonly d: ClaimsServiceDeps) {}

  /** Registers a claim, assesses it and settles it automatically if the rules allow. */
  async registerClaim(claim: Claim): Promise<{ claim: Claim; assessment: Assessment; decision: ClaimDecision | null }> {
    try {
      validateClaim(claim);
    } catch (e) {
      throw new DomainError('validation', (e as Error).message);
    }
    const existing = await this.d.store.getClaim(claim.id);
    if (existing) throw new DomainError('conflict', `Claim ${claim.id} already exists`);

    await asConflict(this.d.store.saveClaim(claim, [{ type: 'claim.registered', occurredAt: this.d.clock.now(), claim }]));
    const assessment = await this.assessClaim(claim.id);
    const decision =
      assessment.mode === 'auto' ? await this.commit(claim, assessment, assessment.proposedOutcome === 'rejected' ? 'reject' : 'accept', 'auto') : null;
    return { claim, assessment, decision };
  }

  /** Assesses an existing claim without storing anything. */
  async assessClaim(claimId: string, knownAt?: Timestamp): Promise<Assessment> {
    const claim = await this.requireClaim(claimId);
    return this.assessInternal(claim, knownAt, claim.id);
  }

  /**
   * Pre-approval, e.g. at the clinic's checkout. The claim is not stored and
   * no deductible periods or amounts are reserved.
   */
  async preview(draft: Claim): Promise<Assessment> {
    try {
      validateClaim(draft);
    } catch (e) {
      throw new DomainError('validation', (e as Error).message);
    }
    return this.assessInternal(draft, undefined, undefined);
  }

  /** Claims handler decision. */
  async decide(claimId: string, cmd: DecideCommand): Promise<ClaimDecision> {
    const claim = await this.requireClaim(claimId);
    const assessment = await this.assessInternal(claim, undefined, claim.id);
    if (cmd.expectedInputHash && cmd.expectedInputHash !== assessment.inputHash) {
      throw new DomainError('conflict', 'The basis has changed since the assessment. Fetch a new assessment and try again.');
    }
    if (cmd.action === 'accept' && assessment.proposedOutcome === 'rejected') {
      throw new DomainError('validation', 'The assessment proposes rejection and cannot be accepted. Reject, or correct the basis.');
    }
    return this.commit(claim, assessment, cmd.action, cmd.decidedBy, cmd.reason);
  }

  /**
   * Reassessment, e.g. after a retroactive policy change. Creates a new decision
   * if the basis has changed; the ledger books only the difference.
   */
  async reassess(claimId: string, decidedBy: string, reason: string): Promise<ClaimDecision | null> {
    const claim = await this.requireClaim(claimId);
    const prev = await this.latestDecision(claimId);
    if (!prev) throw new DomainError('conflict', 'The claim has no decision to reassess');
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
      throw new DomainError('not_found', 'No vet care cover in force for the animal on that date');
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
      if (!policy) throw new DomainError('conflict', 'The policy could not be read when booking');
      const limitKey = `${claim.animalId}:${COVERAGE}:${policy.policyYearStart}`;
      const cur = claim.currency;
      journals.push({
        id: this.d.ids.next('jrn'),
        sourceType: 'claim_decision',
        sourceId: decision.id,
        claimId: claim.id,
        currency: cur,
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

    const events: ClaimsEvent[] = [{ type: 'claim.decided', occurredAt: now, decision }];
    await asConflict(this.d.store.commitDecision({ decision, journals, deductiblePeriod, events }));
    return decision;
  }

  private async latestDecision(claimId: string): Promise<ClaimDecision | null> {
    const all = await this.d.store.getDecisions(claimId);
    return all.length ? all.reduce((a, b) => (b.seq > a.seq ? b : a)) : null;
  }

  private async requireClaim(claimId: string): Promise<Claim> {
    const claim = await this.d.store.getClaim(claimId);
    if (!claim) throw new DomainError('not_found', `Claim ${claimId} does not exist`);
    return claim;
  }
}
