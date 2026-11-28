import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, parseCloudEvent, shortType, summary, typePattern } from '../src/cloud-event.ts';
import { likeTest } from '../src/store.ts';
import { event } from './helpers.ts';

test('reads a CloudEvent and says why a body is not one', () => {
  const e = event();
  assert.deepEqual(parseCloudEvent(JSON.stringify(e)), e);
  assert.equal(parseCloudEvent('{'), 'The body is not JSON');
  assert.equal(parseCloudEvent('[]'), 'The body is not an object');
  assert.equal(parseCloudEvent(JSON.stringify({ ...e, specversion: '0.3' })), 'specversion is not 1.0');
  assert.equal(parseCloudEvent(JSON.stringify({ ...e, subject: '' })), 'subject is missing');
  assert.equal(parseCloudEvent(JSON.stringify({ ...e, time: 'yesterday' })), 'time is not a time');
  assert.equal(parseCloudEvent(JSON.stringify({ ...e, data: null })), 'data is not an object');
});

test('short types and type filters', () => {
  assert.equal(shortType('petvold.claim.payout_ordered.v1'), 'claim.payout_ordered');
  const issued = likeTest(typePattern('policy.issued'));
  assert.ok(issued('petvold.policy.issued.v1'));
  assert.ok(!issued('petvold.policy.issued_late.v1'));
  const policy = likeTest(typePattern('policy.*'));
  assert.ok(policy('petvold.policy.renewed.v1'));
  assert.ok(!policy('petvold.claim.registered.v1'));
  // An underscore is a letter, not a wildcard.
  assert.ok(!likeTest(typePattern('claim.payout_ordered'))('petvold.claim.payoutXordered.v1'));
});

test('a summary shows amounts, dates and codes, not ids', () => {
  assert.match(formatMoney(412000, 'SEK'), /^4\s120,00\skr$/);
  assert.deepEqual(
    summary({ policyId: 'pol_1', startDate: '2026-12-01', premium: { amount: 412000, currency: 'SEK' }, reason: 'unpaid-premium' }).map((f) => f.key),
    ['startDate', 'premium', 'reason'],
  );
  assert.deepEqual(summary({ claimId: 'clm_1', amount: 150000, currency: 'SEK', channel: 'bank' }), [
    { key: 'amount', value: formatMoney(150000, 'SEK') },
    { key: 'channel', value: 'bank' },
  ]);
  assert.equal(summary({ a: '2026-01-01', b: '2026-01-02', c: '2026-01-03', d: '2026-01-04', e: '2026-01-05' }).length, 4);
});
