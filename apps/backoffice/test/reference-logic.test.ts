import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenceBody, referenceProblems, suggestCode, type ReferenceForm } from '../src/reference-logic.ts';

const form = (o: Partial<ReferenceForm> = {}): ReferenceForm => ({ code: 'dog-kooikerhondje', labels: { sv: 'Kooikerhondje', en: 'Kooikerhondje' }, parent: 'dog', active: true, reason: '', ...o });

test('a new code needs a code, a label and, for a breed, its species; a change needs a reason', () => {
  assert.deepEqual(referenceProblems('breed', form(), true), []);
  assert.deepEqual(referenceProblems('breed', form({ code: 'Dog Kooiker', labels: { sv: ' ' }, parent: '' }), true), ['code', 'labels', 'parent']);
  assert.deepEqual(referenceProblems('sex', form({ parent: '' }), true), [], 'only a breed has a species');
  assert.deepEqual(referenceProblems('breed', form(), false), ['reason']);
  assert.deepEqual(referenceProblems('breed', form({ reason: 'Swedish name corrected' }), false), []);
});

test('the body: a new breed names its species, a change its revision and reason, empty labels left out', () => {
  assert.deepEqual(referenceBody('breed', form({ labels: { sv: ' Kooikerhondje ', en: '', de: 'Kooikerhondje' } })), { labels: { sv: 'Kooikerhondje', de: 'Kooikerhondje' }, active: true, parent: 'dog' });
  assert.deepEqual(referenceBody('breed', form({ active: false, reason: ' Not bred any more ' }), 3), { labels: { sv: 'Kooikerhondje', en: 'Kooikerhondje' }, active: false, basedOnRevision: 3, reason: 'Not bred any more' });
  assert.deepEqual(referenceBody('species', form()), { labels: { sv: 'Kooikerhondje', en: 'Kooikerhondje' }, active: true });
});

test('a suggested code from the English label', () => {
  assert.equal(suggestCode('breed', 'Labrador Retriever', 'dog'), 'dog-labrador-retriever');
  assert.equal(suggestCode('species', 'Guinea pig', ''), 'guinea-pig');
  assert.equal(suggestCode('breed', 'L\u00f6wchen', 'dog'), 'dog-lowchen');
  assert.equal(suggestCode('sex', '', ''), '');
});
