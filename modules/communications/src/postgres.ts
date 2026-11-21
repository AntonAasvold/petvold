/**
 * NoticeStore against the schema `communications` (migration 0031). Connect
 * with the service role `communications_service`: it may only insert and read,
 * so notices and deliveries never change.
 */
import type pg from 'pg';
import { NoticeConflictError, type Delivery, type NoticeDocument, type Notice, type NoticeEvent, type NoticeFilter, type NoticeSettings, type NoticeSettingsStore, type NoticeStore } from './index.ts';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

const NOTICE = `n.notice_id, n.type, n.schema, n.market, n.recipient_party_id, n.language, n.policy_id, n.application_id,
  n.source_event_id, n.source_event_type, n.source_occurred_at, n.legal_basis, n.due_by::text as due_by, n.content, n.settings_version, n.document_maker, n.created_at,
  (select json_build_object('id', x.document_id, 'sha256', x.sha256, 'madeBy', x.made_by, 'madeAt', x.made_at)
    from communications.notice_document x where x.notice_id = n.notice_id) as document,
  coalesce((select json_agg(json_build_object(
      'id', d.delivery_id, 'outcome', d.outcome, 'channel', d.channel, 'sentAt', d.sent_at, 'documentId', d.document_id,
      'sha256', d.sha256, 'reason', d.reason, 'reportedBy', d.reported_by, 'reportedAt', d.reported_at)
    order by d.reported_at, d.delivery_id)
    from communications.delivery d where d.notice_id = n.notice_id), '[]'::json) as deliveries`;

const iso = (t: unknown) => (t instanceof Date ? t.toISOString() : new Date(String(t)).toISOString());

export class PostgresNoticeStore implements NoticeStore {
  constructor(private readonly pool: pg.Pool) {}

  /** Runs fn in one transaction. */
  private async tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      const out = await fn(db);
      await db.query('commit');
      return out;
    } catch (e) {
      await db.query('rollback');
      throw e;
    } finally {
      db.release();
    }
  }

  async add(n: Notice, events: NoticeEvent[]): Promise<boolean> {
    return this.tx(async (db) => {
      const added = await this.insertNotice(db, n);
      if (added) await insertEvents(db, events);
      return added;
    });
  }

  private async insertNotice(db: pg.PoolClient, n: Notice): Promise<boolean> {
    const r = await db.query(
      `insert into communications.notice (notice_id, type, schema, market, recipient_party_id, language, policy_id, application_id,
         source_event_id, source_event_type, source_occurred_at, legal_basis, due_by, content, settings_version, document_maker, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       on conflict (source_event_id, type) do nothing`,
      [
        n.id,
        n.type,
        n.schema,
        n.market,
        n.recipientPartyId,
        n.language,
        n.policyId ?? null,
        n.applicationId ?? null,
        n.source.eventId,
        n.source.eventType,
        n.source.occurredAt,
        JSON.stringify(n.legalBasis),
        n.dueBy,
        JSON.stringify(n.content),
        n.settingsVersion ?? null,
        n.documentMaker ?? 'insurer',
        n.createdAt,
      ],
    );
    return r.rowCount === 1;
  }

  async get(id: string): Promise<Notice | null> {
    const r = await this.pool.query(`select ${NOTICE} from communications.notice n where n.notice_id = $1`, [id]);
    return r.rows[0] ? toNotice(r.rows[0]) : null;
  }

  async list(f: NoticeFilter): Promise<Notice[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    const eq = (column: string, value: string | undefined) => {
      if (value === undefined) return;
      args.push(value);
      where.push(`n.${column} = $${args.length}`);
    };
    eq('type', f.type);
    eq('market', f.market);
    eq('policy_id', f.policyId);
    eq('application_id', f.applicationId);
    eq('recipient_party_id', f.recipientPartyId);
    const sent = `exists (select 1 from communications.delivery d where d.notice_id = n.notice_id and d.outcome = 'sent')`;
    const any = `exists (select 1 from communications.delivery d where d.notice_id = n.notice_id)`;
    if (f.status === 'sent') where.push(sent);
    if (f.status === 'failed') where.push(`not ${sent} and ${any}`);
    if (f.status === 'pending') where.push(`not ${any}`);
    const r = await this.pool.query(
      `select ${NOTICE} from communications.notice n ${where.length ? `where ${where.join(' and ')}` : ''} order by n.created_at, n.notice_id`,
      args,
    );
    return r.rows.map(toNotice);
  }

  async addDelivery(noticeId: string, d: Delivery, events: NoticeEvent[]): Promise<void> {
    await this.tx(async (db) => {
      await db.query(
        `insert into communications.delivery (delivery_id, notice_id, outcome, channel, sent_at, document_id, sha256, reason, reported_by, reported_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [d.id, noticeId, d.outcome, d.channel ?? null, d.sentAt ?? null, d.documentId ?? null, d.sha256 ?? null, d.reason ?? null, d.reportedBy, d.reportedAt],
      );
      await insertEvents(db, events);
    })
      .catch((e: { code?: string; message?: string }) => {
        if (e.code === FOREIGN_KEY_VIOLATION) throw new NoticeConflictError(`Notice ${noticeId} does not exist`);
        if (e.code === UNIQUE_VIOLATION) throw new NoticeConflictError(`Delivery ${d.id} exists`);
        throw e;
      });
  }

  async addDocument(noticeId: string, doc: NoticeDocument, events: NoticeEvent[]): Promise<void> {
    await this.tx(async (db) => {
      await db.query(`insert into communications.notice_document (notice_id, document_id, sha256, made_by, made_at) values ($1, $2, $3, $4, $5)`, [
        noticeId,
        doc.id,
        doc.sha256,
        doc.madeBy,
        doc.madeAt,
      ]);
      await insertEvents(db, events);
    }).catch((e: { code?: string }) => {
      if (e.code === FOREIGN_KEY_VIOLATION) throw new NoticeConflictError(`Notice ${noticeId} does not exist`);
      if (e.code === UNIQUE_VIOLATION) throw new NoticeConflictError(`Notice ${noticeId} has its document already`);
      throw e;
    });
  }

  async pendingEvents(limit: number): Promise<NoticeEvent[]> {
    const { rows } = await this.pool.query(
      `select seq, event_id, type, notice_id, market, occurred_at, data from communications.outbox where published_at is null order by seq limit $1`,
      [limit],
    );
    return rows.map((r) => ({ id: r.event_id, type: r.type, noticeId: r.notice_id, market: r.market, occurredAt: iso(r.occurred_at), data: r.data, sequence: Number(r.seq) }));
  }

  async markPublished(ids: string[], at: string): Promise<void> {
    await this.pool.query(`update communications.outbox set published_at = $2 where event_id = any($1) and published_at is null`, [ids, at]);
  }
}

async function insertEvents(db: pg.PoolClient, events: NoticeEvent[]): Promise<void> {
  for (const e of events) {
    await db.query(`insert into communications.outbox (event_id, type, notice_id, market, occurred_at, data) values ($1, $2, $3, $4, $5, $6)`, [
      e.id,
      e.type,
      e.noticeId,
      e.market,
      e.occurredAt,
      JSON.stringify(e.data),
    ]);
  }
}

function toNotice(r: Record<string, any>): Notice {
  return {
    id: r.notice_id,
    type: r.type,
    schema: r.schema,
    market: r.market,
    recipientPartyId: r.recipient_party_id,
    language: r.language,
    ...(r.policy_id ? { policyId: r.policy_id } : {}),
    ...(r.application_id ? { applicationId: r.application_id } : {}),
    source: { eventId: r.source_event_id, eventType: r.source_event_type, occurredAt: iso(r.source_occurred_at) },
    legalBasis: r.legal_basis,
    dueBy: r.due_by,
    content: r.content,
    ...(r.settings_version === null ? {} : { settingsVersion: r.settings_version }),
    documentMaker: r.document_maker,
    ...(r.document ? { document: { id: r.document.id, sha256: r.document.sha256, madeBy: r.document.madeBy, madeAt: iso(r.document.madeAt) } } : {}),
    createdAt: iso(r.created_at),
    deliveries: (r.deliveries as Record<string, any>[]).map((d) => ({
      id: d.id,
      outcome: d.outcome,
      ...(d.channel ? { channel: d.channel } : {}),
      ...(d.sentAt ? { sentAt: iso(d.sentAt) } : {}),
      ...(d.documentId ? { documentId: d.documentId } : {}),
      ...(d.sha256 ? { sha256: d.sha256 } : {}),
      ...(d.reason ? { reason: d.reason } : {}),
      reportedBy: d.reportedBy,
      reportedAt: iso(d.reportedAt),
    })),
  };
}

/** The insurer's notice settings as versions (migration 0032). Append-only. */
export class PostgresNoticeSettingsStore implements NoticeSettingsStore {
  constructor(private readonly pool: pg.Pool) {}

  async current(): Promise<NoticeSettings | null> {
    const { rows } = await this.pool.query(`select * from communications.notice_settings order by version desc limit 1`);
    return rows[0] ? toSettings(rows[0]) : null;
  }

  async versions(): Promise<NoticeSettings[]> {
    const { rows } = await this.pool.query(`select * from communications.notice_settings order by version`);
    return rows.map(toSettings);
  }

  async append(s: NoticeSettings): Promise<void> {
    await this.pool
      .query(
        `insert into communications.notice_settings (version, markets, changed_by, changed_at, reason)
         select $1, $2, $3, $4, $5 where $1 = coalesce((select max(version) from communications.notice_settings), 0) + 1`,
        [s.version, JSON.stringify(s.markets), s.changedBy, s.changedAt, s.reason],
      )
      .then((r) => {
        if (r.rowCount !== 1) throw new NoticeConflictError(`Notice settings version ${s.version} is not the next`);
      })
      .catch((e: { code?: string }) => {
        if (e.code === UNIQUE_VIOLATION) throw new NoticeConflictError(`Notice settings version ${s.version} exists`);
        throw e;
      });
  }
}

function toSettings(r: Record<string, any>): NoticeSettings {
  return { version: r.version, markets: r.markets, changedBy: r.changed_by, changedAt: iso(r.changed_at), reason: r.reason };
}
