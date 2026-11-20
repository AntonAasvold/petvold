/**
 * The documents' records in the schema `documents` (migration 0046), with the
 * service role documents_service. The files are in the archive (s3.ts).
 */
import pg from 'pg';
import { DocumentConflictError, type DocumentFilter, type DocumentLink, type DocumentStore, type StoredDocument, type Timestamp } from './index.ts';

const iso = (v: Date | string | null) => (v === null ? undefined : new Date(v).toISOString());

const DOC = `id, kind, media_type, size_bytes, sha256, filename, owner_claim_id, owner_policy_id, owner_notice_id, party_ids, market, created_by, created_at, erased_at`;

function toDocument(r: Record<string, any>): StoredDocument {
  return {
    id: r.id,
    kind: r.kind,
    mediaType: r.media_type,
    size: Number(r.size_bytes),
    sha256: r.sha256,
    ...(r.filename === null ? {} : { filename: r.filename }),
    owner: {
      ...(r.owner_claim_id === null ? {} : { claimId: r.owner_claim_id }),
      ...(r.owner_policy_id === null ? {} : { policyId: r.owner_policy_id }),
      ...(r.owner_notice_id === null ? {} : { noticeId: r.owner_notice_id }),
    },
    partyIds: r.party_ids,
    market: r.market,
    createdBy: r.created_by,
    createdAt: iso(r.created_at)!,
    ...(r.erased_at === null ? {} : { erasedAt: iso(r.erased_at) }),
  };
}

export class PostgresDocumentStore implements DocumentStore {
  constructor(private readonly pool: pg.Pool) {}

  async save(d: StoredDocument): Promise<void> {
    await this.pool
      .query(
        `insert into documents.document (id, kind, media_type, size_bytes, sha256, filename, owner_claim_id, owner_policy_id, owner_notice_id, party_ids, market, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [d.id, d.kind, d.mediaType, d.size, d.sha256, d.filename ?? null, d.owner.claimId ?? null, d.owner.policyId ?? null, d.owner.noticeId ?? null, d.partyIds, d.market, d.createdBy, d.createdAt],
      )
      .catch((e: { code?: string }) => {
        if (e.code === '23505') throw new DocumentConflictError(`Document ${d.id} exists`);
        throw e;
      });
  }

  async get(id: string): Promise<StoredDocument | null> {
    const { rows } = await this.pool.query(`select ${DOC} from documents.document where id = $1`, [id]);
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async list(f: DocumentFilter): Promise<StoredDocument[]> {
    const { rows } = await this.pool.query(
      `select ${DOC} from documents.document
       where ($1::text is null or party_ids @> array[$1::text])
         and ($2::text is null or owner_claim_id = $2)
         and ($3::text is null or owner_policy_id = $3)
       order by created_at desc, id desc`,
      [f.partyId ?? null, f.claimId ?? null, f.policyId ?? null],
    );
    return rows.map(toDocument);
  }

  async saveLink(l: DocumentLink): Promise<void> {
    await this.pool.query(
      `insert into documents.link (id, document_id, audience, created_by, created_at, expires_at) values ($1, $2, $3, $4, $5, $6)`,
      [l.id, l.documentId, l.audience, l.createdBy, l.createdAt, l.expiresAt],
    );
  }

  async getLink(id: string): Promise<DocumentLink | null> {
    return (await this.linksWhere('l.id = $1', [id]))[0] ?? null;
  }

  links(documentId: string): Promise<DocumentLink[]> {
    return this.linksWhere('l.document_id = $1', [documentId]);
  }

  async revokeLink(id: string, by: string, at: Timestamp): Promise<void> {
    const r = await this.pool.query(`update documents.link set revoked_by = $2, revoked_at = $3 where id = $1 and revoked_at is null`, [id, by, at]);
    if (r.rowCount !== 1) {
      if (await this.getLink(id)) throw new DocumentConflictError(`Link ${id} is revoked already`);
      throw new Error(`Link ${id} does not exist`);
    }
  }

  async logAccess(linkId: string, at: Timestamp): Promise<void> {
    await this.pool.query(`insert into documents.link_access (link_id, opened_at) values ($1, $2)`, [linkId, at]);
  }

  private async linksWhere(where: string, params: unknown[]): Promise<DocumentLink[]> {
    const { rows } = await this.pool.query(
      `select l.id, l.document_id, l.audience, l.created_by, l.created_at, l.expires_at, l.revoked_by, l.revoked_at,
              coalesce((select array_agg(a.opened_at order by a.seq) from documents.link_access a where a.link_id = l.id), '{}') as accesses
       from documents.link l where ${where}
       order by l.created_at desc, l.id desc`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      audience: r.audience,
      createdBy: r.created_by,
      createdAt: iso(r.created_at)!,
      expiresAt: iso(r.expires_at)!,
      ...(r.revoked_at === null ? {} : { revokedBy: r.revoked_by, revokedAt: iso(r.revoked_at) }),
      accesses: (r.accesses as (Date | string)[]).map((a) => iso(a)!),
    }));
  }
}
