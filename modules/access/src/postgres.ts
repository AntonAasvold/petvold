/**
 * RoleConfigStore against the schema `access` (migration 0009). Connect with
 * the service role `access_service`, which may only read and insert.
 */
import type pg from 'pg';
import { VersionConflictError, type RoleConfig, type RoleConfigStore, type RoleSet } from './index.ts';

const UNIQUE_VIOLATION = '23505';

export class PostgresRoleConfigStore<R extends RoleSet = RoleSet> implements RoleConfigStore<R> {
  constructor(private readonly pool: pg.Pool) {}

  async current(): Promise<RoleConfig<R> | null> {
    const { rows } = await this.pool.query(
      `select version, roles, changed_by, changed_at, reason from access.role_config order by version desc limit 1`,
    );
    return rows[0] ? toConfig<R>(rows[0]) : null;
  }

  async versions(): Promise<RoleConfig<R>[]> {
    const { rows } = await this.pool.query(`select version, roles, changed_by, changed_at, reason from access.role_config order by version`);
    return rows.map((r) => toConfig<R>(r));
  }

  async append(c: RoleConfig<R>): Promise<void> {
    // Inserts only if the version is exactly the next one. Two concurrent
    // appends of the same version clash on the primary key.
    const res = await this.pool
      .query(
        `insert into access.role_config (version, roles, changed_by, changed_at, reason)
         select $1, $2, $3, $4, $5
         where $1 = (select coalesce(max(version), 0) + 1 from access.role_config)`,
        [c.version, JSON.stringify(c.roles), c.changedBy, c.changedAt, c.reason],
      )
      .catch((e: { code?: string }) => {
        if (e.code === UNIQUE_VIOLATION) throw new VersionConflictError(`Version ${c.version} already exists`);
        throw e;
      });
    if (res.rowCount !== 1) throw new VersionConflictError(`Version ${c.version} is not the next version`);
  }
}

function toConfig<R extends RoleSet>(r: { version: number; roles: R; changed_by: string; changed_at: Date | string; reason: string }): RoleConfig<R> {
  return {
    version: r.version,
    roles: r.roles,
    changedBy: r.changed_by,
    changedAt: r.changed_at instanceof Date ? r.changed_at.toISOString() : new Date(r.changed_at).toISOString(),
    reason: r.reason,
  };
}
