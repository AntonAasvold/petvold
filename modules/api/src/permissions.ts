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
  /** Approve or return another handler's decision proposal (ADR 0019). */
  'claims:approve',
  /** Ask for a human review of an automated decision on the customer's behalf (ADR 0018). */
  'claims:request-review',
  /** Ask the customer or the clinic for more information, and cancel such a request (ADR 0036). */
  'claims:request-information',
  'claims:preview',
  'limits:read',
  /** Read rule sets (ADR 0021). */
  'rules:read',
  /** Create and change drafts of rule sets, and submit them for review. */
  'rules:write',
  /** Publish, return or retire rule sets submitted by someone else (four eyes). */
  'rules:publish',
  /** Run a rule set against stored decisions. Shows claim data within the caller's scope. */
  'rules:simulate',
  /** Read reference data such as species and breeds (ADR 0022). Not sensitive. */
  'catalog:read',
  /** Create and change reference data and product drafts, and submit product versions for review. */
  'catalog:write',
  /** Publish or return product versions submitted by someone else (four eyes), and end their sales (ADR 0023). */
  'catalog:publish',
  /** Read the animal register: animals, identifiers and owners (ADR 0024). Personal data: owners are parties. */
  'animals:read',
  /** Register animals, correct their details, add identifiers and change owners. */
  'animals:write',
  /**
   * Look up an animal by identifier, e.g. a clinic reading a microchip (ADR 0025).
   * Finds only animals open for lookup, and shows no owners or change history.
   */
  'animals:lookup',
  /** Read persons and organizations (ADR 0026). Personal data; personal numbers are always masked. */
  'parties:read',
  /** Register persons and organizations, change their details and add identifiers. */
  'parties:write',
  /**
   * Data protection (ADR 0028): see restricted parties, register erasure requests,
   * reject them, and list them.
   */
  'parties:privacy',
  /** Approve an erasure request someone else made, which anonymizes the party, and change retention settings. */
  'parties:erase',
  /** Run retention: ask for anonymization of every party whose retention has ended (ADR 0028). */
  'parties:retention',
  /** Read policies, their terms and history (ADR 0029). */
  'policies:read',
  /** Get a price indication (ADR 0030). Stores nothing. */
  'policies:quote',
  /** Issue, renew and cancel policies, and reverse a cancellation. */
  'policies:write',
  /** Scheduled policy jobs: renew every policy up for renewal, and end the ones whose transfer was not accepted in time (ADR 0029). */
  'policies:renew',
  /** Set a premium other than the tariff's, with a reason (ADR 0030). The computed premium is kept next to it. */
  'policies:price-override',
  /** Decide on an application referred to a person: accept, with or without riders, or decline with a reason (ADR 0031). */
  'policies:underwrite',
  /** Read notices to the customer and their deliveries (ADR 0032). Notices hold party ids, not names or addresses. */
  'notices:read',
  /** Report that a notice was sent, with the document's id and checksum, or that it failed: the insurer's document system. */
  'notices:deliver',
  /** Change the insurer's notice settings: texts, days for "promptly" and optional types turned off (ADR 0032). */
  'notices:configure',
  /** Read webhook subscriptions and their deliveries (ADR 0033). Never the secrets. */
  'webhooks:read',
  /** Create and change webhook subscriptions, and rotate their secrets. */
  'webhooks:manage',
  /** See the runs, their history and the relay's dead letters (ADR 0037). */
  'jobs:read',
  /** Run a job now, pause and resume it, and send a dead letter again (ADR 0037). Takes effect at once. */
  'jobs:operate',
  /** Propose, approve and reject changes of a job's schedule, with four eyes (ADR 0037). */
  'jobs:configure',
  /** Read the role settings and their history (ADR 0020). */
  'access:read',
  /** Change the role settings, except roles the caller holds (ADR 0020). */
  'access:manage',
  /**
   * Read documents and open them through a short link (ADR 0038). Each document
   * also needs the right to what it belongs to: a claim, a policy or a notice.
   */
  'documents:read',
  /** Give the customer a link to a document, and revoke a link (ADR 0038). */
  'documents:share',
  /** Read payer accounts and premium plans (ADR 0040). */
  'billing:read',
  /** Match a payment that came in without a usable reference to a payer account (ADR 0040). */
  'billing:write',
  /** Read payments into and out of the insurer's accounts (ADR 0017, 0040). */
  'payments:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Not a permission but a marker in `x-permission`: any authenticated caller may
 * call the operation. Only for what concerns the caller itself, such as GET /v1/me.
 * No role can grant it, and it is never part of a role's permissions.
 */
export const SIGNED_IN = 'signed-in';

/** A valid `x-permission` value: a permission or SIGNED_IN. */
export function isOperationPermission(value: unknown): value is Permission | typeof SIGNED_IN {
  return value === SIGNED_IN || isPermission(value);
}

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
  /**
   * Highest payout per currency the role may decide alone (claims:decide, ADR 0019).
   * Above it, the decision becomes a proposal. Omitted: no limit. A currency
   * missing from the map has the limit 0.
   */
  decisionLimits?: Readonly<Record<string, number>>;
  /** Highest payout per currency the role may approve (claims:approve). Omitted: no limit. */
  approvalLimits?: Readonly<Record<string, number>>;
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
      'claims:request-information',
      'claims:preview',
      'limits:read',
      'documents:read',
      'catalog:read',
      'animals:read',
      'parties:read',
      'policies:read',
      'notices:read',
    ],
    // SEK 25,000 and EUR 2,500 alone; above that, someone with claims:approve approves.
    decisionLimits: { SEK: 2_500_000, EUR: 250_000 },
  },
  approver: { permissions: ['claims:read', 'claims:approve', 'limits:read', 'catalog:read', 'animals:read', 'parties:read', 'policies:read', 'documents:read'] },
  clinic: { permissions: ['claims:register', 'claims:read', 'claims:preview', 'catalog:read', 'animals:lookup', 'documents:read'], bindsTo: 'clinic' },
  'reassessment-job': { permissions: ['claims:read', 'claims:reassess'] },
  /** Writes rule set drafts and submits them for review. */
  'rules-author': { permissions: ['rules:read', 'rules:write', 'rules:simulate', 'catalog:read'] },
  /** Reviews and publishes rule sets. */
  'rules-publisher': { permissions: ['rules:read', 'rules:publish', 'rules:simulate', 'catalog:read'] },
  /** Registers animals and changes of owner, e.g. the insurer's back office or sales channel. */
  'animal-registrar': { permissions: ['animals:read', 'animals:write', 'catalog:read', 'parties:read'] },
  /** Registers persons and organizations and keeps their details up to date, e.g. customer service. */
  'party-registrar': { permissions: ['parties:read', 'parties:write'] },
  /** Issues policies, e.g. the insurer's sales channel or customer service (ADR 0029). */
  'policy-registrar': { permissions: ['policies:read', 'policies:write', 'policies:quote', 'animals:read', 'parties:read', 'catalog:read', 'notices:read', 'documents:read'] },
  /** The scheduled renewal run and expiry of transfers not accepted in time. */
  'renewal-job': { permissions: ['policies:renew'] },
  /** Decides on applications and prices that need a person, e.g. a manual premium (ADR 0030). */
  underwriter: {
    permissions: ['policies:read', 'policies:write', 'policies:quote', 'policies:price-override', 'policies:underwrite', 'animals:read', 'parties:read', 'catalog:read', 'notices:read', 'documents:read'],
  },
  /**
   * The insurer's document system (ADR 0032): reads the notices due, makes and sends
   * the documents with the recipient's name and address, and reports each delivery.
   */
  'document-service': { permissions: ['notices:read', 'notices:deliver', 'parties:read', 'policies:read', 'catalog:read', 'documents:read', 'documents:share'] },
  /** Connects the insurer's systems to Petvold's events with webhooks (ADR 0033). */
  'integration-admin': { permissions: ['webhooks:read', 'webhooks:manage'] },
  /** Writes the insurer's texts in notices and their settings, e.g. compliance or customer communications. */
  'communications-manager': { permissions: ['notices:read', 'notices:configure'] },
  /** Handles erasure and restriction of personal data (ADR 0028). Two people are needed to anonymize. */
  'privacy-officer': { permissions: ['parties:read', 'parties:privacy', 'parties:erase', 'parties:retention', 'documents:read'] },
  /** The scheduled retention run. Only asks; a privacy officer approves each request. */
  'retention-job': { permissions: ['parties:retention'] },
  /** Maintains reference data and writes product drafts. */
  'catalog-manager': { permissions: ['catalog:read', 'catalog:write'] },
  /** Reviews and publishes product versions. */
  'catalog-publisher': { permissions: ['catalog:read', 'catalog:publish'] },
  /** Manages roles and limits. No permissions in claims. */
  admin: { permissions: ['access:read', 'access:manage'] },
  /** Watches and steers Petvold's runs and the relay (ADR 0037), e.g. the operations team. */
  operations: { permissions: ['jobs:read', 'jobs:operate', 'jobs:configure', 'webhooks:read'] },
  /** The insurer's customer portal or app, acting for a signed-in customer. */
  'customer-channel': { permissions: ['claims:read', 'claims:request-review', 'catalog:read', 'policies:read', 'policies:quote', 'notices:read', 'documents:read', 'documents:share', 'billing:read'], bindsTo: 'policies' },
  /** Follows the premiums: payer accounts, premium plans and later invoices and payments (ADR 0040), e.g. the finance team. */
  'billing-clerk': { permissions: ['billing:read', 'billing:write', 'payments:read', 'policies:read', 'parties:read', 'catalog:read'] },
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
    for (const field of ['decisionLimits', 'approvalLimits'] as const) {
      for (const [currency, amount] of Object.entries(def[field] ?? {})) {
        if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Role '${role}' has ${field} for an invalid currency '${currency}'`);
        if (!Number.isSafeInteger(amount) || amount < 0) {
          throw new Error(`Role '${role}' has ${field}.${currency} that is not a non-negative integer`);
        }
      }
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

/**
 * The caller's amount limits for deciding or approving (ADR 0019): only roles
 * with the permission count, and the highest limit per currency wins. null means
 * no limit: some role with the permission has none. Callers without the
 * permission never reach the operation, so their limits do not matter.
 */
export function amountLimitsOf(roleNames: readonly string[], roles: RoleDefinitions, kind: 'decide' | 'approve'): Record<string, number> | null {
  const permission: Permission = kind === 'decide' ? 'claims:decide' : 'claims:approve';
  const field = kind === 'decide' ? 'decisionLimits' : 'approvalLimits';
  const defs = known(roleNames, roles).filter((d) => d.permissions.includes(permission));
  if (defs.length === 0 || defs.some((d) => !d[field])) return defs.length === 0 ? {} : null;
  const out: Record<string, number> = {};
  for (const d of defs) for (const [cur, amount] of Object.entries(d[field]!)) out[cur] = Math.max(out[cur] ?? 0, amount);
  return out;
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

export interface RoleSync {
  roles: RoleDefinitions;
  /** Default roles the installation did not have, added as they are. */
  addedRoles: string[];
  /** Permissions added to roles the installation already had. */
  addedPermissions: { role: string; permissions: Permission[] }[];
}

/**
 * Brings an installation's roles up to date with the defaults in a new Petvold
 * version: adds missing default roles and the default permissions an existing
 * role of the same name lacks. Never removes anything, and keeps bindings and
 * limits as they are. Note: a default permission the installation removed on
 * purpose comes back, so review the result before applying it. Pure.
 */
export function syncWithDefaults(current: RoleDefinitions, defaults: RoleDefinitions = DEFAULT_ROLES): RoleSync {
  const roles: RoleDefinitions = structuredClone(current);
  const addedRoles: string[] = [];
  const addedPermissions: RoleSync['addedPermissions'] = [];
  for (const [name, def] of Object.entries(defaults)) {
    const have = roles[name];
    if (!have) {
      roles[name] = structuredClone(def);
      addedRoles.push(name);
      continue;
    }
    const missing = def.permissions.filter((p) => !have.permissions.includes(p));
    if (missing.length) {
      roles[name] = { ...have, permissions: [...have.permissions, ...missing] };
      addedPermissions.push({ role: name, permissions: missing });
    }
  }
  return { roles, addedRoles, addedPermissions };
}
