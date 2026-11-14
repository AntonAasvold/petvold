/**
 * Role settings as versioned configuration (ADR 0020).
 *
 * The access module owns which permissions, bindings and amount limits each
 * role has in this installation. Every change is a new version with who, when
 * and why; nothing is overwritten. The module does not know the permissions
 * themselves: the caller supplies a validator (e.g. the api module's).
 */

/** The smallest shape a role set has: role name -> definition with permissions. */
export type RoleSet = Record<string, { permissions: readonly string[] }>;

export interface RoleConfig<R extends RoleSet = RoleSet> {
  /** 1, 2, 3 … Version 1 is created from the installation's defaults. */
  version: number;
  roles: R;
  changedBy: string;
  changedAt: string;
  reason: string;
}

/** Where the versions are kept. Postgres in production, in memory in tests. */
export interface RoleConfigStore<R extends RoleSet = RoleSet> {
  /** The latest version, or null before the first one is stored. */
  current(): Promise<RoleConfig<R> | null>;
  /** All versions, oldest first. */
  versions(): Promise<RoleConfig<R>[]>;
  /**
   * Appends a version. Throws VersionConflictError unless `config.version` is
   * exactly one more than the current version (1 when there is none).
   */
  append(config: RoleConfig<R>): Promise<void>;
}

export class VersionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VersionConflictError';
  }
}

export type AccessErrorCode = 'validation' | 'conflict' | 'forbidden';

export class AccessError extends Error {
  constructor(
    public readonly code: AccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccessError';
  }
}

export interface ChangeRolesCommand<R extends RoleSet> {
  roles: R;
  /** The version the change was made from. Another version in between gives 'conflict'. */
  basedOnVersion: number;
  changedBy: string;
  /** The roles of the one making the change. None of them may change. */
  callerRoles: readonly string[];
  reason: string;
}

export interface AccessServiceDeps<R extends RoleSet> {
  store: RoleConfigStore<R>;
  clock: { now(): string };
  /** Throws if the role set is invalid, e.g. an unknown permission. */
  validate(roles: R): void;
  /** Version 1, used the first time the installation starts. */
  defaults: R;
}

export class AccessService<R extends RoleSet = RoleSet> {
  constructor(private readonly d: AccessServiceDeps<R>) {}

  /** The role settings in force. Creates version 1 from the defaults if there is none. */
  async current(): Promise<RoleConfig<R>> {
    const now = await this.d.store.current();
    if (now) return now;
    this.d.validate(this.d.defaults);
    const first: RoleConfig<R> = {
      version: 1,
      roles: this.d.defaults,
      changedBy: 'petvold',
      changedAt: this.d.clock.now(),
      reason: 'Default roles at installation',
    };
    try {
      await this.d.store.append(first);
      return first;
    } catch (e) {
      // Another instance created version 1 at the same time.
      if (e instanceof VersionConflictError) return (await this.d.store.current())!;
      throw e;
    }
  }

  async versions(): Promise<RoleConfig<R>[]> {
    await this.current();
    return this.d.store.versions();
  }

  /** Stores a new version of the whole role set (ADR 0020). */
  async change(cmd: ChangeRolesCommand<R>): Promise<RoleConfig<R>> {
    const reason = cmd.reason.trim();
    if (!reason) throw new AccessError('validation', 'A change of the roles needs a reason');
    try {
      this.d.validate(cmd.roles);
    } catch (e) {
      throw new AccessError('validation', (e as Error).message);
    }
    const now = await this.current();
    if (cmd.basedOnVersion !== now.version) {
      throw new AccessError('conflict', `The roles have changed since version ${cmd.basedOnVersion}; the current version is ${now.version}`);
    }
    const touched = cmd.callerRoles.filter((r) => !sameDefinition(now.roles[r], cmd.roles[r]));
    if (touched.length) {
      throw new AccessError('forbidden', `You cannot change a role you hold yourself: ${touched.join(', ')}`);
    }
    const next: RoleConfig<R> = { version: now.version + 1, roles: cmd.roles, changedBy: cmd.changedBy, changedAt: this.d.clock.now(), reason };
    try {
      await this.d.store.append(next);
    } catch (e) {
      if (e instanceof VersionConflictError) throw new AccessError('conflict', 'Someone else changed the roles at the same time');
      throw e;
    }
    return next;
  }
}

function sameDefinition(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/** JSON with sorted keys, so that key order never counts as a change. */
function canonical(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** In-memory store, for tests and the dev server without a database. */
export class InMemoryRoleConfigStore<R extends RoleSet = RoleSet> implements RoleConfigStore<R> {
  private list: RoleConfig<R>[] = [];

  async current() {
    const last = this.list.at(-1);
    return last ? structuredClone(last) : null;
  }

  async versions() {
    return structuredClone(this.list);
  }

  async append(config: RoleConfig<R>) {
    const expected = (this.list.at(-1)?.version ?? 0) + 1;
    if (config.version !== expected) throw new VersionConflictError(`Expected version ${expected}, got ${config.version}`);
    this.list.push(structuredClone(config));
  }
}
