/**
 * PaymentsStore against the schema `payments` (migration 0054). Connect with
 * the service role `payments_service`: it may only insert and read, so a
 * payment never changes.
 */
import type pg from 'pg';
import type { Payment, PaymentEvent, PaymentFilter, PaymentsStore } from './index.ts';

const UNIQUE_VIOLATION = '23505';

const iso = (t: unknown) => (t instanceof Date ? t.toISOString() : new Date(String(t)).toISOString());

const PAYMENT = `payment_id, direction, status, provider, provider_ref, market, currency, amount, reference, booked_on::text as booked_on, received_at`;

function payment(r: Record<string, any>): Payment {
  return {
    id: r.payment_id,
    direction: r.direction,
    status: r.status,
    provider: r.provider,
    providerRef: r.provider_ref,
    market: r.market,
    currency: r.currency,
    amount: Number(r.amount),
    reference: r.reference ?? null,
    bookedOn: String(r.booked_on),
    receivedAt: iso(r.received_at),
  };
}

export class PostgresPaymentsStore implements PaymentsStore {
  constructor(private readonly pool: pg.Pool) {}

  async addPayment(p: Payment, e: PaymentEvent): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into payments.payment (payment_id, direction, status, provider, provider_ref, market, currency, amount, reference, booked_on, received_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [p.id, p.direction, p.status, p.provider, p.providerRef, p.market, p.currency, p.amount, p.reference, p.bookedOn, p.receivedAt],
      );
      await client.query(`insert into payments.outbox (event_id, type, payment_id, market, occurred_at, data) values ($1, $2, $3, $4, $5, $6)`, [
        e.id,
        e.type,
        e.paymentId,
        e.market,
        e.occurredAt,
        e.data,
      ]);
      await client.query('commit');
      return true;
    } catch (err) {
      await client.query('rollback');
      if ((err as { code?: string }).code === UNIQUE_VIOLATION && (err as { constraint?: string }).constraint === 'payment_provider_provider_ref_key') return false;
      throw err;
    } finally {
      client.release();
    }
  }

  async payment(id: string): Promise<Payment | null> {
    const { rows } = await this.pool.query(`select ${PAYMENT} from payments.payment where payment_id = $1`, [id]);
    return rows[0] ? payment(rows[0]) : null;
  }

  async byProviderRef(provider: string, providerRef: string): Promise<Payment | null> {
    const { rows } = await this.pool.query(`select ${PAYMENT} from payments.payment where provider = $1 and provider_ref = $2`, [provider, providerRef]);
    return rows[0] ? payment(rows[0]) : null;
  }

  async payments(filter: PaymentFilter): Promise<Payment[]> {
    const { rows } = await this.pool.query(
      `select ${PAYMENT} from payments.payment
       where ($1::text is null or market = $1) and ($2::text is null or reference = $2)
       order by received_at, payment_id collate "C"`,
      [filter.market ?? null, filter.reference ?? null],
    );
    return rows.map(payment);
  }

  async pendingEvents(limit: number): Promise<PaymentEvent[]> {
    const { rows } = await this.pool.query(
      `select seq, event_id, type, payment_id, market, occurred_at, data from payments.outbox where published_at is null order by seq limit $1`,
      [limit],
    );
    return rows.map((r) => ({ id: r.event_id, type: r.type, paymentId: r.payment_id, market: r.market, occurredAt: iso(r.occurred_at), data: r.data, sequence: Number(r.seq) }));
  }

  async markPublished(ids: string[], at: string): Promise<void> {
    await this.pool.query(`update payments.outbox set published_at = $2 where event_id = any($1) and published_at is null`, [ids, at]);
  }
}
