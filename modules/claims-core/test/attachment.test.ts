import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService, DomainError } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';

const { bellaPolicy, cruciateClaim, RULES_SE_DOG, PRODUCT } = fixtures;

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

const invalid = (e: unknown) => e instanceof DomainError && e.code === 'validation';
const conflict = (e: unknown) => e instanceof DomainError && e.code === 'conflict';
const pdf = { kind: 'invoice' as const, mediaType: 'Application/PDF', size: 184_320, sha256: 'a'.repeat(64), url: 'https://archive.example.test/docs/1' };

test('an attachment is a reference with a checksum, checked before it is stored (ADR 0036)', async () => {
  const { service } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  const a = await service.addAttachment(claim.id, pdf, 'h');
  assert.deepEqual([a.mediaType, a.addedBy, a.url], ['application/pdf', 'h', pdf.url]);
  for (const bad of [
    { ...pdf, kind: 'x-ray' as never },
    { ...pdf, mediaType: 'pdf' },
    { ...pdf, size: 0 },
    { ...pdf, sha256: 'A'.repeat(64) },
    { ...pdf, url: 'http://archive.example.test/1' },
    { ...pdf, url: 'file:///tmp/x.pdf' },
    { ...pdf, replaces: 'att_none' },
    { ...pdf, informationRequestId: 'inf_none' },
  ]) {
    await assert.rejects(service.addAttachment(claim.id, bad, 'h'), invalid, JSON.stringify(bad));
  }
  await service.addAttachment(claim.id, { ...pdf, url: 'urn:archive:7c1f9e2a' }, 'h');
});

test('a replaced attachment no longer counts, and a decision keeps those in force by id and checksum', async () => {
  const { service, store } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  const first = await service.addAttachment(claim.id, pdf, 'h');
  const record = await service.addAttachment(claim.id, { ...pdf, kind: 'medical-record', sha256: 'b'.repeat(64) }, 'h');
  const better = await service.addAttachment(claim.id, { ...pdf, sha256: 'c'.repeat(64), replaces: first.id }, 'h');
  await assert.rejects(service.addAttachment(claim.id, { ...pdf, replaces: first.id }, 'h'), conflict);
  const { decision } = await service.decide(claim.id, { action: 'accept', decidedBy: 'h' });
  const evidence = await store.getEvidence(decision!.id);
  assert.deepEqual(evidence!.attachments, [
    { id: record.id, sha256: 'b'.repeat(64) },
    { id: better.id, sha256: 'c'.repeat(64) },
  ]);
  const explanation = await service.explainDecision(claim.id, decision!.seq);
  assert.deepEqual(explanation.basis.attachments, evidence!.attachments);
  // Not input to the rules: the replay still matches.
  assert.equal((await service.replayDecision(claim.id, decision!.seq)).inputHashMatches, true);
});

test('a closed claim gets no attachments', async () => {
  const { service } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  await service.withdraw(claim.id, { reason: 'Withdrawn' }, 'h');
  await assert.rejects(service.addAttachment(claim.id, pdf, 'h'), conflict);
});
