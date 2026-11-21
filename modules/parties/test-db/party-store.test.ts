/** The shared PartyStore suite against Postgres, as the service role parties_service. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresPartyStore, PostgresRetentionStore, reapplyErasures } from '../src/postgres.ts';
import { organization, person, personalNumber, partyStoreSuite } from '../test-suites/party-store.ts';

const ownerUrl = process.env.TEST_DATABASE_URL;
const serviceUrl = process.env.PARTIES_TEST_DATABASE_URL;
if (!ownerUrl || !serviceUrl) throw new Error('TEST_DATABASE_URL or PARTIES_TEST_DATABASE_URL is missing. Copy .env.example to .env.');

const admin = new pg.Pool({ connectionString: ownerUrl, max: 1 });
const pool = new pg.Pool({ connectionString: serviceUrl, max: 4 });
after(async () => {
  await pool.end();
  await admin.end();
});
const clean = () => admin.query('truncate parties.party_revision, parties.party_identifier, parties.erasure_request, parties.erasure_decision, parties.retention_settings, parties.restriction, parties.party_status');

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

test('an identifier may only be removed, once; restriction and ending rows never change (ADR 0039)', async () => {
  await clean();
  const store = new PostgresPartyStore(pool);
  await store.register(person(), [personalNumber()]);
  await assert.rejects(pool.query(`update parties.party_identifier set value = '209903154566'`), /permission denied/);
  await assert.rejects(pool.query(`update parties.party_identifier set party_id = 'pty_bo'`), /permission denied/);
  await pool.query(`update parties.party_identifier set removed_by = 'a', removed_at = now(), removal_reason = 'Wrong party'`);
  await assert.rejects(pool.query(`update parties.party_identifier set removal_reason = 'Other'`), /removed already/);
  await assert.rejects(pool.query(`delete from parties.party_identifier`), /permission denied/);
  await store.addRestriction({ id: 'prs_1', partyId: 'pty_anna', action: 'restrict', until: '2027-01-31', reason: 'x', decidedBy: 'a', decidedAt: '2026-11-15T10:00:00.000Z' });
  await assert.rejects(pool.query(`update parties.restriction set until = '2099-01-01'`), /permission denied/);
  await assert.rejects(pool.query(`delete from parties.party_status`), /permission denied/);
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

test('retention settings are versions, and approved anonymizations can be run again after a restore', async () => {
  await clean();
  const settings = new PostgresRetentionStore(pool);
  const v1 = { version: 1, markets: { SE: { years: 10 } }, changedBy: 'petvold-defaults', changedAt: '2026-11-15T10:00:00.000Z', reason: 'Defaults' };
  await settings.append(v1);
  await assert.rejects(settings.append(v1), /exists|not the next/);
  await assert.rejects(settings.append({ ...v1, version: 3 }), /not the next/);
  assert.deepEqual(await settings.current(), v1);
  assert.deepEqual(await settings.versions(), [v1]);
  await assert.rejects(pool.query('update parties.retention_settings set reason = $1', ['x']), /permission denied/);

  const store = new PostgresPartyStore(pool);
  const at = '2026-11-15T10:00:00.000Z';
  await store.register(person(), []);
  await store.addErasureRequest({ id: 'era_1', partyId: 'pty_anna', market: 'XX', basis: 'subject-request', reason: 'Asked', requestedBy: 'a', requestedAt: at });
  await store.decideErasure('era_1', { outcome: 'approved', decidedBy: 'b', decidedAt: at });
  // A restore brings the personal data back; the owner role stands in for the backup here.
  await admin.query(`update parties.party_revision set given_name = 'Anna', family_name = 'Example', anonymized = false where party_id = 'pty_anna'`);
  assert.equal((await store.get('pty_anna'))!.givenName, 'Anna');
  assert.deepEqual(await reapplyErasures(pool), ['pty_anna']);
  assert.equal((await store.get('pty_anna'))!.givenName, undefined);
  assert.deepEqual(await reapplyErasures(pool), ['pty_anna']); // safe to run again
});
