/**
 * Databastester (lager 6, ADR 0012): reglerna som Postgres själv upprätthåller
 * i schemat `claims`. Körs mot TEST_DATABASE_URL efter `npm run dev:up`.
 * Varje test körs i en transaktion som rullas tillbaka.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL saknas. Kopiera .env.example till .env och kör npm run dev:up.');

const db = new pg.Client({ connectionString: url });
before(() => db.connect());
after(() => db.end());

/** Kör `fn` i en transaktion som alltid rullas tillbaka. */
async function inTx(fn: () => Promise<void>): Promise<void> {
  await db.query('begin');
  try {
    await fn();
  } finally {
    await db.query('rollback');
  }
}

/** Fångar ett förväntat databasfel i en savepoint, så att transaktionen kan fortsätta. */
async function rejects(sql: string, params: unknown[], code: string): Promise<void> {
  await db.query('savepoint s');
  await assert.rejects(db.query(sql, params), (e: { code?: string }) => e.code === code);
  await db.query('rollback to savepoint s');
}

const PERMISSION_DENIED = '42501';
const EXCLUSION_VIOLATION = '23P01';
const RAISE_EXCEPTION = 'P0001';

async function seedDecision(): Promise<void> {
  await db.query(
    `insert into claims.claim (id, claim_no, policy_id, animal_id, market, currency, channel, treatment_from, treatment_to, diagnosis_code)
     values ('clm_t1', 'T-1', 'pol_t', 'ani_t', 'SE', 'SEK', 'customer', '2026-10-01', '2026-10-01', 'ORA-OTIT')`,
  );
  await db.query(
    `insert into claims.decision (id, claim_id, seq, outcome, payout_minor, currency, assessment, input_hash, rules_version, decided_by)
     values ('dec_t1', 'clm_t1', 1, 'approved', 100000, 'SEK', '{}', 'h', 'SE-HUND-2026.2', 'auto')`,
  );
}

async function journal(id: string, amounts: number[]): Promise<void> {
  await db.query(`insert into claims.journal (id, source_type, source_id, claim_id) values ($1, 'claim_decision', 'dec_t1', 'clm_t1')`, [id]);
  for (const [i, a] of amounts.entries()) {
    await db.query(`insert into claims.journal_line (journal_id, line_no, account, amount_minor) values ($1, $2, $3, $4)`, [id, i + 1, `acc${i}`, a]);
  }
}

test('migreringarna har körts', async () => {
  const { rows } = await db.query(`select version from schema_migrations order by version`);
  assert.deepEqual(
    rows.map((r) => r.version),
    ['0001', '0002'],
  );
});

test('en journal som balanserar godtas', async () => {
  await inTx(async () => {
    await seedDecision();
    await journal('jnl_ok', [100000, -100000]);
    await db.query('set constraints all immediate');
  });
});

test('en journal som inte balanserar avvisas', async () => {
  await inTx(async () => {
    await seedDecision();
    await journal('jnl_bad', [100000, -99999]);
    await rejects('set constraints all immediate', [], RAISE_EXCEPTION);
  });
});

test('självriskperioder för samma djur och grupp får inte överlappa', async () => {
  await inTx(async () => {
    await seedDecision();
    const insert = `insert into claims.deductible_period (id, animal_id, diagnosis_group, valid, opened_by_claim_id)
                    values ($1, 'ani_t', 'ora', $2::daterange, 'clm_t1')`;
    await db.query(insert, ['dp1', '[2026-10-01,2027-02-03)']);
    await rejects(insert, ['dp2', '[2027-02-02,2027-06-01)'], EXCLUSION_VIOLATION);
    // Halvöppna intervall: en period som börjar där den förra slutar är tillåten.
    await db.query(insert, ['dp3', '[2027-02-03,2027-06-08)']);
  });
});

test('tjänstekontot kan inte ändra eller radera beslut och ledger', async () => {
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

test('tjänstekontot kan läsa, lägga till och ersätta självriskperioder', async () => {
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

test('tjänstekontot kan bara markera händelser som publicerade', async () => {
  await inTx(async () => {
    await db.query('set local role claims_service');
    await db.query(`insert into claims.outbox (type, aggregate_id, payload) values ('claim.registered', 'clm_t1', '{}')`);
    await db.query(`update claims.outbox set published_at = now() where aggregate_id = 'clm_t1'`);
    await rejects(`update claims.outbox set payload = '{"x":1}' where aggregate_id = 'clm_t1'`, [], PERMISSION_DENIED);
  });
});
