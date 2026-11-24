import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesFrom, partsOf, rewriteLinks, search, slugify, snippet } from '../src/docs-logic.ts';

const files = {
  '../../../docs/processer/README.md': '# Processes and rules\n\nAn overview.\n',
  '../../../docs/processer/obetald-premie.md': [
    '# Unpaid premium',
    '',
    'Reminder and notice.',
    '',
    '## Rules',
    '',
    '| Id | Rule |',
    '| --- | --- |',
    '| PREM-07 | A reminder seven days after the due date |',
    '| PREM-08 | Paid before the notice takes effect, see PREM-07 |',
    '',
    '```mermaid',
    '# not a heading',
    '```',
    '',
    'See [Premiums](../funktion/premier.md#invoices), [ADR](../adr/0040-pengar.md) and [operations](../teknik/drift.md).',
  ].join('\n'),
  '../../../docs/funktion/premier.md': '# Premiums and payments\n\n## Invoices\n\nThe invoice falls due and may get a reminder.\n',
  '../../../docs/adr/0040-pengar.md': '# 0040. Money\n\nDecision on reminders.\n',
  '../../../docs/teknik/drift.md': '# Drift\n',
  '../../../docs/adr/0000-mall.md': '# NNNN. Title\n',
};
const pages = pagesFrom(files);

test('pages come from processes, functions and decisions, README first, technical docs left out', () => {
  assert.deepEqual(pages.map((p) => `${p.section}/${p.slug}`), ['processer/README', 'processer/obetald-premie', 'funktion/premier', 'adr/0040-pengar']);
  assert.equal(pages[1]!.title, 'Unpaid premium');
});

test('a page splits at its headings, but not inside code', () => {
  const parts = partsOf(pages[1]!);
  assert.deepEqual(parts.map((p) => [p.heading, p.anchor, p.level]), [['Unpaid premium', '', 1], ['Rules', 'rules', 2]]);
  assert.ok(parts[1]!.text.includes('PREM-07'));
  assert.ok(!parts[1]!.text.includes('|'), 'no table pipes');
});

test('search needs every word, ranks title and heading, and finds a rule id', () => {
  assert.equal(search(pages, 'reminder').length, 4, 'every part with the word');
  assert.deepEqual(search(pages, 'premium reminder').map((h) => `${h.page.slug}#${h.part.anchor}`)[0], 'obetald-premie#', 'a word in the title ranks first');
  assert.deepEqual(search(pages, 'prem-07').map((h) => `${h.page.slug}#${h.part.anchor}`), ['obetald-premie#rules']);
  const defining = { ...files, '../../../docs/processer/other.md': '# Other\n\n## Rules\n\n| X-01 | Refers to PREM-07 |\n' };
  assert.deepEqual(search(pagesFrom(defining), 'prem-07').map((h) => h.page.slug), ['obetald-premie', 'other'], 'the row that defines the id first');
  assert.deepEqual(search(pages, 'reminder invoice').map((h) => h.page.slug), ['premier']);
  assert.deepEqual(search(pages, 'x'), [], 'one letter is no search');
  assert.deepEqual(search(pages, 'inkasso'), []);
});

test('links lead within the documentation, and others keep their text', () => {
  const known = new Set(pages.map((p) => `${p.section}/${p.slug}`));
  const out = rewriteLinks(pages[1]!.markdown, pages[1]!, known);
  assert.ok(out.includes('[Premiums](/docs/funktion/premier#invoices)'));
  assert.ok(out.includes('[ADR](/docs/adr/0040-pengar)'));
  assert.ok(out.includes(' and operations.'), 'a technical page is only text');
  assert.equal(rewriteLinks('[ext](https://riksdagen.se) [here](#a) [same](obetald-premie.md)', pages[1]!, known), '[ext](https://riksdagen.se) [here](#a) [same](/docs/processer/obetald-premie)');
});

test('anchors and snippets', () => {
  // Swedish letters are letters: \u00e5 is a ring-a.
  assert.equal(slugify('L\u00e5tsasbanken (`fake`)'), 'l\u00e5tsasbanken-fake');
  assert.equal(slugify('Payout of a Claim'), 'payout-of-a-claim');
  const s = snippet(`${'a '.repeat(100)}reminder ${'b '.repeat(100)}`, ['reminder']);
  assert.ok(s.startsWith('\u2026') && s.endsWith('\u2026') && s.includes('reminder'));
});
