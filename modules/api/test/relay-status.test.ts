/** How far behind the relay is (ADR 0008, 0037): what waits per module, and the oldest. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';

test('the relay status shows what waits per module until a round has taken it', async () => {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  const tokens: Record<string, Principal> = { ops: { subject: 'drift@example.test', roles: ['operations'], markets: '*' }, handler: { subject: 'h', roles: ['handler'], markets: '*' } };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  const get = async (token: string) => {
    const res = await app.request('/v1/relay-status', { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json()) as any };
  };
  assert.equal((await get('handler')).status, 403);
  const before = await get('ops');
  assert.equal(before.status, 200);
  assert.ok(validatorFor('RelayStatus')(structuredClone(before.body)), JSON.stringify(validatorFor('RelayStatus').errors));
  const claims = before.body.sources.find((s: any) => s.name === 'claims');
  assert.ok(claims.pending > 0 && claims.oldestAt, 'the sample claims wait');
  while ((await inst.relay.tick()) > 0);
  const after = await get('ops');
  assert.deepEqual(after.body.sources.filter((s: any) => s.pending > 0).map((s: any) => s.name), [], 'nothing waits after the rounds');
  assert.equal(after.body.sources.find((s: any) => s.name === 'claims').oldestAt, undefined);
});
