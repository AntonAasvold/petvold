/**
 * AccountingStore against the schema `accounting` (migration 0064). Connect
 * with the service role `accounting_service`: it may only insert and read, and
 * move the number series, so a verification never changes.
 */
import type pg from 'pg';
import type { AccountingStore, Verification, VerificationFilter } from './index.ts';

const UNIQUE_VIOLATION = '23505';
const iso = (t: unknown) => (t instanceof Date ? t.toISOString() : new Date(String(t)).toISOString());

const VERIFICATION = `v.verification_id, v.verification_no, v.market, v.currency, v.booking_date::text as booking_date, v.text, v.source_event_id, v.source_event_type, v.object_type, v.object_id, v.created_at,
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

  async add(market: string, year: number, numbered: (no: number) => Verification): Promise<Verification | null> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      // The row lock serializes verifications in the market and year: no gaps or repeats.
      await db.query(`insert into accounting.verification_number_series (market, year, last_no) values ($1, $2, 0) on conflict do nothing`, [market, year]);
      const r = await db.query(`update accounting.verification_number_series set last_no = last_no + 1 where market = $1 and year = $2 returning last_no`, [market, year]);
      const v = numbered(Number(r.rows[0].last_no));
      await db.query(
        `insert into accounting.verification (verification_id, verification_no, market, currency, booking_date, text, source_event_id, source_event_type, object_type, object_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [v.id, v.number, v.market, v.currency, v.bookingDate, v.text, v.source.eventId, v.source.eventType, v.source.objectType, v.source.objectId, v.createdAt],
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
