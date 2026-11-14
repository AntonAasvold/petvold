/**
 * Shared test suite for ClaimsStore (layer 4, ADR 0012).
 *
 * Every implementation (memory, Postgres …) runs the same suite with its own factory:
 *
 *   claimsStoreSuite('InMemoryClaimsStore', async () => ({ store: new InMemoryClaimsStore() }));
 *
 * The suite is the `ClaimsStore` port expressed as tests. What it states holds
 * for every implementation, and a new implementation is done when it passes.
 * Timestamps are given in canonical form (`Date#toISOString`) and must come back unchanged.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { StoreConflictError, type ClaimsEvent, type ClaimsOutbox, type ClaimsStore, type DecisionCommit } from '../src/ports.ts';
import type { Assessment, Claim, ClaimDecision, ClaimsRules, CurrencyCode, DecisionEvidence, DeductiblePeriod, LedgerJournal, PolicySnapshot, ReviewRequest, DecisionProposal } from '../src/types.ts';
import { accounts, type LimitKey } from '../src/ledger.ts';

/** A store that also exposes its outbox, as every implementation must. */
export type StoreWithOutbox = ClaimsStore & ClaimsOutbox;

export interface StoreHarness {
  store: StoreWithOutbox;
  /** Runs after each test, e.g. to close a connection. */
  cleanup?: () => Promise<void>;
}

/** Creates a new, empty store for each test. */
export type StoreFactory = () => Promise<StoreHarness>;

// ---------------------------------------------------------------------------
// Made-up test data
// ---------------------------------------------------------------------------

const YEAR = '2026-04-01';

function claim(id: string, overrides: Partial<Claim> = {}): Claim {
  return {
    id,
    claimNo: `S-${id}`,
    policyId: 'pol_suite',
    animalId: 'ani_suite',
    market: 'SE',
    currency: 'SEK',
    channel: 'customer',
    treatmentFrom: '2026-10-01',
    treatmentTo: '2026-10-02',
    diagnosisCode: 'ORA-OTIT',
    lines: [
      { id: 'l1', description: 'Examination', category: 'examination', amount: 65_000, vat: 13_000 },
      { id: 'l2', description: 'Medication', category: 'medication', amount: 35_000, diagnosisCode: 'ORA-OTIT' },
    ],
    receivedAt: '2026-10-02T09:15:00.000Z',
    ...overrides,
  };
}

function assessment(claimId: string): Assessment {
  return {
    claimId,
    market: 'SE',
    currency: 'SEK',
    policyVersionId: 'pv_suite',
    productVersion: 'SE-HUND-SUITE@1',
    rulesVersion: 'SE-HUND-SUITE.1',
    rules: [{ code: 'POLICY_ACTIVE', status: 'pass', reason: 'policy.active', params: { policyId: 'pol_suite' } }],
    calculation: null,
    proposedOutcome: 'approved',
    mode: 'auto',
    diagnosisGroup: 'ora',
    inputHash: `hash-${claimId}`,
  };
}

function decision(claimId: string, seq: number, payout: number, overrides: Partial<ClaimDecision> = {}): ClaimDecision {
  return {
    id: `dec_${claimId}_${seq}`,
    claimId,
    seq,
    outcome: 'approved',
    payout,
    assessment: assessment(claimId),
    decidedBy: 'auto',
    decidedAt: `2026-10-0${2 + seq}T10:00:00.000Z`,
    deviatesFromProposal: false,
    automated: (overrides.decidedBy ?? 'auto') === 'auto',
    ...overrides,
  };
}

const RULES: ClaimsRules = {
  rulesVersion: 'SE-HUND-SUITE.1',
  market: 'SE',
  vatReimbursable: true,
  nonReimbursableCategories: ['food'],
  diagnosisGroups: { 'ORA-OTIT': 'ora' },
  autoSettleMax: 1_000_000,
};

const POLICY: PolicySnapshot = {
  policyId: 'pol_suite',
  policyVersionId: 'pv_suite',
  market: 'SE',
  currency: 'SEK',
  animalId: 'ani_suite',
  animalBirthDate: '2019-03-14',
  productVersion: 'SE-HUND-SUITE@1',
  status: 'active',
  validFrom: YEAR,
  inceptionDate: '2024-04-01',
  policyYearStart: YEAR,
  policyYearEnd: '2027-04-01',
  vetCare: {
    code: 'vet_care',
    annualLimit: 6_000_000,
    deductible: { fixed: 200_000, fixedPer: 'period', periodDays: 125, variableBp: 2500, variableBpByAge: [{ fromAgeYears: 8, bp: 3500 }] },
    waitingPeriodDays: 30,
  },
  riders: [{ id: 'rid_1', description: 'Lameness, right hind leg', diagnosisCodes: ['ORT-HALTA-HB-H'], validFrom: '2025-09-12' }],
};

/** Evidence as the service stores it: the full input, model and engine version. */
function evidenceFor(d: ClaimDecision, overrides: Partial<DecisionEvidence> = {}): DecisionEvidence {
  return {
    decisionId: d.id,
    input: {
      claim: claim(d.claimId),
      policy: POLICY,
      rules: RULES,
      openDeductiblePeriod: period(`dp_open_${d.id}`, 'clm_earlier', '2026-09-01', '2027-01-04'),
      consumedBefore: 123_456,
    },
    calculationModel: 'vet-care.v1',
    engineVersion: '0.1.0+suite',
    ...overrides,
  };
}

function limit(animalId = 'ani_suite', policyYearStart = YEAR, currency: CurrencyCode = 'SEK'): LimitKey {
  return { animalId, coverage: 'vet_care', policyYearStart, currency };
}

/** Journal consuming `amount` of the limit, as the service books it. */
function consumption(d: ClaimDecision, amount: number, key: LimitKey = limit()): LedgerJournal {
  const cur = key.currency;
  return {
    id: `jrn_${d.id}`,
    sourceType: 'claim_decision',
    sourceId: d.id,
    claimId: d.claimId,
    currency: cur,
    bookedAt: d.decidedAt,
    lines: [
      { account: accounts.limitConsumed(key), amount },
      { account: accounts.limitAvailable(key), amount: -amount },
      { account: accounts.claimExpense(cur, d.claimId), amount },
      { account: accounts.claimPayable(cur, d.claimId), amount: -amount },
    ],
  };
}

function period(id: string, openedByClaimId: string, validFrom: string, validTo: string, overrides: Partial<DeductiblePeriod> = {}): DeductiblePeriod {
  return { id, animalId: 'ani_suite', diagnosisGroup: 'ora', validFrom, validTo, openedByClaimId, ...overrides };
}

function registered(c: Claim): ClaimsEvent[] {
  return [{ type: 'claim.registered', occurredAt: c.receivedAt, claim: c }];
}

function reviewRequest(d: ClaimDecision, overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    id: `rvw_${d.id}`,
    claimId: d.claimId,
    decisionId: d.id,
    decisionSeq: d.seq,
    requestedBy: 'customer-portal',
    statement: 'The vet says this is a new illness.',
    requestedAt: '2026-10-05T08:00:00.000Z',
    ...overrides,
  };
}

function proposal(claimId: string, overrides: Partial<DecisionProposal> = {}): DecisionProposal {
  return {
    id: `prp_${claimId}`,
    claimId,
    action: 'accept',
    outcome: 'partial',
    payout: 1_216_500,
    currency: 'SEK',
    inputHash: `hash-${claimId}`,
    proposedBy: 'handlaggare@example.test',
    proposedAt: '2026-10-03T08:00:00.000Z',
    deviatesFromProposal: false,
    proposerLimit: 1_000_000,
    status: 'open',
    ...overrides,
  };
}

function proposed(p: DecisionProposal): ClaimsEvent[] {
  return [{ type: 'claim.decision_proposed', occurredAt: p.proposedAt, proposal: p }];
}

function reviewRequested(request: ReviewRequest): ClaimsEvent[] {
  return [{ type: 'claim.review_requested', occurredAt: request.requestedAt, request }];
}

/** The reserve journal the service books when a claim goes to a handler. A negative amount releases it. */
function reserve(claimId: string, amount: number): LedgerJournal {
  return {
    id: `jrn_reserve_${claimId}`,
    sourceType: 'claim_reserve',
    sourceId: claimId,
    claimId,
    currency: 'SEK',
    bookedAt: '2026-10-02T09:15:00.000Z',
    lines: [
      { account: accounts.reserveExpense('SEK', claimId), amount },
      { account: accounts.claimReserve('SEK', claimId), amount: -amount },
    ],
  };
}

function decided(d: ClaimDecision): ClaimsEvent[] {
  return [{ type: 'claim.decided', occurredAt: d.decidedAt, decision: d }];
}

/** Stores a claim the way the service does: with its registered event. */
const save = (store: ClaimsStore, c: Claim): Promise<void> => store.saveClaim(c, registered(c));

function commit(d: ClaimDecision, journals: LedgerJournal[] = [], deductiblePeriod: DeductiblePeriod | null = null): DecisionCommit {
  return { decision: d, journals, deductiblePeriod, evidence: evidenceFor(d), events: decided(d) };
}

const pendingTypes = async (store: ClaimsOutbox) => (await store.pendingEvents(100)).map((e) => e.event.type);

const isConflict = (reason: StoreConflictError['reason']) => (e: unknown) =>
  e instanceof StoreConflictError && e.reason === reason;

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

export function claimsStoreSuite(name: string, factory: StoreFactory): void {
  describe(`ClaimsStore: ${name}`, () => {
    /** Runs a test against a new, empty store. */
    const it = (title: string, fn: (store: StoreWithOutbox) => Promise<void>) =>
      test(title, async () => {
        const h = await factory();
        try {
          await fn(h.store);
        } finally {
          await h.cleanup?.();
        }
      });

    // Claims -----------------------------------------------------------------

    it('a stored claim is read back unchanged', async (store) => {
      const c = claim('clm_a');
      await save(store, c);
      assert.deepEqual(await store.getClaim('clm_a'), c);
    });

    it('the submitting clinic is read back, and a claim without one has none', async (store) => {
      const fromClinic = claim('clm_a', { channel: 'clinic_direct', clinicId: 'clinic_001' });
      await save(store, fromClinic);
      await save(store, claim('clm_b', { claimNo: 'S-b' }));
      assert.deepEqual(await store.getClaim('clm_a'), fromClinic);
      assert.equal(Object.hasOwn((await store.getClaim('clm_b'))!, 'clinicId'), false);
    });

    it('a claim can be stored with its reserve journal; balances are read per account', async (store) => {
      const c = claim('clm_a');
      await store.saveClaim(c, registered(c), [reserve('clm_a', 500_000)]);
      assert.equal(await store.getBalance(accounts.claimReserve('SEK', 'clm_a')), -500_000);
      assert.equal(await store.getBalance(accounts.reserveExpense('SEK', 'clm_a')), 500_000);
      assert.equal(await store.getBalance('claim_reserve:SEK:clm_none'), 0);
    });

    it('a claim with an unbalanced reserve is not stored at all', async (store) => {
      const c = claim('clm_a');
      const bad = reserve('clm_a', 500_000);
      bad.lines[1]!.amount = -400_000;
      await assert.rejects(store.saveClaim(c, registered(c), [bad]));
      assert.equal(await store.getClaim('clm_a'), null);
      assert.equal(await store.getBalance(accounts.reserveExpense('SEK', 'clm_a')), 0);
      assert.deepEqual(await pendingTypes(store), []);
    });

    it('a decision can release the reserve in the same commit', async (store) => {
      const c = claim('clm_a');
      await store.saveClaim(c, registered(c), [reserve('clm_a', 500_000)]);
      const d = decision('clm_a', 1, 500_000, { decidedBy: 'handlaggare@example.test' });
      const release: LedgerJournal = {
        ...reserve('clm_a', -500_000),
        id: `jrn_release_${d.id}`,
        sourceId: d.id,
        bookedAt: d.decidedAt,
      };
      await store.commitDecision(commit(d, [consumption(d, 500_000), release]));
      assert.equal(await store.getBalance(accounts.claimReserve('SEK', 'clm_a')), 0);
    });

    it('an unknown claim gives null', async (store) => {
      assert.equal(await store.getClaim('clm_finns_inte'), null);
    });

    it('a claim with the same id cannot be stored twice', async (store) => {
      await save(store, claim('clm_a'));
      await assert.rejects(save(store, claim('clm_a', { diagnosisCode: 'GI-ENTERIT' })), isConflict('claim_exists'));
      assert.equal((await store.getClaim('clm_a'))?.diagnosisCode, 'ORA-OTIT');
    });

    it('changes to a read object do not affect the store', async (store) => {
      await save(store, claim('clm_a'));
      const read = (await store.getClaim('clm_a'))!;
      read.lines[0]!.amount = 1;
      assert.equal((await store.getClaim('clm_a'))?.lines[0]?.amount, 65_000);
    });

    // Decisions ---------------------------------------------------------------

    it('a claim without decisions has an empty list', async (store) => {
      await save(store, claim('clm_a'));
      assert.deepEqual(await store.getDecisions('clm_a'), []);
    });

    it('decisions are read back unchanged and in order', async (store) => {
      await save(store, claim('clm_a'));
      const first = decision('clm_a', 1, 50_000);
      const second = decision('clm_a', 2, 30_000, { decidedBy: 'handlaggare@example.test', reason: 'Reassessment' });
      await store.commitDecision(commit(first, [consumption(first, 50_000)]));
      await store.commitDecision(commit(second, [consumption(second, -20_000)]));
      assert.deepEqual(await store.getDecisions('clm_a'), [first, second]);
    });

    it('the same sequence number cannot be decided twice', async (store) => {
      await save(store, claim('clm_a'));
      const d = decision('clm_a', 1, 50_000);
      await store.commitDecision(commit(d, [consumption(d, 50_000)]));
      const again = decision('clm_a', 1, 70_000, { id: 'dec_annat' });
      await assert.rejects(store.commitDecision(commit(again, [consumption(again, 70_000)])), isConflict('decision_exists'));
      assert.deepEqual(await store.getDecisions('clm_a'), [d]);
      assert.equal(await store.getConsumed(limit()), 50_000);
    });

    it('a deviating decision keeps its reason code and reason', async (store) => {
      await save(store, claim('clm_a'));
      const d = decision('clm_a', 1, 0, {
        outcome: 'rejected',
        decidedBy: 'handlaggare@example.test',
        deviatesFromProposal: true,
        reasonCode: 'pre_existing_condition',
        reason: 'Symptoms noted before the policy started',
      });
      await store.commitDecision(commit(d));
      assert.deepEqual(await store.getDecisions('clm_a'), [d]);
    });

    // Evidence (ADR 0018) -------------------------------------------------------

    it('the evidence is stored with the decision and read back unchanged', async (store) => {
      await save(store, claim('clm_a'));
      const d = decision('clm_a', 1, 50_000);
      await store.commitDecision(commit(d, [consumption(d, 50_000)]));
      assert.deepEqual(await store.getEvidence(d.id), evidenceFor(d));
    });

    it('unknown decisions have no evidence', async (store) => {
      assert.equal(await store.getEvidence('dec_finns_inte'), null);
    });

    it('evidence for another decision is rejected and nothing is stored', async (store) => {
      await save(store, claim('clm_a'));
      const d = decision('clm_a', 1, 50_000);
      const wrong = { ...commit(d, [consumption(d, 50_000)]), evidence: evidenceFor(decision('clm_a', 2, 0)) };
      await assert.rejects(store.commitDecision(wrong));
      assert.deepEqual(await store.getDecisions('clm_a'), []);
      assert.equal(await store.getEvidence(d.id), null);
      assert.equal(await store.getConsumed(limit()), 0);
    });

    it('a decision requires a stored claim', async (store) => {
      await assert.rejects(store.commitDecision(commit(decision('clm_saknas', 1, 0))));
    });

    // Ledger ------------------------------------------------------------------

    it('an unbalanced journal is rejected and nothing is stored', async (store) => {
      await save(store, claim('clm_a'));
      const d = decision('clm_a', 1, 50_000);
      const bad = consumption(d, 50_000);
      bad.lines[1]!.amount = -49_999;
      await assert.rejects(store.commitDecision(commit(d, [bad], period('dp_a', 'clm_a', '2026-10-01', '2027-02-03'))));
      assert.deepEqual(await store.getDecisions('clm_a'), []);
      assert.equal(await store.getEvidence(d.id), null);
      assert.equal(await store.getConsumed(limit()), 0);
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-11-01'), null);
    });

    it('the consumed limit is the sum of the claims\' journals for animal and policy year', async (store) => {
      for (const id of ['clm_a', 'clm_b', 'clm_annat_djur', 'clm_annat_ar']) await save(store, claim(id));
      const a1 = decision('clm_a', 1, 50_000);
      const a2 = decision('clm_a', 2, 30_000);
      const b = decision('clm_b', 1, 10_000);
      const other = decision('clm_annat_djur', 1, 99_000);
      const otherYear = decision('clm_annat_ar', 1, 88_000);
      await store.commitDecision(commit(a1, [consumption(a1, 50_000)]));
      await store.commitDecision(commit(a2, [consumption(a2, -20_000)])); // reassessment books the difference
      await store.commitDecision(commit(b, [consumption(b, 10_000)]));
      await store.commitDecision(commit(other, [consumption(other, 99_000, limit('ani_annat'))]));
      await store.commitDecision(commit(otherYear, [consumption(otherYear, 88_000, limit('ani_suite', '2025-04-01'))]));

      assert.equal(await store.getConsumed(limit()), 40_000);
      assert.equal(await store.getConsumed(limit(), 'clm_a'), 10_000);
      assert.equal(await store.getConsumed(limit('ani_suite', '2025-04-01')), 88_000);
      assert.equal(await store.getConsumed(limit('ani_okant')), 0);
    });

    it('the consumed limit counts only amounts in the limit\'s currency', async (store) => {
      await save(store, claim('clm_sek'));
      await save(store, claim('clm_eur', { market: 'DE', currency: 'EUR' }));
      const sek = decision('clm_sek', 1, 50_000);
      const eur = decision('clm_eur', 1, 7_000);
      await store.commitDecision(commit(sek, [consumption(sek, 50_000)]));
      await store.commitDecision(commit(eur, [consumption(eur, 7_000, limit('ani_suite', YEAR, 'EUR'))]));

      assert.equal(await store.getConsumed(limit()), 50_000);
      assert.equal(await store.getConsumed(limit('ani_suite', YEAR, 'EUR')), 7_000);
    });

    // Deductible periods ----------------------------------------------------

    it('a deductible period applies from its first day to the day before its end date', async (store) => {
      await save(store, claim('clm_a'));
      const p = period('dp_a', 'clm_a', '2026-10-01', '2027-02-03');
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], p));
      assert.deepEqual(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-10-01'), p);
      assert.deepEqual(await store.findDeductiblePeriod('ani_suite', 'ora', '2027-02-02'), p);
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2027-02-03'), null);
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-09-30'), null);
    });

    it('deductible periods apply only to the same animal and diagnosis group', async (store) => {
      await save(store, claim('clm_a'));
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], period('dp_a', 'clm_a', '2026-10-01', '2027-02-03')));
      assert.equal(await store.findDeductiblePeriod('ani_annat', 'ora', '2026-11-01'), null);
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'mag-tarm', '2026-11-01'), null);
    });

    it('periods opened by the claim itself can be excluded', async (store) => {
      await save(store, claim('clm_a'));
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], period('dp_a', 'clm_a', '2026-10-01', '2027-02-03')));
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-11-01', 'clm_a'), null);
      assert.notEqual(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-11-01', 'clm_annat'), null);
    });

    it('a new decision replaces the period the claim opened, and null removes it', async (store) => {
      await save(store, claim('clm_a'));
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], period('dp_1', 'clm_a', '2026-10-01', '2027-02-03')));
      const moved = period('dp_2', 'clm_a', '2026-10-05', '2027-02-07');
      await store.commitDecision(commit(decision('clm_a', 2, 0), [], moved));
      assert.deepEqual(await store.findDeductiblePeriod('ani_suite', 'ora', '2027-02-05'), moved);
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-10-02'), null);

      await store.commitDecision(commit(decision('clm_a', 3, 0), [], null));
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-11-01'), null);
    });

    it('periods for the same animal and group must not overlap, and nothing is stored', async (store) => {
      await save(store, claim('clm_a'));
      await save(store, claim('clm_b'));
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], period('dp_a', 'clm_a', '2026-10-01', '2027-02-03')));
      const b = decision('clm_b', 1, 10_000);
      await assert.rejects(
        store.commitDecision(commit(b, [consumption(b, 10_000)], period('dp_b', 'clm_b', '2027-02-02', '2027-06-07'))),
        isConflict('period_overlaps'),
      );
      assert.deepEqual(await store.getDecisions('clm_b'), []);
      assert.equal(await store.getConsumed(limit()), 0);
    });

    it('a period may start on the day another ends', async (store) => {
      await save(store, claim('clm_a'));
      await save(store, claim('clm_b'));
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], period('dp_a', 'clm_a', '2026-10-01', '2027-02-03')));
      const next = period('dp_b', 'clm_b', '2027-02-03', '2027-06-08');
      await store.commitDecision(commit(decision('clm_b', 1, 0), [], next));
      assert.deepEqual(await store.findDeductiblePeriod('ani_suite', 'ora', '2027-02-03'), next);
    });
    // Review requests (ADR 0018) ------------------------------------------------

    it('the automated flag and the answered review are read back with the decision', async (store) => {
      await save(store, claim('clm_a'));
      const auto = decision('clm_a', 1, 50_000);
      await store.commitDecision(commit(auto, [consumption(auto, 50_000)]));
      const req = reviewRequest(auto);
      await store.saveReviewRequest(req, reviewRequested(req));
      const human = decision('clm_a', 2, 50_000, { decidedBy: 'handlaggare@example.test', reviewRequestId: req.id });
      await store.commitDecision({ ...commit(human), closesReviewRequestId: req.id });
      assert.deepEqual(await store.getDecisions('clm_a'), [auto, human]);
      assert.equal(auto.automated, true);
      assert.equal(human.automated, false);
    });

    it('a review request is read back unchanged, and a claim without requests has an empty list', async (store) => {
      await save(store, claim('clm_a'));
      await save(store, claim('clm_b', { claimNo: 'S-b' }));
      const d = decision('clm_a', 1, 50_000);
      await store.commitDecision(commit(d, [consumption(d, 50_000)]));
      const req = reviewRequest(d);
      await store.saveReviewRequest(req, reviewRequested(req));
      assert.deepEqual(await store.getReviewRequests('clm_a'), [req]);
      assert.deepEqual(await store.getReviewRequests('clm_b'), []);
    });

    it('a claim has at most one open review request, and nothing is stored on conflict', async (store) => {
      await save(store, claim('clm_a'));
      const d = decision('clm_a', 1, 50_000);
      await store.commitDecision(commit(d, [consumption(d, 50_000)]));
      const first = reviewRequest(d);
      await store.saveReviewRequest(first, reviewRequested(first));
      const second = reviewRequest(d, { id: 'rvw_second' });
      await assert.rejects(store.saveReviewRequest(second, reviewRequested(second)), isConflict('review_open'));
      assert.deepEqual(await store.getReviewRequests('clm_a'), [first]);
      assert.deepEqual(await pendingTypes(store), ['claim.registered', 'claim.decided', 'claim.review_requested']);
    });

    it('a review request for a decision made by a person is rejected', async (store) => {
      await save(store, claim('clm_a'));
      const d = decision('clm_a', 1, 50_000, { decidedBy: 'handlaggare@example.test' });
      await store.commitDecision(commit(d, [consumption(d, 50_000)]));
      await assert.rejects(store.saveReviewRequest(reviewRequest(d), []));
      assert.deepEqual(await store.getReviewRequests('clm_a'), []);
    });

    it('the human decision closes the request in the same transaction, and a new request can then be made', async (store) => {
      await save(store, claim('clm_a'));
      const auto = decision('clm_a', 1, 50_000);
      await store.commitDecision(commit(auto, [consumption(auto, 50_000)]));
      const req = reviewRequest(auto);
      await store.saveReviewRequest(req, reviewRequested(req));
      const human = decision('clm_a', 2, 50_000, { decidedBy: 'handlaggare@example.test', reviewRequestId: req.id });
      await store.commitDecision({ ...commit(human), closesReviewRequestId: req.id });
      assert.deepEqual(await store.getReviewRequests('clm_a'), [{ ...req, closedByDecisionId: human.id, closedAt: human.decidedAt }]);

      const again = decision('clm_a', 3, 50_000, { decidedAt: '2026-10-06T10:00:00.000Z' });
      await store.commitDecision(commit(again));
      const next = reviewRequest(again, { id: 'rvw_next', requestedAt: '2026-10-07T10:00:00.000Z' });
      await store.saveReviewRequest(next, reviewRequested(next));
      assert.equal((await store.getReviewRequests('clm_a')).length, 2);
    });

    it('closing a request needs the human decision that answers it, else nothing is stored', async (store) => {
      await save(store, claim('clm_a'));
      const auto = decision('clm_a', 1, 50_000);
      await store.commitDecision(commit(auto, [consumption(auto, 50_000)]));
      const req = reviewRequest(auto);
      await store.saveReviewRequest(req, reviewRequested(req));
      const automated = decision('clm_a', 2, 50_000, { reviewRequestId: req.id });
      await assert.rejects(store.commitDecision({ ...commit(automated), closesReviewRequestId: req.id }));
      const unknown = decision('clm_a', 2, 50_000, { decidedBy: 'handlaggare@example.test', reviewRequestId: 'rvw_unknown' });
      await assert.rejects(store.commitDecision({ ...commit(unknown), closesReviewRequestId: 'rvw_unknown' }));
      assert.deepEqual(await store.getDecisions('clm_a'), [auto]);
      assert.deepEqual(await store.getReviewRequests('clm_a'), [req]);
    });

    // Decision proposals (ADR 0019) ----------------------------------------------

    it('a proposal is read back unchanged and writes its event', async (store) => {
      await save(store, claim('clm_a'));
      const p = proposal('clm_a');
      await store.saveProposal(p, proposed(p));
      assert.deepEqual(await store.getProposals('clm_a'), [p]);
      assert.deepEqual(await store.getProposals('clm_unknown'), []);
      assert.deepEqual(await pendingTypes(store), ['claim.registered', 'claim.decision_proposed']);
    });

    it('a claim has at most one open proposal, and nothing is stored on conflict', async (store) => {
      await save(store, claim('clm_a'));
      const p = proposal('clm_a');
      await store.saveProposal(p, proposed(p));
      const second = proposal('clm_a', { id: 'prp_second' });
      await assert.rejects(store.saveProposal(second, proposed(second)), isConflict('proposal_open'));
      assert.deepEqual(await store.getProposals('clm_a'), [p]);
      assert.deepEqual(await pendingTypes(store), ['claim.registered', 'claim.decision_proposed']);
    });

    it('the approving decision closes the proposal in the same transaction', async (store) => {
      await save(store, claim('clm_a'));
      const p = proposal('clm_a');
      await store.saveProposal(p, proposed(p));
      const d = decision('clm_a', 1, 1_216_500, { decidedBy: p.proposedBy, approvedBy: 'approver@example.test', proposalId: p.id });
      await store.commitDecision({ ...commit(d, [consumption(d, 1_216_500)]), closesProposalId: p.id });
      assert.deepEqual(await store.getDecisions('clm_a'), [d]);
      assert.deepEqual(await store.getProposals('clm_a'), [
        { ...p, status: 'approved', closedBy: 'approver@example.test', closedAt: d.decidedAt, decisionId: d.id },
      ]);
    });

    it('the proposer cannot approve, and nothing is stored', async (store) => {
      await save(store, claim('clm_a'));
      const p = proposal('clm_a');
      await store.saveProposal(p, proposed(p));
      const d = decision('clm_a', 1, 1_216_500, { decidedBy: p.proposedBy, approvedBy: p.proposedBy, proposalId: p.id });
      await assert.rejects(store.commitDecision({ ...commit(d, [consumption(d, 1_216_500)]), closesProposalId: p.id }));
      assert.deepEqual(await store.getDecisions('clm_a'), []);
      assert.equal(await store.getConsumed(limit()), 0);
      assert.equal((await store.getProposals('clm_a'))[0]!.status, 'open');
    });

    it('a returned proposal cannot be approved or returned again, and a new one can be made', async (store) => {
      await save(store, claim('clm_a'));
      const p = proposal('clm_a');
      await store.saveProposal(p, proposed(p));
      await store.returnProposal(p.id, 'approver@example.test', '2026-10-04T08:00:00.000Z', 'Check the invoice', []);
      assert.deepEqual(await store.getProposals('clm_a'), [
        { ...p, status: 'returned', closedBy: 'approver@example.test', closedAt: '2026-10-04T08:00:00.000Z', returnReason: 'Check the invoice' },
      ]);
      await assert.rejects(store.returnProposal(p.id, 'approver@example.test', '2026-10-04T09:00:00.000Z', 'Again', []), isConflict('proposal_closed'));
      const d = decision('clm_a', 1, 1_216_500, { decidedBy: p.proposedBy, approvedBy: 'approver@example.test', proposalId: p.id });
      await assert.rejects(store.commitDecision({ ...commit(d, [consumption(d, 1_216_500)]), closesProposalId: p.id }), isConflict('proposal_closed'));
      assert.deepEqual(await store.getDecisions('clm_a'), []);
      const next = proposal('clm_a', { id: 'prp_next', proposedAt: '2026-10-05T08:00:00.000Z' });
      await store.saveProposal(next, proposed(next));
      assert.equal((await store.getProposals('clm_a')).length, 2);
    });

    // Outbox ------------------------------------------------------------------

    it('a stored claim writes its event to the outbox', async (store) => {
      const c = claim('clm_a');
      await save(store, c);
      const pending = await store.pendingEvents(10);
      assert.equal(pending.length, 1);
      assert.deepEqual(pending[0]!.event, registered(c)[0]);
    });

    it('a decision writes its event in the same transaction', async (store) => {
      await save(store, claim('clm_a'));
      const d = decision('clm_a', 1, 50_000);
      await store.commitDecision(commit(d, [consumption(d, 50_000)]));
      const pending = await store.pendingEvents(10);
      assert.deepEqual(pending.map((e) => e.event.type), ['claim.registered', 'claim.decided']);
      assert.deepEqual(pending[1]!.event, decided(d)[0]);
    });

    it('a rejected claim or decision writes no event', async (store) => {
      await save(store, claim('clm_a'));
      await assert.rejects(save(store, claim('clm_a')));
      const d = decision('clm_a', 1, 50_000);
      const bad = consumption(d, 50_000);
      bad.lines[0]!.amount = 1;
      await assert.rejects(store.commitDecision(commit(d, [bad])));
      await save(store, claim('clm_b'));
      await store.commitDecision(commit(decision('clm_b', 1, 0), [], period('dp_b', 'clm_b', '2026-10-01', '2027-02-03')));
      const clash = decision('clm_a', 1, 0);
      await assert.rejects(store.commitDecision(commit(clash, [], period('dp_a', 'clm_a', '2026-11-01', '2027-03-01'))));
      assert.deepEqual(await pendingTypes(store), ['claim.registered', 'claim.registered', 'claim.decided']);
    });

    it('pending events come oldest first and respect the limit', async (store) => {
      for (const id of ['clm_1', 'clm_2', 'clm_3']) await save(store, claim(id));
      const two = await store.pendingEvents(2);
      assert.deepEqual(
        two.map((e) => (e.event.type === 'claim.registered' ? e.event.claim.id : '')),
        ['clm_1', 'clm_2'],
      );
    });

    it('published events are no longer pending', async (store) => {
      for (const id of ['clm_1', 'clm_2']) await save(store, claim(id));
      const [first] = await store.pendingEvents(1);
      await store.markPublished([first!.id], '2026-10-03T08:00:00.000Z');
      await store.markPublished([first!.id, 'unknown'], '2026-10-03T08:01:00.000Z');
      const rest = await store.pendingEvents(10);
      assert.equal(rest.length, 1);
      assert.notEqual(rest[0]!.id, first!.id);
    });
  });
}
