/** The demo's fixed tokens (ADR 0041). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_TOKENS, demoAuthenticator } from '../src/demo-tokens.ts';
import { DEFAULT_ROLES } from '../src/permissions.ts';

test('every demo token has roles that exist, and nothing else signs in', async () => {
  for (const [token, p] of Object.entries(DEMO_TOKENS)) {
    assert.ok(p.roles.length > 0, token);
    for (const r of p.roles) assert.ok(DEFAULT_ROLES[r], `${token}: ${r}`);
  }
  const auth = demoAuthenticator();
  assert.equal((await auth.authenticate('dev-all'))?.subject, 'all-a@example.test');
  assert.equal(await auth.authenticate('dev-nobody'), null);
  assert.equal(await auth.authenticate(undefined), null);
  assert.equal(await auth.authenticate('constructor'), null);
});
