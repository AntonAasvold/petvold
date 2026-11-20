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
  accounts,
  eventClaimId,
  basisCompleteAt,
  informationMissing,
  type InformationRequest,
  type InformationRequestStatus,
  type ClaimCorrection,
  type ClaimData,
  type ClaimRevision,
  type ClaimAttachment,
  type LimitKey,
  type ClaimFilter,
  type ClaimSummary,
  type Claim,
  type ClaimClosure,
  type ClaimDecision,
  type ClaimsEvent,
  type ClaimsOutbox,
  type ClaimsStore,
  type OutboxEntry,
  type DecisionCommit,
  type DecisionEvidence,
  type DeductiblePeriod,
  type ReviewRequest,
  type DecisionProposal,
  type LedgerJournal,
  type ISODate,
  type MinorUnits,
  type Timestamp,
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

/** Writes events to the outbox within the caller's transaction (ADR 0008). */
async function insertEvents(db: pg.PoolClient, events: ClaimsEvent[]): Promise<void> {
  for (const e of events) {
    await db.query(`insert into claims.outbox (type, aggregate_id, payload, created_at) values ($1, $2, $3, $4)`, [
      e.type,
      eventClaimId(e),
      JSON.stringify(e),
      e.occurredAt,
    ]);
  }
}

/** Writes journals and their lines within the caller's transaction. The database checks the balance at commit. */
async function insertJournals(db: pg.PoolClient, journals: LedgerJournal[]): Promise<void> {
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
}

const DECISION_COLUMNS = `d.id, d.claim_id, d.seq, d.outcome, d.payout_minor, d.assessment, d.decided_by, d.decided_at, d.reason,
  d.deviates_from_proposal, d.reason_code, d.automated, d.review_request_id, d.approved_by, d.proposal_id, d.claim_revision`;

function toDecision(d: Record<string, any>): ClaimDecision {
  return {
    id: d.id,
    claimId: d.claim_id,
    seq: d.seq,
    outcome: d.outcome,
    payout: d.payout_minor,
    assessment: d.assessment,
    decidedBy: d.decided_by,
    decidedAt: d.decided_at,
    ...(d.reason !== null ? { reason: d.reason } : {}),
    deviatesFromProposal: d.deviates_from_proposal,
    ...(d.reason_code !== null ? { reasonCode: d.reason_code } : {}),
    automated: d.automated,
    ...(d.review_request_id !== null ? { reviewRequestId: d.review_request_id } : {}),
    ...(d.approved_by !== null ? { approvedBy: d.approved_by, proposalId: d.proposal_id } : {}),
    ...(d.claim_revision > 1 ? { claimRevision: d.claim_revision } : {}),
  };
}

const INFORMATION_SELECT = `select id, claim_id, recipient, items, note, due_date, remind_on, rules_version, requested_by, requested_at, status,
  reminded_at, received_at, closed_by, closed_at, closing_note from claims.information_request`;

function toInformationRequest(r: Record<string, any>): InformationRequest {
  return {
    id: r.id,
    claimId: r.claim_id,
    recipient: r.recipient,
    items: r.items,
    note: r.note,
    dueDate: r.due_date,
    ...(r.remind_on === null ? {} : { remindOn: r.remind_on }),
    rulesVersion: r.rules_version,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    status: r.status,
    ...(r.reminded_at === null ? {} : { remindedAt: r.reminded_at }),
    ...(r.received_at === null ? {} : { receivedAt: r.received_at }),
    ...(r.closed_by === null ? {} : { closedBy: r.closed_by, closedAt: r.closed_at }),
    ...(r.closing_note === null ? {} : { closingNote: r.closing_note }),
  };
}

/** basisCompleteAt and informationMissing for a claim in a list (ADR 0036). */
function withBasis(receivedAt: Timestamp, requests: InformationRequest[]): { basisCompleteAt?: Timestamp; informationMissing?: true } {
  const complete = basisCompleteAt(receivedAt, requests);
  return { ...(complete ? { basisCompleteAt: complete } : {}), ...(informationMissing(requests) ? { informationMissing: true } : {}) };
}

// Postgres error codes (SQLSTATE).
const UNIQUE_VIOLATION = '23505';
/** Raised by the triggers in migration 0037 (ADR 0036). */
const CLAIM_CLOSED = 'PVC01';
const CLAIM_DECIDED = 'PVC02';
const EXCLUSION_VIOLATION = '23P01';

type PgError = { code?: string; constraint?: string };

export class PostgresClaimsStore implements ClaimsStore, ClaimsOutbox {
  constructor(private readonly pool: pg.Pool) {}

  async saveClaim(claim: Claim, events: ClaimsEvent[], journals: LedgerJournal[] = []): Promise<void> {
    await this.tx(async (db) => {
      await db.query(
        `insert into claims.claim (id, claim_no, policy_id, animal_id, market, currency, channel, treatment_from, treatment_to, diagnosis_code,
                                   received_at, clinic_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
          claim.clinicId ?? null,
        ],
      );
      for (const [i, l] of claim.lines.entries()) {
        await db.query(
          `insert into claims.claim_line (claim_id, line_id, line_no, description, category, diagnosis_code, amount_minor, vat_minor)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [claim.id, l.id, i + 1, l.description, l.category, l.diagnosisCode ?? null, l.amount, l.vat ?? null],
        );
      }
      await insertJournals(db, journals);
      await insertEvents(db, events);
    }).catch((e: PgError) => {
      if (e.code === UNIQUE_VIOLATION && (e.constraint === 'claim_pkey' || e.constraint === 'claim_claim_no_key')) {
        throw new StoreConflictError('claim_exists', `Claim ${claim.id} (${claim.claimNo}) already exists`);
      }
      throw e;
    });
  }

  async claimNoTaken(claimNo: string): Promise<boolean> {
    const { rows } = await this.pool.query('select 1 from claims.claim where claim_no = $1', [claimNo]);
    return rows.length > 0;
  }

  async nextClaimNumber(year: number): Promise<number> {
    // One statement, so two callers never get the same number.
    const { rows } = await this.pool.query<{ last_no: number }>(
      `insert into claims.claim_number_series (year, last_no) values ($1, 1)
       on conflict (year) do update set last_no = claims.claim_number_series.last_no + 1
       returning last_no`,
      [year],
    );
    return rows[0]!.last_no;
  }

  async getClaim(claimId: string): Promise<Claim | null> {
    const { rows } = await this.pool.query(
      `select id, claim_no, policy_id, animal_id, market, currency, channel, treatment_from, treatment_to, diagnosis_code, received_at,
              clinic_id
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
    // The latest correction's details, if any (ADR 0036).
    const corrected = await this.pool.query<{ revision: number; data: ClaimData }>(
      `select revision, data from claims.claim_correction where claim_id = $1 order by revision desc limit 1`,
      [claimId],
    );
    const last = corrected.rows[0];
    const registered: Claim = {
      id: c.id,
      claimNo: c.claim_no,
      policyId: c.policy_id,
      animalId: c.animal_id,
      market: c.market,
      currency: c.currency,
      channel: c.channel,
      ...(c.clinic_id !== null ? { clinicId: c.clinic_id } : {}),
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
    return last ? { ...registered, ...last.data, revision: last.revision } : registered;
  }

  async correctClaim(correction: ClaimCorrection, data: ClaimData, events: ClaimsEvent[]): Promise<void> {
    await this.tx(async (db) => {
      // The revision before must be the latest: the primary key stops two corrections of the same revision.
      const { rows } = await db.query<{ latest: number }>(
        `select coalesce(max(revision), 1) as latest from claims.claim_correction where claim_id = $1`,
        [correction.claimId],
      );
      if (rows[0]!.latest !== correction.revision - 1) throw new StoreConflictError('revision_changed', `Claim ${correction.claimId} is at revision ${rows[0]!.latest}`);
      await db.query(
        `insert into claims.claim_correction (claim_id, revision, id, data, fields, reason, corrected_by, corrected_at, reopens)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [correction.claimId, correction.revision, correction.id, JSON.stringify(data), correction.fields, correction.reason, correction.correctedBy, correction.correctedAt, correction.reopens],
      );
      await insertEvents(db, events);
    }).catch((e: PgError) => {
      if (e.code === UNIQUE_VIOLATION && e.constraint === 'claim_correction_pkey') {
        throw new StoreConflictError('revision_changed', `Claim ${correction.claimId} already has revision ${correction.revision}`);
      }
      if (e.code === CLAIM_CLOSED) throw new StoreConflictError('claim_closed', `Claim ${correction.claimId} is closed`);
      throw e;
    });
  }

  async saveAttachment(a: ClaimAttachment, events: ClaimsEvent[]): Promise<void> {
    await this.tx(async (db) => {
      await db.query(
        `insert into claims.claim_attachment (id, claim_id, kind, media_type, size_bytes, sha256, url, information_request_id, replaces, added_by, added_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [a.id, a.claimId, a.kind, a.mediaType, a.size, a.sha256, a.url, a.informationRequestId ?? null, a.replaces ?? null, a.addedBy, a.addedAt],
      );
      await insertEvents(db, events);
    }).catch((e: PgError) => {
      if (e.code === UNIQUE_VIOLATION && e.constraint === 'claim_attachment_replaces_key') {
        throw new StoreConflictError('attachment_replaced', `Attachment ${a.replaces} is replaced already`);
      }
      if (e.code === CLAIM_CLOSED) throw new StoreConflictError('claim_closed', `Claim ${a.claimId} is closed`);
      throw e;
    });
  }

  async getAttachments(claimId: string): Promise<ClaimAttachment[]> {
    const { rows } = await this.pool.query(
      `select id, claim_id, kind, media_type, size_bytes, sha256, url, information_request_id, replaces, added_by, added_at
       from claims.claim_attachment where claim_id = $1 order by added_at, id`,
      [claimId],
    );
    return rows.map((r) => ({
      id: r.id,
      claimId: r.claim_id,
      kind: r.kind,
      mediaType: r.media_type,
      size: r.size_bytes,
      sha256: r.sha256,
      url: r.url,
      ...(r.information_request_id === null ? {} : { informationRequestId: r.information_request_id }),
      ...(r.replaces === null ? {} : { replaces: r.replaces }),
      addedBy: r.added_by,
      addedAt: r.added_at,
    }));
  }

  async getRevisions(claimId: string): Promise<ClaimRevision[]> {
    const claim = await this.pool.query(`select 1 from claims.claim where id = $1`, [claimId]);
    if (!claim.rows.length) return [];
    const { rows } = await this.pool.query(
      `select revision, id, data, fields, reason, corrected_by, corrected_at, reopens from claims.claim_correction where claim_id = $1 order by revision`,
      [claimId],
    );
    // Revision 1 is the claim as registered; read it without the corrections.
    const all = rows.map((r) => r.data as ClaimData);
    const registered = await this.registeredData(claimId);
    return [
      { revision: 1, data: registered },
      ...rows.map((r, i) => ({
        revision: r.revision,
        data: all[i]!,
        correction: { id: r.id, claimId, revision: r.revision, fields: r.fields, reason: r.reason, correctedBy: r.corrected_by, correctedAt: r.corrected_at, reopens: r.reopens },
      })),
    ];
  }

  private async registeredData(claimId: string): Promise<ClaimData> {
    const c = (await this.pool.query(`select channel, treatment_from, treatment_to, diagnosis_code from claims.claim where id = $1`, [claimId])).rows[0];
    const lines = await this.pool.query(
      `select line_id, description, category, diagnosis_code, amount_minor, vat_minor from claims.claim_line where claim_id = $1 order by line_no`,
      [claimId],
    );
    return {
      channel: c.channel,
      treatmentFrom: c.treatment_from,
      treatmentTo: c.treatment_to,
      diagnosisCode: c.diagnosis_code,
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

  async getBalance(account: string): Promise<MinorUnits> {
    const { rows } = await this.pool.query(
      `select coalesce(sum(amount_minor), 0)::bigint as balance from claims.journal_line where account = $1`,
      [account],
    );
    return rows[0].balance;
  }

  async getConsumed(limit: LimitKey, excludeClaimId?: string): Promise<MinorUnits> {
    const { rows } = await this.pool.query(
      `select coalesce(sum(jl.amount_minor), 0)::bigint as consumed
       from claims.journal_line jl join claims.journal j on j.id = jl.journal_id
       where jl.account = $1 and ($2::text is null or j.claim_id <> $2)`,
      [accounts.limitConsumed(limit), excludeClaimId ?? null],
    );
    return rows[0].consumed;
  }

  async getDecisions(claimId: string): Promise<ClaimDecision[]> {
    const { rows } = await this.pool.query(`select ${DECISION_COLUMNS} from claims.decision d where claim_id = $1 order by seq`, [claimId]);
    return rows.map(toDecision);
  }

  async latestDecisionsWithEvidence(from: Timestamp, to: Timestamp, limit: number) {
    const { rows } = await this.pool.query(
      `select ${DECISION_COLUMNS}, e.input, e.calculation_model, e.engine_version, e.attachments
       from claims.decision d
       join claims.decision_evidence e on e.decision_id = d.id
       where d.decided_at >= $1 and d.decided_at < $2
         and d.seq = (select max(seq) from claims.decision x where x.claim_id = d.claim_id)
       order by d.decided_at, d.id
       limit $3`,
      [from, to, limit],
    );
    return rows.map((r) => ({
      decision: toDecision(r),
      evidence: { decisionId: r.id, input: r.input, calculationModel: r.calculation_model, engineVersion: r.engine_version, ...(r.attachments === null ? {} : { attachments: r.attachments }) },
    }));
  }

  async listClaims(filter: ClaimFilter): Promise<ClaimSummary[]> {
    const { rows } = await this.pool.query(
      `select * from (
         select c.id, c.claim_no, c.policy_id, c.animal_id, c.market, c.currency, coalesce(v.data->>'channel', c.channel) as channel, c.clinic_id,
                coalesce(v.data->>'treatmentFrom', c.treatment_from::text) as treatment_from, coalesce(v.data->>'diagnosisCode', c.diagnosis_code) as diagnosis_code, c.received_at,
                d.seq, d.outcome, d.payout_minor, d.decided_at,
                case
                  when k.kind is not null then k.kind
                  when exists (select 1 from claims.decision_proposal p where p.claim_id = c.id and p.status = 'open') then 'awaiting-approval'
                  when exists (select 1 from claims.information_request i where i.claim_id = c.id and i.status = 'open') then 'awaiting-information'
                  when exists (select 1 from claims.review_request r where r.claim_id = c.id and r.closed_at is null) then 'review-requested'
                  when d.seq is not null and not exists (
                    select 1 from claims.claim_correction r where r.claim_id = c.id and r.revision > d.claim_revision and r.reopens) then 'decided'
                  else 'awaiting-decision'
                end as state
         from claims.claim c
         left join lateral (select seq, outcome, payout_minor, decided_at, claim_revision from claims.decision x where x.claim_id = c.id order by seq desc limit 1) d on true
         left join lateral (select data from claims.claim_correction r where r.claim_id = c.id order by revision desc limit 1) v on true
         left join claims.claim_closure k on k.claim_id = c.id
         where ($1::text is null or c.market = $1)
           and ($2::text is null or c.policy_id = $2)
           and ($3::text is null or c.animal_id = $3)
           and ($4::text is null or c.clinic_id = $4)
       ) q
       where ($5::text is null or q.state = $5)
       order by q.received_at, q.id`,
      [filter.market ?? null, filter.policyId ?? null, filter.animalId ?? null, filter.clinicId ?? null, filter.state ?? null],
    );
    // When the basis was complete comes from the requests, by the same rule as the memory store.
    const requests = new Map<string, InformationRequest[]>();
    if (rows.length) {
      const found = await this.pool.query(`${INFORMATION_SELECT} where claim_id = any($1) order by requested_at, id`, [rows.map((r) => r.id)]);
      for (const r of found.rows.map(toInformationRequest)) requests.set(r.claimId, [...(requests.get(r.claimId) ?? []), r]);
    }
    return rows.map((r) => ({
      id: r.id,
      claimNo: r.claim_no,
      policyId: r.policy_id,
      animalId: r.animal_id,
      market: r.market,
      currency: r.currency,
      channel: r.channel,
      ...(r.clinic_id === null ? {} : { clinicId: r.clinic_id }),
      treatmentFrom: r.treatment_from,
      diagnosisCode: r.diagnosis_code,
      receivedAt: new Date(r.received_at).toISOString(),
      state: r.state,
      ...(r.seq === null ? {} : { latestDecision: { seq: r.seq, outcome: r.outcome, payout: Number(r.payout_minor), decidedAt: new Date(r.decided_at).toISOString() } }),
      ...withBasis(new Date(r.received_at).toISOString(), requests.get(r.id) ?? []),
    }));
  }

  async claimActivity(policyId: string, from: string, to: string): Promise<{ open: boolean; lastAt?: Timestamp }> {
    const { rows } = await this.pool.query(
      `select
         coalesce(bool_or(
           k.claim_id is null and (
             not exists (select 1 from claims.decision d where d.claim_id = c.id)
             or exists (select 1 from claims.review_request r where r.claim_id = c.id and r.closed_at is null)
             or exists (select 1 from claims.decision_proposal p where p.claim_id = c.id and p.status = 'open')
             or exists (select 1 from claims.information_request i where i.claim_id = c.id and i.status = 'open')
             or exists (
               select 1 from claims.claim_correction r
               where r.claim_id = c.id and r.reopens
                 and r.revision > (select claim_revision from claims.decision d where d.claim_id = c.id order by seq desc limit 1)))
         ), false) as open,
         max(greatest(c.received_at, (select max(decided_at) from claims.decision d where d.claim_id = c.id), k.closed_at)) as last_at
       from claims.claim c
       left join claims.claim_closure k on k.claim_id = c.id
       left join lateral (select data from claims.claim_correction r where r.claim_id = c.id order by revision desc limit 1) v on true
       where c.policy_id = $1 and coalesce((v.data->>'treatmentFrom')::date, c.treatment_from) >= $2 and coalesce((v.data->>'treatmentFrom')::date, c.treatment_from) < $3`,
      [policyId, from, to],
    );
    const r = rows[0];
    return { open: r.open, ...(r.last_at === null ? {} : { lastAt: new Date(r.last_at).toISOString() }) };
  }

  async claimsDecidedOnPolicyVersions(policyVersionIds: string[]): Promise<string[]> {
    const { rows } = await this.pool.query(
      `select d.claim_id from claims.decision d
       where d.policy_version_id = any($1)
         and d.seq = (select max(seq) from claims.decision x where x.claim_id = d.claim_id)
       order by d.claim_id`,
      [policyVersionIds],
    );
    return rows.map((r) => r.claim_id);
  }

  async getEvidence(decisionId: string): Promise<DecisionEvidence | null> {
    const { rows } = await this.pool.query(
      `select decision_id, input, calculation_model, engine_version, attachments from claims.decision_evidence where decision_id = $1`,
      [decisionId],
    );
    const e = rows[0];
    return e
      ? { decisionId: e.decision_id, input: e.input, calculationModel: e.calculation_model, engineVersion: e.engine_version, ...(e.attachments === null ? {} : { attachments: e.attachments }) }
      : null;
  }

  async commitDecision({ decision: d, journals, deductiblePeriod: p, evidence, events, closesReviewRequestId, closesProposalId }: DecisionCommit): Promise<void> {
    if (evidence.decisionId !== d.id) throw new Error(`Evidence for ${evidence.decisionId} given with decision ${d.id}`);
    await this.tx(async (db) => {
      const a = d.assessment;
      await db.query(
        `insert into claims.decision (id, claim_id, seq, outcome, payout_minor, currency, assessment, input_hash,
                                      rules_version, product_version, policy_version_id, decided_by, decided_at, reason,
                                      deviates_from_proposal, reason_code, automated, review_request_id, approved_by, proposal_id, claim_revision)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
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
          d.deviatesFromProposal,
          d.reasonCode ?? null,
          d.automated,
          d.reviewRequestId ?? null,
          d.approvedBy ?? null,
          d.proposalId ?? null,
          d.claimRevision ?? 1,
        ],
      );
      if (closesProposalId) {
        const closed = await db.query(
          `update claims.decision_proposal set status = 'approved', closed_by = $2, closed_at = $3, decision_id = $4
           where id = $1 and claim_id = $5 and status = 'open'`,
          [closesProposalId, d.approvedBy ?? null, d.decidedAt, d.id, d.claimId],
        );
        if (closed.rowCount !== 1) throw new StoreConflictError('proposal_closed', `Proposal ${closesProposalId} is not open`);
      }
      if (closesReviewRequestId) {
        const closed = await db.query(
          `update claims.review_request set closed_by_decision_id = $2, closed_at = $3
           where id = $1 and claim_id = $4 and closed_at is null`,
          [closesReviewRequestId, d.id, d.decidedAt, d.claimId],
        );
        if (closed.rowCount !== 1) throw new Error(`Review request ${closesReviewRequestId} is not open for claim ${d.claimId}`);
      }
      await db.query(
        `insert into claims.decision_evidence (decision_id, input, calculation_model, engine_version, attachments) values ($1, $2, $3, $4, $5)`,
        [evidence.decisionId, JSON.stringify(evidence.input), evidence.calculationModel, evidence.engineVersion, evidence.attachments ? JSON.stringify(evidence.attachments) : null],
      );
      await insertJournals(db, journals);
      await db.query(`delete from claims.deductible_period where opened_by_claim_id = $1`, [d.claimId]);
      if (p) {
        await db.query(
          `insert into claims.deductible_period (id, animal_id, diagnosis_group, valid, opened_by_claim_id)
           values ($1, $2, $3, daterange($4::date, $5::date, '[)'), $6)`,
          [p.id, p.animalId, p.diagnosisGroup, p.validFrom, p.validTo, p.openedByClaimId],
        );
      }
      await insertEvents(db, events);
    }).catch((e: PgError) => {
      if (e.code === UNIQUE_VIOLATION && (e.constraint === 'decision_claim_id_seq_key' || e.constraint === 'decision_pkey')) {
        throw new StoreConflictError('decision_exists', `Decision ${d.claimId}#${d.seq} already exists`);
      }
      if (e.code === EXCLUSION_VIOLATION) {
        throw new StoreConflictError('period_overlaps', `The deductible period for ${d.claimId} clashes with another period`);
      }
      if (e.code === CLAIM_CLOSED) throw new StoreConflictError('claim_closed', `Claim ${d.claimId} is closed`);
      throw e;
    });
  }

  async saveReviewRequest(r: ReviewRequest, events: ClaimsEvent[]): Promise<void> {
    await this.tx(async (db) => {
      await db.query(
        `insert into claims.review_request (id, claim_id, decision_id, decision_seq, requested_by, statement, requested_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [r.id, r.claimId, r.decisionId, r.decisionSeq, r.requestedBy, r.statement ?? null, r.requestedAt],
      );
      await insertEvents(db, events);
    }).catch((e: PgError) => {
      if (e.code === UNIQUE_VIOLATION && e.constraint === 'review_request_one_open') {
        throw new StoreConflictError('review_open', `Claim ${r.claimId} already has an open review request`);
      }
      throw e;
    });
  }

  async saveProposal(p: DecisionProposal, events: ClaimsEvent[]): Promise<void> {
    await this.tx(async (db) => {
      await db.query(
        `insert into claims.decision_proposal (id, claim_id, action, outcome, payout_minor, currency, input_hash, proposed_by, proposed_at,
                                               reason, reason_code, deviates_from_proposal, proposer_limit_minor, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          p.id,
          p.claimId,
          p.action,
          p.outcome,
          p.payout,
          p.currency,
          p.inputHash,
          p.proposedBy,
          p.proposedAt,
          p.reason ?? null,
          p.reasonCode ?? null,
          p.deviatesFromProposal,
          p.proposerLimit,
          p.status,
        ],
      );
      await insertEvents(db, events);
    }).catch((e: PgError) => {
      if (e.code === UNIQUE_VIOLATION && e.constraint === 'decision_proposal_one_open') {
        throw new StoreConflictError('proposal_open', `Claim ${p.claimId} already has an open proposal`);
      }
      throw e;
    });
  }

  async getProposals(claimId: string): Promise<DecisionProposal[]> {
    const { rows } = await this.pool.query(
      `select id, claim_id, action, outcome, payout_minor, currency, input_hash, proposed_by, proposed_at, reason, reason_code,
              deviates_from_proposal, proposer_limit_minor, status, closed_by, closed_at, decision_id, return_reason
       from claims.decision_proposal where claim_id = $1 order by proposed_at, id`,
      [claimId],
    );
    return rows.map((r) => ({
      id: r.id,
      claimId: r.claim_id,
      action: r.action,
      outcome: r.outcome,
      payout: r.payout_minor,
      currency: r.currency,
      inputHash: r.input_hash,
      proposedBy: r.proposed_by,
      proposedAt: r.proposed_at,
      ...(r.reason !== null ? { reason: r.reason } : {}),
      ...(r.reason_code !== null ? { reasonCode: r.reason_code } : {}),
      deviatesFromProposal: r.deviates_from_proposal,
      proposerLimit: r.proposer_limit_minor,
      status: r.status,
      ...(r.closed_by !== null ? { closedBy: r.closed_by, closedAt: r.closed_at } : {}),
      ...(r.decision_id !== null ? { decisionId: r.decision_id } : {}),
      ...(r.return_reason !== null ? { returnReason: r.return_reason } : {}),
    }));
  }

  async closeClaim(closure: ClaimClosure, events: ClaimsEvent[], journals: LedgerJournal[]): Promise<void> {
    await this.tx(async (db) => {
      await db.query(
        `insert into claims.claim_closure (claim_id, id, kind, reason_code, reason, duplicate_of, closed_by, closed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [closure.claimId, closure.id, closure.kind, closure.reasonCode ?? null, closure.reason, closure.duplicateOf ?? null, closure.closedBy, closure.closedAt],
      );
      await db.query(
        `update claims.decision_proposal set status = 'returned', closed_by = $2, closed_at = $3, return_reason = $4
         where claim_id = $1 and status = 'open'`,
        [closure.claimId, closure.closedBy, closure.closedAt, closure.reason],
      );
      await db.query(
        `update claims.information_request set status = 'cancelled', closed_by = $2, closed_at = $3, closing_note = $4
         where claim_id = $1 and status = 'open'`,
        [closure.claimId, closure.closedBy, closure.closedAt, closure.reason],
      );
      await insertJournals(db, journals);
      await insertEvents(db, events);
    }).catch((e: PgError) => {
      if (e.code === UNIQUE_VIOLATION && e.constraint === 'claim_closure_pkey') throw new StoreConflictError('claim_closed', `Claim ${closure.claimId} is closed already`);
      if (e.code === CLAIM_DECIDED) throw new StoreConflictError('claim_decided', `Claim ${closure.claimId} has a decision`);
      throw e;
    });
  }

  async saveInformationRequest(r: InformationRequest, events: ClaimsEvent[]): Promise<void> {
    await this.tx(async (db) => {
      await db.query(
        `insert into claims.information_request (id, claim_id, recipient, items, note, due_date, remind_on, rules_version, requested_by, requested_at, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [r.id, r.claimId, r.recipient, r.items, r.note, r.dueDate, r.remindOn ?? null, r.rulesVersion, r.requestedBy, r.requestedAt, r.status],
      );
      await insertEvents(db, events);
    }).catch((e: PgError) => {
      if (e.code === UNIQUE_VIOLATION && e.constraint === 'information_request_one_open') {
        throw new StoreConflictError('information_open', `Claim ${r.claimId} already has an open request to the ${r.recipient}`);
      }
      if (e.code === CLAIM_CLOSED) throw new StoreConflictError('claim_closed', `Claim ${r.claimId} is closed`);
      throw e;
    });
  }

  async getInformationRequests(claimId: string): Promise<InformationRequest[]> {
    const { rows } = await this.pool.query(`${INFORMATION_SELECT} where claim_id = $1 order by requested_at, id`, [claimId]);
    return rows.map(toInformationRequest);
  }

  async updateInformationRequest(next: InformationRequest, from: { statuses: InformationRequestStatus[]; notReminded?: boolean }, events: ClaimsEvent[]): Promise<void> {
    await this.tx(async (db) => {
      // Only the state moves; the trigger in migration 0042 refuses anything else.
      const updated = await db.query(
        `update claims.information_request
         set status = $3, reminded_at = $4, received_at = $5, closed_by = $6, closed_at = $7, closing_note = $8
         where id = $1 and claim_id = $2 and status = any($9) and ($10::boolean is not true or reminded_at is null)`,
        [next.id, next.claimId, next.status, next.remindedAt ?? null, next.receivedAt ?? null, next.closedBy ?? null, next.closedAt ?? null, next.closingNote ?? null, from.statuses, from.notReminded ?? false],
      );
      if (updated.rowCount !== 1) throw new StoreConflictError('information_closed', `Request ${next.id} is no longer ${from.statuses.join(' or ')}`);
      await insertEvents(db, events);
    });
  }

  async informationRequestsDue(market: string, onDate: ISODate): Promise<InformationRequest[]> {
    const { rows } = await this.pool.query(
      `${INFORMATION_SELECT}
       where status = 'open'
         and (due_date < $2::date or (remind_on <= $2::date and reminded_at is null))
         and claim_id in (select id from claims.claim where market = $1)
       order by requested_at, id`,
      [market, onDate],
    );
    return rows.map(toInformationRequest);
  }

  async getClosure(claimId: string): Promise<ClaimClosure | null> {
    const { rows } = await this.pool.query(
      `select id, claim_id, kind, reason_code, reason, duplicate_of, closed_by, closed_at from claims.claim_closure where claim_id = $1`,
      [claimId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      claimId: r.claim_id,
      kind: r.kind,
      ...(r.reason_code === null ? {} : { reasonCode: r.reason_code }),
      reason: r.reason,
      ...(r.duplicate_of === null ? {} : { duplicateOf: r.duplicate_of }),
      closedBy: r.closed_by,
      closedAt: new Date(r.closed_at).toISOString(),
    };
  }

  async returnProposal(proposalId: string, closedBy: string, closedAt: Timestamp, reason: string, events: ClaimsEvent[]): Promise<void> {
    await this.tx(async (db) => {
      const closed = await db.query(
        `update claims.decision_proposal set status = 'returned', closed_by = $2, closed_at = $3, return_reason = $4
         where id = $1 and status = 'open'`,
        [proposalId, closedBy, closedAt, reason],
      );
      if (closed.rowCount !== 1) throw new StoreConflictError('proposal_closed', `Proposal ${proposalId} is not open`);
      await insertEvents(db, events);
    });
  }

  async getReviewRequests(claimId: string): Promise<ReviewRequest[]> {
    const { rows } = await this.pool.query(
      `select id, claim_id, decision_id, decision_seq, requested_by, statement, requested_at, closed_by_decision_id, closed_at
       from claims.review_request where claim_id = $1 order by requested_at, id`,
      [claimId],
    );
    return rows.map((r) => ({
      id: r.id,
      claimId: r.claim_id,
      decisionId: r.decision_id,
      decisionSeq: r.decision_seq,
      requestedBy: r.requested_by,
      ...(r.statement !== null ? { statement: r.statement } : {}),
      requestedAt: r.requested_at,
      ...(r.closed_by_decision_id !== null ? { closedByDecisionId: r.closed_by_decision_id, closedAt: r.closed_at } : {}),
    }));
  }

  async pendingEvents(limit: number): Promise<OutboxEntry[]> {
    const { rows } = await this.pool.query(
      `select o.id::text as id, o.payload from claims.outbox o where o.published_at is null order by o.id limit $1`,
      [limit],
    );
    return rows.map((r) => ({ id: r.id, event: r.payload }));
  }

  async markPublished(ids: string[], at: Timestamp): Promise<void> {
    const numeric = ids.filter((id) => /^\d+$/.test(id));
    if (numeric.length === 0) return;
    await this.pool.query(
      `update claims.outbox set published_at = $2 where id = any($1::bigint[]) and published_at is null`,
      [numeric, at],
    );
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

/** A stored response for an idempotency key, as the API layer needs it. */
export interface IdempotentResponse {
  fingerprint: string;
  status: number;
  body: unknown;
}

/**
 * Responses per idempotency key in `claims.idempotency`, so that a retried
 * request gets the same response even after a restart. The first response for
 * a key wins; later writes for the same key are ignored.
 */
export class PostgresIdempotencyStore {
  constructor(private readonly pool: pg.Pool) {}

  async get(key: string): Promise<IdempotentResponse | null> {
    const { rows } = await this.pool.query(`select fingerprint, status, body from claims.idempotency where scoped_key = $1`, [key]);
    const r = rows[0];
    return r ? { fingerprint: r.fingerprint, status: r.status, body: r.body } : null;
  }

  async put(key: string, value: IdempotentResponse): Promise<void> {
    await this.pool.query(
      `insert into claims.idempotency (scoped_key, fingerprint, status, body) values ($1, $2, $3, $4)
       on conflict (scoped_key) do nothing`,
      [key, value.fingerprint, value.status, JSON.stringify(value.body ?? null)],
    );
  }
}
