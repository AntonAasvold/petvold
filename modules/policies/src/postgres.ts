/**
 * PolicyStore against the schema `policies` (migration 0021). Connect with the
 * service role `policies_service`: it may insert and read, and may only set
 * the end of a version in system time. The database stops overlapping versions
 * of a policy and two active policies for one animal on the same day.
 */
import type pg from 'pg';
import {
  PolicyConflictError,
  type ISODate,
  type Policy,
  type PolicyRecord,
  type PolicyStore,
  type PolicyTransaction,
  type PolicyVersion,
  type Term,
} from './index.ts';

const EXCLUSION_VIOLATION = '23P01';
const UNIQUE_VIOLATION = '23505';
const VERSION = `version_id, policy_id, valid_from::text as valid_from, valid_to::text as valid_to, sys_from, sys_to,
  policyholder_party_id, status, term_no, transaction_id`;

export class PostgresPolicyStore implements PolicyStore {
  constructor(private readonly pool: pg.Pool) {}

  async get(id: string): Promise<PolicyRecord | null> {
    const { rows } = await this.pool.query(
      `select policy_id, market, animal_id, inception_date::text as inception_date, created_by, created_at from policies.policy where policy_id = $1`,
      [id],
    );
    const p = rows[0];
    if (!p) return null;
    const terms = await this.pool.query(
      `select policy_id, term_no, start_date::text as start_date, end_date::text as end_date, product_version, currency, vet_care,
         deductible_option, premium, riders, transaction_id from policies.term where policy_id = $1 order by term_no`,
      [id],
    );
    const versions = await this.pool.query(`select ${VERSION} from policies.policy_version where policy_id = $1 and sys_to is null order by valid_from`, [id]);
    return {
      id: p.policy_id,
      market: p.market,
      animalId: p.animal_id,
      inceptionDate: p.inception_date,
      createdBy: p.created_by,
      createdAt: iso(p.created_at),
      terms: terms.rows.map(toTerm),
      versions: versions.rows.map(toVersion),
    };
  }

  async history(id: string): Promise<PolicyVersion[]> {
    const { rows } = await this.pool.query(`select ${VERSION} from policies.policy_version where policy_id = $1 order by sys_from, valid_from`, [id]);
    return rows.map(toVersion);
  }

  async transactions(id: string): Promise<PolicyTransaction[]> {
    const { rows } = await this.pool.query(
      `select transaction_id, policy_id, type, steps, requested_by, requested_at from policies.policy_transaction where policy_id = $1 order by requested_at, transaction_id`,
      [id],
    );
    return rows.map((r) => ({ id: r.transaction_id, policyId: r.policy_id, type: r.type, steps: r.steps, requestedBy: r.requested_by, requestedAt: iso(r.requested_at) }));
  }

  async versionAt(id: string, onDate: ISODate, knownAt?: string): Promise<PolicyVersion | null> {
    const { rows } = await this.pool.query(
      `select ${VERSION} from policies.policy_version
       where policy_id = $1 and valid_from <= $2 and $2 < valid_to
         and (case when $3::timestamptz is null then sys_to is null else sys_from <= $3 and (sys_to is null or $3 < sys_to) end)`,
      [id, onDate, knownAt ?? null],
    );
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async findByAnimal(animalId: string): Promise<string[]> {
    const { rows } = await this.pool.query(`select policy_id from policies.policy where animal_id = $1 order by policy_id`, [animalId]);
    return rows.map((r) => r.policy_id);
  }

  async findByPolicyholder(partyId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `select distinct policy_id from policies.policy_version where policyholder_party_id = $1 and sys_to is null order by policy_id`,
      [partyId],
    );
    return rows.map((r) => r.policy_id);
  }

  async issue(p: Policy, t: Term, v: PolicyVersion, tx: PolicyTransaction): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      await db.query(`insert into policies.policy (policy_id, market, animal_id, inception_date, created_by, created_at) values ($1, $2, $3, $4, $5, $6)`, [
        p.id,
        p.market,
        p.animalId,
        p.inceptionDate,
        p.createdBy,
        p.createdAt,
      ]);
      await db.query(
        `insert into policies.policy_transaction (transaction_id, policy_id, type, steps, requested_by, requested_at) values ($1, $2, $3, $4, $5, $6)`,
        [tx.id, tx.policyId, tx.type, JSON.stringify(tx.steps), tx.requestedBy, tx.requestedAt],
      );
      await db.query(
        `insert into policies.term (policy_id, term_no, start_date, end_date, product_version, currency, vet_care, deductible_option, premium, riders, transaction_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [t.policyId, t.termNo, t.startDate, t.endDate, t.productVersion, t.currency, JSON.stringify(t.vetCare), t.deductibleOption, t.premium, JSON.stringify(t.riders), t.transactionId],
      );
      await db.query(
        `insert into policies.policy_version (version_id, policy_id, animal_id, valid_from, valid_to, sys_from, sys_to, policyholder_party_id, status, term_no, transaction_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [v.id, v.policyId, p.animalId, v.validFrom, v.validTo, v.sysFrom, v.sysTo ?? null, v.policyholderPartyId, v.status, v.termNo, v.transactionId],
      );
      await db.query('commit');
    } catch (e) {
      await db.query('rollback');
      const code = (e as { code?: string }).code;
      if (code === EXCLUSION_VIOLATION) throw new PolicyConflictError(`The animal ${p.animalId} already has a policy for that period`);
      if (code === UNIQUE_VIOLATION) throw new PolicyConflictError(`Policy ${p.id} exists`);
      throw e;
    } finally {
      db.release();
    }
  }
}

const iso = (d: Date | string) => new Date(d).toISOString();

function toTerm(r: Record<string, any>): Term {
  return {
    policyId: r.policy_id,
    termNo: r.term_no,
    startDate: r.start_date,
    endDate: r.end_date,
    productVersion: r.product_version,
    currency: r.currency,
    vetCare: r.vet_care,
    deductibleOption: r.deductible_option,
    premium: Number(r.premium),
    riders: r.riders,
    transactionId: r.transaction_id,
  };
}

function toVersion(r: Record<string, any>): PolicyVersion {
  return {
    id: r.version_id,
    policyId: r.policy_id,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    sysFrom: iso(r.sys_from),
    ...(r.sys_to === null ? {} : { sysTo: iso(r.sys_to) }),
    policyholderPartyId: r.policyholder_party_id,
    status: r.status,
    termNo: r.term_no,
    transactionId: r.transaction_id,
  };
}
