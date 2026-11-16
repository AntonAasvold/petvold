/**
 * PolicyStore against the schema `policies` (migration 0021). Connect with the
 * service role `policies_service`: it may insert and read, and may only set
 * the end of a version in system time. The database stops overlapping versions
 * of a policy and two active policies for one animal on the same day.
 * Migration 0022 adds cancellation fields and the outbox (ADR 0008, 0029), and
 * migration 0023 renewal, migration 0025 proposals and transfer, and migration
 * 0026 changes during a term. Migration 0029 adds applications (ADR 0031),
 * and migration 0030 the decisions on referred ones.
 */
import type pg from 'pg';
import {
  PolicyConflictError,
  type Application,
  type ApplicationDecision,
  type ApplicationFilter,
  type IssueExtra,
  type ISODate,
  type Policy,
  type PolicyEvent,
  type Proposal,
  type ProposalDecision,
  type PolicyRecord,
  type PolicyStore,
  type PolicyTransaction,
  type PolicyVersion,
  type ApplyExtra,
  type GroupMembership,
  type PolicyGroup,
  type Term,
  type TermChange,
} from './index.ts';

const EXCLUSION_VIOLATION = '23P01';
const UNIQUE_VIOLATION = '23505';
const VERSION = `version_id, policy_id, valid_from::text as valid_from, valid_to::text as valid_to, sys_from, sys_to,
  policyholder_party_id, status, term_no, change_no, transaction_id`;

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
         deductible_option, premium, riders, transaction_id, pricing from policies.term where policy_id = $1 order by term_no`,
      [id],
    );
    const versions = await this.pool.query(`select ${VERSION} from policies.policy_version where policy_id = $1 and sys_to is null order by valid_from`, [id]);
    const changes = await this.pool.query(
      `select term_no, change_no, from_date::text as from_date, vet_care, deductible_option, premium, transaction_id, pricing
       from policies.term_change where policy_id = $1 order by term_no, change_no`,
      [id],
    );
    return {
      id: p.policy_id,
      market: p.market,
      animalId: p.animal_id,
      inceptionDate: p.inception_date,
      createdBy: p.created_by,
      createdAt: iso(p.created_at),
      terms: terms.rows.map(toTerm).map((t) => {
        const own = changes.rows
          .filter((c) => c.term_no === t.termNo)
          .map((c): TermChange => ({
            changeNo: c.change_no,
            from: c.from_date,
            vetCare: c.vet_care,
            deductibleOption: c.deductible_option,
            premium: Number(c.premium),
            transactionId: c.transaction_id,
            ...(c.pricing === null ? {} : { pricing: c.pricing }),
          }));
        return own.length ? { ...t, changes: own } : t;
      }),
      versions: versions.rows.map(toVersion),
    };
  }

  async history(id: string): Promise<PolicyVersion[]> {
    const { rows } = await this.pool.query(`select ${VERSION} from policies.policy_version where policy_id = $1 order by sys_from, valid_from`, [id]);
    return rows.map(toVersion);
  }

  async transactions(id: string): Promise<PolicyTransaction[]> {
    const { rows } = await this.pool.query(
      `select transaction_id, policy_id, type, steps, requested_by, requested_at, supersedes, cancellation, reverses, note, renewal, transfer, change, issue
       from policies.policy_transaction where policy_id = $1 order by requested_at, transaction_id`,
      [id],
    );
    return rows.map((r) => ({
      id: r.transaction_id,
      policyId: r.policy_id,
      type: r.type,
      steps: r.steps,
      requestedBy: r.requested_by,
      requestedAt: iso(r.requested_at),
      ...(r.supersedes === null ? {} : { supersedes: r.supersedes }),
      ...(r.cancellation === null ? {} : { cancellation: r.cancellation }),
      ...(r.reverses === null ? {} : { reverses: r.reverses }),
      ...(r.note === null ? {} : { note: r.note }),
      ...(r.renewal === null ? {} : { renewal: r.renewal }),
      ...(r.transfer === null ? {} : { transfer: r.transfer }),
      ...(r.change === null ? {} : { change: r.change }),
      ...(r.issue === null ? {} : { issue: r.issue }),
    }));
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

  async endingBetween(from: ISODate, to: ISODate): Promise<string[]> {
    const { rows } = await this.pool.query(
      `select distinct v.policy_id from policies.policy_version v
       where v.sys_to is null and v.status = 'active' and v.valid_to between $1 and $2
         and not exists (select 1 from policies.policy_version n where n.policy_id = v.policy_id and n.sys_to is null and n.valid_from = v.valid_to)
       order by v.policy_id`,
      [from, to],
    );
    return rows.map((r) => r.policy_id);
  }

  async apply(
    policyId: string,
    supersede: string[],
    add: PolicyVersion[],
    tx: PolicyTransaction,
    events: PolicyEvent[],
    { terms = [], decision, changes = [], endMemberships = [] }: ApplyExtra = {},
  ): Promise<void> {
    await this.tx(async (db) => {
      if (supersede.length) {
        const res = await db.query(
          `update policies.policy_version set sys_to = $3 where policy_id = $1 and version_id = any($2) and sys_to is null`,
          [policyId, supersede, tx.requestedAt],
        );
        if (res.rowCount !== supersede.length) throw new PolicyConflictError(`Policy ${policyId} has changed`);
      }
      await insertTransaction(db, tx);
      for (const t of terms) await insertTerm(db, t);
      for (const c of changes) {
        await db.query(
          `insert into policies.term_change (policy_id, term_no, change_no, from_date, vet_care, deductible_option, premium, transaction_id, pricing)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [c.policyId, c.termNo, c.changeNo, c.from, JSON.stringify(c.vetCare), c.deductibleOption, c.premium, c.transactionId, c.pricing ? JSON.stringify(c.pricing) : null],
        );
      }
      const { rows } = await db.query(`select animal_id from policies.policy where policy_id = $1`, [policyId]);
      for (const v of add) await insertVersion(db, v, rows[0].animal_id);
      await insertEvents(db, events);
      if (decision) await insertDecision(db, decision.proposalId, decision.decision);
      for (const e of endMemberships) await endMembership(db, e.groupId, e.policyId, e);
    }, policyId);
  }

  async createGroup(g: PolicyGroup): Promise<void> {
    await this.pool.query(
      `insert into policies.policy_group (group_id, market, kind, holder_party_id, litter_id, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7)`,
      [g.id, g.market, g.kind, g.holderPartyId, g.litterId ?? null, g.createdBy, g.createdAt],
    );
  }

  async getGroup(id: string): Promise<PolicyGroup | null> {
    return (await this.groups(`where g.group_id = $1`, [id]))[0] ?? null;
  }

  async findGroups(filter: { holderPartyId?: string; policyId?: string }): Promise<PolicyGroup[]> {
    return this.groups(
      `where ($1::text is null or g.holder_party_id = $1)
         and ($2::text is null or exists (select 1 from policies.group_membership m where m.group_id = g.group_id and m.policy_id = $2))`,
      [filter.holderPartyId ?? null, filter.policyId ?? null],
    );
  }

  async addMember(groupId: string, m: GroupMembership): Promise<void> {
    await this.pool
      .query(`insert into policies.group_membership (group_id, policy_id, from_date, added_by, added_at) values ($1, $2, $3, $4, $5)`, [
        groupId,
        m.policyId,
        m.from,
        m.addedBy,
        m.addedAt,
      ])
      .catch((e: { code?: string }) => {
        if (e.code === UNIQUE_VIOLATION) throw new PolicyConflictError(`Policy ${m.policyId} is already a member of a group`);
        throw e;
      });
  }

  async endMember(groupId: string, policyId: string, end: { to: string; endedBy: string; endedAt: string; reason: string }): Promise<void> {
    const db = await this.pool.connect();
    try {
      await endMembership(db, groupId, policyId, end, true);
    } finally {
      db.release();
    }
  }

  private async groups(where: string, params: unknown[]): Promise<PolicyGroup[]> {
    const { rows } = await this.pool.query(
      `select group_id, market, kind, holder_party_id, litter_id, created_by, created_at from policies.policy_group g ${where} order by g.created_at, g.group_id`,
      params,
    );
    if (!rows.length) return [];
    const members = await this.pool.query(
      `select group_id, policy_id, from_date::text as from_date, to_date::text as to_date, added_by, added_at, ended_by, ended_at, end_reason
       from policies.group_membership where group_id = any($1) order by from_date, policy_id`,
      [rows.map((r) => r.group_id)],
    );
    return rows.map((r) => ({
      id: r.group_id,
      market: r.market,
      kind: r.kind,
      holderPartyId: r.holder_party_id,
      ...(r.litter_id === null ? {} : { litterId: r.litter_id }),
      createdBy: r.created_by,
      createdAt: iso(r.created_at),
      members: members.rows
        .filter((m) => m.group_id === r.group_id)
        .map((m) => ({
          policyId: m.policy_id,
          from: m.from_date,
          ...(m.to_date === null ? {} : { to: m.to_date }),
          addedBy: m.added_by,
          addedAt: iso(m.added_at),
          ...(m.ended_by === null ? {} : { endedBy: m.ended_by, endedAt: iso(m.ended_at), endReason: m.end_reason }),
        })),
    }));
  }

  async addProposal(p: Proposal, events: PolicyEvent[]): Promise<boolean> {
    let added = false;
    await this.tx(async (db) => {
      const res = await db.query(
        `insert into policies.proposal (proposal_id, policy_id, market, kind, source_event_id, details, deadline, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (source_event_id) do nothing`,
        [p.id, p.policyId, p.market, p.kind, p.sourceEventId, JSON.stringify(p.details), p.deadline ?? null, p.createdAt],
      );
      added = res.rowCount === 1;
      if (added) await insertEvents(db, events);
    }, p.policyId);
    return added;
  }

  async getProposal(id: string): Promise<Proposal | null> {
    const { rows } = await this.pool.query(`${PROPOSALS} where p.proposal_id = $1`, [id]);
    return rows[0] ? toProposal(rows[0]) : null;
  }

  async listProposals(filter: { policyId?: string; pending?: boolean }): Promise<Proposal[]> {
    const { rows } = await this.pool.query(
      `${PROPOSALS} where ($1::text is null or p.policy_id = $1) and ($2::boolean is null or (d.proposal_id is null) = $2) order by p.created_at, p.proposal_id`,
      [filter.policyId ?? null, filter.pending ?? null],
    );
    return rows.map(toProposal);
  }

  async decideProposal(proposalId: string, decision: ProposalDecision): Promise<void> {
    await this.tx(async (db) => insertDecision(db, proposalId, decision), proposalId);
  }

  async pendingEvents(limit: number): Promise<PolicyEvent[]> {
    const { rows } = await this.pool.query(
      `select event_id, type, policy_id, application_id, occurred_at, data from policies.outbox where published_at is null order by seq limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.event_id,
      type: r.type,
      ...(r.policy_id === null ? {} : { policyId: r.policy_id }),
      ...(r.application_id === null ? {} : { applicationId: r.application_id }),
      occurredAt: iso(r.occurred_at),
      data: r.data,
    }));
  }

  async markPublished(ids: string[], at: string): Promise<void> {
    await this.pool.query(`update policies.outbox set published_at = $2 where event_id = any($1) and published_at is null`, [ids, at]);
  }

  async addApplication(a: Application, events: PolicyEvent[]): Promise<void> {
    await this.tx(async (db) => {
      await insertApplication(db, a);
      await insertEvents(db, events);
    }, a.id);
  }

  async getApplication(id: string): Promise<Application | null> {
    const { rows } = await this.pool.query(`${APPLICATIONS} where a.application_id = $1`, [id]);
    return rows[0] ? toApplication(rows[0]) : null;
  }

  async listApplications(f: ApplicationFilter): Promise<Application[]> {
    const { rows } = await this.pool.query(
      `${APPLICATIONS} where ($1::text is null or coalesce(d.outcome, a.status) = $1) and ($2::text is null or a.market = $2)
         and ($3::text is null or a.animal_id = $3) and ($4::text is null or a.policyholder_party_id = $4)
       order by a.received_at, a.application_id`,
      [f.status ?? null, f.market ?? null, f.animalId ?? null, f.policyholderPartyId ?? null],
    );
    return rows.map(toApplication);
  }

  async decideApplication(applicationId: string, decision: ApplicationDecision, events: PolicyEvent[]): Promise<void> {
    await this.tx(async (db) => {
      await insertApplicationDecision(db, applicationId, decision);
      await insertEvents(db, events);
    }, applicationId);
  }

  async issue(p: Policy, t: Term, v: PolicyVersion, tx: PolicyTransaction, events: PolicyEvent[], { application, decision }: IssueExtra = {}): Promise<void> {
    await this.tx(async (db) => {
      await db.query(`insert into policies.policy (policy_id, market, animal_id, inception_date, created_by, created_at) values ($1, $2, $3, $4, $5, $6)`, [
        p.id,
        p.market,
        p.animalId,
        p.inceptionDate,
        p.createdBy,
        p.createdAt,
      ]);
      await insertTransaction(db, tx);
      await insertTerm(db, t);
      await insertVersion(db, v, p.animalId);
      if (application) await insertApplication(db, application);
      if (decision) await insertApplicationDecision(db, decision.applicationId, decision.decision);
      await insertEvents(db, events);
    }, p.id, p.animalId);
  }

  private async tx(fn: (db: pg.PoolClient) => Promise<void>, policyId: string, animalId?: string): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      await fn(db);
      await db.query('commit');
    } catch (e) {
      await db.query('rollback');
      const code = (e as { code?: string }).code;
      if (code === EXCLUSION_VIOLATION) throw new PolicyConflictError(`The animal ${animalId ?? 'of ' + policyId} already has a policy for that period`);
      if (code === UNIQUE_VIOLATION) throw new PolicyConflictError(`Policy ${policyId} exists or has changed`);
      throw e;
    } finally {
      db.release();
    }
  }
}

const PROPOSALS = `select p.proposal_id, p.policy_id, p.market, p.kind, p.source_event_id, p.details, p.deadline::text as deadline, p.created_at,
  d.outcome, d.acceptance, d.reason, d.transaction_id, d.decided_by, d.decided_at
  from policies.proposal p left join policies.proposal_decision d using (proposal_id)`;

function toProposal(r: Record<string, any>): Proposal {
  return {
    id: r.proposal_id,
    policyId: r.policy_id,
    market: r.market,
    kind: r.kind,
    sourceEventId: r.source_event_id,
    details: r.details,
    ...(r.deadline === null ? {} : { deadline: r.deadline }),
    createdAt: iso(r.created_at),
    ...(r.outcome === null
      ? {}
      : {
          decision: {
            outcome: r.outcome,
            ...(r.acceptance === null ? {} : { acceptance: r.acceptance }),
            ...(r.reason === null ? {} : { reason: r.reason }),
            ...(r.transaction_id === null ? {} : { transactionId: r.transaction_id }),
            decidedBy: r.decided_by,
            decidedAt: iso(r.decided_at),
          },
        }),
  };
}

async function insertDecision(db: pg.PoolClient, proposalId: string, d: ProposalDecision) {
  await db.query(
    `insert into policies.proposal_decision (proposal_id, outcome, acceptance, reason, transaction_id, decided_by, decided_at) values ($1, $2, $3, $4, $5, $6, $7)`,
    [proposalId, d.outcome, d.acceptance ? JSON.stringify(d.acceptance) : null, d.reason ?? null, d.transactionId ?? null, d.decidedBy, d.decidedAt],
  );
}

async function endMembership(
  db: pg.PoolClient,
  groupId: string,
  policyId: string,
  end: { to: string; endedBy: string; endedAt: string; reason: string },
  mustExist = false,
) {
  const res = await db.query(
    `update policies.group_membership set to_date = $3, ended_by = $4, ended_at = $5, end_reason = $6
     where group_id = $1 and policy_id = $2 and to_date is null`,
    [groupId, policyId, end.to, end.endedBy, end.endedAt, end.reason],
  );
  if (mustExist && res.rowCount !== 1) throw new PolicyConflictError(`Policy ${policyId} is not a member of group ${groupId}`);
}

async function insertTerm(db: pg.PoolClient, t: Term) {
  await db.query(
    `insert into policies.term (policy_id, term_no, start_date, end_date, product_version, currency, vet_care, deductible_option, premium, riders, transaction_id, pricing)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      t.policyId,
      t.termNo,
      t.startDate,
      t.endDate,
      t.productVersion,
      t.currency,
      JSON.stringify(t.vetCare),
      t.deductibleOption,
      t.premium,
      JSON.stringify(t.riders),
      t.transactionId,
      t.pricing ? JSON.stringify(t.pricing) : null,
    ],
  );
}

async function insertTransaction(db: pg.PoolClient, tx: PolicyTransaction) {
  await db.query(
    `insert into policies.policy_transaction (transaction_id, policy_id, type, steps, requested_by, requested_at, supersedes, cancellation, reverses, note, renewal, transfer, change, issue)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      tx.id,
      tx.policyId,
      tx.type,
      JSON.stringify(tx.steps),
      tx.requestedBy,
      tx.requestedAt,
      tx.supersedes ?? null,
      tx.cancellation ? JSON.stringify(tx.cancellation) : null,
      tx.reverses ?? null,
      tx.note ?? null,
      tx.renewal ? JSON.stringify(tx.renewal) : null,
      tx.transfer ? JSON.stringify(tx.transfer) : null,
      tx.change ? JSON.stringify(tx.change) : null,
      tx.issue ? JSON.stringify(tx.issue) : null,
    ],
  );
}

async function insertVersion(db: pg.PoolClient, v: PolicyVersion, animalId: string) {
  await db.query(
    `insert into policies.policy_version (version_id, policy_id, animal_id, valid_from, valid_to, sys_from, sys_to, policyholder_party_id, status, term_no, change_no, transaction_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [v.id, v.policyId, animalId, v.validFrom, v.validTo, v.sysFrom, v.sysTo ?? null, v.policyholderPartyId, v.status, v.termNo, v.changeNo ?? null, v.transactionId],
  );
}

async function insertEvents(db: pg.PoolClient, events: PolicyEvent[]) {
  for (const e of events) {
    await db.query(`insert into policies.outbox (event_id, policy_id, application_id, type, occurred_at, data) values ($1, $2, $3, $4, $5, $6)`, [
      e.id,
      e.policyId ?? null,
      e.applicationId ?? null,
      e.type,
      e.occurredAt,
      JSON.stringify(e.data),
    ]);
  }
}

const iso = (d: Date | string) => new Date(d).toISOString();

const APPLICATIONS = `select a.application_id, a.market, a.animal_id, a.policyholder_party_id, a.product_version, a.start_date::text as start_date, a.choices,
  a.acceptance, a.premium, a.currency, a.status, a.deadline::text as deadline, a.underwriting, a.policy_id, a.received_by, a.received_at,
  d.outcome, d.riders, d.reason, d.note, d.policy_id as decision_policy_id, d.decided_by, d.decided_at
  from policies.application a left join policies.application_decision d using (application_id)`;

async function insertApplicationDecision(db: pg.PoolClient, applicationId: string, d: ApplicationDecision) {
  // Two decisions at once: the primary key lets one win, and the other gets a unique violation (a conflict).
  const { rows } = await db.query(
    `select a.status, d.outcome from policies.application a left join policies.application_decision d using (application_id) where a.application_id = $1`,
    [applicationId],
  );
  if (rows[0]?.status !== 'referred' || rows[0]?.outcome) throw new PolicyConflictError(`Application ${applicationId} is not waiting for a decision`);
  await db.query(
    `insert into policies.application_decision (application_id, outcome, riders, reason, note, policy_id, decided_by, decided_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [applicationId, d.outcome, d.riders ? JSON.stringify(d.riders) : null, d.reason ?? null, d.note ?? null, d.policyId ?? null, d.decidedBy, d.decidedAt],
  );
}

async function insertApplication(db: pg.PoolClient, a: Application) {
  const choices = { ...(a.vetCare ? { vetCare: a.vetCare } : {}), ...(a.groupId ? { groupId: a.groupId } : {}), ...(a.campaignCode ? { campaignCode: a.campaignCode } : {}) };
  await db.query(
    `insert into policies.application (application_id, market, animal_id, policyholder_party_id, product_version, start_date, choices, acceptance,
       premium, currency, status, underwriting, policy_id, received_by, received_at, deadline)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      a.id,
      a.market,
      a.animalId,
      a.policyholderPartyId,
      a.productVersion,
      a.startDate,
      JSON.stringify(choices),
      JSON.stringify(a.acceptance),
      a.premium.amount,
      a.premium.currency,
      a.status,
      JSON.stringify(a.underwriting),
      a.policyId ?? null,
      a.receivedBy,
      a.receivedAt,
      a.deadline ?? null,
    ],
  );
}

function toApplication(r: Record<string, any>): Application {
  return {
    id: r.application_id,
    market: r.market,
    animalId: r.animal_id,
    policyholderPartyId: r.policyholder_party_id,
    productVersion: r.product_version,
    startDate: r.start_date,
    ...r.choices,
    acceptance: r.acceptance,
    premium: { amount: Number(r.premium), currency: r.currency },
    status: r.outcome ?? r.status,
    ...(r.deadline === null ? {} : { deadline: r.deadline }),
    ...(r.outcome === null
      ? {}
      : {
          decision: {
            outcome: r.outcome,
            ...(r.riders === null ? {} : { riders: r.riders }),
            ...(r.reason === null ? {} : { reason: r.reason }),
            ...(r.note === null ? {} : { note: r.note }),
            ...(r.decision_policy_id === null ? {} : { policyId: r.decision_policy_id }),
            decidedBy: r.decided_by,
            decidedAt: iso(r.decided_at),
          },
        }),
    underwriting: r.underwriting,
    ...((r.policy_id ?? r.decision_policy_id) === null ? {} : { policyId: r.policy_id ?? r.decision_policy_id }),
    receivedBy: r.received_by,
    receivedAt: iso(r.received_at),
  };
}

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
    ...(r.pricing === null || r.pricing === undefined ? {} : { pricing: r.pricing }),
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
    ...(r.change_no === null ? {} : { changeNo: r.change_no }),
    transactionId: r.transaction_id,
  };
}
