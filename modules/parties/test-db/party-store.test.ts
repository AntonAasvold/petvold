/** The shared PartyStore suite against Postgres, as the service role parties_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresPartyStore } from '../src/postgres.ts';
import { organization, person, partyStoreSuite } from '../test-suites/party-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.PARTIES_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or PARTIES_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await admin.end();
});
const clean = () => admin.query('truncate parties.party_revision, parties.party_identifier, parties.erasure_request, parties.erasure_decision');

partyStoreSuite('PostgresPartyStore', async () => {
  await clean();
  return { store: new PostgresPartyStore(pool) };
});

test('the database keeps the history, the kind and the market', async () => {
  await clean();
  const store = new PostgresPartyStore(pool);
  await store.register(person(), []);
  await assert.rejects(pool.query(`update parties.party_revision set given_name = 'Bo'`), /permission denied/);
  await assert.rejects(pool.query('delete from parties.party_revision'), /permission denied/);
  await assert.rejects(store.appendRevision(person({ revision: 2, market: 'YY', reason: 'x' })), /never change/);
  await assert.rejects(store.register(organization({ givenName: 'Anna' }), []), /party_revision_names/);
  await assert.rejects(store.register(person({ id: 'pty_bo', name: 'Bo AB' }), []), /party_revision_names/);
});

test('only an approved request by someone else anonymizes, and only through the function', async () => {
  await clean();
  const store = new PostgresPartyStore(pool);
  await store.register(person(), []);
  await assert.rejects(pool.query(`select parties.anonymize('pty_anna')`), /no approved erasure request/);
  await assert.rejects(pool.query(`update parties.party_revision set anonymized = true`), /permission denied/);
  const at = '2026-11-15T10:00:00.000Z';
  await store.addErasureRequest({ id: 'era_1', partyId: 'pty_anna', market: 'XX', basis: 'subject-request', reason: 'Asked', requestedBy: 'a', requestedAt: at });
  await assert.rejects(store.decideErasure('era_1', { outcome: 'approved', decidedBy: 'a', decidedAt: at }), /Four eyes/);
  assert.equal((await store.get('pty_anna'))!.givenName, 'Anna');
  await assert.rejects(pool.query(`delete from parties.erasure_request`), /permission denied/);
});
