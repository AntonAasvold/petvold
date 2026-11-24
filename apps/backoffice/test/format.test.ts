import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatMoney } from '../src/format.ts';
import { move } from '../src/grid-keys.ts';
import { append, emptyPager, hasMore } from '../src/pager.ts';
import { sectionsFor } from '../src/permissions.ts';

const nbsp = (s: string) => s.replace(/ | /g, ' ');

test('amounts in minor units follow the locale and the currency', () => {
  assert.equal(nbsp(formatMoney(150_000, 'SEK', 'sv')), '1 500 kr', 'whole kronor without the minor unit in Swedish');
  assert.equal(nbsp(formatMoney(150_050, 'SEK', 'sv')), '1 500,50 kr');
  assert.equal(nbsp(formatMoney(150_000, 'SEK', 'en')), 'SEK 1,500.00');
  assert.equal(nbsp(formatMoney(150_000, 'EUR', 'en')), '€1,500.00');
  assert.equal(nbsp(formatMoney(1500, 'JPY', 'en')), '¥1,500', 'a currency without minor units');
});

test('a calendar date is the same date everywhere', () => {
  assert.equal(formatDate('2026-11-16', 'sv'), '16 nov. 2026');
  assert.equal(formatDate('2026-01-01', 'en'), 'Jan 1, 2026');
});

test('the grid moves within its bounds and activates a row with Enter', () => {
  const size = { rows: 3, cols: 4 };
  assert.deepEqual(move({ row: 0, col: 0 }, 'ArrowDown', size), { to: { row: 1, col: 0 } });
  assert.deepEqual(move({ row: 2, col: 0 }, 'ArrowDown', size), { to: { row: 2, col: 0 } });
  assert.deepEqual(move({ row: 1, col: 1 }, 'End', size), { to: { row: 1, col: 3 } });
  assert.deepEqual(move({ row: 1, col: 1 }, 'Home', size, { ctrl: true }), { to: { row: 0, col: 0 } });
  assert.deepEqual(move({ row: 0, col: 2 }, 'PageDown', size), { to: { row: 2, col: 2 } });
  assert.deepEqual(move({ row: 1, col: 2 }, 'Enter', size), { activate: 1 });
  assert.equal(move({ row: 0, col: 0 }, 'x', size), null);
  assert.equal(move({ row: 0, col: 0 }, 'ArrowDown', { rows: 0, cols: 4 }), null);
});

test('a list grows a page at a time with the cursor', () => {
  let p = emptyPager<number>();
  assert.equal(hasMore(p), true, 'nothing loaded yet');
  p = append(p, { items: [1, 2], nextCursor: 'c1' });
  assert.deepEqual([p.items, p.next, hasMore(p)], [[1, 2], 'c1', true]);
  p = append(p, { items: [3] });
  assert.deepEqual([p.items, p.next, hasMore(p)], [[1, 2, 3], undefined, false]);
});

test('sections follow the permissions from /v1/me; the documentation is there for everyone signed in', () => {
  const me = (permissions: string[]) => ({ subject: 's', roles: [], permissions, scope: { markets: '*' as const } });
  const paths = (permissions: string[]) => sectionsFor(me(permissions)).map((s) => s.path).filter((p) => p !== '/docs');
  assert.deepEqual(paths(['claims:read']), ['/claims']);
  assert.deepEqual(paths(['policies:read']), ['/policies', '/applications', '/proposals']);
  assert.deepEqual(paths(['notices:read']), ['/notices', '/settings']);
  assert.deepEqual(paths(['access:read']), ['/settings']);
  assert.deepEqual(paths(['catalog:read']), ['/products']);
  assert.deepEqual(sectionsFor(me(['limits:read'])).map((s) => s.path), ['/docs']);
  assert.deepEqual(sectionsFor(null), []);
});

test('the menu counts a page of waiting items', async () => {
  const { countLabel, SECTIONS } = await import('../src/permissions.ts');
  assert.equal(countLabel({ items: [1, 2, 3] }), '3');
  assert.equal(countLabel({ items: new Array(100).fill(0), nextCursor: 'c' }), '100+');
  assert.deepEqual(SECTIONS.filter((s) => s.count).map((s) => s.path), ['/claims', '/erasures', '/applications', '/proposals', '/notices', '/money', '/webhooks', '/jobs']);
});
