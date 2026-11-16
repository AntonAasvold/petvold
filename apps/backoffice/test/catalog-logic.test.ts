import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lifecycleActions, nextProductVersion, parseJson } from '../src/catalog-logic.ts';

const me = (permissions: string[], subject = 'a@example.test') => ({ subject, roles: [], permissions, scope: { markets: '*' as const } });

test('what may be done with a version, with four eyes for publishing', () => {
  const author = me(['catalog:read', 'catalog:write']);
  const publisher = me(['catalog:read', 'catalog:publish'], 'p@example.test');
  assert.deepEqual(lifecycleActions('product', { status: 'draft' }, author), ['edit', 'submit', 'copy']);
  assert.deepEqual(lifecycleActions('product', { status: 'in_review', submittedBy: 'a@example.test' }, author), ['copy']);
  assert.deepEqual(lifecycleActions('product', { status: 'in_review', submittedBy: 'a@example.test' }, publisher), ['publish', 'return']);
  assert.deepEqual(lifecycleActions('product', { status: 'in_review', submittedBy: 'p@example.test' }, publisher), ['return'], 'not your own');
  assert.deepEqual(lifecycleActions('product', { status: 'published' }, publisher), ['end']);
  assert.deepEqual(lifecycleActions('rules', { status: 'published' }, me(['rules:publish'])), ['end']);
  assert.deepEqual(lifecycleActions('rules', { status: 'retired' }, me(['rules:read'])), []);
});

test('the content is a JSON object', () => {
  assert.deepEqual(parseJson('{"a":1}'), { ok: true, value: { a: 1 } });
  assert.equal(parseJson('[1]').ok, false);
  assert.equal(parseJson('{a:1}').ok, false);
});

test('the next product version follows the year', () => {
  assert.equal(nextProductVersion(['2026.1', '2026.2', '2025.4'], 2026), '2026.3');
  assert.equal(nextProductVersion(['2025.4'], 2026), '2026.1');
  assert.equal(nextProductVersion(['beta'], 2026), '2026.1');
});
