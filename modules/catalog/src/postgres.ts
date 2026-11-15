/**
 * ReferenceDataStore against the schema `catalog` (migration 0013). Connect
 * with the service role `catalog_service`, which may only read and insert:
 * every change is a new row, so the history cannot be rewritten.
 */
import type pg from 'pg';
import { ReferenceConflictError, type ReferenceDataStore, type ReferenceItem, type ReferenceKind } from './index.ts';

const UNIQUE_VIOLATION = '23505';
const COLUMNS = 'kind, code, revision, parent, labels, active, changed_by, changed_at, reason';

export class PostgresReferenceDataStore implements ReferenceDataStore {
  constructor(private readonly pool: pg.Pool) {}

  async list(kind: ReferenceKind): Promise<ReferenceItem[]> {
    const { rows } = await this.pool.query(
      `select distinct on (code) ${COLUMNS} from catalog.reference_item where kind = $1 order by code, revision desc`,
      [kind],
    );
    return rows.map(toItem);
  }

  async get(kind: ReferenceKind, code: string): Promise<ReferenceItem | null> {
    const { rows } = await this.pool.query(
      `select ${COLUMNS} from catalog.reference_item where kind = $1 and code = $2 order by revision desc limit 1`,
      [kind, code],
    );
    return rows[0] ? toItem(rows[0]) : null;
  }

  async history(kind: ReferenceKind, code: string): Promise<ReferenceItem[]> {
    const { rows } = await this.pool.query(`select ${COLUMNS} from catalog.reference_item where kind = $1 and code = $2 order by revision`, [
      kind,
      code,
    ]);
    return rows.map(toItem);
  }

  async append(i: ReferenceItem): Promise<void> {
    const res = await this.pool
      .query(
        `insert into catalog.reference_item (${COLUMNS})
         select $1, $2, $3, $4, $5, $6, $7, $8, $9
         where $3 = (select coalesce(max(revision), 0) + 1 from catalog.reference_item where kind = $1 and code = $2)`,
        [i.kind, i.code, i.revision, i.parent ?? null, JSON.stringify(i.labels), i.active, i.changedBy, i.changedAt, i.reason ?? null],
      )
      .catch((e: { code?: string; message?: string }) => {
        if (e.code === UNIQUE_VIOLATION) throw new ReferenceConflictError(`${i.kind} '${i.code}' has changed`);
        throw e;
      });
    if (res.rowCount !== 1) throw new ReferenceConflictError(`Revision ${i.revision} is not the next revision of ${i.kind} '${i.code}'`);
  }
}

function toItem(r: Record<string, any>): ReferenceItem {
  return {
    kind: r.kind,
    code: r.code,
    ...(r.parent === null ? {} : { parent: r.parent }),
    labels: r.labels,
    active: r.active,
    revision: r.revision,
    changedBy: r.changed_by,
    changedAt: new Date(r.changed_at).toISOString(),
    ...(r.reason === null ? {} : { reason: r.reason }),
  };
}
