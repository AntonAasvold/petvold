/** The composition root (granskningen A1): every module connected once, in memory here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, databasesFromEnv } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp } from '../src/index.ts';

test('the modules are connected, and the relay drives the policy module from the animal register', async () => {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  assert.deepEqual(Object.values(inst.storage), ['memory', 'memory', 'memory', 'memory', 'memory', 'memory', 'memory', 'memory', 'memory', 'memory']);
  await seedSampleData(inst, clock);
  await seedSampleData(inst, clock); // twice is harmless
  const app = createApp({ ...inst.deps, auth: { authenticate: async () => ({ subject: 'h', roles: ['handler'], markets: '*' }) } });
  assert.equal((await app.request('/v1/policies/pol_bella', { headers: { authorization: 'Bearer x' } })).status, 200);

  // Bella dies in the register; the relay turns it into a cancellation proposal.
  const bella = (await inst.deps.animals!.get('ani_bella'))!;
  await inst.deps.animals!.correct('ani_bella', { basedOnRevision: bella.revision, reason: 'Died', sex: bella.sex, neutered: bella.neutered, name: bella.name, birthDate: bella.birthDate, breed: bella.breed!, allowLookup: bella.allowLookup, deceasedOn: '2026-11-10' }, 'registrar');
  assert.ok((await inst.relay.tick()) >= 1);
  assert.deepEqual((await inst.deps.policies!.listProposals({ pending: true })).map((p) => p.kind), ['cancel-death']);
  await inst.close();
});

test('the relay turns the policy module\'s events into notices to the customer (ADR 0032)', async () => {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  const notices = await inst.deps.communications!.list({});
  const byType = (t: string) => notices.filter((n) => n.type === t);
  const policies = (await inst.deps.policies!.findByPolicyholder('pty_owner004')).length + (await inst.deps.policies!.findByPolicyholder('pty_owner003')).length;
  assert.ok(byType('policy-confirmation').length >= policies && policies > 0, 'every issued policy is confirmed');
  const declined = byType('application-declined');
  assert.deepEqual(declined.map((n) => [n.recipientPartyId, n.content.reasons, n.status]), [['pty_owner004', ['too-old'], 'pending']]);
  // Bella is sold to Erik: the policy module proposes a transfer, and Erik gets the offer.
  await inst.deps.animals!.transfer('ani_bella', { partyId: 'pty_owner002', from: '2026-11-14' }, 'registrar');
  while ((await inst.relay.tick()) > 0);
  const offers = await inst.deps.communications!.list({ type: 'transfer-offer' });
  assert.deepEqual(offers.map((n) => [n.recipientPartyId, n.policyId, n.content.fromPartyId, n.content.from]), [['pty_owner002', 'pol_bella', 'pty_owner001', '2026-11-14']]);
  notices.push(...offers);
  // Delivered again: no new notices.
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  assert.equal((await inst.deps.communications!.list({})).length, notices.length);
  await inst.close();
});

test('database URLs come from the environment, skipping empty ones', () => {
  assert.deepEqual(databasesFromEnv({ CLAIMS_DATABASE_URL: 'postgres://c', PARTIES_DATABASE_URL: '', OTHER: 'x' }), { claims: 'postgres://c' });
});

test('the sample data fills every work queue and prices the households with the tariff', async () => {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  await seedSampleData(inst, clock); // twice is harmless
  const claims = await inst.deps.service.listClaims({});
  assert.deepEqual(
    claims.map((c) => [c.id, c.state]),
    [
      ['clm_021877', 'decided'],
      ['clm_033410', 'review-requested'],
      ['clm_050977', 'awaiting-approval'],
      ['clm_048213', 'awaiting-decision'],
    ],
  );
  const policies = inst.deps.policies!;
  const [doris] = await policies.findByAnimal('ani_doris');
  const [max] = await policies.findByAnimal('ani_max');
  const [ludde] = await policies.findByAnimal('ani_ludde');
  for (const p of [doris, max, ludde]) assert.ok(p!.terms[0]!.pricing, `${p!.id} is priced by the tariff`);
  assert.equal((await policies.findByAnimal('ani_smilla')).length, 0);
  // Ludde joins Max in the household group and gets the group discount.
  assert.ok(ludde!.terms[0]!.pricing!.result.facts.discountBp > 0);
  assert.equal(doris!.terms[0]!.pricing!.result.facts.discountBp, 0);
  // Applications for the product with health questions: one in each outcome (ADR 0031).
  const applications = await policies.listApplications({ policyholderPartyId: 'pty_owner004' });
  assert.deepEqual(
    applications.map((a) => [a.animalId, a.status, a.underwriting.result.reasons]),
    [
      ['ani_kajsa', 'accepted', []],
      ['ani_rocky', 'referred', ['ongoing-symptoms']],
      ['ani_sixten', 'declined', ['too-old']],
    ],
  );
  // The customer was shown the Swedish terms and pre-contract information (ADR 0032).
  assert.deepEqual(applications[0]!.acceptance.documents?.map((d) => `${d.type}/${d.language}`), ['pre-contract/sv', 'terms/sv']);
  const [kajsa] = await policies.findByAnimal('ani_kajsa');
  assert.deepEqual(kajsa!.terms[0]!.riders.map((r) => [r.diagnosisCodes, r.source]), [[['ORA-OTIT'], 'underwriting']]);
  await inst.close();
});

test('the claim number prefix per market is read from the environment, and a bad one stops the start', async () => {
  const { claimNumberPrefixFromEnv } = await import('../src/composition.ts');
  assert.deepEqual(claimNumberPrefixFromEnv({ PETVOLD_CLAIM_NUMBER_PREFIX: 'SE=S, NO=N' }), { SE: 'S', NO: 'N' });
  assert.deepEqual(claimNumberPrefixFromEnv({}), {});
  assert.throws(() => claimNumberPrefixFromEnv({ PETVOLD_CLAIM_NUMBER_PREFIX: 'se=s' }), /MARKET=PREFIX/);
});

test("the scheduler runs the four jobs once per market and day, with counts and ids only in the history (ADR 0037)", async () => {
  // 03:30 in Stockholm: every job's time has come.
  const clock = { now: () => '2026-11-19T02:30:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  const runs = await inst.scheduler.tick();
  assert.deepEqual([...new Set(runs.map((r) => r.job))], ['policies.application-expiry', 'policies.proposal-expiry', 'policies.renewal', 'parties.retention']);
  assert.ok(runs.every((r) => r.status === 'succeeded'), JSON.stringify(runs.filter((r) => r.status !== 'succeeded')));
  assert.ok(runs.some((r) => r.market === 'SE'));
  const renewal = runs.find((r) => r.job === 'policies.renewal' && r.market === 'SE')!;
  assert.deepEqual(Object.keys(renewal.result!).sort(), ['cancelled', 'checked', 'needsDecision', 'notYet', 'renewed', 'renewedPolicyIds']);
  assert.deepEqual(await inst.scheduler.tick(), [], 'once a day');
  await inst.close();
});
