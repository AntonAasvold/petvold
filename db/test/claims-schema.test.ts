/**
 * Database tests (layer 6, ADR 0012): the rules Postgres itself enforces in
 * the schema `claims`. Run against TEST_DATABASE_URL after `npm run dev:up`.
 * Every test runs in a transaction that is rolled back.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is missing. Copy .env.example to .env and run npm run dev:up.');

const db = new pg.Client({ connectionString: url });
before(() => db.connect());
after(() => db.end());

/** Runs `fn` in a transaction that is always rolled back. */
async function inTx(fn: () => Promise<void>): Promise<void> {
  await db.query('begin');
  try {
    await fn();
  } finally {
    await db.query('rollback');
  }
}

/** Catches an expected database error in a savepoint, so the transaction can continue. */
async function rejects(sql: string, params: unknown[], code: string): Promise<void> {
  await db.query('savepoint s');
  await assert.rejects(db.query(sql, params), (e: { code?: string }) => e.code === code);
  await db.query('rollback to savepoint s');
}

const PERMISSION_DENIED = '42501';
const EXCLUSION_VIOLATION = '23P01';
const RAISE_EXCEPTION = 'P0001';
const CHECK_VIOLATION = '23514';

async function seedDecision(): Promise<void> {
  await db.query(
    `insert into claims.claim (id, claim_no, policy_id, animal_id, market, currency, channel, treatment_from, treatment_to, diagnosis_code)
     values ('clm_t1', 'T-1', 'pol_t', 'ani_t', 'SE', 'SEK', 'customer', '2026-10-01', '2026-10-01', 'ORA-OTIT')`,
  );
  await db.query(
    `insert into claims.decision (id, claim_id, seq, outcome, payout_minor, currency, assessment, input_hash, rules_version, decided_by)
     values ('dec_t1', 'clm_t1', 1, 'approved', 100000, 'SEK', '{}', 'h', 'SE-HUND-2026.2', 'auto')`,
  );
  await db.query(
    `insert into claims.decision_evidence (decision_id, input, calculation_model, engine_version)
     values ('dec_t1', '{}', 'vet-care.v1', '0.1.0+test')`,
  );
}

async function journal(id: string, amounts: number[]): Promise<void> {
  await db.query(`insert into claims.journal (id, source_type, source_id, claim_id, currency) values ($1, 'claim_decision', 'dec_t1', 'clm_t1', 'SEK')`, [id]);
  for (const [i, a] of amounts.entries()) {
    await db.query(`insert into claims.journal_line (journal_id, line_no, account, amount_minor) values ($1, $2, $3, $4)`, [id, i + 1, `acc${i}`, a]);
  }
}

test('the migrations have been applied', async () => {
  const { rows } = await db.query(`select version from schema_migrations order by version`);
  assert.deepEqual(
    rows.map((r) => r.version),
    ['0001', '0002', '0003', '0004', '0005'],
  );
});

test('a balanced journal is accepted', async () => {
  await inTx(async () => {
    await seedDecision();
    await journal('jnl_ok', [100000, -100000]);
    await db.query('set constraints all immediate');
  });
});

test('an unbalanced journal is rejected', async () => {
  await inTx(async () => {
    await seedDecision();
    await journal('jnl_bad', [100000, -99999]);
    await rejects('set constraints all immediate', [], RAISE_EXCEPTION);
  });
});

test('deductible periods for the same animal and group must not overlap', async () => {
  await inTx(async () => {
    await seedDecision();
    const insert = `insert into claims.deductible_period (id, animal_id, diagnosis_group, valid, opened_by_claim_id)
                    values ($1, 'ani_t', 'ora', $2::daterange, 'clm_t1')`;
    await db.query(insert, ['dp1', '[2026-10-01,2027-02-03)']);
    await rejects(insert, ['dp2', '[2027-02-02,2027-06-01)'], EXCLUSION_VIOLATION);
    // Half-open ranges: a period starting where the previous one ends is allowed.
    await db.query(insert, ['dp3', '[2027-02-03,2027-06-08)']);
  });
});

test('the service role cannot change or delete decisions and ledger', async () => {
  await inTx(async () => {
    await seedDecision();
    await journal('jnl_r', [500, -500]);
    await db.query('set constraints all immediate');
    await db.query('set local role claims_service');
    await rejects(`update claims.decision set payout_minor = 0 where id = 'dec_t1'`, [], PERMISSION_DENIED);
    await rejects(`delete from claims.decision where id = 'dec_t1'`, [], PERMISSION_DENIED);
    await rejects(`update claims.journal_line set amount_minor = 0 where journal_id = 'jnl_r'`, [], PERMISSION_DENIED);
    await rejects(`delete from claims.journal_line where journal_id = 'jnl_r'`, [], PERMISSION_DENIED);
    await rejects(`delete from claims.journal where id = 'jnl_r'`, [], PERMISSION_DENIED);
  });
});

test('the service role can read, insert and replace deductible periods', async () => {
  await inTx(async () => {
    await db.query('set local role claims_service');
    await seedDecision();
    const { rows } = await db.query(`select count(*)::int as n from claims.decision where id = 'dec_t1'`);
    assert.equal(rows[0].n, 1);
    await db.query(
      `insert into claims.deductible_period (id, animal_id, diagnosis_group, valid, opened_by_claim_id)
       values ('dp_s', 'ani_t', 'ora', '[2026-10-01,2027-02-03)', 'clm_t1')`,
    );
    await db.query(`delete from claims.deductible_period where id = 'dp_s'`);
  });
});

test('the service role can only mark events as published', async () => {
  await inTx(async () => {
    await db.query('set local role claims_service');
    await db.query(`insert into claims.outbox (type, aggregate_id, payload) values ('claim.registered', 'clm_t1', '{}')`);
    await db.query(`update claims.outbox set published_at = now() where aggregate_id = 'clm_t1'`);
    await rejects(`update claims.outbox set payload = '{"x":1}' where aggregate_id = 'clm_t1'`, [], PERMISSION_DENIED);
  });
});

// Evidence and deviations (ADR 0018) --------------------------------------------

test('a decision without evidence is rejected at commit', async () => {
  await inTx(async () => {
    await seedDecision();
    await db.query(
      `insert into claims.decision (id, claim_id, seq, outcome, payout_minor, currency, assessment, input_hash, rules_version, decided_by)
       values ('dec_t2', 'clm_t1', 2, 'approved', 100000, 'SEK', '{}', 'h', 'SE-HUND-2026.2', 'auto')`,
    );
    await rejects('set constraints all immediate', [], RAISE_EXCEPTION);
  });
});

test('the service role cannot change or delete evidence', async () => {
  await inTx(async () => {
    await seedDecision();
    await db.query('set constraints all immediate');
    await db.query('set local role claims_service');
    await rejects(`update claims.decision_evidence set input = '{"x":1}' where decision_id = 'dec_t1'`, [], PERMISSION_DENIED);
    await rejects(`delete from claims.decision_evidence where decision_id = 'dec_t1'`, [], PERMISSION_DENIED);
  });
});

test('a deviation from the proposal needs a known reason code and a reason', async () => {
  await inTx(async () => {
    await seedDecision();
    const insert = `insert into claims.decision (id, claim_id, seq, outcome, payout_minor, currency, assessment, input_hash, rules_version,
                                                 decided_by, reason, deviates_from_proposal, reason_code)
                    values ($1, 'clm_t1', $2, 'rejected', 0, 'SEK', '{}', 'h', 'SE-HUND-2026.2', 'h1', $3, true, $4)`;
    await rejects(insert, ['dec_d1', 2, null, 'other'], CHECK_VIOLATION);
    await rejects(insert, ['dec_d2', 2, ' ', 'other'], CHECK_VIOLATION);
    await rejects(insert, ['dec_d3', 2, 'Seen before', null], CHECK_VIOLATION);
    await rejects(insert, ['dec_d4', 2, 'Seen before', 'made_up'], CHECK_VIOLATION);
    await db.query(insert, ['dec_d5', 2, 'Seen before', 'pre_existing_condition']);
  });
});
