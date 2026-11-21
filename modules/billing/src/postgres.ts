/**
 * BillingStore against the schema `billing` (migration 0050). Connect with the
 * service role `billing_service`: it may only insert and read, so accounts and
 * plans never change.
 */
import type pg from 'pg';
import { InvoiceConflictError, type BillingEvent, type BillingStore, type CreditNote, type Invoice, type InvoiceFilter, type PayerAccount, type PlanRecord } from './index.ts';

const UNIQUE_VIOLATION = '23505';

const iso = (t: unknown) => (t instanceof Date ? t.toISOString() : new Date(String(t)).toISOString());

const ACCOUNT = 'account_id, party_id, market, currency, payment_method, created_at';
const PLAN = `plan_id, account_id, policy_id, term_no, market, product_version, source_event_id, source_event_type, source_occurred_at, input, plan, invoice_lead_days, replaces_plan_id, adjustment, created_at`;

const CREDIT = `c.credit_note_id, c.credit_note_no, c.invoice_id, c.account_id, c.party_id, c.market, c.currency, c.issue_date::text as issue_date, c.total,
  c.source_event_id, c.source_event_type, c.created_at,
  (select json_agg(json_build_object('planId', l.plan_id, 'policyId', l.policy_id, 'seq', l.seq, 'amount', l.amount) order by l.line_no)
   from billing.credit_note_line l where l.credit_note_id = c.credit_note_id) as lines`;

function creditNote(r: Record<string, any>): CreditNote {
  return {
    id: r.credit_note_id,
    number: r.credit_note_no,
    invoiceId: r.invoice_id,
    accountId: r.account_id,
    partyId: r.party_id,
    market: r.market,
    currency: r.currency,
    issueDate: String(r.issue_date),
    lines: (r.lines ?? []).map((l: Record<string, any>) => ({ ...l, amount: Number(l.amount) })),
    total: Number(r.total),
    source: { eventId: r.source_event_id, eventType: r.source_event_type },
    createdAt: iso(r.created_at),
  };
}
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
    ...(r.replaces_plan_id ? { replaces: String(r.replaces_plan_id) } : {}),
    ...(r.adjustment ? { adjustment: r.adjustment as PlanRecord['adjustment'] } : {}),
    createdAt: iso(r.created_at),
  };
}

const planArgs = (p: PlanRecord, accountId: string) => [
  p.id,
  accountId,
  p.policyId,
  p.termNo,
  p.market,
  p.productVersion,
  p.source.eventId,
  p.source.eventType,
  p.source.occurredAt,
  JSON.stringify(p.input),
  JSON.stringify(p.plan),
  p.invoiceLeadDays ?? null,
  p.replaces ?? null,
  p.adjustment ? JSON.stringify(p.adjustment) : null,
  p.createdAt,
];

export class PostgresBillingStore implements BillingStore {
  constructor(private readonly pool: pg.Pool) {}

  async addPlan(a: PayerAccount, p: PlanRecord): Promise<boolean> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      // An issue or a renewal gives one plan: a repeated event gives nothing, whatever account it would find.
      if ((await db.query(`select 1 from billing.premium_plan where source_event_id = $1`, [p.source.eventId])).rowCount) {
        await db.query('rollback');
        return false;
      }
      await db.query(
        `insert into billing.payer_account (${ACCOUNT}) values ($1, $2, $3, $4, $5, $6)
         on conflict (party_id, market, currency) do nothing`,
        [a.id, a.partyId, a.market, a.currency, a.paymentMethod, a.createdAt],
      );
      const acc = await db.query(`select account_id from billing.payer_account where party_id = $1 and market = $2 and currency = $3`, [a.partyId, a.market, a.currency]);
      const r = await db.query(
        `insert into billing.premium_plan (${PLAN}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         on conflict do nothing`,
        planArgs(p, acc.rows[0].account_id),
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

  async addAdjustment(
    input: { market: string; year: number; accounts: PayerAccount[]; plans: PlanRecord[]; credits: Omit<CreditNote, 'number'>[] },
    numbered: (credit: Omit<CreditNote, 'number'>, no: number) => CreditNote,
    events: (credits: CreditNote[]) => BillingEvent[],
  ): Promise<boolean> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      const eventId = input.plans[0]?.source.eventId ?? input.credits[0]?.source.eventId;
      const done = await db.query(
        `select 1 from billing.premium_plan where source_event_id = $1 and adjustment is not null union all select 1 from billing.credit_note where source_event_id = $1`,
        [eventId],
      );
      if (done.rowCount) {
        await db.query('rollback');
        return false;
      }
      const accountIds = new Map<string, string>();
      for (const a of input.accounts) {
        await db.query(`insert into billing.payer_account (${ACCOUNT}) values ($1, $2, $3, $4, $5, $6) on conflict (party_id, market, currency) do nothing`, [
          a.id,
          a.partyId,
          a.market,
          a.currency,
          a.paymentMethod,
          a.createdAt,
        ]);
        const r = await db.query(`select account_id from billing.payer_account where party_id = $1 and market = $2 and currency = $3`, [a.partyId, a.market, a.currency]);
        accountIds.set(a.id, r.rows[0].account_id);
      }
      for (const p of input.plans) {
        await db.query(`insert into billing.premium_plan (${PLAN}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`, planArgs(p, accountIds.get(p.accountId) ?? p.accountId));
      }
      const made: CreditNote[] = [];
      for (const c of input.credits) {
        await db.query(`insert into billing.invoice_number_series (market, year, last_no) values ($1, $2, 0) on conflict do nothing`, [input.market, input.year]);
        const r = await db.query(`update billing.invoice_number_series set last_no = last_no + 1 where market = $1 and year = $2 returning last_no`, [input.market, input.year]);
        const note = numbered(c, Number(r.rows[0].last_no));
        await db.query(
          `insert into billing.credit_note (credit_note_id, credit_note_no, invoice_id, account_id, party_id, market, currency, issue_date, total, source_event_id, source_event_type, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [note.id, note.number, note.invoiceId, note.accountId, note.partyId, note.market, note.currency, note.issueDate, note.total, note.source.eventId, note.source.eventType, note.createdAt],
        );
        for (const [n, l] of note.lines.entries()) {
          await db.query(`insert into billing.credit_note_line (credit_note_id, line_no, plan_id, policy_id, seq, amount) values ($1, $2, $3, $4, $5, $6)`, [note.id, n + 1, l.planId, l.policyId, l.seq, l.amount]);
        }
        made.push(note);
      }
      for (const e of events(made)) {
        await db.query(`insert into billing.outbox (event_id, type, invoice_id, market, occurred_at, data) values ($1, $2, $3, $4, $5, $6)`, [e.id, e.type, e.invoiceId, e.market, e.occurredAt, JSON.stringify(e.data)]);
      }
      await db.query('commit');
      return true;
    } catch (e) {
      await db.query('rollback');
      if ((e as { code?: string }).code === UNIQUE_VIOLATION && (e as { constraint?: string }).constraint === 'premium_plan_replaces') throw new InvoiceConflictError('A plan is already replaced');
      throw e;
    } finally {
      db.release();
    }
  }

  async creditNotes(filter: { invoiceId?: string; accountId?: string; policyId?: string }) {
    const r = await this.pool.query(
      `select ${CREDIT} from billing.credit_note c
       where ($1::text is null or c.invoice_id = $1) and ($2::text is null or c.account_id = $2)
         and ($3::text is null or exists (select 1 from billing.credit_note_line l where l.credit_note_id = c.credit_note_id and l.policy_id = $3))
       order by c.created_at, c.credit_note_no collate "C"`,
      [filter.invoiceId ?? null, filter.accountId ?? null, filter.policyId ?? null],
    );
    return r.rows.map(creditNote);
  }

  async creditNote(id: string) {
    const r = await this.pool.query(`select ${CREDIT} from billing.credit_note c where c.credit_note_id = $1`, [id]);
    return r.rows[0] ? creditNote(r.rows[0]) : null;
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
