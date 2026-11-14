import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService, simulate, type ClaimsRules } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';

const { bellaPolicy, otitisClaim, cruciateClaim, RULES_SE_DOG, PRODUCT } = fixtures;

async function history() {
  const store = new InMemoryClaimsStore();
  const service = new ClaimsService({
    policies: new InMemoryPolicyPort([{ snapshot: bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]),
    rules: new StaticRulesPort({ [PRODUCT]: RULES_SE_DOG }, RULES_SE_DOG),
    store,
    clock: new FixedClock('2026-11-13T14:00:00.000Z'),
    ids: new SequentialIds(),
  });
  await service.registerClaim(otitisClaim()); // auto, SEK 1,500
  await service.registerClaim(cruciateClaim());
  await service.decide('clm_048213', { action: 'accept', decidedBy: 'h1' }); // manual, SEK 12,165
  return service.decisionsForSimulation('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
}

test('the same rules change nothing', async () => {
  const r = simulate(await history(), { ...RULES_SE_DOG, rulesVersion: 'SE-HUND-VV@9' }, 'vet-care.v1');
  assert.deepEqual([r.decisions, r.changed, r.items.length], [2, 0, 0]);
  assert.deepEqual(r.totals, [{ currency: 'SEK', decisions: 2, storedPayout: 1_366_500, simulatedPayout: 1_366_500 }]);
});

test('a lower auto limit moves the small claim to manual handling, without changing amounts', async () => {
  const rules: ClaimsRules = { ...RULES_SE_DOG, rulesVersion: 'SE-HUND-VV@2', autoSettleMax: 100_000 };
  const r = simulate(await history(), rules, 'vet-care.v1');
  assert.equal(r.changed, 1);
  assert.deepEqual(r.modeChanged, { autoToManual: 1, manualToAuto: 0 });
  assert.equal(r.items[0]!.claimId, 'clm_021877');
  assert.equal(r.items[0]!.payoutDelta, 0);
});

test('food becoming reimbursable raises the cruciate payout by 75 % of SEK 420', async () => {
  const rules: ClaimsRules = { ...RULES_SE_DOG, rulesVersion: 'SE-HUND-VV@2', nonReimbursableCategories: [] };
  const r = simulate(await history(), rules, 'vet-care.v1');
  const cruciate = r.items.find((x) => x.claimId === 'clm_048213');
  assert.ok(cruciate);
  assert.equal(cruciate.payoutDelta, 31_500);
  assert.equal(cruciate.stored.proposedOutcome, 'partial');
  assert.equal(cruciate.simulated.proposedOutcome, 'approved');
  assert.equal(r.totals[0]!.simulatedPayout - r.totals[0]!.storedPayout, 31_500);
});

test('an unknown calculation model is refused', async () => {
  assert.throws(() => simulate([], { ...RULES_SE_DOG }, 'vet-care.v99'), /Unknown calculation model/);
});
