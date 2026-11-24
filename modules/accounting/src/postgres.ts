/**
 * AccountingStore against the schema `accounting` (migration 0064). Connect
 * with the service role `accounting_service`: it may only insert and read, and
 * move the number series, so a verification never changes.
 */
import type pg from 'pg';
import { addDays, type ISODate } from '@petvold/common';
import { ChartConflictError, type AccountingEvent, type AccountingStore, type ChartOfAccounts, type DayClose, type Verification, type VerificationFilter } from './index.ts';

const UNIQUE_VIOLATION = '23505';
const iso = (t: unknown) => (t instanceof Date ? t.toISOString() : new Date(String(t)).toISOString());

const VERIFICATION = `v.verification_id, v.verification_no, v.market, v.currency, v.booking_date::text as booking_date, v.event_date::text as event_date, v.text, v.source_event_id, v.source_event_type, v.object_type, v.object_id, v.created_at,
  (select json_agg(json_build_object('account', l.account, 'debit', l.debit, 'credit', l.credit, 'payerAccountId', l.payer_account_id, 'policyId', l.policy_id,
     'claimId', l.claim_id, 'from', l.period_from, 'to', l.period_to) order by l.line_no)
   from accounting.verification_line l where l.verification_id = v.verification_id) as lines`;

function verification(r: Record<string, any>): Verification {
  return {
    id: r.verification_id,
    number: r.verification_no,
    market: r.market,
    currency: r.currency,
    bookingDate: String(r.booking_date),
    ...(r.event_date ? { eventDate: String(r.event_date) } : {}),
    text: r.text,
    source: { eventId: r.source_event_id, eventType: r.source_event_type, objectType: r.object_type, objectId: r.object_id },
    lines: (r.lines ?? []).map((l: Record<string, any>) => ({
      account: l.account,
      debit: Number(l.debit),
      credit: Number(l.credit),
      ...(l.payerAccountId ? { payerAccountId: l.payerAccountId } : {}),
      ...(l.policyId ? { policyId: l.policyId } : {}),
      ...(l.claimId ? { claimId: l.claimId } : {}),
      ...(l.from ? { period: { from: l.from, to: l.to } } : {}),
    })),
    createdAt: iso(r.created_at),
  };
}

export class PostgresAccountingStore implements AccountingStore {
  constructor(private readonly pool: pg.Pool) {}

  async add(market: string, eventDate: ISODate, numbered: (bookingDate: ISODate, no: number) => Verification): Promise<Verification | null> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      // The market's lock: a day is never closed while a verification for it is being stored.
      await db.query(`select pg_advisory_xact_lock(hashtext('accounting.market:' || $1))`, [market]);
      const closed = await this.closedThroughWith(db, market);
      const bookingDate = closed && eventDate <= closed ? addDays(closed, 1) : eventDate;
      const year = Number(bookingDate.slice(0, 4));
      // The row lock serializes verifications in the market and year: no gaps or repeats.
      await db.query(`insert into accounting.verification_number_series (market, year, last_no) values ($1, $2, 0) on conflict do nothing`, [market, year]);
      const r = await db.query(`update accounting.verification_number_series set last_no = last_no + 1 where market = $1 and year = $2 returning last_no`, [market, year]);
      const v = numbered(bookingDate, Number(r.rows[0].last_no));
      await db.query(
        `insert into accounting.verification (verification_id, verification_no, market, currency, booking_date, event_date, text, source_event_id, source_event_type, object_type, object_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [v.id, v.number, v.market, v.currency, v.bookingDate, v.eventDate ?? null, v.text, v.source.eventId, v.source.eventType, v.source.objectType, v.source.objectId, v.createdAt],
      );
      for (const [n, l] of v.lines.entries()) {
        await db.query(
          `insert into accounting.verification_line (verification_id, line_no, account, debit, credit, payer_account_id, policy_id, claim_id, period_from, period_to)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [v.id, n + 1, l.account, l.debit, l.credit, l.payerAccountId ?? null, l.policyId ?? null, l.claimId ?? null, l.period?.from ?? null, l.period?.to ?? null],
        );
      }
      await db.query('commit');
      return v;
    } catch (err) {
      await db.query('rollback');
      // The event is booked already: the number taken goes back with the rollback.
      if ((err as { code?: string }).code === UNIQUE_VIOLATION && (err as { constraint?: string }).constraint === 'verification_source_event_id_key') return null;
      throw err;
    } finally {
      db.release();
    }
  }

  private async closedThroughWith(db: Pick<pg.PoolClient, 'query'>, market: string): Promise<ISODate | null> {
    const r = await db.query(`select max(day)::text as day from accounting.day_close where market = $1`, [market]);
    return r.rows[0].day ?? null;
  }

  async closedThrough(market: string): Promise<ISODate | null> {
    return this.closedThroughWith(this.pool as unknown as pg.PoolClient, market);
  }

  async closeDay(market: string, day: ISODate, make: (verifications: Verification[]) => { close: DayClose; events: AccountingEvent[] }): Promise<DayClose | null> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      await db.query(`select pg_advisory_xact_lock(hashtext('accounting.market:' || $1))`, [market]);
      const last = await this.closedThroughWith(db, market);
      const earlier = await db.query(`select 1 from accounting.verification where market = $1 and booking_date < $2 limit 1`, [market, day]);
      if (last ? day !== addDays(last, 1) : earlier.rowCount !== 0) {
        await db.query('rollback');
        return null;
      }
      const vs = await db.query(`select ${VERIFICATION} from accounting.verification v where v.market = $1 and v.booking_date = $2 order by v.verification_no collate "C"`, [market, day]);
      const { close, events } = make(vs.rows.map(verification));
      await db.query(
        `insert into accounting.day_close (market, day, closed_at, closed_by, verification_count, totals, chart_version, unmapped, csv_sha256) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [close.market, close.day, close.closedAt, close.closedBy, close.verificationCount, JSON.stringify(close.totals), close.chartVersion, JSON.stringify(close.unmapped), close.csvSha256],
      );
      for (const e of events) {
        await db.query(`insert into accounting.outbox (event_id, type, market, day, occurred_at, data) values ($1, $2, $3, $4, $5, $6)`, [e.id, e.type, e.market, e.day, e.occurredAt, JSON.stringify(e.data)]);
      }
      await db.query('commit');
      return close;
    } catch (err) {
      await db.query('rollback');
      throw err;
    } finally {
      db.release();
    }
  }

  async dayClose(market: string, day: ISODate): Promise<DayClose | null> {
    return (await this.dayCloses({ market, from: day, to: day }))[0] ?? null;
  }

  async dayCloses(f: { market?: string; from?: ISODate; to?: ISODate }): Promise<DayClose[]> {
    const r = await this.pool.query(
      `select market, day::text as day, closed_at, closed_by, verification_count, totals, chart_version, unmapped, csv_sha256 from accounting.day_close
       where ($1::text is null or market = $1) and ($2::date is null or day >= $2) and ($3::date is null or day <= $3) order by day, market`,
      [f.market ?? null, f.from ?? null, f.to ?? null],
    );
    return r.rows.map((x) => ({
      market: x.market,
      day: x.day,
      closedAt: iso(x.closed_at),
      closedBy: x.closed_by,
      verificationCount: x.verification_count,
      totals: x.totals,
      chartVersion: x.chart_version,
      unmapped: x.unmapped,
      csvSha256: x.csv_sha256,
    }));
  }

  async chart(): Promise<ChartOfAccounts | null> {
    return (await this.chartVersions()).at(-1) ?? null;
  }

  async chartVersions(): Promise<ChartOfAccounts[]> {
    const r = await this.pool.query(`select version, markets, changed_by, changed_at, reason from accounting.chart_version order by version`);
    return r.rows.map((x) => ({ version: x.version, markets: x.markets, changedBy: x.changed_by, changedAt: iso(x.changed_at), reason: x.reason }));
  }

  async addChart(c: ChartOfAccounts): Promise<void> {
    try {
      await this.pool.query(`insert into accounting.chart_version (version, markets, changed_by, changed_at, reason) values ($1, $2, $3, $4, $5)`, [c.version, JSON.stringify(c.markets), c.changedBy, c.changedAt, c.reason]);
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new ChartConflictError(`Chart version ${c.version} exists`);
      throw err;
    }
  }

  async pendingEvents(limit: number): Promise<AccountingEvent[]> {
    const r = await this.pool.query(`select seq, event_id, type, market, day::text as day, occurred_at, data from accounting.outbox where published_at is null order by seq limit $1`, [limit]);
    return r.rows.map((x) => ({ id: x.event_id, type: x.type, market: x.market, day: x.day, occurredAt: iso(x.occurred_at), data: x.data, sequence: Number(x.seq) }));
  }

  async markPublished(ids: string[], at: string): Promise<void> {
    await this.pool.query(`update accounting.outbox set published_at = $2 where event_id = any($1) and published_at is null`, [ids, at]);
  }

  async verification(id: string): Promise<Verification | null> {
    const r = await this.pool.query(`select ${VERIFICATION} from accounting.verification v where v.verification_id = $1`, [id]);
    return r.rows[0] ? verification(r.rows[0]) : null;
  }

  async bySourceEvent(eventId: string): Promise<Verification | null> {
    const r = await this.pool.query(`select ${VERIFICATION} from accounting.verification v where v.source_event_id = $1`, [eventId]);
    return r.rows[0] ? verification(r.rows[0]) : null;
  }

  async verifications(f: VerificationFilter): Promise<Verification[]> {
    const r = await this.pool.query(
      `select ${VERIFICATION} from accounting.verification v
       where ($1::text is null or v.market = $1) and ($2::date is null or v.booking_date >= $2) and ($3::date is null or v.booking_date <= $3) and ($4::text is null or v.object_id = $4)
       order by v.verification_no collate "C"`,
      [f.market ?? null, f.from ?? null, f.to ?? null, f.objectId ?? null],
    );
    return r.rows.map(verification);
  }
}
