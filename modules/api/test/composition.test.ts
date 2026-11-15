/** The composition root (granskningen A1): every module connected once, in memory here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, databasesFromEnv } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp } from '../src/index.ts';

test('the modules are connected, and the relay drives the policy module from the animal register', async () => {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  assert.deepEqual(Object.values(inst.storage), ['memory', 'memory', 'memory', 'memory', 'memory', 'memory', 'memory']);
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

test('database URLs come from the environment, skipping empty ones', () => {
  assert.deepEqual(databasesFromEnv({ CLAIMS_DATABASE_URL: 'postgres://c', PARTIES_DATABASE_URL: '', OTHER: 'x' }), { claims: 'postgres://c' });
});
