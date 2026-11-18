import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService, DomainError, type NewClaim } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';

const { bellaPolicy, cruciateClaim, RULES_SE_DOG, PRODUCT } = fixtures;

function setup(claimNumberPrefix?: Record<string, string>) {
  const store = new InMemoryClaimsStore();
  const service = new ClaimsService({
    policies: new InMemoryPolicyPort([{ snapshot: bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]),
    rules: new StaticRulesPort({ [PRODUCT]: RULES_SE_DOG }, RULES_SE_DOG),
    store,
    clock: new FixedClock('2026-11-13T14:00:00Z'),
    ids: new SequentialIds(),
    ...(claimNumberPrefix ? { claimNumberPrefix } : {}),
  });
  return { service, store };
}

/** The cruciate claim without the id and claim number the client used to choose. */
function withoutNumbers(o: Partial<NewClaim> = {}): NewClaim {
  const { id: _id, claimNo: _no, ...rest } = cruciateClaim();
  return { ...rest, ...o };
}

test('without an id or a claim number, the server gives both from the series (ADR 0036)', async () => {
  const { service } = setup();
  const a = await service.registerClaim(withoutNumbers());
  const b = await service.registerClaim(withoutNumbers());
  assert.match(a.claim.id, /^clm_/);
  assert.notEqual(a.claim.id, b.claim.id);
  assert.deepEqual([a.claim.claimNo, b.claim.claimNo], ['S-2026-000001', 'S-2026-000002']);
});

test("the prefix is the market's, and the year is the market's on the day the claim was received", async () => {
  const { service } = setup({ SE: 'SKD' });
  // 23:30 UTC on New Year's Eve is already 2027 in Stockholm.
  const r = await service.registerClaim(withoutNumbers({ receivedAt: '2026-12-31T23:30:00Z' }));
  assert.equal(r.claim.claimNo, 'SKD-2027-000001');
});

test("a client's own claim number is kept, a taken one is a conflict, and the series skips it", async () => {
  const { service } = setup();
  const own = await service.registerClaim(withoutNumbers({ claimNo: 'S-2026-000001' }));
  assert.equal(own.claim.claimNo, 'S-2026-000001');
  await assert.rejects(service.registerClaim(withoutNumbers({ claimNo: 'S-2026-000001' })), (e) => e instanceof DomainError && e.code === 'conflict');
  const given = await service.registerClaim(withoutNumbers());
  assert.equal(given.claim.claimNo, 'S-2026-000002');
});

test('a preview needs no id or claim number, and uses none from the series', async () => {
  const { service } = setup();
  const a = await service.preview(withoutNumbers());
  assert.equal(a.claimId, 'clm_preview');
  const r = await service.registerClaim(withoutNumbers());
  assert.equal(r.claim.claimNo, 'S-2026-000001');
});
