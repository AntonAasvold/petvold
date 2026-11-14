import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService, DomainError, StoreConflictError } from '@petvold/claims-core';
import {
  FixedClock,
  InMemoryClaimsStore,
  InMemoryPolicyPort,
  SequentialIds,
  StaticRulesPort,
  fixtures,
} from '@petvold/claims-store-memory';

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
  assert.deepEqual((await store.pendingEvents(10)).map((e) => e.event.type), ['claim.registered', 'claim.decided']);

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

  const d = await service.decide('clm_048213', {
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
  const d = await service.decide('c_x', { action: 'reject', decidedBy: 'h', reason: 'Rider' });
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
