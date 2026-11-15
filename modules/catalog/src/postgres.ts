/**
 * ReferenceDataStore (migration 0013) and ProductStore (migration 0014) against the schema `catalog`.
 *
 * ReferenceDataStore: Connect
 * with the service role `catalog_service`, which may only read and insert:
 * every change is a new row, so the history cannot be rewritten.
 */
import type pg from 'pg';
import { ProductConflictError, ReferenceConflictError, type ProductStore, type ProductVersion, type ReferenceDataStore, type ReferenceItem, type ReferenceKind } from './index.ts';

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

const PRODUCT_COLUMNS = `product, version, status, content, sales_from::text as sales_from, sales_to::text as sales_to, checksum, revision,
  created_by, created_at, submitted_by, submitted_at, published_by, published_at, sales_ended_by, sales_ended_at, note`;

/** Connect with `catalog_service`. The database keeps published versions unchanged and one version on sale per product and day. */
export class PostgresProductStore implements ProductStore {
  constructor(private readonly pool: pg.Pool) {}

  async list(product: string): Promise<ProductVersion[]> {
    const { rows } = await this.pool.query(
      `select ${PRODUCT_COLUMNS} from catalog.product_version where product = $1 order by sales_from, version`,
      [product],
    );
    return rows.map(toProduct);
  }

  async get(product: string, version: string): Promise<ProductVersion | null> {
    const { rows } = await this.pool.query(`select ${PRODUCT_COLUMNS} from catalog.product_version where product = $1 and version = $2`, [
      product,
      version,
    ]);
    return rows[0] ? toProduct(rows[0]) : null;
  }

  async published(): Promise<ProductVersion[]> {
    const { rows } = await this.pool.query(
      `select ${PRODUCT_COLUMNS} from catalog.product_version where status = 'published' order by product, sales_from, version`,
    );
    return rows.map(toProduct);
  }

  async create(v: ProductVersion): Promise<void> {
    await this.pool
      .query(
        `insert into catalog.product_version (product, version, status, content, sales_from, sales_to, revision, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [v.product, v.version, v.status, JSON.stringify(v.content), v.salesFrom, v.salesTo ?? null, v.revision, v.createdBy, v.createdAt],
      )
      .catch((e: { code?: string }) => {
        if (e.code === UNIQUE_VIOLATION) throw new ProductConflictError(`${v.product}@${v.version} already exists`);
        throw e;
      });
  }

  async update(v: ProductVersion): Promise<void> {
    const res = await this.pool.query(
      `update catalog.product_version set
         status = $3, content = $4, sales_from = $5, sales_to = $6, checksum = $7, revision = $8,
         submitted_by = $9, submitted_at = $10, published_by = $11, published_at = $12,
         sales_ended_by = $13, sales_ended_at = $14, note = $15
       where product = $1 and version = $2 and revision = $8 - 1`,
      [
        v.product,
        v.version,
        v.status,
        JSON.stringify(v.content),
        v.salesFrom,
        v.salesTo ?? null,
        v.checksum ?? null,
        v.revision,
        v.submittedBy ?? null,
        v.submittedAt ?? null,
        v.publishedBy ?? null,
        v.publishedAt ?? null,
        v.salesEndedBy ?? null,
        v.salesEndedAt ?? null,
        v.note ?? null,
      ],
    );
    if (res.rowCount !== 1) throw new ProductConflictError(`${v.product}@${v.version} has changed`);
  }
}

function toProduct(r: Record<string, any>): ProductVersion {
  const opt = (key: string, value: unknown) => (value === null || value === undefined ? {} : { [key]: value });
  const iso = (d: Date | string | null) => (d === null ? undefined : new Date(d).toISOString());
  return {
    product: r.product,
    version: r.version,
    status: r.status,
    content: r.content,
    salesFrom: r.sales_from,
    ...opt('salesTo', r.sales_to),
    ...opt('checksum', r.checksum),
    revision: r.revision,
    createdBy: r.created_by,
    createdAt: iso(r.created_at)!,
    ...opt('submittedBy', r.submitted_by),
    ...opt('submittedAt', iso(r.submitted_at)),
    ...opt('publishedBy', r.published_by),
    ...opt('publishedAt', iso(r.published_at)),
    ...opt('salesEndedBy', r.sales_ended_by),
    ...opt('salesEndedAt', iso(r.sales_ended_at)),
    ...opt('note', r.note),
  } as ProductVersion;
}
