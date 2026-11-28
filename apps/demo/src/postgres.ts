/**
 * The demo's storage in its own database, petvold_demo (db/migrations here),
 * never Petvold's.
 */
import pg from 'pg';
import type { CloudEvent } from './cloud-event.ts';
import { typePattern } from './cloud-event.ts';
import type { Counts, Delivery, EventFilter, Rejected, Store, StoredEvent } from './store.ts';

type EventRow = { id: string; seq: string; body: CloudEvent; received_at: Date; deliveries: string };

const toStored = (r: EventRow): StoredEvent => ({ id: r.id, seq: Number(r.seq), event: r.body, receivedAt: r.received_at.toISOString(), deliveries: Number(r.deliveries) });

export class PostgresStore implements Store {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }

  async receive(event: CloudEvent, delivery: Delivery) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query(
        `insert into event (id, type, source, subject, market, occurred_at, sequence, body, received_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do nothing`,
        [event.id, event.type, event.source, event.subject, event.market, event.time, event.sequence ?? null, JSON.stringify(event), delivery.receivedAt],
      );
      await client.query('insert into delivery (webhook_id, event_id, received_at, headers) values ($1, $2, $3, $4)', [delivery.webhookId, event.id, delivery.receivedAt, JSON.stringify(delivery.headers)]);
      await client.query('commit');
      return { duplicate: inserted.rowCount === 0 };
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  async reject(r: Omit<Rejected, 'id'>) {
    await this.pool.query('insert into rejected (webhook_id, received_at, reason, headers, body) values ($1, $2, $3, $4, $5)', [r.webhookId, r.receivedAt, r.reason, JSON.stringify(r.headers), r.body]);
  }

  async events(f: EventFilter, limit: number, offset: number) {
    const where: string[] = [];
    const args: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      args.push(v);
      where.push(sql.replace('?', `$${args.length}`));
    };
    if (f.type) add('e.type like ?', typePattern(f.type));
    if (f.market) add('e.market = ?', f.market);
    if (f.subject) add('e.subject = ?', f.subject);
    if (f.from) add('e.occurred_at >= ?', f.from);
    if (f.to) add('e.occurred_at < ?', f.to);
    args.push(limit, offset);
    const { rows } = await this.pool.query<EventRow>(
      `select e.id, e.seq, e.body, e.received_at, (select count(*) from delivery d where d.event_id = e.id) as deliveries
       from event e ${where.length ? `where ${where.join(' and ')}` : ''}
       order by e.occurred_at desc, e.seq desc limit $${args.length - 1} offset $${args.length}`,
      args,
    );
    return rows.map(toStored);
  }

  async event(id: string) {
    const { rows } = await this.pool.query<EventRow>(
      'select e.id, e.seq, e.body, e.received_at, (select count(*) from delivery d where d.event_id = e.id) as deliveries from event e where e.id = $1',
      [id],
    );
    if (!rows[0]) return null;
    const d = await this.pool.query<{ webhook_id: string; received_at: Date; headers: Record<string, string> }>('select webhook_id, received_at, headers from delivery where event_id = $1 order by id', [id]);
    return { stored: toStored(rows[0]), deliveries: d.rows.map((r) => ({ webhookId: r.webhook_id, receivedAt: r.received_at.toISOString(), headers: r.headers })) };
  }

  async rejected(limit: number) {
    const { rows } = await this.pool.query<{ id: string; webhook_id: string | null; received_at: Date; reason: string; headers: Record<string, string>; body: string }>(
      'select id, webhook_id, received_at, reason, headers, body from rejected order by id desc limit $1',
      [limit],
    );
    return rows.map((r) => ({ id: Number(r.id), webhookId: r.webhook_id, receivedAt: r.received_at.toISOString(), reason: r.reason, headers: r.headers, body: r.body }));
  }

  async counts(): Promise<Counts> {
    const { rows } = await this.pool.query<{ events: string; deliveries: string; rejected: string }>(
      'select (select count(*) from event) as events, (select count(*) from delivery) as deliveries, (select count(*) from rejected) as rejected',
    );
    const r = rows[0]!;
    return { events: Number(r.events), deliveries: Number(r.deliveries), rejected: Number(r.rejected) };
  }

  async setting<T>(key: string) {
    const { rows } = await this.pool.query<{ value: T }>('select value from setting where key = $1', [key]);
    return rows[0] ? rows[0].value : null;
  }

  async setSetting(key: string, value: unknown, at: string) {
    await this.pool.query('insert into setting (key, value, changed_at) values ($1, $2, $3) on conflict (key) do update set value = excluded.value, changed_at = excluded.changed_at', [key, JSON.stringify(value), at]);
  }

  async close() {
    await this.pool.end();
  }
}
