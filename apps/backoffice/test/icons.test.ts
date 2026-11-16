import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const list = JSON.parse(readFileSync(new URL('../icons.json', import.meta.url), 'utf8')) as { solid: string[]; regular: string[] };

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

test('every icon the code names is in icons.json, so it is copied and never fetched from a CDN', () => {
  const src = new URL('../src', import.meta.url).pathname;
  const used = new Set<string>();
  for (const f of files(src).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/<wa-icon[^>]*\\sname="([a-z0-9-]+)"/g)) used.add(m[1]!);
    for (const m of text.matchAll(/icon: '([a-z0-9-]+)'/g)) used.add(m[1]!);
  }
  const missing = [...used].filter((n) => !list.solid.includes(n) && !list.regular.includes(n));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 0);
});
