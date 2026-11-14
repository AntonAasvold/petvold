import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventClaimId, relayOutbox, type ClaimsEvent } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, fixtures } from '@petvold/claims-store-memory';

const clock = new FixedClock('2026-11-14T10:00:00.000Z');

async function storeWithClaims(...ids: string[]) {
  const store = new InMemoryClaimsStore();
  for (const id of ids) {
    const claim = fixtures.otitisClaim({ id, claimNo: id });
    await store.saveClaim(claim, [{ type: 'claim.registered', occurredAt: claim.receivedAt, claim }]);
  }
  return store;
}

const claimId = eventClaimId;

test('the relay publishes pending events in order and marks them as published', async () => {
  const store = await storeWithClaims('clm_1', 'clm_2', 'clm_3');
  const seen: string[] = [];
  const n = await relayOutbox(store, { publish: async (e) => void seen.push(claimId(e)) }, clock);
  assert.equal(n, 3);
  assert.deepEqual(seen, ['clm_1', 'clm_2', 'clm_3']);
  assert.deepEqual(await store.pendingEvents(10), []);
  assert.equal(await relayOutbox(store, { publish: async () => assert.fail('nothing to publish') }, clock), 0);
});

test('the relay stops at a failure and resumes from the same event next time', async () => {
  const store = await storeWithClaims('clm_1', 'clm_2', 'clm_3');
  const seen: string[] = [];
  const flaky = {
    publish: async (e: ClaimsEvent) => {
      if (claimId(e) === 'clm_2' && !seen.includes('retry')) {
        seen.push('retry');
        throw new Error('broker unavailable');
      }
      seen.push(claimId(e));
    },
  };
  await assert.rejects(relayOutbox(store, flaky, clock), /broker unavailable/);
  assert.equal((await store.pendingEvents(10)).length, 2);
  assert.equal(await relayOutbox(store, flaky, clock), 2);
  assert.deepEqual(seen, ['clm_1', 'retry', 'clm_2', 'clm_3']);
});

test('the relay publishes at most the limit per run', async () => {
  const store = await storeWithClaims('clm_1', 'clm_2', 'clm_3');
  assert.equal(await relayOutbox(store, { publish: async () => {} }, clock, 2), 2);
  assert.equal((await store.pendingEvents(10)).length, 1);
});
