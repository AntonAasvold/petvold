/**
 * Brings the stored role settings up to date with Petvold's default roles
 * (ADR 0020): adds missing roles and missing default permissions as a new
 * version with a reason. Never removes anything.
 *
 * Shows the change by default; applies it only with --apply. A default
 * permission the installation removed on purpose comes back, so read the list.
 *
 * Usage: npm run roles:sync [-- --apply]   (uses ACCESS_DATABASE_URL)
 */
import pg from 'pg';
import { AccessService } from '@petvold/access';
import { PostgresRoleConfigStore } from '@petvold/access/postgres';
import { DEFAULT_ROLES, assertRoleDefinitions, syncWithDefaults, type RoleDefinitions } from '../src/permissions.ts';

const url = process.env.ACCESS_DATABASE_URL;
if (!url) throw new Error('ACCESS_DATABASE_URL is missing');
const apply = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const store = new PostgresRoleConfigStore<RoleDefinitions>(pool);
  const current = await store.current();
  if (!current) {
    console.log('No stored role settings: version 1 is created from the defaults when Petvold starts.');
  } else {
    const sync = syncWithDefaults(current.roles);
    const lines = [
      ...sync.addedRoles.map((r) => `  + role ${r}: ${DEFAULT_ROLES[r]!.permissions.join(', ')}`),
      ...sync.addedPermissions.map((a) => `  + ${a.role}: ${a.permissions.join(', ')}`),
    ];
    if (!lines.length) {
      console.log(`OK – version ${current.version} already has every default role and permission`);
    } else {
      console.log(`Changes to version ${current.version}:\n${lines.join('\n')}`);
      if (!apply) {
        console.log('Nothing stored. Run again with --apply to store them as a new version.');
      } else {
        const access = new AccessService<RoleDefinitions>({
          store,
          clock: { now: () => new Date().toISOString() },
          validate: assertRoleDefinitions,
          defaults: DEFAULT_ROLES,
        });
        const next = await access.change({
          roles: sync.roles,
          basedOnVersion: current.version,
          changedBy: 'roles-sync',
          callerRoles: [],
          reason: `Default roles and permissions from Petvold: ${[...sync.addedRoles.map((r) => `role ${r}`), ...sync.addedPermissions.map((a) => `${a.role} (${a.permissions.join(', ')})`)].join('; ')}`,
        });
        console.log(`OK – stored as version ${next.version}`);
      }
    }
  }
} finally {
  await pool.end();
}
