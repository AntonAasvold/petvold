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
    `insert into claims.decision (id, claim_id, seq, outcome, payout_minor, currency, assessment, input_hash, rules_version, decided_by, automated)
     values ('dec_t1', 'clm_t1', 1, 'approved', 100000, 'SEK', '{}', 'h', 'SE-HUND-2026.2', 'auto', true)`,
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
    ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010', '0011', '0012', '0013', '0014', '0015'],
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
      `insert into claims.decision (id, claim_id, seq, outcome, payout_minor, currency, assessment, input_hash, rules_version, decided_by, automated)
       values ('dec_t2', 'clm_t1', 2, 'approved', 100000, 'SEK', '{}', 'h', 'SE-HUND-2026.2', 'auto', true)`,
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
                                                 decided_by, reason, deviates_from_proposal, reason_code, automated)
                    values ($1, 'clm_t1', $2, 'rejected', 0, 'SEK', '{}', 'h', 'SE-HUND-2026.2', 'h1', $3, true, $4, false)`;
    await rejects(insert, ['dec_d1', 2, null, 'other'], CHECK_VIOLATION);
    await rejects(insert, ['dec_d2', 2, ' ', 'other'], CHECK_VIOLATION);
    await rejects(insert, ['dec_d3', 2, 'Seen before', null], CHECK_VIOLATION);
    await rejects(insert, ['dec_d4', 2, 'Seen before', 'made_up'], CHECK_VIOLATION);
    await db.query(insert, ['dec_d5', 2, 'Seen before', 'pre_existing_condition']);
  });
});

const UNIQUE_VIOLATION = '23505';

/** A human decision (seq 2) that may answer a review request. */
async function humanDecision(id: string, seq: number, reviewRequestId: string | null): Promise<void> {
  await db.query(
    `insert into claims.decision (id, claim_id, seq, outcome, payout_minor, currency, assessment, input_hash, rules_version, decided_by,
                                  automated, review_request_id)
     values ($1, 'clm_t1', $2, 'approved', 100000, 'SEK', '{}', 'h', 'SE-HUND-2026.2', 'h1', false, $3)`,
    [id, seq, reviewRequestId],
  );
  await db.query(`insert into claims.decision_evidence (decision_id, input, calculation_model, engine_version) values ($1, '{}', 'vet-care.v1', 't')`, [id]);
}

const insertReview = `insert into claims.review_request (id, claim_id, decision_id, decision_seq, requested_by, requested_at)
                      values ($1, 'clm_t1', $2, $3, 'customer-portal', now())`;

test('a review request concerns an automated decision on the same claim, and only one is open', async () => {
  await inTx(async () => {
    await seedDecision();
    await rejects(insertReview, ['rvw_wrong_seq', 'dec_t1', 2], RAISE_EXCEPTION);
    await db.query(insertReview, ['rvw_1', 'dec_t1', 1]);
    await rejects(insertReview, ['rvw_2', 'dec_t1', 1], UNIQUE_VIOLATION);
    await humanDecision('dec_h0', 2, null);
    await rejects(insertReview, ['rvw_human', 'dec_h0', 2], RAISE_EXCEPTION);
  });
});

test('a review request is closed once, by the human decision that answers it', async () => {
  await inTx(async () => {
    await seedDecision();
    await db.query(insertReview, ['rvw_1', 'dec_t1', 1]);
    await db.query('set local role claims_service');
    const close = `update claims.review_request set closed_by_decision_id = $2, closed_at = now() where id = $1`;
    await rejects(close, ['rvw_1', 'dec_t1'], RAISE_EXCEPTION); // automated
    await humanDecision('dec_h1', 2, null);
    await rejects(close, ['rvw_1', 'dec_h1'], RAISE_EXCEPTION); // does not answer it
    await humanDecision('dec_h2', 3, 'rvw_1');
    await db.query(close, ['rvw_1', 'dec_h2']);
    await rejects(close, ['rvw_1', 'dec_h2'], RAISE_EXCEPTION); // already closed
    await rejects(`update claims.review_request set statement = 'x' where id = 'rvw_1'`, [], PERMISSION_DENIED);
    await rejects(`delete from claims.review_request where id = 'rvw_1'`, [], PERMISSION_DENIED);
  });
});

test('an automated decision cannot be the answer to a review', async () => {
  await inTx(async () => {
    await seedDecision();
    await db.query(insertReview, ['rvw_1', 'dec_t1', 1]);
    await rejects(
      `insert into claims.decision (id, claim_id, seq, outcome, payout_minor, currency, assessment, input_hash, rules_version, decided_by,
                                    automated, review_request_id)
       values ('dec_a2', 'clm_t1', 2, 'approved', 100000, 'SEK', '{}', 'h', 'SE-HUND-2026.2', 'auto', true, 'rvw_1')`,
      [],
      CHECK_VIOLATION,
    );
  });
});

const insertProposal = `insert into claims.decision_proposal (id, claim_id, action, outcome, payout_minor, currency, input_hash, proposed_by,
                                                              proposed_at, deviates_from_proposal, proposer_limit_minor)
                        values ($1, 'clm_t1', 'accept', 'approved', 500000, 'SEK', 'h', 'h1', now(), false, $2)`;

test('a proposal exceeds the proposer\'s limit, and only one is open per claim', async () => {
  await inTx(async () => {
    await seedDecision();
    await rejects(insertProposal, ['prp_within', 500000], CHECK_VIOLATION);
    await db.query(insertProposal, ['prp_1', 100000]);
    await rejects(insertProposal, ['prp_2', 100000], UNIQUE_VIOLATION);
  });
});

test('a proposal is closed once, only its closing fields change, and the approver is not the proposer', async () => {
  await inTx(async () => {
    await seedDecision();
    await db.query(insertProposal, ['prp_1', 100000]);
    await db.query('set local role claims_service');
    await rejects(`update claims.decision_proposal set payout_minor = 1 where id = 'prp_1'`, [], PERMISSION_DENIED);
    await rejects(`delete from claims.decision_proposal where id = 'prp_1'`, [], PERMISSION_DENIED);
    await rejects(
      `insert into claims.decision (id, claim_id, seq, outcome, payout_minor, currency, assessment, input_hash, rules_version, decided_by,
                                    automated, approved_by, proposal_id)
       values ('dec_self', 'clm_t1', 2, 'approved', 500000, 'SEK', '{}', 'h', 'SE-HUND-2026.2', 'h1', false, 'h1', 'prp_1')`,
      [],
      CHECK_VIOLATION,
    );
    const ret = `update claims.decision_proposal set status = 'returned', closed_by = 'a1', closed_at = now(), return_reason = $2 where id = $1`;
    await rejects(ret, ['prp_1', ' '], CHECK_VIOLATION);
    await db.query(ret, ['prp_1', 'Check the invoice']);
    await rejects(ret, ['prp_1', 'Again'], RAISE_EXCEPTION);
  });
});

test('a reserve journal refers to its claim or to a decision on it; a decision journal only to a decision', async () => {
  await inTx(async () => {
    await seedDecision();
    const insert = `insert into claims.journal (id, source_type, source_id, claim_id, currency) values ($1, $2, $3, 'clm_t1', 'SEK')`;
    await db.query(insert, ['jnl_reserve', 'claim_reserve', 'clm_t1']);
    await db.query(insert, ['jnl_release', 'claim_reserve', 'dec_t1']);
    await rejects(insert, ['jnl_other', 'claim_reserve', 'dec_unknown'], RAISE_EXCEPTION);
    await rejects(insert, ['jnl_claim', 'claim_decision', 'clm_t1'], RAISE_EXCEPTION);
    await rejects(insert, ['jnl_kind', 'claim_guess', 'clm_t1'], CHECK_VIOLATION);
  });
});
