/**
 * PartyStore against the schema `parties` (migration 0017). Connect with the
 * service role `parties_service`: it may only insert and read. The database
 * also checks that kind and market never change.
 */
import type pg from 'pg';
import {
  PartyConflictError,
  PartyIdentifierTakenError,
  type Party,
  type PartyIdentifier,
  type PartyIdentifierType,
  type PartyRecord,
  type PartyStore,
} from './index.ts';

const UNIQUE_VIOLATION = '23505';
const REVISION = `party_id, revision, kind, market, given_name, family_name, birth_date::text as birth_date, name, email, phone,
  address, language, changed_by, changed_at, reason`;
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
    return {
      ...toParty(rows[0]),
      identifiers: ids.rows.map((r) => ({ type: r.type, country: r.country, value: r.value, addedBy: r.added_by, addedAt: iso(r.added_at) })),
    };
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
  };
}
