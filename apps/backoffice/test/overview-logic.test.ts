import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUEUES, failedJobs, ordered, queuesFor, tabFromUrl } from '../src/overview-logic.ts';

const me = (permissions: string[]) => ({ subject: 's', roles: [], permissions, scope: { markets: '*' as const } });

test('each role sees its own queues', () => {
  assert.deepEqual(queuesFor(me(['claims:read'])).map((q) => q.key), ['claims.decide', 'claims.review']);
  assert.deepEqual(queuesFor(me(['claims:read', 'claims:approve'])).map((q) => q.key), ['claims.decide', 'claims.approve', 'claims.review']);
  assert.deepEqual(queuesFor(me(['billing:read'])).map((q) => q.key), ['money.unmatched', 'money.proposals', 'money.recoveries']);
  assert.deepEqual(queuesFor(null), []);
  assert.equal(new Set(QUEUES.map((q) => q.key)).size, QUEUES.length, 'one key each');
});

test('queues with something waiting come first, the rest keep their order', () => {
  const rows = queuesFor(me(['claims:read', 'claims:approve'])).map((queue, i) => ({ queue, count: ['0', '3', ''][i]! }));
  assert.deepEqual(ordered(rows).map((r) => r.queue.key), ['claims.approve', 'claims.decide', 'claims.review']);
  assert.equal(ordered([]).length, 0);
});

test('jobs whose last run failed, and the tab a URL asks for', () => {
  assert.deepEqual(
    failedJobs([
      { id: 'billing.invoicing', markets: [{ market: 'SE', lastRun: { status: 'succeeded' } }, { market: 'FI', lastRun: { status: 'failed' } }] },
      { id: 'accounting.day-close', markets: [{ market: 'SE' }] },
    ]),
    [{ id: 'billing.invoicing', markets: ['FI'] }],
  );
  assert.equal(tabFromUrl('?tab=held', ['unmatched', 'held'] as const), 'held');
  assert.equal(tabFromUrl('?tab=nope', ['unmatched', 'held'] as const), null);
  assert.equal(tabFromUrl('', ['unmatched'] as const), null);
});
