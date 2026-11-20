/** Runs through the API (ADR 0037): the list, history, run now, pause and the relay's dead letters. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Principal } from '@petvold/api';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp } from '../src/index.ts';
import { validatorFor } from '../src/contract.ts';

const tokens: Record<string, Principal> = {
  ops: { subject: 'drift@example.test', roles: ['operations'], markets: '*' },
  ops2: { subject: 'drift2@example.test', roles: ['operations'], markets: '*' },
  handler: { subject: 'handlaggare@example.test', roles: ['handler'], markets: '*' },
  renewal: { subject: 'renewal-job', roles: ['renewal-job'], markets: '*' },
};

async function setup() {
  // 01:30 in Stockholm: expiry (01:00 and 01:15) is due, renewal (02:00) is not yet.
  const clock = { now: () => '2026-11-19T00:30:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock });
  await seedSampleData(inst, clock);
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let n = 0;
  const call = async (method: string, path: string, token = 'ops', body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(method === 'POST' ? { 'idempotency-key': `key-jobs-${++n}-${Date.now()}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as any) };
  };
  return { inst, call };
}

const valid = (schema: string, body: unknown) => {
  const v = validatorFor(schema);
  assert.ok(v(body), `${schema}: ${JSON.stringify(v.errors)}`);
};

test('the list shows every job with its schedule, and for each market the next run', async () => {
  const { call } = await setup();
  const r = await call('GET', '/v1/jobs');
  assert.equal(r.status, 200);
  r.body.items.forEach((j: unknown) => valid('Job', j));
  const renewal = r.body.items.find((j: any) => j.id === 'policies.renewal');
  assert.deepEqual(renewal.schedule, { kind: 'daily', at: '02:00', enabled: true, version: 0 });
  assert.equal(renewal.markets.find((m: any) => m.market === 'SE').nextRunAt, '2026-11-19T01:00:00.000Z');
  assert.equal((await call('GET', '/v1/jobs', 'handler')).status, 403, 'a handler has no jobs:read');
});

test('run now keeps the run in the history, also while the job is paused; a paused job is skipped by the scheduler', async () => {
  const { inst, call } = await setup();
  const paused = await call('POST', '/v1/jobs/policies.application-expiry/pauses', 'ops', { reason: 'Checking the deadlines' });
  assert.equal(paused.status, 201);
  valid('JobPause', paused.body);
  assert.equal((await call('POST', '/v1/jobs/policies.application-expiry/pauses', 'ops', { reason: 'again' })).status, 409);
  assert.ok(!(await inst.scheduler.tick()).some((r) => r.job === 'policies.application-expiry'), 'skipped while paused');

  const run = await call('POST', '/v1/jobs/policies.application-expiry/runs', 'ops', { market: 'SE', dryRun: true });
  assert.equal(run.status, 201);
  valid('JobRun', run.body);
  assert.deepEqual([run.body.trigger, run.body.startedBy, run.body.status, run.body.dryRun], ['manual', 'drift@example.test', 'succeeded', true]);
  assert.equal((await call('POST', '/v1/jobs/policies.application-expiry/runs', 'ops', { market: 'ZZ' })).status, 422);
  assert.equal((await call('POST', '/v1/jobs/nothing.here/runs', 'ops', { market: 'SE' })).status, 404);

  const resumed = await call('POST', '/v1/jobs/policies.application-expiry/resumptions', 'ops', { reason: 'Deadlines are right' });
  assert.equal(resumed.status, 201);
  const detail = await call('GET', '/v1/jobs/policies.application-expiry');
  valid('JobDetail', detail.body);
  // The clock stands still in the test, so both have the same time; in use the newest comes first.
  assert.deepEqual(detail.body.controls.map((c: any) => c.action).sort(), ['pause', 'resume']);
  const history = await call('GET', '/v1/jobs/policies.application-expiry/runs?market=SE');
  assert.deepEqual(history.body.items.map((r: any) => r.trigger), ['manual']);
});

test('the old run operations answer as before and keep the history as api', async () => {
  const { call } = await setup();
  const r = await call('POST', '/v1/renewal-runs', 'renewal', { dryRun: true });
  assert.equal(r.status, 200);
  valid('RenewalRunResult', r.body);
  assert.equal(r.body.dryRun, true);
  const history = await call('GET', '/v1/jobs/policies.renewal/runs');
  assert.ok(history.body.items.length >= 1);
  assert.ok(history.body.items.every((x: any) => x.trigger === 'api' && x.startedBy === 'renewal-job' && x.dryRun));
});

test("the relay's dead letters are listed and sent again", async () => {
  const { inst, call } = await setup();
  await inst.stores.scheduling.saveDeadLetter({ source: 'claims', eventId: '42', attempts: 10, lastError: 'Receiver down', deadAt: '2026-11-19T00:00:00.000Z' });
  const list = await call('GET', '/v1/relay-dead-letters');
  list.body.items.forEach((d: unknown) => valid('RelayDeadLetter', d));
  assert.deepEqual(list.body.items.map((d: any) => d.id), ['claims:42']);
  assert.equal((await call('POST', '/v1/relay-dead-letters/claims:42/retries', 'handler')).status, 403);
  assert.equal((await call('POST', '/v1/relay-dead-letters/claims:42/retries')).status, 204);
  assert.equal((await call('POST', '/v1/relay-dead-letters/claims:42/retries')).status, 404);
  assert.deepEqual((await call('GET', '/v1/relay-dead-letters')).body.items, []);
});

test('a schedule change waits for a second person, and then moves the next run (ADR 0037)', async () => {
  const { call } = await setup();
  const proposed = await call('POST', '/v1/jobs/policies.renewal/schedule-changes', 'ops', { at: '04:30', enabled: true, reason: 'After the night batch' });
  assert.equal(proposed.status, 201);
  valid('ScheduleChange', proposed.body);
  assert.equal((await call('POST', '/v1/jobs/policies.renewal/schedule-changes', 'ops2', { at: '05:00', enabled: true, reason: 'x' })).status, 409, 'one waiting at a time');
  const job = (await call('GET', '/v1/jobs/policies.renewal')).body;
  assert.deepEqual([job.schedule.at, job.pendingChange.id], ['02:00', proposed.body.id], 'nothing changes before approval');

  const path = `/v1/jobs/policies.renewal/schedule-changes/${proposed.body.id}`;
  assert.equal((await call('POST', `${path}/approvals`, 'ops')).status, 403, 'not by the proposer');
  assert.equal((await call('POST', `${path}/approvals`, 'handler')).status, 403, 'not without jobs:configure');
  const approved = await call('POST', `${path}/approvals`, 'ops2');
  assert.deepEqual([approved.status, approved.body.status, approved.body.decidedBy], [201, 'approved', 'drift2@example.test']);

  const after = (await call('GET', '/v1/jobs/policies.renewal')).body;
  assert.deepEqual(after.schedule, { kind: 'daily', at: '04:30', enabled: true, version: 1 });
  assert.equal(after.markets.find((m: any) => m.market === 'SE').nextRunAt, '2026-11-19T03:30:00.000Z');

  // Turned off: no next run. A rejection needs a reason.
  const off = await call('POST', '/v1/jobs/policies.renewal/schedule-changes', 'ops2', { at: '04:30', enabled: false, reason: 'Off during the migration' });
  const offPath = `/v1/jobs/policies.renewal/schedule-changes/${off.body.id}`;
  assert.equal((await call('POST', `${offPath}/rejections`, 'ops', {})).status, 422);
  const rejected = await call('POST', `${offPath}/rejections`, 'ops', { reason: 'Not during the renewal season' });
  assert.equal(rejected.body.status, 'rejected');
  const history = await call('GET', '/v1/jobs/policies.renewal/schedule-changes');
  // The clock stands still in the test; in use the newest comes first.
  assert.deepEqual(history.body.items.map((x: any) => x.status).sort(), ['approved', 'rejected']);
});

test('job.failed is a public event with the job, not the error', async () => {
  const { toCloudEvent } = await import('@petvold/webhooks');
  const e = toCloudEvent({ id: 'run_1', type: 'job.failed', runId: 'run_1', market: 'SE', occurredAt: '2026-11-19T01:00:00Z', data: { job: 'policies.renewal', trigger: 'schedule', startedAt: '2026-11-19T01:00:00Z', error: 'Policy of Anna Example' } });
  assert.deepEqual(e?.data, { runId: 'run_1', job: 'policies.renewal', trigger: 'schedule', startedAt: '2026-11-19T01:00:00Z' });
  assert.equal(e?.type, 'petvold.job.failed.v1');
});

test('reminders and expiry of requests for information run as a job, and expire a request past its due date (ADR 0036)', async () => {
  const { inst, call } = await setup();
  const [claim] = await inst.deps.service.listClaims({ state: 'awaiting-decision', market: 'SE' });
  assert.ok(claim, 'the sample data has a claim waiting for a handler');
  const request = await inst.deps.service.requestInformation(claim.id, { recipient: 'customer', items: ['medical-record'], note: 'The record', dueDate: '2026-11-20' }, 'handlaggare@example.test');
  const job = (await call('GET', '/v1/jobs/claims.information-requests')).body;
  assert.deepEqual(job.schedule, { kind: 'daily', at: '06:00', enabled: true, version: 0 });
  // Run now on today's date: not yet due.
  const run = await call('POST', '/v1/jobs/claims.information-requests/runs', 'ops', { market: 'SE' });
  assert.equal(run.status, 201);
  assert.deepEqual(run.body.result, { reminded: 0, expired: 0, remindedRequestIds: [], expiredRequestIds: [] });
  // Two days later the due date has passed.
  const later = await inst.deps.service.informationRequestRun({ market: 'SE', onDate: '2026-11-21' }, 'scheduler');
  assert.deepEqual(later.expired, [request.id]);
  assert.equal((await inst.deps.service.getClaim(claim.id)).informationMissing, true);
});
