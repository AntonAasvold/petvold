/**
 * Permissions and roles (ADR 0016).
 *
 * Each operation in the contract names one permission in `x-permission`.
 * Roles come from the caller's token and are mapped to permissions per
 * installation. No role grants everything.
 */

export const PERMISSIONS = [
  'claims:register',
  'claims:read',
  'claims:decide',
  'claims:reassess',
  'claims:preview',
  'limits:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Role name -> permissions. Configured per installation. */
export type RolePermissions = Record<string, readonly Permission[]>;

/** The default roles Petvold ships with, as a starting point for an installation. */
export const DEFAULT_ROLES: RolePermissions = {
  handler: ['claims:register', 'claims:read', 'claims:decide', 'claims:reassess', 'claims:preview', 'limits:read'],
  approver: ['claims:read', 'limits:read'],
  clinic: ['claims:register', 'claims:read', 'claims:preview'],
  'reassessment-job': ['claims:read', 'claims:reassess'],
};

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

/** Throws if a role names an unknown permission. Run at start-up, so a typo never silently grants or denies. */
export function assertRolePermissions(roles: RolePermissions): void {
  for (const [role, perms] of Object.entries(roles)) {
    for (const p of perms) {
      if (!isPermission(p)) throw new Error(`Role '${role}' has an unknown permission '${String(p)}'`);
    }
  }
}

/** The permissions a caller with these roles has. Unknown roles give nothing. */
export function permissionsOf(roleNames: readonly string[], roles: RolePermissions): Set<Permission> {
  return new Set(roleNames.flatMap((r) => (Object.hasOwn(roles, r) ? roles[r]! : [])));
}
