/**
 * AnimalStore against the schema `animals` (migration 0015). Connect with the
 * service role `animals_service`: it may insert and read, and may only set the
 * end of an open ownership. The database also checks that market and species
 * never change and that ownerships follow each other without gaps.
 */
import type pg from 'pg';
import {
  AnimalConflictError,
  IdentifierTakenError,
  type Animal,
  type AnimalIdentifier,
  type AnimalRecord,
  type AnimalStore,
  type IdentifierType,
  type ISODate,
  type Ownership,
} from './index.ts';

const UNIQUE_VIOLATION = '23505';
const REVISION = `animal_id, revision, market, species, breed, sex, neutered, name, birth_date::text as birth_date,
  deceased_on::text as deceased_on, changed_by, changed_at, reason`;

export class PostgresAnimalStore implements AnimalStore {
  constructor(private readonly pool: pg.Pool) {}

  async get(id: string): Promise<AnimalRecord | null> {
    const { rows } = await this.pool.query(`select ${REVISION} from animals.animal_revision where animal_id = $1 order by revision desc limit 1`, [id]);
    if (!rows[0]) return null;
    const ids = await this.pool.query(
      `select type, value, added_by, added_at from animals.animal_identifier where animal_id = $1 order by added_at, type, value`,
      [id],
    );
    const owners = await this.pool.query(
      `select seq, party_id, valid_from::text as valid_from, valid_to::text as valid_to, recorded_by, recorded_at, reason
       from animals.ownership where animal_id = $1 order by seq`,
      [id],
    );
    return {
      ...toAnimal(rows[0]),
      identifiers: ids.rows.map((r) => ({ type: r.type, value: r.value, addedBy: r.added_by, addedAt: iso(r.added_at) })),
      ownerships: owners.rows.map((r) => ({
        seq: r.seq,
        partyId: r.party_id,
        validFrom: r.valid_from,
        ...(r.valid_to === null ? {} : { validTo: r.valid_to }),
        recordedBy: r.recorded_by,
        recordedAt: iso(r.recorded_at),
        ...(r.reason === null ? {} : { reason: r.reason }),
      })),
    };
  }

  async revisions(id: string): Promise<Animal[]> {
    const { rows } = await this.pool.query(`select ${REVISION} from animals.animal_revision where animal_id = $1 order by revision`, [id]);
    return rows.map(toAnimal);
  }

  async findByIdentifier(type: IdentifierType, value: string): Promise<string | null> {
    const { rows } = await this.pool.query(`select animal_id from animals.animal_identifier where type = $1 and value = $2`, [type, value]);
    return rows[0]?.animal_id ?? null;
  }

  async findByOwner(partyId: string, onDate: ISODate): Promise<string[]> {
    const { rows } = await this.pool.query(
      `select distinct animal_id from animals.ownership
       where party_id = $1 and valid_from <= $2 and (valid_to is null or $2 < valid_to) order by animal_id`,
      [partyId, onDate],
    );
    return rows.map((r) => r.animal_id);
  }

  async register(animal: Animal, identifiers: AnimalIdentifier[], owner: Ownership): Promise<void> {
    await this.tx(async (db) => {
      await insertRevision(db, animal);
      for (const i of identifiers) await insertIdentifier(db, animal.id, i);
      await insertOwnership(db, animal.id, owner);
    });
  }

  async appendRevision(animal: Animal): Promise<void> {
    const res = await this.pool
      .query(
        `insert into animals.animal_revision (animal_id, revision, market, species, breed, sex, neutered, name, birth_date, deceased_on, changed_by, changed_at, reason)
         select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
         where $2 = (select max(revision) + 1 from animals.animal_revision where animal_id = $1)`,
        revisionParams(animal),
      )
      .catch(conflict(`Animal ${animal.id} has changed`));
    if (res.rowCount !== 1) throw new AnimalConflictError(`Animal ${animal.id} has changed`);
  }

  async addIdentifier(animalId: string, identifier: AnimalIdentifier): Promise<void> {
    await insertIdentifier(this.pool, animalId, identifier);
  }

  async transfer(animalId: string, closesSeq: number, next: Ownership): Promise<void> {
    await this.tx(async (db) => {
      const closed = await db.query(
        `update animals.ownership set valid_to = $3 where animal_id = $1 and seq = $2 and valid_to is null`,
        [animalId, closesSeq, next.validFrom],
      );
      if (closed.rowCount !== 1) throw new AnimalConflictError(`The owner of animal ${animalId} has changed`);
      await insertOwnership(db, animalId, next);
    });
  }

  private async tx(fn: (db: pg.PoolClient) => Promise<void>): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query('begin');
      await fn(db);
      await db.query('commit');
    } catch (e) {
      await db.query('rollback');
      throw e;
    } finally {
      db.release();
    }
  }
}

type Db = Pick<pg.Pool, 'query'>;

function revisionParams(a: Animal) {
  return [
    a.id,
    a.revision,
    a.market,
    a.species,
    a.breed ?? null,
    a.sex,
    a.neutered,
    a.name,
    a.birthDate,
    a.deceasedOn ?? null,
    a.changedBy,
    a.changedAt,
    a.reason ?? null,
  ];
}

async function insertRevision(db: Db, a: Animal) {
  await db
    .query(
      `insert into animals.animal_revision (animal_id, revision, market, species, breed, sex, neutered, name, birth_date, deceased_on, changed_by, changed_at, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      revisionParams(a),
    )
    .catch(conflict(`Animal ${a.id} exists`));
}

async function insertIdentifier(db: Db, animalId: string, i: AnimalIdentifier) {
  await db
    .query(`insert into animals.animal_identifier (type, value, animal_id, added_by, added_at) values ($1, $2, $3, $4, $5)`, [
      i.type,
      i.value,
      animalId,
      i.addedBy,
      i.addedAt,
    ])
    .catch((e: { code?: string }) => {
      if (e.code === UNIQUE_VIOLATION) throw new IdentifierTakenError(i);
      throw e;
    });
}

async function insertOwnership(db: Db, animalId: string, o: Ownership) {
  await db
    .query(
      `insert into animals.ownership (animal_id, seq, party_id, valid_from, valid_to, recorded_by, recorded_at, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [animalId, o.seq, o.partyId, o.validFrom, o.validTo ?? null, o.recordedBy, o.recordedAt, o.reason ?? null],
    )
    .catch(conflict(`The owner of animal ${animalId} has changed`));
}

function conflict(message: string) {
  return (e: { code?: string }): never => {
    if (e.code === UNIQUE_VIOLATION) throw new AnimalConflictError(message);
    throw e;
  };
}

const iso = (d: Date | string) => new Date(d).toISOString();

function toAnimal(r: Record<string, any>): Animal {
  return {
    id: r.animal_id,
    revision: r.revision,
    market: r.market,
    species: r.species,
    ...(r.breed === null ? {} : { breed: r.breed }),
    sex: r.sex,
    neutered: r.neutered,
    name: r.name,
    birthDate: r.birth_date,
    ...(r.deceased_on === null ? {} : { deceasedOn: r.deceased_on }),
    changedBy: r.changed_by,
    changedAt: iso(r.changed_at),
    ...(r.reason === null ? {} : { reason: r.reason }),
  };
}
