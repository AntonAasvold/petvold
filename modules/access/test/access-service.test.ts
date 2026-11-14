import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccessError, AccessService, InMemoryRoleConfigStore, type RoleSet } from '../src/index.ts';

type Roles = Record<string, { permissions: string[]; decisionLimits?: Record<string, number> }>;

const DEFAULTS: Roles = {
  admin: { permissions: ['access:manage'] },
  handler: { permissions: ['claims:decide'], decisionLimits: { SEK: 2_500_000 } },
};

function setup() {
  const store = new InMemoryRoleConfigStore<Roles>();
  const service = new AccessService<Roles>({
    store,
    clock: { now: () => '2026-11-14T12:00:00.000Z' },
    validate: (roles: RoleSet) => {
      for (const [name, def] of Object.entries(roles)) {
        if (def.permissions.some((p) => !p.includes(':'))) throw new Error(`Role '${name}' has an unknown permission`);
      }
    },
    defaults: DEFAULTS,
  });
  return { store, service };
}

const raise = (roles: Roles, sek: number): Roles => ({ ...roles, handler: { ...roles.handler!, decisionLimits: { SEK: sek } } });
const code = (c: AccessError['code']) => (e: unknown) => e instanceof AccessError && e.code === c;

test('the first read creates version 1 from the defaults', async () => {
  const { service, store } = setup();
  const v1 = await service.current();
  assert.equal(v1.version, 1);
  assert.deepEqual(v1.roles, DEFAULTS);
  assert.equal((await store.versions()).length, 1);
  assert.equal((await service.current()).version, 1, 'not created twice');
});

test('an admin raises the handler limit: a new version with who, when and why', async () => {
  const { service } = setup();
  const v1 = await service.current();
  const v2 = await service.change({ roles: raise(v1.roles, 5_000_000), basedOnVersion: 1, changedBy: 'admin@example.test', callerRoles: ['admin'], reason: ' New team lead ' });
  assert.deepEqual(
    { version: v2.version, limit: v2.roles.handler!.decisionLimits, by: v2.changedBy, reason: v2.reason },
    { version: 2, limit: { SEK: 5_000_000 }, by: 'admin@example.test', reason: 'New team lead' },
  );
  assert.deepEqual((await service.versions()).map((v) => v.version), [1, 2]);
  assert.equal((await service.versions())[0]!.roles.handler!.decisionLimits!.SEK, 2_500_000, 'history is kept');
});

test('nobody changes a role they hold: no raised own limit, no removed own admin role', async () => {
  const { service } = setup();
  const v1 = await service.current();
  await assert.rejects(
    service.change({ roles: raise(v1.roles, 99_000_000), basedOnVersion: 1, changedBy: 'h', callerRoles: ['handler', 'admin'], reason: 'x' }),
    code('forbidden'),
  );
  const { admin: _a, ...withoutAdmin } = v1.roles;
  await assert.rejects(
    service.change({ roles: withoutAdmin, basedOnVersion: 1, changedBy: 'a', callerRoles: ['admin'], reason: 'x' }),
    code('forbidden'),
  );
  assert.equal((await service.current()).version, 1);
});

test('key order is not a change', async () => {
  const { service } = setup();
  const v1 = await service.current();
  const reordered: Roles = { handler: { decisionLimits: { SEK: 2_500_000 }, permissions: ['claims:decide'] }, admin: { permissions: ['access:manage'] } };
  const v2 = await service.change({ roles: { ...reordered, viewer: { permissions: ['claims:read'] } }, basedOnVersion: 1, changedBy: 'a', callerRoles: ['admin', 'handler'], reason: 'Add viewer' });
  assert.equal(v2.version, 2);
});

test('a change based on an old version is refused', async () => {
  const { service } = setup();
  const v1 = await service.current();
  await service.change({ roles: raise(v1.roles, 3_000_000), basedOnVersion: 1, changedBy: 'a', callerRoles: ['admin'], reason: 'first' });
  await assert.rejects(
    service.change({ roles: raise(v1.roles, 4_000_000), basedOnVersion: 1, changedBy: 'b', callerRoles: ['admin'], reason: 'second' }),
    code('conflict'),
  );
});

test('an invalid role set or a missing reason is refused', async () => {
  const { service } = setup();
  const v1 = await service.current();
  await assert.rejects(
    service.change({ roles: { ...v1.roles, bad: { permissions: ['everything'] } }, basedOnVersion: 1, changedBy: 'a', callerRoles: ['admin'], reason: 'x' }),
    code('validation'),
  );
  await assert.rejects(service.change({ roles: v1.roles, basedOnVersion: 1, changedBy: 'a', callerRoles: ['admin'], reason: '  ' }), code('validation'));
});
