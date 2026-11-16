import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeFlags, parseList, subscriptionBody, subscriptionProblems } from '../src/integration-logic.ts';

test('lists are split on commas and spaces, without repeats', () => {
  assert.deepEqual(parseList(' policy.*, claim.decided  policy.* ,'), ['policy.*', 'claim.decided']);
  assert.deepEqual(parseList(''), []);
});

test('a subscription needs https, event types and markets', () => {
  const ok = { url: 'https://crm.example.com/hook', eventTypes: 'policy.*, claim.decided', markets: 'SE NO' };
  assert.deepEqual(subscriptionProblems(ok), []);
  assert.deepEqual(subscriptionBody(ok), { url: 'https://crm.example.com/hook', eventTypes: ['policy.*', 'claim.decided'], markets: ['SE', 'NO'] });
  assert.deepEqual(subscriptionBody({ ...ok, markets: '*', description: ' CRM ' }).markets, '*');
  assert.deepEqual(subscriptionProblems({ ...ok, url: 'http://crm.example.com' }), ['webhooks.needHttps']);
  assert.deepEqual(subscriptionProblems({ ...ok, url: 'http://localhost:4000/hook' }), [], 'a local receiver in development');
  assert.deepEqual(subscriptionProblems({ ...ok, eventTypes: 'Policy.Issued' }), ['webhooks.needTypes']);
  assert.deepEqual(subscriptionProblems({ ...ok, markets: 'se' }), ['webhooks.needMarkets']);
});

test('the flags of a notice that need a person', () => {
  assert.deepEqual(noticeFlags({ status: 'failed', overdue: true }), ['failed', 'overdue']);
  assert.deepEqual(noticeFlags({ status: 'pending', incomplete: ['review'] }), ['incomplete']);
  assert.deepEqual(noticeFlags({ status: 'sent', late: true, incomplete: ['review'] }), ['late']);
  assert.deepEqual(noticeFlags({ status: 'pending' }), []);
});
