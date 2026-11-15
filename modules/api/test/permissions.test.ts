/** Bringing stored roles up to date with the defaults (npm run roles:sync). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROLES, assertRoleDefinitions, syncWithDefaults, type RoleDefinitions } from '../src/permissions.ts';

test('missing default roles and permissions are added; nothing is removed and limits stay', () => {
  const stored: RoleDefinitions = {
    handler: { permissions: ['claims:read', 'claims:decide'], decisionLimits: { SEK: 1_000_000 } },
    clinic: { permissions: ['claims:register'], bindsTo: 'clinic' },
    'own-role': { permissions: ['claims:read'] },
  };
  const sync = syncWithDefaults(stored);
  assertRoleDefinitions(sync.roles);
  assert.deepEqual(sync.roles['own-role'], stored['own-role']);
  assert.deepEqual(sync.roles.handler!.decisionLimits, { SEK: 1_000_000 });
  assert.equal(sync.roles.clinic!.bindsTo, 'clinic');
  assert.deepEqual(sync.roles.handler!.permissions.slice(0, 2), ['claims:read', 'claims:decide']);
  assert.ok(DEFAULT_ROLES.handler!.permissions.every((p) => sync.roles.handler!.permissions.includes(p)));
  assert.deepEqual(sync.addedPermissions.find((a) => a.role === 'clinic')?.permissions, ['claims:read', 'claims:preview', 'catalog:read', 'animals:lookup']);
  assert.ok(sync.addedRoles.includes('privacy-officer'));
  assert.ok(!sync.addedRoles.includes('handler'));
  assert.deepEqual(stored.handler!.permissions, ['claims:read', 'claims:decide']); // input untouched
});

test('roles already up to date give no change', () => {
  const sync = syncWithDefaults(structuredClone(DEFAULT_ROLES));
  assert.deepEqual([sync.addedRoles, sync.addedPermissions], [[], []]);
  assert.deepEqual(sync.roles, DEFAULT_ROLES);
});
