/** The shared BillingStore suite against Postgres, as the service role billing_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresBillingStore } from '../src/postgres.ts';
import { billingStoreSuite, invoiceOf, payer, planRecord, receipt } from '../test-suites/billing-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.BILLING_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or BILLING_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await admin.end();
});
const clean = () => admin.query('truncate billing.credit_proposal_decision, billing.credit_proposal, billing.credit_application, billing.refund, billing.invoice_dunning, billing.allocation, billing.payment_match, billing.payment_receipt, billing.outbox, billing.credit_note_line, billing.credit_note, billing.invoice_line, billing.invoice, billing.invoice_number_series, billing.premium_plan, billing.payer_account cascade');

billingStoreSuite('PostgresBillingStore', async () => {
  await clean();
  return { store: new PostgresBillingStore(pool) };
});

test('accounts and plans never change', async () => {
  await clean();
  const store = new PostgresBillingStore(pool);
  await store.addPlan(payer(), planRecord());
  await assert.rejects(pool.query(`update billing.premium_plan set term_no = 2`), /permission denied/);
  await assert.rejects(pool.query(`delete from billing.payer_account`), /permission denied/);
  await assert.rejects(pool.query(`insert into billing.payer_account (account_id, party_id, market, currency, payment_method, created_at) values ('bac_x', 'pty_x', 'SE', 'SEK', 'cash', now())`), /check/);
});

test('invoices never change, and a line must add up', async () => {
  await clean();
  const store = new PostgresBillingStore(pool);
  await store.addPlan(payer(), planRecord());
  await store.addInvoice('SE', 2026, (no) => invoiceOf('inv_a', no, planRecord()), () => []);
  await assert.rejects(pool.query(`update billing.invoice set total = 0`), /permission denied/);
  await assert.rejects(pool.query(`delete from billing.invoice_line`), /permission denied/);
  await assert.rejects(pool.query(`update billing.invoice_number_series set year = 2030`), /permission denied/);
  await assert.rejects(
    pool.query(`insert into billing.invoice_line (invoice_id, line_no, plan_id, policy_id, term_no, seq, period_start, period_end, premium, tax, fee, amount)
                values ('inv_a', 9, 'ppl_1', 'pol_1', 1, 9, '2027-01-01', '2027-02-01', 100, 0, 0, 99)`),
    /check/,
  );
});

test('two runs at once: the number series has no gaps and no installment is invoiced twice', async () => {
  await clean();
  const store = new PostgresBillingStore(pool);
  await store.addPlan(payer(), planRecord());
  const p = planRecord();
  const results = await Promise.allSettled([1, 2, 3, 4].map((k) => store.addInvoice('SE', 2026, (no) => invoiceOf(`inv_${k}`, no, p, [k <= 2 ? 1 : k]), () => [])));
  const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.number] : []));
  assert.equal(ok.length, 3, 'one of the two invoices of installment 1 is refused');
  assert.deepEqual(ok.sort(), ['SE-2026-000001', 'SE-2026-000002', 'SE-2026-000003']);
});

test('payments, matches and allocations never change', async () => {
  await clean();
  const store = new PostgresBillingStore(pool);
  await store.addPlan(payer(), planRecord());
  await store.addInvoice('SE', 2026, (no) => invoiceOf('inv_a', no, planRecord()), () => []);
  await store.addReceipt(receipt(1), {
    match: { paymentId: 'pay_1', accountId: 'bac_1', how: 'reference', matchedBy: 'billing', matchedAt: '2026-12-01T10:00:00.000Z' },
    plan: () => ({ allocations: [{ paymentId: 'pay_1', invoiceId: 'inv_a', accountId: 'bac_1', amount: 100 }], events: [] }),
  });
  await assert.rejects(pool.query(`update billing.payment_receipt set amount = 1`), /permission denied/);
  await assert.rejects(pool.query(`delete from billing.payment_match`), /permission denied/);
  await assert.rejects(pool.query(`update billing.allocation set amount = 1`), /permission denied/);
  await assert.rejects(store.addReceipt(receipt(2, { amount: 0 }), null), /check/);
});
