/**
 * BillingStore against the schema `billing` (migration 0050). Connect with the
 * service role `billing_service`: it may only insert and read, so accounts and
 * plans never change.
 */
import type pg from 'pg';
import { InvoiceConflictError, type BillingEvent, type BillingStore, type Invoice, type InvoiceFilter, type PayerAccount, type PlanRecord } from './index.ts';

const UNIQUE_VIOLATION = '23505';

const iso = (t: unknown) => (t instanceof Date ? t.toISOString() : new Date(String(t)).toISOString());

const ACCOUNT = 'account_id, party_id, market, currency, payment_method, created_at';
const PLAN = `plan_id, account_id, policy_id, term_no, market, product_version, source_event_id, source_event_type, source_occurred_at, input, plan, invoice_lead_days, created_at`;
const date = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

const INVOICE = `i.invoice_id, i.invoice_no, i.account_id, i.party_id, i.market, i.currency, i.issue_date::text as issue_date, i.due_date::text as due_date,
  i.reference_type, i.reference, i.total, i.created_by, i.created_at,
  (select json_agg(json_build_object('planId', l.plan_id, 'policyId', l.policy_id, 'termNo', l.term_no, 'seq', l.seq, 'periodStart', l.period_start,
     'periodEnd', l.period_end, 'premium', l.premium, 'tax', l.tax, 'fee', l.fee, 'amount', l.amount) order by l.line_no)
   from billing.invoice_line l where l.invoice_id = i.invoice_id) as lines`;

function invoice(r: Record<string, any>): Invoice {
  return {
    id: r.invoice_id,
    number: r.invoice_no,
    accountId: r.account_id,
    partyId: r.party_id,
    market: r.market,
    currency: r.currency,
    issueDate: date(r.issue_date),
    dueDate: date(r.due_date),
    reference: { type: r.reference_type, value: r.reference },
    lines: (r.lines ?? []).map((l: Record<string, any>) => ({ ...l, premium: Number(l.premium), tax: Number(l.tax), fee: Number(l.fee), amount: Number(l.amount) })),
    total: Number(r.total),
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
  };
}

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
    ...(r.invoice_lead_days === null || r.invoice_lead_days === undefined ? {} : { invoiceLeadDays: Number(r.invoice_lead_days) }),
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
        `insert into billing.premium_plan (${PLAN}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (source_event_id) do nothing`,
        [p.id, acc.rows[0].account_id, p.policyId, p.termNo, p.market, p.productVersion, p.source.eventId, p.source.eventType, p.source.occurredAt, JSON.stringify(p.input), JSON.stringify(p.plan), p.invoiceLeadDays ?? null, p.createdAt],
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

  async plans(filter: { policyId?: string; accountId?: string; market?: string }) {
    const r = await this.pool.query(
      `select ${PLAN} from billing.premium_plan
       where ($1::text is null or policy_id = $1) and ($2::text is null or account_id = $2) and ($3::text is null or market = $3)
       order by created_at, plan_id collate "C"`,
      [filter.policyId ?? null, filter.accountId ?? null, filter.market ?? null],
    );
    return r.rows.map(plan);
  }

  async invoicedSeqs(planIds: string[]) {
    const out = new Map<string, Set<number>>();
    if (planIds.length === 0) return out;
    const r = await this.pool.query(`select plan_id, seq from billing.invoice_line where plan_id = any($1)`, [planIds]);
    for (const x of r.rows) out.set(x.plan_id, (out.get(x.plan_id) ?? new Set()).add(Number(x.seq)));
    return out;
  }

  async addInvoice(market: string, year: number, numbered: (no: number) => Invoice, events: (i: Invoice) => BillingEvent[]) {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      // The row lock serializes runs in the same market and year, so the series has no gaps or repeats.
      await db.query(`insert into billing.invoice_number_series (market, year, last_no) values ($1, $2, 0) on conflict do nothing`, [market, year]);
      const r = await db.query(`update billing.invoice_number_series set last_no = last_no + 1 where market = $1 and year = $2 returning last_no`, [market, year]);
      const inv = numbered(Number(r.rows[0].last_no));
      await db.query(
        `insert into billing.invoice (invoice_id, invoice_no, account_id, party_id, market, currency, issue_date, due_date, reference_type, reference, total, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [inv.id, inv.number, inv.accountId, inv.partyId, inv.market, inv.currency, inv.issueDate, inv.dueDate, inv.reference.type, inv.reference.value, inv.total, inv.createdBy, inv.createdAt],
      );
      for (const [n, l] of inv.lines.entries()) {
        await db.query(
          `insert into billing.invoice_line (invoice_id, line_no, plan_id, policy_id, term_no, seq, period_start, period_end, premium, tax, fee, amount)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [inv.id, n + 1, l.planId, l.policyId, l.termNo, l.seq, l.periodStart, l.periodEnd, l.premium, l.tax, l.fee, l.amount],
        );
      }
      for (const e of events(inv)) {
        await db.query(`insert into billing.outbox (event_id, type, invoice_id, market, occurred_at, data) values ($1, $2, $3, $4, $5, $6)`, [
          e.id,
          e.type,
          e.invoiceId,
          e.market,
          e.occurredAt,
          JSON.stringify(e.data),
        ]);
      }
      await db.query('commit');
      return inv;
    } catch (e) {
      await db.query('rollback');
      if ((e as { code?: string }).code === UNIQUE_VIOLATION && (e as { constraint?: string }).constraint === 'invoice_line_plan_id_seq_key') {
        throw new InvoiceConflictError('An installment on the invoice is already invoiced');
      }
      throw e;
    } finally {
      db.release();
    }
  }

  async invoice(id: string) {
    const r = await this.pool.query(`select ${INVOICE} from billing.invoice i where i.invoice_id = $1`, [id]);
    return r.rows[0] ? invoice(r.rows[0]) : null;
  }

  async invoices(filter: InvoiceFilter) {
    const r = await this.pool.query(
      `select ${INVOICE} from billing.invoice i
       where ($1::text is null or i.account_id = $1) and ($2::text is null or i.market = $2)
         and ($3::text is null or exists (select 1 from billing.invoice_line l where l.invoice_id = i.invoice_id and l.policy_id = $3))
       order by i.created_at, i.invoice_no collate "C"`,
      [filter.accountId ?? null, filter.market ?? null, filter.policyId ?? null],
    );
    return r.rows.map(invoice);
  }

  async pendingEvents(limit: number): Promise<BillingEvent[]> {
    const { rows } = await this.pool.query(
      `select seq, event_id, type, invoice_id, market, occurred_at, data from billing.outbox where published_at is null order by seq limit $1`,
      [limit],
    );
    return rows.map((r) => ({ id: r.event_id, type: r.type, invoiceId: r.invoice_id, market: r.market, occurredAt: iso(r.occurred_at), data: r.data, sequence: Number(r.seq) }));
  }

  async markPublished(ids: string[], at: string): Promise<void> {
    await this.pool.query(`update billing.outbox set published_at = $2 where event_id = any($1) and published_at is null`, [ids, at]);
  }
}
