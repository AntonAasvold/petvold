import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeBody, displayName, emptyParty, partyProblems, partyToForm, registerBody } from '../src/party-logic.ts';

test('a person needs a name; an organization its name; contact details must look right', () => {
  assert.deepEqual(partyProblems(emptyParty()), ['party.needName']);
  assert.deepEqual(partyProblems({ ...emptyParty(), kind: 'organization' }), ['party.needOrgName']);
  const bad = { ...emptyParty(), givenName: 'Eva', familyName: 'Lind', email: 'eva@', phone: '0701', street: 'Storgatan 1', language: 'swe' };
  assert.deepEqual(partyProblems(bad), ['party.badEmail', 'party.badPhone', 'party.partAddress', 'party.badLanguage']);
  assert.deepEqual(partyProblems({ ...bad, email: 'eva@example.test', phone: '+46 70 123 45 67', postalCode: '111 22', city: 'Stockholm', language: 'sv' }), []);
});

test('the bodies leave out empty fields, keep the address whole, and the number goes along at registration', () => {
  const f = { ...emptyParty(), givenName: ' Eva ', familyName: 'Lind', phone: '+46 70-123 45 67', name: 'not for a person' };
  assert.deepEqual(registerBody(f, { type: 'personal-number', country: 'SE', value: ' 19850312-1234 ' }), {
    kind: 'person',
    market: 'SE',
    givenName: 'Eva',
    familyName: 'Lind',
    phone: '+46701234567',
    identifiers: [{ type: 'personal-number', country: 'SE', value: '19850312-1234' }],
  });
  assert.deepEqual(registerBody(f, { type: 'personal-number', country: 'SE', value: ' ' }).identifiers, undefined);
  const stored = { kind: 'person' as const, market: 'SE', givenName: 'Eva', familyName: 'Lind', address: { street: 'Storgatan 1', postalCode: '11122', city: 'Stockholm', country: 'SE' } };
  assert.deepEqual(changeBody(partyToForm(stored), 3, ' Moved '), { basedOnRevision: 3, reason: 'Moved', givenName: 'Eva', familyName: 'Lind', address: stored.address });
});

test('the name to show, and none for an anonymized party', () => {
  assert.equal(displayName({ givenName: 'Eva', familyName: 'Lind' }), 'Eva Lind');
  assert.equal(displayName({ name: 'Stall Norr AB' }), 'Stall Norr AB');
  assert.equal(displayName({ anonymized: true, givenName: 'x' }), '–');
});
