/**
 * BillingStore against the schema `billing` (migration 0050). Connect with the
 * service role `billing_service`: it may only insert and read, so accounts and
 * plans never change.
 */
import type pg from 'pg';
import type { BillingStore, PayerAccount, PlanRecord } from './index.ts';

const iso = (t: unknown) => (t instanceof Date ? t.toISOString() : new Date(String(t)).toISOString());

const ACCOUNT = 'account_id, party_id, market, currency, payment_method, created_at';
const PLAN = `plan_id, account_id, policy_id, term_no, market, product_version, source_event_id, source_event_type, source_occurred_at, input, plan, created_at`;

function account(r: Record<string, unknown>): PayerAccount {
  return {
    id: String(r.account_id),
    partyId: String(r.party_id),
    market: String(r.market),
    currency: String(r.currency),
    paymentMethod: r.payment_method as PayerAccount['paymentMethod'],
    createdAt: iso(r.created_at),
  };
}

function plan(r: Record<string, unknown>): PlanRecord {
  return {
    id: String(r.plan_id),
    accountId: String(r.account_id),
    policyId: String(r.policy_id),
    termNo: Number(r.term_no),
    market: String(r.market),
    productVersion: String(r.product_version),
    source: { eventId: String(r.source_event_id), eventType: String(r.source_event_type), occurredAt: iso(r.source_occurred_at) },
    input: r.input as PlanRecord['input'],
    plan: r.plan as PlanRecord['plan'],
    createdAt: iso(r.created_at),
  };
}

export class PostgresBillingStore implements BillingStore {
  constructor(private readonly pool: pg.Pool) {}

  async addPlan(a: PayerAccount, p: PlanRecord): Promise<boolean> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      await db.query(
        `insert into billing.payer_account (${ACCOUNT}) values ($1, $2, $3, $4, $5, $6)
         on conflict (party_id, market, currency) do nothing`,
        [a.id, a.partyId, a.market, a.currency, a.paymentMethod, a.createdAt],
      );
      const acc = await db.query(`select account_id from billing.payer_account where party_id = $1 and market = $2 and currency = $3`, [a.partyId, a.market, a.currency]);
      const r = await db.query(
        `insert into billing.premium_plan (${PLAN}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict (source_event_id) do nothing`,
        [p.id, acc.rows[0].account_id, p.policyId, p.termNo, p.market, p.productVersion, p.source.eventId, p.source.eventType, p.source.occurredAt, JSON.stringify(p.input), JSON.stringify(p.plan), p.createdAt],
      );
      // A repeated event: nothing is stored, not even a new account.
      await db.query(r.rowCount === 1 ? 'commit' : 'rollback');
      return r.rowCount === 1;
    } catch (e) {
      await db.query('rollback');
      throw e;
    } finally {
      db.release();
    }
  }

  async account(id: string) {
    const r = await this.pool.query(`select ${ACCOUNT} from billing.payer_account where account_id = $1`, [id]);
    return r.rows[0] ? account(r.rows[0]) : null;
  }

  async accountFor(partyId: string, market: string, currency: string) {
    const r = await this.pool.query(`select ${ACCOUNT} from billing.payer_account where party_id = $1 and market = $2 and currency = $3`, [partyId, market, currency]);
    return r.rows[0] ? account(r.rows[0]) : null;
  }

  async accounts(filter: { partyId?: string; market?: string }) {
    const r = await this.pool.query(
      `select ${ACCOUNT} from billing.payer_account
       where ($1::text is null or party_id = $1) and ($2::text is null or market = $2)
       order by created_at, account_id collate "C"`,
      [filter.partyId ?? null, filter.market ?? null],
    );
    return r.rows.map(account);
  }

  async plans(filter: { policyId?: string; accountId?: string }) {
    const r = await this.pool.query(
      `select ${PLAN} from billing.premium_plan
       where ($1::text is null or policy_id = $1) and ($2::text is null or account_id = $2)
       order by created_at, plan_id collate "C"`,
      [filter.policyId ?? null, filter.accountId ?? null],
    );
    return r.rows.map(plan);
  }
}
