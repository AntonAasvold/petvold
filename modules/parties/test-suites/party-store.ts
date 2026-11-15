/** Shared PartyStore tests, run against every implementation. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PartyConflictError, PartyIdentifierTakenError, anonymize, type ErasureRequest, type Party, type PartyIdentifier, type PartyStore } from '../src/index.ts';

export type PartyStoreFactory = () => Promise<{ store: PartyStore; cleanup?: () => Promise<void> }>;

const at = '2026-11-15T10:00:00.000Z';
export const person = (overrides: Partial<Party> = {}): Party => ({
  id: 'pty_anna',
  revision: 1,
  kind: 'person',
  market: 'XX',
  givenName: 'Anna',
  familyName: 'Example',
  birthDate: '1985-03-12',
  email: 'anna@example.test',
  phone: '+46700000000',
  address: { street: 'Example Street 1', postalCode: '11122', city: 'Example City', country: 'SE' },
  language: 'sv',
  changedBy: 'registrar@example.test',
  changedAt: at,
  ...overrides,
});
export const organization = (overrides: Partial<Party> = {}): Party => ({
  id: 'pty_kennel',
  revision: 1,
  kind: 'organization',
  market: 'XX',
  name: 'Example Kennel',
  changedBy: 'registrar@example.test',
  changedAt: at,
  ...overrides,
});
/** Born 2099: no living person can have this number. */
export const personalNumber = (value = '209901011230'): PartyIdentifier => ({
  type: 'personal-number',
  country: 'SE',
  value,
  addedBy: 'registrar@example.test',
  addedAt: at,
});

export function partyStoreSuite(name: string, factory: PartyStoreFactory): void {
  describe(`PartyStore: ${name}`, () => {
    const it = (title: string, fn: (store: PartyStore) => Promise<void>) =>
      test(title, async () => {
        const h = await factory();
        try {
          await fn(h.store);
        } finally {
          await h.cleanup?.();
        }
      });

    it('a party is read back with its identifiers', async (store) => {
      await store.register(person(), [personalNumber()]);
      assert.deepEqual(await store.get('pty_anna'), { ...person(), identifiers: [personalNumber()] });
      await store.register(organization(), []);
      assert.deepEqual(await store.get('pty_kennel'), { ...organization(), identifiers: [] });
      assert.equal(await store.findByIdentifier('personal-number', 'SE', '209901011230'), 'pty_anna');
      assert.equal(await store.findByIdentifier('personal-number', 'NO', '209901011230'), null);
      assert.equal(await store.get('pty_none'), null);
    });

    it('registering is all or nothing, and an identifier belongs to one party', async (store) => {
      await store.register(person(), [personalNumber()]);
      await assert.rejects(store.register(person({ id: 'pty_bo' }), [personalNumber()]), PartyIdentifierTakenError);
      assert.equal(await store.get('pty_bo'), null);
      await assert.rejects(store.register(person(), []), PartyConflictError);
      const second = personalNumber('209903154566');
      await store.addIdentifier('pty_anna', second);
      await assert.rejects(store.addIdentifier('pty_anna', second), PartyIdentifierTakenError);
      assert.equal((await store.get('pty_anna'))!.identifiers.length, 2);
    });

    it('an approved erasure anonymizes every revision and removes the identifiers', async (store) => {
      const request: ErasureRequest = {
        id: 'era_1',
        partyId: 'pty_anna',
        market: 'XX',
        basis: 'subject-request',
        reason: 'The customer asked',
        requestedBy: 'officer-a@example.test',
        requestedAt: at,
      };
      await store.register(person(), [personalNumber()]);
      const moved = person({ revision: 2, reason: 'Moved to Example Road 2', changedAt: '2026-11-16T10:00:00.000Z' });
      await store.appendRevision(moved);
      await store.addErasureRequest(request);
      await assert.rejects(store.addErasureRequest({ ...request, id: 'era_2' }), PartyConflictError);
      assert.deepEqual(await store.listErasureRequests({ pending: true }), [request]);

      const decision = { outcome: 'approved' as const, decidedBy: 'officer-b@example.test', decidedAt: '2026-11-17T10:00:00.000Z' };
      await store.decideErasure('era_1', decision);
      await assert.rejects(store.decideErasure('era_1', decision), PartyConflictError);
      assert.deepEqual(await store.revisions('pty_anna'), [anonymize(person()), anonymize(moved)]);
      assert.deepEqual(await store.get('pty_anna'), { ...anonymize(moved), identifiers: [] });
      assert.equal(await store.findByIdentifier('personal-number', 'SE', '209901011230'), null);
      assert.deepEqual(await store.getErasureRequest('era_1'), { ...request, decision });
      assert.deepEqual(await store.listErasureRequests({ pending: true }), []);
      assert.deepEqual((await store.listErasureRequests({ partyId: 'pty_anna' })).map((r) => r.id), ['era_1']);
      // Another request is allowed once the first is decided.
      await store.addErasureRequest({ ...request, id: 'era_2' });
    });

    it('a rejected request can restrict the party until a date, and does not anonymize', async (store) => {
      await store.register(person(), [personalNumber()]);
      await store.addErasureRequest({ id: 'era_1', partyId: 'pty_anna', market: 'XX', basis: 'subject-request', reason: 'Asked', requestedBy: 'a', requestedAt: at });
      await store.decideErasure('era_1', { outcome: 'rejected', reason: 'Open claim', restrictUntil: '2036-11-15', decidedBy: 'a', decidedAt: at });
      const p = (await store.get('pty_anna'))!;
      assert.deepEqual([p.restrictedUntil, p.givenName, p.anonymized, p.identifiers.length], ['2036-11-15', 'Anna', undefined, 1]);
      assert.equal(await store.getErasureRequest('era_none'), null);
    });

    it('revisions follow each other and keep the history', async (store) => {
      await store.register(person(), []);
      const moved = person({ revision: 2, address: { street: 'New Road 2', postalCode: '22233', city: 'Other City', country: 'SE' }, reason: 'Moved', changedAt: '2026-11-16T10:00:00.000Z' });
      await store.appendRevision(moved);
      await assert.rejects(store.appendRevision(moved), PartyConflictError);
      await assert.rejects(store.appendRevision(person({ revision: 4, reason: 'x' })), PartyConflictError);
      assert.deepEqual(await store.revisions('pty_anna'), [person(), moved]);
      assert.equal((await store.get('pty_anna'))!.address!.city, 'Other City');
    });
  });
}
