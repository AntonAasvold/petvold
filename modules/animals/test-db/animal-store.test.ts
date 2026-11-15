/** The shared AnimalStore suite against Postgres, as the service role animals_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresAnimalStore } from '../src/postgres.ts';
import { animal, animalStoreSuite, owner } from '../test-suites/animal-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.ANIMALS_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or ANIMALS_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await admin.end();
});
const clean = () => admin.query('truncate animals.animal_revision, animals.animal_identifier, animals.ownership, animals.litter, animals.litter_member, animals.outbox');

animalStoreSuite('PostgresAnimalStore', async () => {
  await clean();
  return { store: new PostgresAnimalStore(pool) };
});

test('the database keeps the history and the ownership chain', async () => {
  await clean();
  const store = new PostgresAnimalStore(pool);
  await store.register(animal(), [], owner());
  await assert.rejects(pool.query(`update animals.animal_revision set name = 'Max'`), /permission denied/);
  await assert.rejects(pool.query('delete from animals.ownership'), /permission denied/);
  await assert.rejects(store.appendRevision(animal({ revision: 2, species: 'cat', reason: 'x' })), /never change/);
  // A gap between owners, a changed party, and two open owners are refused.
  await assert.rejects(
    pool.query(`insert into animals.ownership values ('ani_rex', 2, 'pty_bo', '2026-06-01', null, 'x', now(), null)`),
    /must start the day/,
  );
  await assert.rejects(pool.query(`update animals.ownership set party_id = 'pty_bo'`), /permission denied/);
  await store.transfer('ani_rex', 1, owner({ seq: 2, partyId: 'pty_bo', validFrom: '2026-06-01' }));
  await assert.rejects(pool.query(`update animals.ownership set valid_to = '2026-07-01' where seq = 1`), /Only the end of the open ownership/);
});
