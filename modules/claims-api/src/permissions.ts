/**
 * Permissions, roles and scope (ADR 0016).
 *
 * Each operation in the contract names one permission in `x-permission`.
 * Roles come from the caller's token and are mapped to permissions per
 * installation. No role grants everything.
 *
 * Scope decides which claims a caller may see at all. Every caller is limited
 * to its markets. A role can also bind the caller to its own clinic or to a
 * list of policies; the token must then carry that attribute. A claim outside
 * the scope answers 404, so its existence is not revealed.
 */

export const PERMISSIONS = [
  'claims:register',
  'claims:read',
  'claims:decide',
  /** Decide against the assessment's proposal (ADR 0018). Checked inside the decide operation. */
  'claims:override',
  'claims:reassess',
  /** Ask for a human review of an automated decision on the customer's behalf (ADR 0018). */
  'claims:request-review',
  'claims:preview',
  'limits:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** What a caller with the role is bound to, beyond its markets. */
export type Binding = 'clinic' | 'policies';

export interface RoleDefinition {
  permissions: readonly Permission[];
  /**
   * clinic: the caller sees only claims its own clinic submitted (token attribute clinicId).
   * policies: the caller sees only claims on the listed policies (token attribute policyIds),
   * e.g. a customer portal acting for a signed-in customer.
   */
  bindsTo?: Binding;
}

/** Role name -> definition. Configured per installation. */
export type RoleDefinitions = Record<string, RoleDefinition>;

/** The default roles Petvold ships with, as a starting point for an installation. */
export const DEFAULT_ROLES: RoleDefinitions = {
  handler: {
    permissions: [
      'claims:register',
      'claims:read',
      'claims:decide',
      'claims:override',
      'claims:reassess',
      'claims:request-review',
      'claims:preview',
      'limits:read',
    ],
  },
  approver: { permissions: ['claims:read', 'limits:read'] },
  clinic: { permissions: ['claims:register', 'claims:read', 'claims:preview'], bindsTo: 'clinic' },
  'reassessment-job': { permissions: ['claims:read', 'claims:reassess'] },
  /** The insurer's customer portal or app, acting for a signed-in customer. */
  'customer-channel': { permissions: ['claims:read', 'claims:request-review'], bindsTo: 'policies' },
};

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

/** Throws if a role names an unknown permission or binding. Run at start-up, so a typo never silently grants or denies. */
export function assertRoleDefinitions(roles: RoleDefinitions): void {
  for (const [role, def] of Object.entries(roles)) {
    if (!def || !Array.isArray(def.permissions)) throw new Error(`Role '${role}' has no permissions list`);
    for (const p of def.permissions) {
      if (!isPermission(p)) throw new Error(`Role '${role}' has an unknown permission '${String(p)}'`);
    }
    if (def.bindsTo !== undefined && def.bindsTo !== 'clinic' && def.bindsTo !== 'policies') {
      throw new Error(`Role '${role}' has an unknown binding '${String(def.bindsTo)}'`);
    }
  }
}

function known(roleNames: readonly string[], roles: RoleDefinitions): RoleDefinition[] {
  return roleNames.flatMap((r) => (Object.hasOwn(roles, r) ? [roles[r]!] : []));
}

/** The permissions a caller with these roles has. Unknown roles give nothing. */
export function permissionsOf(roleNames: readonly string[], roles: RoleDefinitions): Set<Permission> {
  return new Set(known(roleNames, roles).flatMap((d) => d.permissions));
}

/** The attributes in the caller's token that limit what it may see. */
export interface ScopeAttributes {
  /** Markets the caller works in, or '*' for every market in the installation. Missing = none. */
  markets?: readonly string[] | '*';
  clinicId?: string;
  policyIds?: readonly string[];
}

export interface Scope {
  markets: ReadonlySet<string> | '*';
  /** Set when a role binds the caller to its clinic. */
  clinicId?: string;
  /** Set when a role binds the caller to its policies. */
  policyIds?: ReadonlySet<string>;
}

/**
 * The caller's scope, or an error if a role binds the caller to an attribute
 * the token lacks. A binding from any role applies: the narrowest scope wins.
 */
export function scopeOf(roleNames: readonly string[], attrs: ScopeAttributes, roles: RoleDefinitions): Scope | { error: string } {
  const bindings = new Set(known(roleNames, roles).flatMap((d) => (d.bindsTo ? [d.bindsTo] : [])));
  let scope: Scope = { markets: attrs.markets === '*' ? '*' : new Set(attrs.markets ?? []) };
  if (bindings.has('clinic')) {
    if (!attrs.clinicId) return { error: 'The token lacks the clinic id the role requires' };
    scope = { ...scope, clinicId: attrs.clinicId };
  }
  if (bindings.has('policies')) {
    if (!attrs.policyIds) return { error: 'The token lacks the policy ids the role requires' };
    scope = { ...scope, policyIds: new Set(attrs.policyIds) };
  }
  return scope;
}

/** Whether the scope covers a market and policy, e.g. for a new claim or a limits lookup. */
export function coversPolicy(scope: Scope, market: string, policyId: string): boolean {
  return (scope.markets === '*' || scope.markets.has(market)) && (!scope.policyIds || scope.policyIds.has(policyId));
}

/** Whether the caller may see a stored claim. */
export function coversClaim(scope: Scope, claim: { market: string; policyId: string; clinicId?: string }): boolean {
  return coversPolicy(scope, claim.market, claim.policyId) && (!scope.clinicId || claim.clinicId === scope.clinicId);
}
