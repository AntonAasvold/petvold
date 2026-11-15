/**
 * PartyStore against the schema `parties` (migration 0017). Connect with the
 * service role `parties_service`: it may only insert and read. The database
 * also checks that kind and market never change. Migration 0019 adds erasure
 * (ADR 0028): the only change to history is the function parties.anonymize,
 * which needs an approved request.
 */
import type pg from 'pg';
import {
  PartyConflictError,
  PartyIdentifierTakenError,
  type RetentionSettings,
  type RetentionStore,
  type ErasureDecision,
  type ErasureRequest,
  type Party,
  type PartyIdentifier,
  type PartyIdentifierType,
  type PartyRecord,
  type PartyStore,
} from './index.ts';

const UNIQUE_VIOLATION = '23505';
const REVISION = `party_id, revision, kind, market, given_name, family_name, birth_date::text as birth_date, name, email, phone,
  address, language, changed_by, changed_at, reason, anonymized`;
const COLUMNS = `party_id, revision, kind, market, given_name, family_name, birth_date, name, email, phone, address, language, changed_by, changed_at, reason`;

export class PostgresPartyStore implements PartyStore {
  constructor(private readonly pool: pg.Pool) {}

  async get(id: string): Promise<PartyRecord | null> {
    const { rows } = await this.pool.query(`select ${REVISION} from parties.party_revision where party_id = $1 order by revision desc limit 1`, [id]);
    if (!rows[0]) return null;
    const ids = await this.pool.query(
      `select type, country, value, added_by, added_at from parties.party_identifier where party_id = $1 order by added_at, type, country, value`,
      [id],
    );
    const restricted = await this.pool.query(
      `select max(d.restrict_until)::text as until from parties.erasure_request r join parties.erasure_decision d using (request_id)
       where r.party_id = $1`,
      [id],
    );
    const until = restricted.rows[0]?.until ?? null;
    return {
      ...toParty(rows[0]),
      ...(until === null ? {} : { restrictedUntil: until }),
      identifiers: ids.rows.map((r) => ({ type: r.type, country: r.country, value: r.value, addedBy: r.added_by, addedAt: iso(r.added_at) })),
    };
  }

  async partyIds(): Promise<string[]> {
    const { rows } = await this.pool.query(`select distinct party_id from parties.party_revision where not anonymized order by party_id`);
    return rows.map((r) => r.party_id);
  }

  async revisions(id: string): Promise<Party[]> {
    const { rows } = await this.pool.query(`select ${REVISION} from parties.party_revision where party_id = $1 order by revision`, [id]);
    return rows.map(toParty);
  }

  async findByIdentifier(type: PartyIdentifierType, country: string, value: string): Promise<string | null> {
    const { rows } = await this.pool.query(`select party_id from parties.party_identifier where type = $1 and country = $2 and value = $3`, [
      type,
      country,
      value,
    ]);
    return rows[0]?.party_id ?? null;
  }

  async register(party: Party, identifiers: PartyIdentifier[]): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      await db.query(`insert into parties.party_revision (${COLUMNS}) values (${placeholders(15)})`, params(party)).catch(conflict(`Party ${party.id} exists`));
      for (const i of identifiers) await insertIdentifier(db, party.id, i);
      await db.query('commit');
    } catch (e) {
      await db.query('rollback');
      throw e;
    } finally {
      db.release();
    }
  }

  async appendRevision(party: Party): Promise<void> {
    const res = await this.pool
      .query(
        `insert into parties.party_revision (${COLUMNS})
         select ${placeholders(15)}
         where $2 = (select max(revision) + 1 from parties.party_revision where party_id = $1)`,
        params(party),
      )
      .catch(conflict(`Party ${party.id} has changed`));
    if (res.rowCount !== 1) throw new PartyConflictError(`Party ${party.id} has changed`);
  }

  async addIdentifier(partyId: string, identifier: PartyIdentifier): Promise<void> {
    await insertIdentifier(this.pool, partyId, identifier);
  }

  async addErasureRequest(r: ErasureRequest): Promise<void> {
    const res = await this.pool.query(
      `insert into parties.erasure_request (request_id, party_id, market, basis, reason, requested_by, requested_at)
       select $1, $2, $3, $4, $5, $6, $7
       where not exists (
         select 1 from parties.erasure_request p left join parties.erasure_decision d using (request_id)
         where p.party_id = $2 and d.request_id is null)`,
      [r.id, r.partyId, r.market, r.basis, r.reason, r.requestedBy, r.requestedAt],
    );
    if (res.rowCount !== 1) throw new PartyConflictError(`Party ${r.partyId} already has an undecided erasure request`);
  }

  async getErasureRequest(id: string): Promise<ErasureRequest | null> {
    const { rows } = await this.pool.query(`${ERASURES} where r.request_id = $1`, [id]);
    return rows[0] ? toErasure(rows[0]) : null;
  }

  async listErasureRequests(filter: { partyId?: string; pending?: boolean }): Promise<ErasureRequest[]> {
    const { rows } = await this.pool.query(
      `${ERASURES}
       where ($1::text is null or r.party_id = $1)
         and ($2::boolean is null or (d.request_id is null) = $2)
       order by r.requested_at, r.request_id`,
      [filter.partyId ?? null, filter.pending ?? null],
    );
    return rows.map(toErasure);
  }

  async decideErasure(requestId: string, d: ErasureDecision): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      await db
        .query(
          `insert into parties.erasure_decision (request_id, outcome, reason, restrict_until, decided_by, decided_at) values ($1, $2, $3, $4, $5, $6)`,
          [requestId, d.outcome, d.reason ?? null, d.restrictUntil ?? null, d.decidedBy, d.decidedAt],
        )
        .catch(conflict(`Erasure request ${requestId} is already decided`));
      if (d.outcome === 'approved') {
        await db.query(`select parties.anonymize(party_id) from parties.erasure_request where request_id = $1`, [requestId]);
      }
      await db.query('commit');
    } catch (e) {
      await db.query('rollback');
      throw e;
    } finally {
      db.release();
    }
  }
}

const ERASURES = `select r.request_id, r.party_id, r.market, r.basis, r.reason, r.requested_by, r.requested_at,
  d.outcome, d.reason as decision_reason, d.restrict_until::text as restrict_until, d.decided_by, d.decided_at
  from parties.erasure_request r left join parties.erasure_decision d using (request_id)`;

function toErasure(r: Record<string, any>): ErasureRequest {
  return {
    id: r.request_id,
    partyId: r.party_id,
    market: r.market,
    basis: r.basis,
    reason: r.reason,
    requestedBy: r.requested_by,
    requestedAt: iso(r.requested_at),
    ...(r.outcome === null
      ? {}
      : {
          decision: {
            outcome: r.outcome,
            ...(r.decision_reason === null ? {} : { reason: r.decision_reason }),
            ...(r.restrict_until === null ? {} : { restrictUntil: r.restrict_until }),
            decidedBy: r.decided_by,
            decidedAt: iso(r.decided_at),
          },
        }),
  };
}

const placeholders = (n: number) => Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', ');

function params(p: Party) {
  return [
    p.id,
    p.revision,
    p.kind,
    p.market,
    p.givenName ?? null,
    p.familyName ?? null,
    p.birthDate ?? null,
    p.name ?? null,
    p.email ?? null,
    p.phone ?? null,
    p.address ? JSON.stringify(p.address) : null,
    p.language ?? null,
    p.changedBy,
    p.changedAt,
    p.reason ?? null,
  ];
}

async function insertIdentifier(db: Pick<pg.Pool, 'query'>, partyId: string, i: PartyIdentifier) {
  await db
    .query(`insert into parties.party_identifier (type, country, value, party_id, added_by, added_at) values ($1, $2, $3, $4, $5, $6)`, [
      i.type,
      i.country,
      i.value,
      partyId,
      i.addedBy,
      i.addedAt,
    ])
    .catch((e: { code?: string }) => {
      if (e.code === UNIQUE_VIOLATION) throw new PartyIdentifierTakenError(i);
      throw e;
    });
}

function conflict(message: string) {
  return (e: { code?: string }): never => {
    if (e.code === UNIQUE_VIOLATION) throw new PartyConflictError(message);
    throw e;
  };
}

const iso = (d: Date | string) => new Date(d).toISOString();

function toParty(r: Record<string, any>): Party {
  const optional: Record<string, unknown> = {
    givenName: r.given_name,
    familyName: r.family_name,
    birthDate: r.birth_date,
    name: r.name,
    email: r.email,
    phone: r.phone,
    address: r.address,
    language: r.language,
  };
  return {
    id: r.party_id,
    revision: r.revision,
    kind: r.kind,
    market: r.market,
    ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== null)),
    changedBy: r.changed_by,
    changedAt: iso(r.changed_at),
    ...(r.reason === null ? {} : { reason: r.reason }),
    ...(r.anonymized ? { anonymized: true as const } : {}),
  };
}

/** Retention settings as versions in parties.retention_settings (migration 0020). */
export class PostgresRetentionStore implements RetentionStore {
  constructor(private readonly pool: pg.Pool) {}

  async current(): Promise<RetentionSettings | null> {
    const { rows } = await this.pool.query(`select * from parties.retention_settings order by version desc limit 1`);
    return rows[0] ? toSettings(rows[0]) : null;
  }

  async versions(): Promise<RetentionSettings[]> {
    const { rows } = await this.pool.query(`select * from parties.retention_settings order by version`);
    return rows.map(toSettings);
  }

  async append(s: RetentionSettings): Promise<void> {
    const res = await this.pool
      .query(
        `insert into parties.retention_settings (version, markets, changed_by, changed_at, reason)
         select $1, $2, $3, $4, $5
         where $1 = coalesce((select max(version) from parties.retention_settings), 0) + 1`,
        [s.version, JSON.stringify(s.markets), s.changedBy, s.changedAt, s.reason],
      )
      .catch(conflict(`Retention settings version ${s.version} exists`));
    if (res.rowCount !== 1) throw new PartyConflictError(`Retention settings version ${s.version} is not the next`);
  }
}

function toSettings(r: Record<string, any>): RetentionSettings {
  return { version: r.version, markets: r.markets, changedBy: r.changed_by, changedAt: iso(r.changed_at), reason: r.reason };
}

/**
 * After a restore from backup: runs every approved anonymization again, oldest
 * first (ADR 0028). Safe to run more than once. Returns the parties anonymized.
 */
export async function reapplyErasures(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query(
    `select r.party_id from parties.erasure_request r join parties.erasure_decision d using (request_id)
     where d.outcome = 'approved' order by d.decided_at, r.request_id`,
  );
  for (const r of rows) await pool.query(`select parties.anonymize($1)`, [r.party_id]);
  return rows.map((r) => r.party_id);
}
