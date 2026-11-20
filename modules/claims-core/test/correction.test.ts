import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService, DomainError } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';

const { bellaPolicy, cruciateClaim, otitisClaim, RULES_SE_DOG, PRODUCT } = fixtures;

function setup() {
  const store = new InMemoryClaimsStore();
  const service = new ClaimsService({
    policies: new InMemoryPolicyPort([{ snapshot: bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]),
    rules: new StaticRulesPort({ [PRODUCT]: RULES_SE_DOG }, RULES_SE_DOG),
    store,
    clock: new FixedClock('2026-11-13T14:00:00.000Z'),
    ids: new SequentialIds(),
  });
  return { service, store };
}

const conflict = (e: unknown) => e instanceof DomainError && e.code === 'conflict';
const invalid = (e: unknown) => e instanceof DomainError && e.code === 'validation';
const state = async (s: ClaimsService, id: string) => (await s.listClaims({})).find((c) => c.id === id)!.state;

test('a correction before any decision makes a new revision and keeps the old one (ADR 0036)', async () => {
  const { service } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  assert.equal(claim.revision, 1);
  const r = await service.correctClaim(claim.id, { treatmentTo: '2026-11-11', reason: ' The last day was wrong ', expectedRevision: 1 }, 'h');
  assert.deepEqual([r.correction.revision, r.correction.fields, r.correction.reason, r.correction.reopens, r.decision], [2, ['treatmentTo'], 'The last day was wrong', false, null]);
  const view = await service.getClaim(claim.id);
  assert.deepEqual([view.revision, view.treatmentTo, view.reopened], [2, '2026-11-11', undefined]);
  const revisions = await service.getRevisions(claim.id);
  assert.deepEqual(revisions.map((x) => [x.revision, x.data.treatmentTo]), [[1, claim.treatmentTo], [2, '2026-11-11']]);
  // The decision names the revision it was made on.
  const decided = await service.decide(claim.id, { action: 'accept', decidedBy: 'h' });
  assert.equal(decided.decision!.claimRevision, 2);
});

test('a correction needs a reason, the current revision, a change, and fields that may change', async () => {
  const { service } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  await assert.rejects(service.correctClaim(claim.id, { diagnosisCode: 'ORA-OTIT', reason: ' ', expectedRevision: 1 }, 'h'), invalid);
  await assert.rejects(service.correctClaim(claim.id, { diagnosisCode: 'ORA-OTIT', reason: 'x', expectedRevision: 2 }, 'h'), conflict);
  await assert.rejects(service.correctClaim(claim.id, { diagnosisCode: claim.diagnosisCode, reason: 'x', expectedRevision: 1 }, 'h'), invalid, 'nothing changes');
  await assert.rejects(service.correctClaim(claim.id, { policyId: 'pol_other', reason: 'x', expectedRevision: 1 } as never, 'h'), invalid);
  await assert.rejects(service.correctClaim(claim.id, { treatmentTo: '2026-01-01', reason: 'x', expectedRevision: 1 }, 'h'), invalid, 'before treatmentFrom');
  await service.withdraw(claim.id, { reason: 'Withdrawn' }, 'h');
  await assert.rejects(service.correctClaim(claim.id, { diagnosisCode: 'ORA-OTIT', reason: 'x', expectedRevision: 1 }, 'h'), conflict);
});

test("after a person's decision the claim is reopened for a person, and the machine does not decide it meanwhile", async () => {
  const { service } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  const first = (await service.decide(claim.id, { action: 'accept', decidedBy: 'h' })).decision!;
  const lines = claim.lines.filter((l) => l.category !== 'food');
  const r = await service.correctClaim(claim.id, { lines, reason: 'Food was never on the invoice', expectedRevision: 1 }, 'h');
  assert.deepEqual([r.correction.reopens, r.decision], [true, null]);
  assert.equal(await state(service, claim.id), 'awaiting-decision');
  assert.equal((await service.getClaim(claim.id)).reopened, true);
  assert.equal(await service.reassess(claim.id, 'policy-change', 'A policy change'), null);
  const second = (await service.decide(claim.id, { action: 'accept', decidedBy: 'h2' })).decision!;
  assert.deepEqual([second.seq, second.claimRevision, second.payout], [2, 2, first.payout]);
  assert.equal(await state(service, claim.id), 'decided');
});

test('after an automated decision: the same outcome stands, another within the rules is decided anew, and one for a handler is reopened', async () => {
  const { service } = setup();
  const { claim, decision } = await service.registerClaim(otitisClaim());
  assert.ok(decision?.automated);
  // A description changes nothing the rules read.
  const lines = claim.lines.map((l) => (l.id === 'l1' ? { ...l, description: 'Examination, both ears' } : l));
  const same = await service.correctClaim(claim.id, { lines, reason: 'Typo', expectedRevision: 1 }, 'h');
  assert.deepEqual([same.correction.reopens, same.decision], [false, null]);
  assert.equal(await state(service, claim.id), 'decided');

  // A lower amount: a new automated decision books the difference.
  const lower = lines.map((l) => (l.id === 'l2' ? { ...l, amount: 235_000 } : l));
  const changed = await service.correctClaim(claim.id, { lines: lower, reason: 'The medication cost less', expectedRevision: 2 }, 'h');
  assert.equal(changed.correction.reopens, false);
  assert.ok(changed.decision?.automated);
  assert.deepEqual([changed.decision!.seq, changed.decision!.claimRevision], [2, 3]);
  assert.ok(changed.decision!.payout < decision!.payout);
  assert.equal(await state(service, claim.id), 'decided');

  // Above the limit for automatic settlement: a handler decides.
  const higher = lower.map((l) => (l.id === 'l2' ? { ...l, amount: 2_335_000 } : l));
  const big = await service.correctClaim(claim.id, { lines: higher, reason: 'Surgery was added', expectedRevision: 3 }, 'h');
  assert.deepEqual([big.correction.reopens, big.decision], [true, null]);
  assert.equal(await state(service, claim.id), 'awaiting-decision');
});

test('a correction is not made while a proposal waits for approval', async () => {
  const { service } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  await service.decide(claim.id, { action: 'accept', decidedBy: 'h', decisionLimits: { SEK: 0 } });
  await assert.rejects(service.correctClaim(claim.id, { diagnosisCode: 'ORA-OTIT', reason: 'x', expectedRevision: 1 }, 'h'), conflict);
});
