/**
 * RuleSetStore against the schema `decisioning` (migration 0011). Connect with
 * the service role `decisioning_service`. The database keeps published
 * versions unchanged and allows one published version per series and date.
 */
import type pg from 'pg';
import { RuleSetConflictError, type RuleSetStore, type RuleSetVersion } from './index.ts';

const UNIQUE_VIOLATION = '23505';
const COLUMNS = `series, version, status, content, calculation_model, effective_from::text as effective_from, checksum, revision,
  created_by, created_at, submitted_by, submitted_at, published_by, published_at, retired_by, retired_at, note`;

export class PostgresRuleSetStore implements RuleSetStore {
  constructor(private readonly pool: pg.Pool) {}

  async list(series: string): Promise<RuleSetVersion[]> {
    const { rows } = await this.pool.query(`select ${COLUMNS} from decisioning.rule_set_version where series = $1 order by version`, [series]);
    return rows.map(toVersion);
  }

  async seriesNames(): Promise<string[]> {
    const { rows } = await this.pool.query(`select distinct series from decisioning.rule_set_version order by series`);
    return rows.map((r) => r.series);
  }

  async get(series: string, version: number): Promise<RuleSetVersion | null> {
    const { rows } = await this.pool.query(`select ${COLUMNS} from decisioning.rule_set_version where series = $1 and version = $2`, [
      series,
      version,
    ]);
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async create(v: RuleSetVersion): Promise<void> {
    const res = await this.pool
      .query(
        `insert into decisioning.rule_set_version (series, version, status, content, calculation_model, effective_from, revision, created_by, created_at)
         select $1, $2, $3, $4, $5, $6, $7, $8, $9
         where $2 = (select coalesce(max(version), 0) + 1 from decisioning.rule_set_version where series = $1)`,
        [v.series, v.version, v.status, JSON.stringify(v.content), v.calculationModel, v.effectiveFrom, v.revision, v.createdBy, v.createdAt],
      )
      .catch(conflict);
    if (res.rowCount !== 1) throw new RuleSetConflictError(`${v.series}@${v.version} is not the next version`);
  }

  async update(v: RuleSetVersion): Promise<void> {
    const res = await this.pool
      .query(
        `update decisioning.rule_set_version set
           status = $3, content = $4, calculation_model = $5, effective_from = $6, checksum = $7, revision = $8,
           submitted_by = $9, submitted_at = $10, published_by = $11, published_at = $12, retired_by = $13, retired_at = $14, note = $15
         where series = $1 and version = $2 and revision = $8 - 1`,
        [
          v.series,
          v.version,
          v.status,
          JSON.stringify(v.content),
          v.calculationModel,
          v.effectiveFrom,
          v.checksum ?? null,
          v.revision,
          v.submittedBy ?? null,
          v.submittedAt ?? null,
          v.publishedBy ?? null,
          v.publishedAt ?? null,
          v.retiredBy ?? null,
          v.retiredAt ?? null,
          v.note ?? null,
        ],
      )
      .catch(conflict);
    if (res.rowCount !== 1) throw new RuleSetConflictError(`Rule set ${v.series}@${v.version} has changed`);
  }
}

function conflict(e: { code?: string; constraint?: string; message?: string }): never {
  if (e.code === UNIQUE_VIOLATION) throw new RuleSetConflictError(e.constraint === 'rule_set_one_published_per_date'
    ? 'Another published version applies from the same date'
    : (e.message ?? 'Conflict'));
  throw e;
}

const iso = (d: Date | string | null) => (d === null ? undefined : new Date(d).toISOString());

function toVersion(r: Record<string, any>): RuleSetVersion {
  const opt = <K extends string>(key: K, value: unknown) => (value === null || value === undefined ? {} : { [key]: value });
  return {
    series: r.series,
    version: r.version,
    status: r.status,
    content: r.content,
    calculationModel: r.calculation_model,
    effectiveFrom: r.effective_from,
    ...opt('checksum', r.checksum),
    revision: r.revision,
    createdBy: r.created_by,
    createdAt: iso(r.created_at)!,
    ...opt('submittedBy', r.submitted_by),
    ...opt('submittedAt', iso(r.submitted_at)),
    ...opt('publishedBy', r.published_by),
    ...opt('publishedAt', iso(r.published_at)),
    ...opt('retiredBy', r.retired_by),
    ...opt('retiredAt', iso(r.retired_at)),
    ...opt('note', r.note),
  } as RuleSetVersion;
}
