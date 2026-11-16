import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { templates } from '../src/locales/sv.ts';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

test('every text in the code has a Swedish translation, and every translation is used', () => {
  const src = new URL('../src', import.meta.url).pathname;
  const ids = new Set<string>();
  for (const f of files(src).filter((f) => f.endsWith('.ts') && !f.includes('locales'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\{ id: '([a-zA-Z0-9.:_-]+)' \}/g)) ids.add(m[1]!);
  }
  // Ids used indirectly, through permissions.ts.
  ids.add('nav.claims');
  assert.deepEqual([...ids].filter((id) => !(id in templates)).sort(), [], 'missing in sv.ts');
  assert.deepEqual(Object.keys(templates).filter((id) => !ids.has(id)).sort(), [], 'unused in sv.ts');
});
