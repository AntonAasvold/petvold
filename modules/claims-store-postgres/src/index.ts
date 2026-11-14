/**
 * ClaimsStore against the Postgres schema `claims` (db/migrations).
 *
 * Connect with the service role `claims_service`, which may only read and
 * insert. The database itself enforces balance, non-overlap and immutable
 * history. This code translates database errors into the port's errors.
 * The behaviour is proven by the shared suite in @petvold/claims-core.
 */
import pg from 'pg';
import {
  StoreConflictError,
  type Claim,
  type ClaimDecision,
  type ClaimsStore,
  type DecisionCommit,
  type DeductiblePeriod,
  type ISODate,
  type MinorUnits,
} from '@petvold/claims-core';

// Types: dates as 'YYYY-MM-DD', bigint as numbers, timestamps as ISO strings.
// Without this, pg turns date into a Date in the local time zone, and bigint into a string.
const DATE = 1082;
const INT8 = 20;
const NUMERIC = 1700;
const TIMESTAMPTZ = 1184;

function toSafeInt(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Amount outside the safe integer range: ${v}`);
  return n;
}

const types = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (oid === DATE) return (v: string) => v;
    if (oid === INT8 || oid === NUMERIC) return toSafeInt;
    if (oid === TIMESTAMPTZ) return (v: string) => new Date(v).toISOString();
    return pg.types.getTypeParser(oid, format);
  },
} as pg.CustomTypesConfig;

/** Creates a pool with Petvold's type parsing. The caller owns the pool and closes it. */
export function createPool(connectionString: string, options: Omit<pg.PoolConfig, 'connectionString' | 'types'> = {}): pg.Pool {
  return new pg.Pool({ connectionString, types, ...options });
}

// Postgres error codes (SQLSTATE).
const UNIQUE_VIOLATION = '23505';
const EXCLUSION_VIOLATION = '23P01';

type PgError = { code?: string; constraint?: string };

export class PostgresClaimsStore implements ClaimsStore {
  constructor(private readonly pool: pg.Pool) {}

  async saveClaim(claim: Claim): Promise<void> {
    await this.tx(async (db) => {
      await db.query(
        `insert into claims.claim (id, claim_no, policy_id, animal_id, market, currency, channel, treatment_from, treatment_to, diagnosis_code, received_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          claim.id,
          claim.claimNo,
          claim.policyId,
          claim.animalId,
          claim.market,
          claim.currency,
          claim.channel,
          claim.treatmentFrom,
          claim.treatmentTo,
          claim.diagnosisCode,
          claim.receivedAt,
        ],
      );
      for (const [i, l] of claim.lines.entries()) {
        await db.query(
          `insert into claims.claim_line (claim_id, line_id, line_no, description, category, diagnosis_code, amount_minor, vat_minor)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [claim.id, l.id, i + 1, l.description, l.category, l.diagnosisCode ?? null, l.amount, l.vat ?? null],
        );
      }
    }).catch((e: PgError) => {
      if (e.code === UNIQUE_VIOLATION && (e.constraint === 'claim_pkey' || e.constraint === 'claim_claim_no_key')) {
        throw new StoreConflictError('claim_exists', `Claim ${claim.id} (${claim.claimNo}) already exists`);
      }
      throw e;
    });
  }

  async getClaim(claimId: string): Promise<Claim | null> {
    const { rows } = await this.pool.query(
      `select id, claim_no, policy_id, animal_id, market, currency, channel, treatment_from, treatment_to, diagnosis_code, received_at
       from claims.claim where id = $1`,
      [claimId],
    );
    const c = rows[0];
    if (!c) return null;
    const lines = await this.pool.query(
      `select line_id, description, category, diagnosis_code, amount_minor, vat_minor
       from claims.claim_line where claim_id = $1 order by line_no`,
      [claimId],
    );
    return {
      id: c.id,
      claimNo: c.claim_no,
      policyId: c.policy_id,
      animalId: c.animal_id,
      market: c.market,
      currency: c.currency,
      channel: c.channel,
      treatmentFrom: c.treatment_from,
      treatmentTo: c.treatment_to,
      diagnosisCode: c.diagnosis_code,
      receivedAt: c.received_at,
      lines: lines.rows.map((l) => ({
        id: l.line_id,
        description: l.description,
        category: l.category,
        ...(l.diagnosis_code !== null ? { diagnosisCode: l.diagnosis_code } : {}),
        amount: l.amount_minor,
        ...(l.vat_minor !== null ? { vat: l.vat_minor } : {}),
      })),
    };
  }

  async findDeductiblePeriod(
    animalId: string,
    diagnosisGroup: string,
    onDate: ISODate,
    excludeClaimId?: string,
  ): Promise<DeductiblePeriod | null> {
    const { rows } = await this.pool.query(
      `select id, animal_id, diagnosis_group, lower(valid) as valid_from, upper(valid) as valid_to, opened_by_claim_id
       from claims.deductible_period
       where animal_id = $1 and diagnosis_group = $2 and valid @> $3::date
         and ($4::text is null or opened_by_claim_id <> $4)
       limit 1`,
      [animalId, diagnosisGroup, onDate, excludeClaimId ?? null],
    );
    const p = rows[0];
    return p
      ? {
          id: p.id,
          animalId: p.animal_id,
          diagnosisGroup: p.diagnosis_group,
          validFrom: p.valid_from,
          validTo: p.valid_to,
          openedByClaimId: p.opened_by_claim_id,
        }
      : null;
  }

  async getConsumed(animalId: string, coverage: string, policyYearStart: ISODate, excludeClaimId?: string): Promise<MinorUnits> {
    const { rows } = await this.pool.query(
      `select coalesce(sum(jl.amount_minor), 0)::bigint as consumed
       from claims.journal_line jl join claims.journal j on j.id = jl.journal_id
       where jl.account = $1 and ($2::text is null or j.claim_id <> $2)`,
      [`limit_consumed:${animalId}:${coverage}:${policyYearStart}`, excludeClaimId ?? null],
    );
    return rows[0].consumed;
  }

  async getDecisions(claimId: string): Promise<ClaimDecision[]> {
    const { rows } = await this.pool.query(
      `select id, claim_id, seq, outcome, payout_minor, assessment, decided_by, decided_at, reason
       from claims.decision where claim_id = $1 order by seq`,
      [claimId],
    );
    return rows.map((d) => ({
      id: d.id,
      claimId: d.claim_id,
      seq: d.seq,
      outcome: d.outcome,
      payout: d.payout_minor,
      assessment: d.assessment,
      decidedBy: d.decided_by,
      decidedAt: d.decided_at,
      ...(d.reason !== null ? { reason: d.reason } : {}),
    }));
  }

  async commitDecision({ decision: d, journals, deductiblePeriod: p }: DecisionCommit): Promise<void> {
    await this.tx(async (db) => {
      const a = d.assessment;
      await db.query(
        `insert into claims.decision (id, claim_id, seq, outcome, payout_minor, currency, assessment, input_hash,
                                      rules_version, product_version, policy_version_id, decided_by, decided_at, reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          d.id,
          d.claimId,
          d.seq,
          d.outcome,
          d.payout,
          a.currency,
          JSON.stringify(a),
          a.inputHash,
          a.rulesVersion,
          a.productVersion,
          a.policyVersionId,
          d.decidedBy,
          d.decidedAt,
          d.reason ?? null,
        ],
      );
      for (const j of journals) {
        await db.query(
          `insert into claims.journal (id, source_type, source_id, claim_id, currency, booked_at) values ($1, $2, $3, $4, $5, $6)`,
          [j.id, j.sourceType, j.sourceId, j.claimId, j.currency, j.bookedAt],
        );
        for (const [i, l] of j.lines.entries()) {
          await db.query(`insert into claims.journal_line (journal_id, line_no, account, amount_minor) values ($1, $2, $3, $4)`, [
            j.id,
            i + 1,
            l.account,
            l.amount,
          ]);
        }
      }
      await db.query(`delete from claims.deductible_period where opened_by_claim_id = $1`, [d.claimId]);
      if (p) {
        await db.query(
          `insert into claims.deductible_period (id, animal_id, diagnosis_group, valid, opened_by_claim_id)
           values ($1, $2, $3, daterange($4::date, $5::date, '[)'), $6)`,
          [p.id, p.animalId, p.diagnosisGroup, p.validFrom, p.validTo, p.openedByClaimId],
        );
      }
    }).catch((e: PgError) => {
      if (e.code === UNIQUE_VIOLATION && (e.constraint === 'decision_claim_id_seq_key' || e.constraint === 'decision_pkey')) {
        throw new StoreConflictError('decision_exists', `Decision ${d.claimId}#${d.seq} already exists`);
      }
      if (e.code === EXCLUSION_VIOLATION) {
        throw new StoreConflictError('period_overlaps', `The deductible period for ${d.claimId} clashes with another period`);
      }
      throw e;
    });
  }

  /** Runs `fn` in a transaction. Errors roll everything back, including errors detected at commit. */
  private async tx(fn: (db: pg.PoolClient) => Promise<void>): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      await fn(db);
      await db.query('commit');
    } catch (e) {
      await db.query('rollback').catch(() => {});
      throw e;
    } finally {
      db.release();
    }
  }
}
