import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryPartyStore,
  PartyError,
  PartyService,
  displayName,
  luhnValid,
  normalizePartyIdentifier,
  publicView,
  type RegisterPartyInput,
} from '../src/index.ts';

function setup() {
  let n = 0;
  return new PartyService({ store: new InMemoryPartyStore(), clock: { now: () => '2026-11-15T10:00:00.000Z' }, ids: { next: (p) => `${p}_${++n}` } });
}
const by = 'registrar@example.test';
// Personal numbers born 2099: valid in form, but no living person can have them.
const PNR = '20990101-1230';
const anna = (o: Partial<RegisterPartyInput> = {}): RegisterPartyInput => ({
  kind: 'person',
  market: 'SE',
  givenName: ' Anna ',
  familyName: 'Example',
  email: 'anna@example.test',
  phone: '+46 70 000 00 00',
  address: { street: 'Example Street 1', postalCode: '111 22', city: 'Example City', country: 'SE' },
  language: 'sv',
  identifiers: [{ type: 'personal-number', country: 'SE', value: PNR }],
  ...o,
});
const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof PartyError && e.code === code && (!msg || msg.test(e.message)));

test('a person is registered with a normalized personal number and found by it', async () => {
  const s = setup();
  const p = await s.register(anna(), by);
  assert.deepEqual([p.id, p.givenName, p.phone, p.revision], ['pty_1', 'Anna', '+46700000000', 1]);
  assert.deepEqual(p.identifiers.map((i) => i.value), ['209901011230']);
  assert.deepEqual((await s.findByIdentifier({ type: 'personal-number', country: 'SE', value: '209901011230' })).map((x) => x.id), ['pty_1']);
  assert.equal(await s.marketOf('pty_1'), 'SE');
  assert.equal(await s.marketOf('pty_none'), null);
  assert.equal(displayName(p), 'Anna Example');
});

test('the public view masks personal numbers but not organization numbers', async () => {
  const s = setup();
  const p = publicView(await s.register(anna(), by));
  assert.deepEqual(p.identifiers.map((i) => [i.value, i.masked]), [['20990101-****', true]]);
  const org = publicView(
    await s.register({ kind: 'organization', market: 'SE', name: 'Example Kennel', identifiers: [{ type: 'organization-number', country: 'SE', value: '202100-5448' }] }, by),
  );
  assert.deepEqual(org.identifiers.map((i) => [i.value, i.masked]), [['2021005448', false]]);
  assert.equal(displayName(org), 'Example Kennel');
});

test('a personal or organization number belongs to one party', async () => {
  const s = setup();
  await s.register(anna(), by);
  await rejects(s.register(anna({ givenName: 'Copy' }), by), 'conflict', /belongs to another party/);
  const bo = await s.register(anna({ givenName: 'Bo', identifiers: [] }), by);
  await rejects(s.addIdentifier(bo.id, { type: 'personal-number', country: 'SE', value: PNR }, by), 'conflict');
  const added = await s.addIdentifier(bo.id, { type: 'personal-number', country: 'SE', value: '209901612342' }, by); // coordination number
  assert.equal(added.identifiers.length, 1);
  assert.equal((await s.addIdentifier(bo.id, { type: 'personal-number', country: 'SE', value: '20990161-2342' }, by)).identifiers.length, 1); // a retry
  await rejects(s.addIdentifier(bo.id, { type: 'organization-number', country: 'SE', value: '2021005448' }, by), 'validation', /cannot have/);
});

test('details change with the current revision and a reason; kind and market never change', async () => {
  const s = setup();
  const p = await s.register(anna(), by);
  const base = { givenName: 'Anna', familyName: 'Example', address: { street: 'New Road 2', postalCode: '22233', city: 'Other City', country: 'SE' } };
  await rejects(s.change(p.id, { ...base, basedOnRevision: 1, reason: ' ' }, by), 'validation', /reason/);
  const moved = await s.change(p.id, { ...base, basedOnRevision: 1, reason: 'Moved' }, by);
  assert.deepEqual([moved.revision, moved.address?.city, moved.email, moved.kind, moved.market], [2, 'Other City', undefined, 'person', 'SE']);
  await rejects(s.change(p.id, { ...base, basedOnRevision: 1, reason: 'x' }, by), 'conflict', /revision 2/);
  await rejects(s.change(p.id, { name: 'Anna AB', basedOnRevision: 2, reason: 'x' }, by), 'validation', /not name/);
  assert.deepEqual((await s.revisions(p.id)).map((r) => r.revision), [1, 2]);
});

test('invalid parties are refused', async () => {
  const s = setup();
  await rejects(s.register(anna({ kind: 'robot' as never }), by), 'validation', /kind/);
  await rejects(s.register(anna({ market: 'se' }), by), 'validation', /market/);
  await rejects(s.register(anna({ familyName: ' ' }), by), 'validation', /givenName and familyName/);
  await rejects(s.register(anna({ birthDate: '2027-01-01' }), by), 'validation', /birthDate/);
  await rejects(s.register(anna({ email: 'anna' }), by), 'validation', /email/);
  await rejects(s.register(anna({ phone: '0701234567' }), by), 'validation', /phone/);
  await rejects(s.register(anna({ address: { street: 'x', postalCode: '1', city: '', country: 'SE' } }), by), 'validation', /address/);
  await rejects(s.register(anna({ language: 'swe' }), by), 'validation', /language/);
  await rejects(s.register({ kind: 'organization', market: 'SE', name: 'X AB', givenName: 'X' }, by), 'validation', /organization/);
  await rejects(s.register({ kind: 'organization', market: 'SE' }, by), 'validation', /needs a name/);
  await rejects(s.register(anna({ identifiers: [{ type: 'personal-number', country: 'SE', value: PNR }, { type: 'personal-number', country: 'SE', value: PNR }] }), by), 'validation', /twice/);
  await rejects(s.get('pty_none'), 'not_found');
});

test('Swedish numbers are checked; other countries only for form', () => {
  const pnr = (value: string) => normalizePartyIdentifier({ type: 'personal-number', country: 'SE', value }).value;
  assert.equal(pnr('20990315-4566'), '209903154566');
  assert.throws(() => pnr('20990315-4567'), /Invalid Swedish personal number/); // check digit
  assert.throws(() => pnr('20990230-0000'), /Invalid Swedish personal number/); // 30 February
  assert.throws(() => pnr('9903154566'), /12 digits/);
  const org = (value: string) => normalizePartyIdentifier({ type: 'organization-number', country: 'SE', value }).value;
  assert.equal(org('16202100-5448'), '2021005448');
  assert.throws(() => org('2021005449'), /organization number/);
  assert.equal(normalizePartyIdentifier({ type: 'personal-number', country: 'NO', value: 'ab 12-34' }).value, 'AB1234');
  assert.throws(() => normalizePartyIdentifier({ type: 'personal-number', country: 'Sweden', value: '1' }), /country/);
  assert.ok(luhnValid('2021005448'));
  assert.ok(!luhnValid('2021005447'));
});
