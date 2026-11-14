import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALCULATION_MODEL, ClaimsService, DomainError, StoreConflictError, accounts, assess, sha256 } from '@petvold/claims-core';
import {
  FixedClock,
  InMemoryClaimsStore,
  InMemoryPolicyPort,
  SequentialIds,
  StaticRulesPort,
  fixtures,
} from '@petvold/claims-store-memory';

/** A handler decision that must be made at once, not proposed. */
async function decideNow(s: ClaimsService, claimId: string, cmd: Parameters<ClaimsService['decide']>[1]) {
  const r = await s.decide(claimId, cmd);
  assert.ok(r.decision, `expected a decision, got a proposal: ${JSON.stringify(r.proposal)}`);
  return r.decision;
}


const { bellaPolicy, cruciateClaim, otitisClaim, RULES_SE_DOG, PRODUCT, eurPolicy, eurClaim, RULES_EUR_EXAMPLE, PRODUCT_EUR } = fixtures;

function setup() {
  const store = new InMemoryClaimsStore();
  const policies = new InMemoryPolicyPort([
    { snapshot: bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' },
    { snapshot: eurPolicy(), sysFrom: '2025-12-01T00:00:00Z' },
  ]);
  const clock = new FixedClock('2026-11-13T14:00:00Z');
  const service = new ClaimsService({
    policies,
    rules: new StaticRulesPort({ [PRODUCT]: RULES_SE_DOG, [PRODUCT_EUR]: RULES_EUR_EXAMPLE }, RULES_SE_DOG),
    store,
    clock,
    ids: new SequentialIds(),
    engineVersion: '0.1.0+test',
  });
  return { service, store, policies, clock };
}

function assertBalanced(store: InMemoryClaimsStore) {
  for (const j of store.dump().journals) {
    assert.equal(j.lines.reduce((s, l) => s + l.amount, 0), 0, `journal ${j.id} does not balance`);
  }
}

test('a small claim is settled automatically, booked and opens a deductible period', async () => {
  const { service, store } = setup();
  const r = await service.registerClaim(otitisClaim());
  assert.equal(r.assessment.mode, 'auto');
  assert.ok(r.decision);
  assert.equal(r.decision.payout, 150_000);
  assert.equal(r.decision.decidedBy, 'auto');
  assertBalanced(store);
  assert.equal(store.dump().periods.length, 1);
  assert.deepEqual((await store.pendingEvents(10)).map((e) => e.event.type), ['claim.registered', 'claim.decided', 'claim.payout_ordered']);

  const limits = await service.getLimits('pol_bella', 'ani_bella', '2026-11-13');
  assert.equal(limits.consumed, 150_000);
  assert.equal(limits.remaining, 6_000_000 - 150_000);
  assert.equal(limits.currency, 'SEK');
});

test('a second claim in the same diagnosis group within the period has no fixed deductible', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  const second = await service.registerClaim(
    otitisClaim({ id: 'clm_2', claimNo: 'S-2', treatmentFrom: '2026-07-01', treatmentTo: '2026-07-01' }),
  );
  assert.equal(second.assessment.calculation!.deductibleFixed, 0);
  assert.equal(second.assessment.calculation!.payout, 300_000); // SEK 4,000 − 25 %
});

test('the design example goes to a handler and is decided with expectedInputHash', async () => {
  const { service, store } = setup();
  const r = await service.registerClaim(cruciateClaim());
  assert.equal(r.decision, null);
  assert.equal(r.assessment.mode, 'manual');

  const d = await decideNow(service, 'clm_048213', {
    action: 'accept',
    decidedBy: 'handlaggare@example.test',
    reason: 'Left cruciate ligament, no link to the rider',
    expectedInputHash: r.assessment.inputHash,
  });
  assert.equal(d.outcome, 'partial');
  assert.equal(d.payout, 1_216_500); // SEK 12,165, as in the design
  assertBalanced(store);
});

test('a decision on a stale basis is rejected', async () => {
  const { service } = setup();
  const r = await service.registerClaim(cruciateClaim());
  await service.registerClaim(otitisClaim()); // changes the consumed limit
  await assert.rejects(
    service.decide('clm_048213', { action: 'accept', decidedBy: 'h', expectedInputHash: r.assessment.inputHash }),
    (e: unknown) => e instanceof DomainError && e.code === 'conflict',
  );
});

test('retroactive policy change: reassessment books only the difference, and knownAt shows the old picture', async () => {
  const { service, store, policies, clock } = setup();
  await service.registerClaim(otitisClaim()); // SEK 1,500
  assert.equal((await service.getLimits('pol_bella', 'ani_bella', '2026-06-04')).consumed, 150_000);

  // On 20 June a change is recorded that applies from 1 April: a lower variable deductible.
  policies.supersede('pv_bella_v4', '2026-06-20T10:00:00Z');
  policies.add({
    snapshot: bellaPolicy({
      policyVersionId: 'pv_bella_v5',
      vetCare: { ...bellaPolicy().vetCare!, deductible: { fixed: 200_000, fixedPer: 'period', periodDays: 125, variableBp: 1500 } },
    }),
    sysFrom: '2026-06-20T10:00:00Z',
  });
  clock.set('2026-06-21T09:00:00Z');

  const before = await service.assessClaim('clm_021877', '2026-06-10T00:00:00Z');
  assert.equal(before.policyVersionId, 'pv_bella_v4');

  const d = await service.reassess('clm_021877', 'system', 'Retroactive change of deductible');
  assert.ok(d);
  assert.equal(d.seq, 2);
  assert.equal(d.payout, 170_000); // SEK 2,000 − 15 %
  assert.equal(d.assessment.policyVersionId, 'pv_bella_v5');

  const journals = store.dump().journals;
  assert.equal(journals.length, 2);
  assert.equal(journals[1]!.lines[0]!.amount, 20_000); // only the difference
  assertBalanced(store);
  assert.equal((await service.getLimits('pol_bella', 'ani_bella', '2026-06-04')).consumed, 170_000);

  // No change in the basis => no new decision
  assert.equal(await service.reassess('clm_021877', 'system', 'igen'), null);
});

test('rejection on reassessment reverses the full amount and closes the deductible period', async () => {
  const { service, store, policies } = setup();
  await service.registerClaim(otitisClaim());
  policies.supersede('pv_bella_v4', '2026-06-20T10:00:00Z');
  policies.add({
    snapshot: bellaPolicy({
      policyVersionId: 'pv_bella_v5',
      riders: [{ id: 'r2', description: 'Ears', diagnosisCodes: ['ORA-OTIT'], validFrom: '2026-01-01' }],
    }),
    sysFrom: '2026-06-20T10:00:00Z',
  });
  const d = await service.reassess('clm_021877', 'system', 'Rider recorded retroactively');
  assert.equal(d!.outcome, 'rejected');
  assert.equal(d!.payout, 0);
  assert.equal((await service.getLimits('pol_bella', 'ani_bella', '2026-06-04')).consumed, 0);
  assert.equal(store.dump().periods.length, 0);
  assertBalanced(store);
});

test('a proposed rejection cannot be accepted', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim({ id: 'c_x', claimNo: 'X', diagnosisCode: 'ORT-HALTA-HB-H' }));
  await assert.rejects(service.decide('c_x', { action: 'accept', decidedBy: 'h' }), (e: unknown) => e instanceof DomainError && e.code === 'validation');
  const d = await decideNow(service, 'c_x', { action: 'reject', decidedBy: 'h', reason: 'Rider' });
  assert.equal(d.outcome, 'rejected');
  assert.equal(d.payout, 0);
});

test('the same claim cannot be registered twice', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  await assert.rejects(service.registerClaim(otitisClaim()), (e: unknown) => e instanceof DomainError && e.code === 'conflict');
});

test('a pre-approval stores and reserves nothing', async () => {
  const { service, store } = setup();
  const a = await service.preview(otitisClaim());
  assert.equal(a.calculation!.payout, 150_000);
  assert.equal(store.dump().decisions.length, 0);
  assert.equal(store.dump().periods.length, 0);
});

test('EUR market through the whole flow: booked in EUR', async () => {
  const { service, store } = setup();
  const r = await service.registerClaim(eurClaim());
  assert.equal(r.decision!.payout, 17_500);
  const accountsBooked = store.dump().journals[0]!.lines.map((l) => l.account.split(':').slice(0, 2).join(':'));
  assert.deepEqual(accountsBooked, ['limit_consumed:EUR', 'limit_available:EUR', 'claim_expense:EUR', 'claim_payable:EUR']);
  // Deductible per claim: no period is stored
  assert.equal(store.dump().periods.length, 0);
  const second = await service.registerClaim(eurClaim({ id: 'clm_rex_2', claimNo: 'X-2' }));
  assert.equal(second.assessment.calculation!.deductibleFixed, 5_000);
});

test('a rejected decision leaves no event in the outbox', async () => {
  const { service, store } = setup();
  store.commitDecision = async () => {
    throw new StoreConflictError('decision_exists', 'Decision clm_021877#1 already exists');
  };
  await assert.rejects(service.registerClaim(otitisClaim()));
  assert.deepEqual((await store.pendingEvents(10)).map((e) => e.event.type), ['claim.registered']);
});

test('a clash in the store becomes conflict, not an internal error', async () => {
  // Simulates another decision getting in between assessment and storing.
  const { service, store } = setup();
  store.commitDecision = async () => {
    throw new StoreConflictError('decision_exists', 'Decision clm_021877#1 already exists');
  };
  await assert.rejects(service.registerClaim(otitisClaim()), (e: unknown) => e instanceof DomainError && e.code === 'conflict');
});

// Evidence and deviations (ADR 0018) --------------------------------------------

test('every decision stores its evidence, and the evidence reproduces the assessment exactly', async () => {
  const { service, store } = setup();
  const { decision } = await service.registerClaim(otitisClaim());
  const evidence = await service.getEvidence('clm_021877', 1);
  assert.equal(evidence.decisionId, decision!.id);
  assert.equal(evidence.calculationModel, CALCULATION_MODEL);
  assert.equal(evidence.engineVersion, '0.1.0+test');
  assert.equal(sha256(evidence.input), decision!.assessment.inputHash);
  assert.deepEqual(assess(evidence.input), decision!.assessment);
  assert.deepEqual(await store.getEvidence(decision!.id), evidence);
});

test('an unknown decision has no evidence', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim());
  await assert.rejects(service.getEvidence('clm_048213', 1), (e: unknown) => e instanceof DomainError && e.code === 'not_found');
});

test('rejecting against the proposal requires the right to override', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim());
  await assert.rejects(
    service.decide('clm_048213', { action: 'reject', decidedBy: 'h', reasonCode: 'pre_existing_condition', reason: 'Seen before' }),
    (e: unknown) => e instanceof DomainError && e.code === 'forbidden',
  );
});

test('rejecting against the proposal requires a reason code and a reason', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim());
  for (const cmd of [{ reason: 'Seen before' }, { reasonCode: 'other' as const }, { reasonCode: 'other' as const, reason: '  ' }]) {
    await assert.rejects(
      service.decide('clm_048213', { action: 'reject', decidedBy: 'h', mayOverride: true, ...cmd }),
      (e: unknown) => e instanceof DomainError && e.code === 'validation',
    );
  }
});

test('a deviation is recorded with its reason code, and following the proposal is not', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim());
  const d = await decideNow(service, 'clm_048213', {
    action: 'reject',
    decidedBy: 'h',
    mayOverride: true,
    reasonCode: 'pre_existing_condition',
    reason: 'Lameness in the same leg before the policy started',
  });
  assert.equal(d.outcome, 'rejected');
  assert.equal(d.deviatesFromProposal, true);
  assert.equal(d.reasonCode, 'pre_existing_condition');

  const auto = (await service.registerClaim(otitisClaim())).decision!;
  assert.equal(auto.deviatesFromProposal, false);
  assert.equal(auto.reasonCode, undefined);
});

// Deductible period across the renewal ---------------------------------------------

/** Bella's policy renewed on 1 April 2027 with the same terms, plus a setting for the deductible period. */
function renewalSetup(periodEndsAtRenewal: boolean) {
  const store = new InMemoryClaimsStore();
  const terms = (v: ReturnType<typeof bellaPolicy>) => ({
    ...v.vetCare!,
    deductible: { ...v.vetCare!.deductible, periodEndsAtRenewal },
  });
  const year1 = bellaPolicy();
  const year2 = bellaPolicy({
    policyVersionId: 'pv_bella_2027',
    validFrom: '2027-04-01',
    validTo: '2028-04-01',
    policyYearStart: '2027-04-01',
    policyYearEnd: '2028-04-01',
  });
  const policies = new InMemoryPolicyPort([
    { snapshot: { ...year1, vetCare: terms(year1) }, sysFrom: '2026-03-03T00:00:00Z' },
    { snapshot: { ...year2, vetCare: terms(year2) }, sysFrom: '2027-02-15T00:00:00Z' },
  ]);
  const service = new ClaimsService({
    policies,
    rules: new StaticRulesPort({ [PRODUCT]: RULES_SE_DOG }, RULES_SE_DOG),
    store,
    clock: new FixedClock('2027-04-20T10:00:00Z'),
    ids: new SequentialIds(),
  });
  return { service, store };
}

const beforeRenewal = () => otitisClaim({ id: 'clm_feb', claimNo: 'S-FEB', treatmentFrom: '2027-02-01', treatmentTo: '2027-02-01' });
const afterRenewal = () => otitisClaim({ id: 'clm_apr', claimNo: 'S-APR', treatmentFrom: '2027-04-15', treatmentTo: '2027-04-15' });

test('by default a deductible period continues past the renewal: one illness, one fixed deductible', async () => {
  const { service, store } = renewalSetup(false);
  await service.registerClaim(beforeRenewal());
  assert.equal(store.dump().periods[0]!.validTo, '2027-06-06'); // 125 days
  const r = await service.registerClaim(afterRenewal());
  assert.equal(r.assessment.calculation!.deductibleFixed, 0);
  assert.equal(r.decision!.payout, 300_000); // SEK 4,000 − 25 %
});

test('with periodEndsAtRenewal the period ends with the policy year, and a new fixed deductible is charged', async () => {
  const { service, store } = renewalSetup(true);
  await service.registerClaim(beforeRenewal());
  assert.equal(store.dump().periods[0]!.validTo, '2027-04-01');
  const r = await service.registerClaim(afterRenewal());
  assert.equal(r.assessment.calculation!.deductibleFixed, 200_000);
  assert.equal(r.decision!.payout, 150_000); // (SEK 4,000 − 2,000) − 25 %
});

test('periodEndsAtRenewal does not shorten a period that ends before the renewal', async () => {
  const { service, store } = renewalSetup(true);
  await service.registerClaim(otitisClaim()); // 4 June 2026 + 125 days
  assert.equal(store.dump().periods[0]!.validTo, '2026-10-07');
});

test('a stored decision can be replayed from its evidence and is identical', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  const r = await service.replayDecision('clm_021877', 1);
  assert.equal(r.status, 'identical');
  assert.equal(r.calculationModel, CALCULATION_MODEL);
  assert.equal(r.replayedWith.engineVersion, '0.1.0+test');
});

// Explanation and human review (ADR 0018, GDPR art. 22) ----------------------

test('an automatic decision is marked automated, a handler decision is not', async () => {
  const { service } = setup();
  const auto = await service.registerClaim(otitisClaim());
  assert.equal(auto.decision!.automated, true);
  await service.registerClaim(cruciateClaim());
  const manual = await decideNow(service, 'clm_048213', { action: 'accept', decidedBy: 'handlaggare@example.test' });
  assert.equal(manual.automated, false);
});

test('the explanation of an automatic decision: main reason, rules, steps that add up, and review available', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  const e = await service.explainDecision('clm_021877', 1);
  assert.equal(e.automated, true);
  assert.equal(e.mainReason.reason, e.outcome === 'partial' ? 'decision.partial' : 'decision.approved');
  assert.ok(e.rules.length > 0);
  assert.equal(e.steps[0]!.step, 'billed');
  assert.equal(e.steps.at(-1)!.step, 'payout');
  assert.equal(e.steps.at(-1)!.amount, 150_000);
  const reductions = e.steps.slice(0, -1).reduce((s, x) => s + x.amount, 0);
  assert.equal(reductions, e.payout, 'the steps add up to the payout');
  assert.deepEqual(e.humanReview, { available: true });
  assert.equal(e.basis.calculationModel, CALCULATION_MODEL);
  assert.equal(e.basis.engineVersion, '0.1.0+test');
});

test('the explanation within an open deductible period names the period instead of a fixed deductible', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  await service.registerClaim(otitisClaim({ id: 'clm_2', claimNo: 'S-2', treatmentFrom: '2026-07-01', treatmentTo: '2026-07-01' }));
  const e = await service.explainDecision('clm_2', 1);
  const step = e.steps.find((s) => s.step === 'deductible_fixed_in_period');
  assert.ok(step, JSON.stringify(e.steps));
  assert.equal(step.amount, 0);
  assert.ok(step.params.validFrom && step.params.validTo);
  assert.ok(!e.steps.some((s) => s.step === 'deductible_fixed'));
});

test('the explanation of a deviation gives the reason code as main reason and no calculation steps', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim());
  await decideNow(service, 'clm_048213', {
    action: 'reject',
    decidedBy: 'handlaggare@example.test',
    mayOverride: true,
    reasonCode: 'pre_existing_condition',
    reason: 'Lameness noted before inception',
  });
  const e = await service.explainDecision('clm_048213', 1);
  assert.equal(e.mainReason.reason, 'deviation.pre_existing_condition');
  assert.deepEqual(e.deviation, { reasonCode: 'pre_existing_condition', reason: 'Lameness noted before inception' });
  assert.deepEqual(e.steps, []);
  assert.equal(e.humanReview.available, false, 'a person already judged it');
});

test('the explanation of a rejection by rule gives the failed rule as main reason', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim({ treatmentFrom: '2026-03-10', treatmentTo: '2026-03-10' })); // before the policy
  await decideNow(service, 'clm_021877', { action: 'reject', decidedBy: 'handlaggare@example.test' });
  const e = await service.explainDecision('clm_021877', 1);
  assert.equal(e.outcome, 'rejected');
  assert.equal(e.mainReason.reason, 'policy.not_found');
  assert.equal(e.mainReason.params.date, '2026-03-10');
});

test('an unknown decision cannot be explained', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  await assert.rejects(service.explainDecision('clm_021877', 2), (e: unknown) => e instanceof DomainError && e.code === 'not_found');
});

test('human review: requested for an automated decision, answered and closed by the next handler decision', async () => {
  const { service, store, clock } = setup();
  await service.registerClaim(otitisClaim());
  clock.set('2026-11-14T08:00:00Z');
  const req = await service.requestReview('clm_021877', 1, { requestedBy: 'customer-portal', statement: '  The vet says it is a new illness.  ' });
  assert.equal(req.decisionSeq, 1);
  assert.equal(req.statement, 'The vet says it is a new illness.');
  assert.equal(req.closedAt, undefined);
  assert.equal((await store.pendingEvents(10)).at(-1)!.event.type, 'claim.review_requested');

  const e = await service.explainDecision('clm_021877', 1);
  assert.deepEqual(e.humanReview, { available: false, openRequestId: req.id });

  clock.set('2026-11-15T09:00:00Z');
  const review = await decideNow(service, 'clm_021877', { action: 'accept', decidedBy: 'handlaggare@example.test' });
  assert.equal(review.seq, 2);
  assert.equal(review.automated, false);
  assert.equal(review.reviewRequestId, req.id);
  const [closed] = await service.getReviewRequests('clm_021877');
  assert.equal(closed!.closedByDecisionId, review.id);
  assert.equal(closed!.closedAt, '2026-11-15T09:00:00Z');
  assert.equal((await service.explainDecision('clm_021877', 2)).reviewRequestId, req.id);
});

test('human review: only one open request per claim', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  await service.requestReview('clm_021877', 1, { requestedBy: 'customer-portal' });
  await assert.rejects(
    service.requestReview('clm_021877', 1, { requestedBy: 'customer-portal' }),
    (e: unknown) => e instanceof DomainError && e.code === 'conflict',
  );
});

test('human review: not for a decision made by a person, nor for a replaced decision', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  await decideNow(service, 'clm_021877', { action: 'accept', decidedBy: 'handlaggare@example.test' });
  const conflict = (e: unknown) => e instanceof DomainError && e.code === 'conflict';
  await assert.rejects(service.requestReview('clm_021877', 2, { requestedBy: 'customer-portal' }), conflict);
  await assert.rejects(service.requestReview('clm_021877', 1, { requestedBy: 'customer-portal' }), conflict);
  await assert.rejects(
    service.requestReview('clm_021877', 3, { requestedBy: 'customer-portal' }),
    (e: unknown) => e instanceof DomainError && e.code === 'not_found',
  );
});

test('human review: a reassessment is automated and does not close the request', async () => {
  const { service, policies, clock } = setup();
  await service.registerClaim(otitisClaim());
  const req = await service.requestReview('clm_021877', 1, { requestedBy: 'customer-portal' });
  clock.set('2026-11-20T00:00:00Z');
  policies.supersede('pv_bella_v4', '2026-11-20T00:00:00Z');
  policies.add({ snapshot: bellaPolicy({ policyVersionId: 'pv_bella_v5', status: 'cancelled' }), sysFrom: '2026-11-20T00:00:00Z' });
  const re = await service.reassess('clm_021877', 'reassessment-job', 'Retroactive cancellation');
  assert.ok(re);
  assert.equal(re.automated, true);
  assert.equal(re.reviewRequestId, undefined);
  assert.equal((await service.getReviewRequests('clm_021877'))[0]!.closedAt, undefined);
  const review = await decideNow(service, 'clm_021877', { action: 'reject', decidedBy: 'handlaggare@example.test' });
  assert.equal(review.reviewRequestId, req.id);
});

// Approval chain (ADR 0019) -----------------------------------------------------

const HANDLER = 'handlaggare@example.test';
const APPROVER = 'attestant@example.test';
const LOW = { SEK: 1_000_000 }; // SEK 10,000: below the cruciate payout of SEK 12,165

test('a decision above the handler\'s limit becomes a proposal: nothing is decided, booked or ordered', async () => {
  const { service, store } = setup();
  await service.registerClaim(cruciateClaim());
  const r = await service.decide('clm_048213', { action: 'accept', decidedBy: HANDLER, decisionLimits: LOW });
  assert.equal(r.decision, undefined);
  assert.ok(r.proposal);
  assert.equal(r.proposal.status, 'open');
  assert.equal(r.proposal.payout, 1_216_500);
  assert.equal(r.proposal.proposerLimit, 1_000_000);
  assert.deepEqual(await service.getDecisions('clm_048213'), []);
  assert.deepEqual(store.dump().journals.map((j) => j.sourceType), ['claim_reserve'], 'only the reserve is booked');
  assert.equal(store.dump().periods.length, 0);
  assert.deepEqual((await store.pendingEvents(10)).map((e) => e.event.type), ['claim.registered', 'claim.decision_proposed']);
});

test('a currency missing from the limits has the limit 0, and no limits means no limit', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim());
  const r = await service.decide('clm_048213', { action: 'accept', decidedBy: HANDLER, decisionLimits: { EUR: 99_999_999 } });
  assert.ok(r.proposal);
  assert.equal(r.proposal.proposerLimit, 0);
});

test('a payout of 0 never needs approval', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim());
  const r = await service.decide('clm_048213', {
    action: 'reject',
    decidedBy: HANDLER,
    decisionLimits: {},
    mayOverride: true,
    reasonCode: 'not_covered',
    reason: 'Not covered',
  });
  assert.equal(r.decision?.payout, 0);
});

test('approval by someone else turns the proposal into a booked decision and a payout order', async () => {
  const { service, store, clock } = setup();
  await service.registerClaim(cruciateClaim({ clinicId: 'clinic_001' }));
  const { proposal } = await service.decide('clm_048213', { action: 'accept', decidedBy: HANDLER, decisionLimits: LOW });
  clock.set('2026-11-14T09:00:00Z');
  const d = await service.approveProposal('clm_048213', proposal!.id, { approvedBy: APPROVER });
  assert.equal(d.decidedBy, HANDLER);
  assert.equal(d.approvedBy, APPROVER);
  assert.equal(d.proposalId, proposal!.id);
  assert.equal(d.payout, 1_216_500);
  assert.equal(d.automated, false);
  const [closed] = await service.getProposals('clm_048213');
  assert.deepEqual(
    { status: closed!.status, closedBy: closed!.closedBy, closedAt: closed!.closedAt, decisionId: closed!.decisionId },
    { status: 'approved', closedBy: APPROVER, closedAt: '2026-11-14T09:00:00Z', decisionId: d.id },
  );
  assertBalanced(store);
  const order = (await store.pendingEvents(10)).map((e) => e.event).find((e) => e.type === 'claim.payout_ordered');
  assert.ok(order && order.type === 'claim.payout_ordered');
  assert.deepEqual(
    { amount: order.order.amount, currency: order.order.currency, decisionId: order.order.decisionId, clinicId: order.order.clinicId },
    { amount: 1_216_500, currency: 'SEK', decisionId: d.id, clinicId: 'clinic_001' },
  );
});

test('four eyes: the proposer cannot approve their own proposal', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim());
  const { proposal } = await service.decide('clm_048213', { action: 'accept', decidedBy: HANDLER, decisionLimits: LOW });
  await assert.rejects(
    service.approveProposal('clm_048213', proposal!.id, { approvedBy: HANDLER }),
    (e: unknown) => e instanceof DomainError && e.code === 'forbidden',
  );
  assert.equal((await service.getProposals('clm_048213'))[0]!.status, 'open');
});

test('the approver\'s own limit applies', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim());
  const { proposal } = await service.decide('clm_048213', { action: 'accept', decidedBy: HANDLER, decisionLimits: LOW });
  await assert.rejects(
    service.approveProposal('clm_048213', proposal!.id, { approvedBy: APPROVER, approvalLimits: { SEK: 1_200_000 } }),
    (e: unknown) => e instanceof DomainError && e.code === 'forbidden',
  );
  const d = await service.approveProposal('clm_048213', proposal!.id, { approvedBy: APPROVER, approvalLimits: { SEK: 1_216_500 } });
  assert.equal(d.payout, 1_216_500);
});

test('an approval on a changed basis is refused; the proposal is returned and a new decision made', async () => {
  const { service, policies, clock } = setup();
  await service.registerClaim(cruciateClaim());
  const { proposal } = await service.decide('clm_048213', { action: 'accept', decidedBy: HANDLER, decisionLimits: LOW });
  clock.set('2026-11-20T00:00:00Z');
  policies.supersede('pv_bella_v4', '2026-11-20T00:00:00Z');
  policies.add({ snapshot: bellaPolicy({ policyVersionId: 'pv_bella_v5' }), sysFrom: '2026-11-20T00:00:00Z' });
  await assert.rejects(
    service.approveProposal('clm_048213', proposal!.id, { approvedBy: APPROVER }),
    (e: unknown) => e instanceof DomainError && e.code === 'conflict',
  );
  const returned = await service.returnProposal('clm_048213', proposal!.id, { returnedBy: APPROVER, reason: 'The policy changed' });
  assert.equal(returned.status, 'returned');
  assert.equal(returned.returnReason, 'The policy changed');
  await assert.rejects(
    service.approveProposal('clm_048213', proposal!.id, { approvedBy: APPROVER }),
    (e: unknown) => e instanceof DomainError && e.code === 'conflict',
  );
  const again = await service.decide('clm_048213', { action: 'accept', decidedBy: HANDLER, decisionLimits: LOW });
  assert.ok(again.proposal);
  assert.notEqual(again.proposal.id, proposal!.id);
});

test('while a proposal is open no other decision can be made, and a return needs a reason', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim());
  const { proposal } = await service.decide('clm_048213', { action: 'accept', decidedBy: HANDLER, decisionLimits: LOW });
  await assert.rejects(
    service.decide('clm_048213', { action: 'accept', decidedBy: 'another@example.test' }),
    (e: unknown) => e instanceof DomainError && e.code === 'conflict',
  );
  await assert.rejects(
    service.returnProposal('clm_048213', proposal!.id, { returnedBy: APPROVER, reason: '  ' }),
    (e: unknown) => e instanceof DomainError && e.code === 'validation',
  );
  await assert.rejects(
    service.approveProposal('clm_048213', 'prp_unknown', { approvedBy: APPROVER }),
    (e: unknown) => e instanceof DomainError && e.code === 'not_found',
  );
});

test('an approved decision answers an open review request', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  const req = await service.requestReview('clm_021877', 1, { requestedBy: 'customer-portal' });
  const { proposal } = await service.decide('clm_021877', { action: 'accept', decidedBy: HANDLER, decisionLimits: { SEK: 0 } });
  const d = await service.approveProposal('clm_021877', proposal!.id, { approvedBy: APPROVER });
  assert.equal(d.reviewRequestId, req.id);
});

test('payout orders: only increases are ordered, for the difference', async () => {
  const { service, store, policies, clock } = setup();
  await service.registerClaim(otitisClaim()); // auto: SEK 1,500
  const orders = async () =>
    (await store.pendingEvents(100)).flatMap((e) => (e.event.type === 'claim.payout_ordered' ? [e.event.order.amount] : []));
  assert.deepEqual(await orders(), [150_000]);
  clock.set('2026-11-20T00:00:00Z');
  policies.supersede('pv_bella_v4', '2026-11-20T00:00:00Z');
  policies.add({ snapshot: bellaPolicy({ policyVersionId: 'pv_bella_v5', status: 'cancelled' }), sysFrom: '2026-11-20T00:00:00Z' });
  const re = await service.reassess('clm_021877', 'reassessment-job', 'Retroactive cancellation');
  assert.equal(re?.payout, 0);
  assert.deepEqual(await orders(), [150_000], 'a decrease is not ordered');
});

// Reserve (roadmap M1) ---------------------------------------------------------------

const reserveOf = (store: InMemoryClaimsStore, claimId: string) => store.getBalance(accounts.claimReserve('SEK', claimId));

test('a claim that goes to a handler reserves its expected payout, and the decision releases it', async () => {
  const { service, store } = setup();
  await service.registerClaim(cruciateClaim());
  assert.equal(await reserveOf(store, 'clm_048213'), -1_216_500, 'credit balance: SEK 12,165 reserved');
  assertBalanced(store);
  const d = await decideNow(service, 'clm_048213', { action: 'accept', decidedBy: HANDLER });
  assert.equal(await reserveOf(store, 'clm_048213'), 0);
  assert.equal(await store.getBalance(accounts.reserveExpense('SEK', 'clm_048213')), 0);
  const release = store.dump().journals.find((j) => j.sourceType === 'claim_reserve' && j.sourceId === d.id);
  assert.ok(release, 'the release refers to the decision');
  assertBalanced(store);
});

test('a rejection also releases the reserve, and an automatic decision never has one', async () => {
  const { service, store } = setup();
  await service.registerClaim(cruciateClaim());
  await decideNow(service, 'clm_048213', { action: 'reject', decidedBy: HANDLER, mayOverride: true, reasonCode: 'other', reason: 'Duplicate' });
  assert.equal(await reserveOf(store, 'clm_048213'), 0);
  await service.registerClaim(otitisClaim());
  assert.ok(!store.dump().journals.some((j) => j.claimId === 'clm_021877' && j.sourceType === 'claim_reserve'));
});

test('no reserve when the assessment proposes rejection', async () => {
  const { service, store } = setup();
  await service.registerClaim(otitisClaim({ treatmentFrom: '2026-03-10', treatmentTo: '2026-03-10' })); // before the policy
  assert.equal(store.dump().journals.length, 0);
});

test('the reserve stays while a proposal awaits approval, and the approval releases it', async () => {
  const { service, store } = setup();
  await service.registerClaim(cruciateClaim());
  const { proposal } = await service.decide('clm_048213', { action: 'accept', decidedBy: HANDLER, decisionLimits: LOW });
  assert.equal(await reserveOf(store, 'clm_048213'), -1_216_500);
  await service.approveProposal('clm_048213', proposal!.id, { approvedBy: APPROVER });
  assert.equal(await reserveOf(store, 'clm_048213'), 0);
});
