import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService, DomainError, basisCompleteAt, informationDates, informationMissing, type InformationRequest } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';

const { bellaPolicy, cruciateClaim, RULES_SE_DOG, PRODUCT } = fixtures;

function setup(rules = RULES_SE_DOG) {
  const store = new InMemoryClaimsStore();
  const clock = new FixedClock('2026-11-13T14:00:00.000Z');
  const service = new ClaimsService({
    policies: new InMemoryPolicyPort([{ snapshot: bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]),
    rules: new StaticRulesPort({ [PRODUCT]: rules }, rules),
    store,
    clock,
    ids: new SequentialIds(),
  });
  return { service, store, clock };
}

const conflict = (e: unknown) => e instanceof DomainError && e.code === 'conflict';
const invalid = (e: unknown) => e instanceof DomainError && e.code === 'validation';
const ask = { recipient: 'clinic' as const, items: ['itemised-invoice' as const], note: ' The specified invoice ' };

test('the dates come from the rules, the handler may choose the due date, and a reminder never falls on it', () => {
  assert.deepEqual(informationDates('2026-11-13', undefined), { dueDate: '2026-12-13', remindOn: '2026-11-27' });
  assert.deepEqual(informationDates('2026-11-13', { reminderAfterDays: 7, expiresAfterDays: 21 }), { dueDate: '2026-12-04', remindOn: '2026-11-20' });
  assert.deepEqual(informationDates('2026-11-13', undefined, '2026-11-20'), { dueDate: '2026-11-20' });
});

test('a request puts the claim in awaiting-information, with the days from the claims rules (ADR 0036)', async () => {
  const { service } = setup({ ...RULES_SE_DOG, informationRequest: { reminderAfterDays: 7, expiresAfterDays: 21 } });
  const { claim } = await service.registerClaim(cruciateClaim());
  const r = await service.requestInformation(claim.id, { ...ask, items: ['itemised-invoice', 'itemised-invoice', 'medical-record'] }, 'handlaggare@example.test');
  assert.deepEqual(
    [r.status, r.items, r.note, r.dueDate, r.remindOn, r.rulesVersion, r.requestedBy],
    ['open', ['itemised-invoice', 'medical-record'], 'The specified invoice', '2026-12-04', '2026-11-20', RULES_SE_DOG.rulesVersion, 'handlaggare@example.test'],
  );
  assert.deepEqual((await service.listClaims({ state: 'awaiting-information' })).map((c) => c.id), [claim.id]);
  const view = await service.getClaim(claim.id);
  assert.equal(view.basisCompleteAt, undefined, 'the basis is not complete while a request is open');
  // A decision waits for the answer.
  await assert.rejects(service.decide(claim.id, { action: 'reject', decidedBy: 'h', mayOverride: true, reasonCode: 'other', reason: 'x' }), conflict);
});

test('a request needs a recipient, items and a note, and a due date after today within a year', async () => {
  const { service } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  await assert.rejects(service.requestInformation(claim.id, { ...ask, items: [] }, 'h'), invalid);
  await assert.rejects(service.requestInformation(claim.id, { ...ask, items: ['x-ray' as never] }, 'h'), invalid);
  await assert.rejects(service.requestInformation(claim.id, { ...ask, note: '  ' }, 'h'), invalid);
  await assert.rejects(service.requestInformation(claim.id, { ...ask, recipient: 'vet' as never }, 'h'), invalid);
  await assert.rejects(service.requestInformation(claim.id, { ...ask, dueDate: '2026-11-13' }, 'h'), invalid);
  await assert.rejects(service.requestInformation(claim.id, { ...ask, dueDate: '2027-11-14' }, 'h'), invalid);
  await assert.rejects(service.requestInformation(claim.id, { ...ask, dueDate: '13/11' }, 'h'), invalid);
  const r = await service.requestInformation(claim.id, { ...ask, dueDate: '2026-11-20' }, 'h');
  assert.deepEqual([r.dueDate, r.remindOn], ['2026-11-20', undefined]);
  await assert.rejects(service.requestInformation(claim.id, ask, 'h'), conflict, 'one open request per recipient');
  await service.requestInformation(claim.id, { ...ask, recipient: 'customer' }, 'h');
});

test('an answer completes the basis when the information came in, and the claim can be decided', async () => {
  const { service, clock } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  const r = await service.requestInformation(claim.id, ask, 'h');
  clock.set('2026-11-20T09:00:00.000Z');
  await assert.rejects(service.answerInformationRequest(claim.id, r.id, { receivedAt: '2026-11-21T09:00:00.000Z' }, 'h'), invalid, 'not in the future');
  await assert.rejects(service.answerInformationRequest(claim.id, r.id, { receivedAt: '2026-11-12T09:00:00.000Z' }, 'h'), invalid, 'not before the request');
  await assert.rejects(service.answerInformationRequest(claim.id, r.id, { receivedAt: 'yesterday' }, 'h'), invalid);
  const answered = await service.answerInformationRequest(claim.id, r.id, { receivedAt: '2026-11-18T10:00:00+01:00', note: 'By mail' }, 'h2');
  assert.deepEqual(
    [answered.status, answered.receivedAt, answered.closedBy, answered.closedAt, answered.closingNote],
    ['answered', '2026-11-18T09:00:00.000Z', 'h2', '2026-11-20T09:00:00.000Z', 'By mail'],
  );
  const view = await service.getClaim(claim.id);
  assert.deepEqual([view.basisCompleteAt, view.daysSinceBasisComplete], ['2026-11-18T09:00:00.000Z', 2]);
  await assert.rejects(service.answerInformationRequest(claim.id, r.id, {}, 'h'), conflict);
  await assert.rejects(service.cancelInformationRequest(claim.id, r.id, { reason: 'x' }, 'h'), conflict);
  await assert.rejects(service.answerInformationRequest(claim.id, 'inf_none', {}, 'h'), (e: unknown) => e instanceof DomainError && e.code === 'not_found');
  const decided = await service.decide(claim.id, { action: 'accept', decidedBy: 'h' });
  assert.ok(decided.decision);
});

test('the daily run reminds once, expires after the due date, and a late answer still completes the basis', async () => {
  const { service, clock, store } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  const r = await service.requestInformation(claim.id, ask, 'h');
  const run = (onDate: string, dryRun = false) => service.informationRequestRun({ market: 'SE', onDate, dryRun }, 'scheduler');
  assert.deepEqual(await run('2026-11-26'), { market: 'SE', onDate: '2026-11-26', dryRun: false, reminded: [], expired: [] });
  assert.deepEqual((await run('2026-11-27', true)).reminded, [r.id]);
  assert.equal((await store.getInformationRequests(claim.id))[0]!.remindedAt, undefined, 'a dry run changes nothing');
  clock.set('2026-11-27T05:00:00.000Z');
  assert.deepEqual((await run('2026-11-27')).reminded, [r.id]);
  assert.deepEqual((await run('2026-11-28')).reminded, [], 'reminded once');
  assert.deepEqual((await run('2026-12-13')).expired, [], 'the due date is the last day to answer');
  clock.set('2026-12-14T05:00:00.000Z');
  assert.deepEqual((await run('2026-12-14')).expired, [r.id]);
  const view = await service.getClaim(claim.id);
  assert.deepEqual([view.basisCompleteAt, view.informationMissing], ['2026-12-14T05:00:00.000Z', true]);
  assert.deepEqual((await service.listClaims({ state: 'awaiting-decision' })).map((c) => [c.id, c.informationMissing]), [[claim.id, true]]);
  const types = (await store.pendingEvents(20)).map((e) => e.event.type);
  assert.deepEqual(types.slice(-3), ['claim.information_requested', 'claim.information_reminded', 'claim.information_expired']);
  clock.set('2026-12-15T08:00:00.000Z');
  await service.answerInformationRequest(claim.id, r.id, {}, 'h');
  const late = await service.getClaim(claim.id);
  assert.deepEqual([late.basisCompleteAt, late.informationMissing], ['2026-12-15T08:00:00.000Z', undefined]);
});

test('a cancelled request needs a reason and does not move when the basis was complete', async () => {
  const { service, clock } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  const r = await service.requestInformation(claim.id, ask, 'h');
  clock.set('2026-11-20T09:00:00.000Z');
  await assert.rejects(service.cancelInformationRequest(claim.id, r.id, { reason: ' ' }, 'h'), invalid);
  const c = await service.cancelInformationRequest(claim.id, r.id, { reason: 'Got it from the clinic portal' }, 'h');
  assert.deepEqual([c.status, c.closingNote], ['cancelled', 'Got it from the clinic portal']);
  assert.equal((await service.getClaim(claim.id)).basisCompleteAt, claim.receivedAt);
});

test('no request on a closed claim or with an open proposal, and closing cancels open requests', async () => {
  const { service, store } = setup();
  const { claim } = await service.registerClaim(cruciateClaim());
  await service.requestInformation(claim.id, ask, 'h');
  await service.withdraw(claim.id, { reason: 'The customer withdrew it' }, 'h');
  const [r] = await service.getInformationRequests(claim.id);
  assert.equal(r!.status, 'cancelled');
  assert.ok((await store.pendingEvents(20)).some((e) => e.event.type === 'claim.information_cancelled'));
  await assert.rejects(service.requestInformation(claim.id, ask, 'h'), conflict);

  const other = (await service.registerClaim({ ...cruciateClaim(), id: 'clm_two', claimNo: 'S-TWO' })).claim;
  const proposed = await service.decide(other.id, { action: 'accept', decidedBy: 'h', decisionLimits: { SEK: 0 } });
  assert.ok(proposed.proposal);
  await assert.rejects(service.requestInformation(other.id, ask, 'h'), conflict);
});

test('basisCompleteAt and informationMissing follow the requests', () => {
  const base = { claimId: 'c', recipient: 'clinic', items: ['other'], note: 'n', dueDate: '2026-12-01', rulesVersion: 'default', requestedBy: 'h' } as const;
  const r = (id: string, at: string, rest: Partial<InformationRequest>): InformationRequest => ({ ...base, items: ['other'], id, requestedAt: at, status: 'open', ...rest });
  const received = '2026-11-01T00:00:00.000Z';
  assert.equal(basisCompleteAt(received, []), received);
  assert.equal(basisCompleteAt(received, [r('a', '2026-11-02T00:00:00.000Z', {})]), undefined);
  const expired = r('a', '2026-11-02T00:00:00.000Z', { status: 'expired', closedAt: '2026-12-02T00:00:00.000Z', closedBy: 's' });
  const cancelled = r('b', '2026-12-03T00:00:00.000Z', { status: 'cancelled', closedAt: '2026-12-04T00:00:00.000Z', closedBy: 'h' });
  assert.equal(basisCompleteAt(received, [expired, cancelled]), '2026-12-02T00:00:00.000Z');
  assert.equal(informationMissing([expired, cancelled]), true, 'a cancelled request does not hide the missing information');
  const answered = r('c', '2026-12-05T00:00:00.000Z', { status: 'answered', receivedAt: '2026-12-06T00:00:00.000Z', closedAt: '2026-12-07T00:00:00.000Z', closedBy: 'h' });
  assert.equal(informationMissing([expired, answered]), false);
  assert.equal(basisCompleteAt(received, [expired, answered]), '2026-12-06T00:00:00.000Z');
});
