import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlProblems, jobRows, mayOperateJobs, resultLine } from '../src/jobs-logic.ts';

test('one row per job and market', () => {
  const jobs = [
    { id: 'policies.renewal', schedule: { kind: 'daily' as const, at: '02:00' }, markets: [{ market: 'SE' }, { market: 'NO' }] },
    { id: 'parties.retention', schedule: { kind: 'daily' as const, at: '03:00' }, markets: [] },
  ];
  assert.deepEqual(jobRows(jobs).map((r) => [r.job.id, r.market]), [
    ['policies.renewal', 'SE'],
    ['policies.renewal', 'NO'],
    ['parties.retention', '–'],
  ]);
});

test("a run's result in a line, without the ids", () => {
  assert.equal(resultLine({ checked: 10, renewed: 3, needsDecision: [{ policyId: 'pol_a' }], renewedPolicyIds: ['pol_b'] }), 'checked 10 · renewed 3 · needsDecision 1');
  assert.equal(resultLine(undefined), '');
});

test('operating jobs needs jobs:operate, and a pause needs a reason', () => {
  assert.equal(mayOperateJobs({ subject: 'd', roles: ['operations'], permissions: ['jobs:read', 'jobs:operate'] } as never), true);
  assert.equal(mayOperateJobs({ subject: 'h', roles: ['handler'], permissions: ['jobs:read'] } as never), false);
  assert.deepEqual(controlProblems(' '), ['settings.needReason']);
  assert.deepEqual(controlProblems('Wrong rule'), []);
});

test('a run is late when its time passed more than five minutes ago', async () => {
  const { isLate } = await import('../src/jobs-logic.ts');
  assert.equal(isLate('2026-11-19T01:00:00Z', '2026-11-19T01:04:00Z'), false);
  assert.equal(isLate('2026-11-19T01:00:00Z', '2026-11-19T01:06:00Z'), true);
});
