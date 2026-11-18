import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService, DomainError, accounts } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';

const { bellaPolicy, cruciateClaim, otitisClaim, RULES_SE_DOG, PRODUCT } = fixtures;

function setup() {
  const store = new InMemoryClaimsStore();
  const service = new ClaimsService({
    policies: new InMemoryPolicyPort([{ snapshot: bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]),
    rules: new StaticRulesPort({ [PRODUCT]: RULES_SE_DOG }, RULES_SE_DOG),
    store,
    clock: new FixedClock('2026-11-13T14:00:00Z'),
    ids: new SequentialIds(),
  });
  return { service, store };
}

const conflict = (e: unknown) => e instanceof DomainError && e.code === 'conflict';
const invalid = (e: unknown) => e instanceof DomainError && e.code === 'validation';

test('a withdrawal closes the claim, releases the reserve and consumes nothing (ADR 0036)', async () => {
  const { service, store } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  const reserve = accounts.claimReserve('SEK', claim.id);
  assert.notEqual(await store.getBalance(reserve), 0, 'a manual claim books a reserve');
  const k = await service.withdraw(claim.id, { reason: ' The customer withdrew it by phone ' }, 'handlaggare@example.test');
  assert.deepEqual([k.kind, k.reason, k.closedBy], ['withdrawn', 'The customer withdrew it by phone', 'handlaggare@example.test']);
  assert.equal(await store.getBalance(reserve), 0);
  assert.deepEqual((await service.getClaim(claim.id)).closure, k);
  assert.deepEqual((await service.listClaims({ state: 'withdrawn' })).map((c) => c.id), [claim.id]);
  // Closed: no decision, and it cannot be closed again.
  await assert.rejects(service.decide(claim.id, { action: 'accept', decidedBy: 'handlaggare@example.test' }), conflict);
  await assert.rejects(service.withdraw(claim.id, { reason: 'Again' }, 'h'), conflict);
});

test('a dismissal as a duplicate names an existing other claim; other reasons name none', async () => {
  const { service } = setup();
  const first = (await service.registerClaim(cruciateClaim())).claim;
  const second = (await service.registerClaim({ ...cruciateClaim(), id: 'clm_dup', claimNo: 'S-DUP' })).claim;
  await assert.rejects(service.dismiss(second.id, { reasonCode: 'duplicate', reason: 'Same invoice' }, 'h'), invalid);
  await assert.rejects(service.dismiss(second.id, { reasonCode: 'duplicate', reason: 'Same invoice', duplicateOf: second.id }, 'h'), invalid);
  await assert.rejects(service.dismiss(second.id, { reasonCode: 'duplicate', reason: 'Same invoice', duplicateOf: 'clm_none' }, 'h'), invalid);
  await assert.rejects(service.dismiss(second.id, { reasonCode: 'not-a-claim', reason: 'x', duplicateOf: first.id }, 'h'), invalid);
  await assert.rejects(service.dismiss(second.id, { reasonCode: 'not-a-claim', reason: '  ' }, 'h'), invalid);
  const k = await service.dismiss(second.id, { reasonCode: 'duplicate', reason: 'Same invoice as the first', duplicateOf: first.id }, 'h');
  assert.deepEqual([k.kind, k.reasonCode, k.duplicateOf], ['dismissed', 'duplicate', first.id]);
});

test('a decided claim cannot be closed: it is corrected or reassessed instead', async () => {
  const { service } = setup();
  const { claim, decision } = await service.registerClaim(otitisClaim());
  assert.ok(decision, 'the otitis claim is settled automatically');
  await assert.rejects(service.withdraw(claim.id, { reason: 'Too late' }, 'h'), conflict);
});
