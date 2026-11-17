import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationDecisionProblems, mayAnswerProposal, mayUnderwrite, mayWithdraw, parseSearch, versionOn } from '../src/policy-logic.ts';

test('a search is recognized by its form', () => {
  assert.deepEqual(parseSearch(' pol_bella '), { kind: 'policy', id: 'pol_bella' });
  assert.deepEqual(parseSearch('ani_rex'), { kind: 'animal', id: 'ani_rex' });
  assert.deepEqual(parseSearch('pty_owner001'), { kind: 'party', id: 'pty_owner001' });
  assert.deepEqual(parseSearch('752 098 100 000 042'), { kind: 'microchip', value: '752098100000042' });
  assert.deepEqual(parseSearch('20990101-1230'), { kind: 'personal-number', value: '20990101-1230' });
  assert.deepEqual(parseSearch('990101-1230'), { kind: 'personal-number', value: '990101-1230' });
  assert.deepEqual(parseSearch('Bella'), { kind: 'unknown' });
});

test('the version in force on a date, as known now', () => {
  const v = [
    { id: 'a', validFrom: '2026-01-01', validTo: '2026-06-01', sysTo: '2026-03-01T00:00:00Z' },
    { id: 'b', validFrom: '2026-01-01', validTo: '2026-06-01' },
    { id: 'c', validFrom: '2026-06-01', validTo: '2027-01-01' },
  ];
  assert.equal(versionOn(v, '2026-02-01')!.id, 'b', 'the superseded version is not known now');
  assert.equal(versionOn(v, '2026-06-01')!.id, 'c');
  assert.equal(versionOn(v, '2030-01-01')!.id, 'c', 'after the end: the latest');
});

test('a decision on an application needs a note; a decline a reason code; no start in the past', () => {
  assert.deepEqual(applicationDecisionProblems({ outcome: 'accept', note: ' ' }, '2026-11-16'), ['application.needNote']);
  assert.deepEqual(applicationDecisionProblems({ outcome: 'decline', note: 'Vet record', reason: 'Too Old' }, '2026-11-16'), ['application.needReason']);
  assert.deepEqual(applicationDecisionProblems({ outcome: 'decline', note: 'Vet record', reason: 'ongoing-symptoms' }, '2026-11-16'), []);
  assert.deepEqual(applicationDecisionProblems({ outcome: 'accept', note: 'ok', startDate: '2026-11-15' }, '2026-11-16'), ['application.startInPast']);
});

test('who may decide, withdraw and answer', () => {
  const me = (p: string[]) => ({ subject: 's', roles: [], permissions: p, scope: { markets: '*' as const } });
  assert.equal(mayUnderwrite(me(['policies:underwrite']), { status: 'referred' }), true);
  assert.equal(mayUnderwrite(me(['policies:underwrite']), { status: 'declined' }), false);
  assert.equal(mayUnderwrite(me(['policies:write']), { status: 'referred' }), false);
  assert.equal(mayWithdraw(me(['policies:write']), { status: 'referred' }), true);
  assert.equal(mayAnswerProposal(me(['policies:write']), {}), true);
  assert.equal(mayAnswerProposal(me(['policies:write']), { decision: {} }), false);
});

test('the top bar search opens a known id, else searches policies without putting the query in the address', async () => {
  const { searchTarget } = await import('../src/policy-logic.ts');
  assert.deepEqual(searchTarget('clm_048213'), { path: '/claims/clm_048213' });
  assert.deepEqual(searchTarget('app_9a'), { path: '/applications/app_9a' });
  assert.deepEqual(searchTarget('ntc_1'), { path: '/notices/ntc_1' });
  assert.deepEqual(searchTarget('pol_bella'), { path: '/policies/pol_bella' });
  assert.deepEqual(searchTarget(' 20990101-1230 '), { path: '/policies', query: '20990101-1230' });
});

test('a party is named by given and family name, or the organisation name', async () => {
  const { partyName } = await import('../src/policy-logic.ts');
  assert.equal(partyName({ givenName: 'Eva', familyName: 'Lind' }), 'Eva Lind');
  assert.equal(partyName({ name: 'Stall Norr AB' }), 'Stall Norr AB');
  assert.equal(partyName(null), '');
});
