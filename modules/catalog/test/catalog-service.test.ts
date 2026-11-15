import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogError, CatalogService, InMemoryReferenceDataStore, labelFor } from '../src/index.ts';

function setup() {
  let t = 0;
  const clock = { now: () => `2026-11-15T10:00:0${t++}.000Z` };
  return new CatalogService({ references: new InMemoryReferenceDataStore(), clock });
}
const by = 'catalog@example.test';
const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof CatalogError && e.code === code && (!msg || msg.test(e.message)));

test('a species and its breeds are created and listed per species', async () => {
  const s = setup();
  const dog = await s.putReference('species', 'dog', { labels: { en: 'Dog', de: 'Hund' } }, by);
  assert.equal(dog.created, true);
  assert.deepEqual(dog.item, { kind: 'species', code: 'dog', labels: { en: 'Dog', de: 'Hund' }, active: true, revision: 1, changedBy: by, changedAt: '2026-11-15T10:00:00.000Z' });
  await s.putReference('species', 'cat', { labels: { en: 'Cat' } }, by);
  await s.putReference('breed', 'dog-beagle', { parent: 'dog', labels: { en: 'Beagle' } }, by);
  await s.putReference('breed', 'cat-domestic', { parent: 'cat', labels: { en: 'Domestic cat' } }, by);
  assert.deepEqual((await s.listReferences('breed', { parent: 'dog' })).map((b) => b.code), ['dog-beagle']);
  assert.deepEqual((await s.listReferences('breed')).map((b) => b.code), ['cat-domestic', 'dog-beagle']);
});

test('a change needs the current revision and a reason, and keeps the history', async () => {
  const s = setup();
  await s.putReference('species', 'dog', { labels: { en: 'Dog' } }, by);
  await rejects(s.putReference('species', 'dog', { labels: { en: 'Doggo' }, basedOnRevision: 1 }, by), 'validation', /reason/);
  const r = await s.putReference('species', 'dog', { labels: { en: 'Dog', fr: 'Chien' }, basedOnRevision: 1, reason: 'French' }, 'other@example.test');
  assert.equal(r.created, false);
  assert.equal(r.item.revision, 2);
  await rejects(s.putReference('species', 'dog', { labels: { en: 'Hound' }, basedOnRevision: 1, reason: 'x' }, by), 'conflict', /revision 2/);
  await rejects(s.putReference('species', 'dog', { labels: { en: 'Hound' } }, by), 'conflict');
  await rejects(s.putReference('species', 'wolf', { labels: { en: 'Wolf' }, basedOnRevision: 1 }, by), 'conflict', /does not exist/);
  const h = await s.referenceHistory('species', 'dog');
  assert.deepEqual(h.map((i) => [i.revision, i.changedBy, i.reason]), [[1, by, undefined], [2, 'other@example.test', 'French']]);
});

test('repeating a stored change is safe and creates no revision', async () => {
  const s = setup();
  const first = await s.putReference('species', 'dog', { labels: { en: 'Dog' } }, by);
  const again = await s.putReference('species', 'dog', { labels: { en: 'Dog' } }, by);
  assert.deepEqual(again, { item: first.item, created: false });
  const change = { labels: { en: 'Dog' }, active: false, basedOnRevision: 1, reason: 'Not sold' };
  const r2 = await s.putReference('species', 'dog', change, by);
  assert.deepEqual((await s.putReference('species', 'dog', change, by)).item, r2.item);
  assert.equal((await s.referenceHistory('species', 'dog')).length, 2);
});

test('a code is deactivated, never deleted, and inactive parents take no new children', async () => {
  const s = setup();
  await s.putReference('species', 'dog', { labels: { en: 'Dog' } }, by);
  await s.putReference('species', 'dog', { labels: { en: 'Dog' }, active: false, basedOnRevision: 1, reason: 'Paused' }, by);
  assert.equal((await s.getReference('species', 'dog')).active, false);
  assert.deepEqual(await s.listReferences('species', { active: true }), []);
  await rejects(s.putReference('breed', 'dog-pug', { parent: 'dog', labels: { en: 'Pug' } }, by), 'validation', /not active/);
});

test('invalid input is refused', async () => {
  const s = setup();
  await rejects(s.putReference('colour', 'red', { labels: { en: 'Red' } }, by), 'not_found');
  await rejects(s.putReference('species', 'Dog', { labels: { en: 'Dog' } }, by), 'validation', /Invalid code/);
  await rejects(s.putReference('species', 'dog', { labels: {} }, by), 'validation', /label/);
  await rejects(s.putReference('species', 'dog', { labels: { english: 'Dog' } }, by), 'validation', /language tag/);
  await rejects(s.putReference('species', 'dog', { labels: { en: '  ' } }, by), 'validation');
  await rejects(s.putReference('sex', 'male', { parent: 'dog', labels: { en: 'Male' } }, by), 'validation', /no parent/);
  await rejects(s.putReference('breed', 'dog-pug', { labels: { en: 'Pug' } }, by), 'validation', /needs a parent/);
  await rejects(s.putReference('breed', 'dog-pug', { parent: 'dog', labels: { en: 'Pug' } }, by), 'validation', /does not exist/);
  await rejects(s.getReference('species', 'dog'), 'not_found');
});

test('a breed cannot move to another species', async () => {
  const s = setup();
  await s.putReference('species', 'dog', { labels: { en: 'Dog' } }, by);
  await s.putReference('species', 'cat', { labels: { en: 'Cat' } }, by);
  await s.putReference('breed', 'dog-pug', { parent: 'dog', labels: { en: 'Pug' } }, by);
  await rejects(s.putReference('breed', 'dog-pug', { parent: 'cat', labels: { en: 'Pug' }, basedOnRevision: 1, reason: 'x' }, by), 'validation', /cannot change/);
  const r = await s.putReference('breed', 'dog-pug', { labels: { en: 'Pug', de: 'Mops' }, basedOnRevision: 1, reason: 'German' }, by);
  assert.equal(r.item.parent, 'dog');
});

test('the label follows the caller languages, with English and then the first tag as fallback', () => {
  const labels = { en: 'Dog', sv: 'Hund', 'de-CH': 'Hund (CH)', nb: 'Hund (nb)' };
  assert.equal(labelFor(labels, 'sv-SE,sv;q=0.9,en;q=0.8'), 'Hund');
  assert.equal(labelFor(labels, 'de-CH'), 'Hund (CH)');
  assert.equal(labelFor(labels, 'de'), 'Hund (CH)');
  assert.equal(labelFor(labels, 'fi, nb'), 'Hund (nb)');
  assert.equal(labelFor(labels, 'fi'), 'Dog');
  assert.equal(labelFor(labels, undefined), 'Dog');
  assert.equal(labelFor({ sv: 'Hund', da: 'Hund (da)' }, 'fi'), 'Hund (da)');
});
