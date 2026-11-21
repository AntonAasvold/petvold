import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sv } from '../src/templates/texts-sv.ts';
import { DocumentError, DocumentService, InMemoryBlobStore, InMemoryDocumentStore, TEMPLATES, canonical, sha256, type PdfRenderer } from '../src/index.ts';

const decision = {
  claimId: 'clm_1',
  claimNo: 'S-2026-000123',
  animalId: 'ani_bella',
  outcome: 'partial',
  payout: { amount: 1_216_500, currency: 'SEK' },
  automated: false,
  mainReason: { reason: 'decision.partial', params: { payout: 1_216_500, currency: 'SEK' } },
  steps: [
    { step: 'billed', amount: 1_864_000, reason: 'step.billed', params: { currency: 'SEK' } },
    { step: 'deductible_fixed', amount: -200_000, reason: 'step.deductible_fixed', params: { currency: 'SEK' } },
  ],
  deviation: { reasonCode: 'not_covered', reason: '<b>Food</b> is not covered' },
  review: 'Contact our complaints manager.',
};
const ctx = { now: '2026-11-21T10:00:00.000Z', recipient: { name: 'Anna Example', addressLines: ['Storgatan 1', '111 22 Stockholm'] }, sender: 'Petvold Insurance', animalName: 'Bella', reason: (r: { reason: string }) => `text:${r.reason}` };

test('the claims decision template fills in the calculation the market\'s way, and escapes what it is given (ADR 0038)', () => {
  const t = TEMPLATES.find((x) => x.name === 'claim-decision' && x.language === 'sv')!;
  const html = t.render(decision, ctx);
  assert.match(html, /<html lang="sv">/);
  assert.match(html, /Skadebesked S-2026-000123/);
  assert.match(html, /12\s165,00\s*kr/, 'Swedish money format');
  assert.match(html, /text:step\.deductible_fixed/);
  assert.match(html, /&lt;b&gt;Food&lt;\/b&gt;/, 'escaped');
  assert.doesNotMatch(html, /<script|https?:\/\//, 'no scripts and nothing to fetch');
  // The sentence about a person's review, from the Swedish catalogue.
  assert.ok(t.render({ ...decision, automated: true }, ctx).includes(sv.automated));
});

test('templates are versioned with a checksum per market and language', () => {
  const names = new Set(TEMPLATES.map((t) => `${t.name}/${t.market}/${t.language}`));
  assert.ok(names.has('policy-confirmation/SE/sv') && names.has('claim-decision/SE/en'));
  for (const t of TEMPLATES) assert.match(t.checksum, /^[0-9a-f]{64}$/);
  const sv = TEMPLATES.find((x) => x.name === 'claim-decision' && x.language === 'sv')!;
  const en = TEMPLATES.find((x) => x.name === 'claim-decision' && x.language === 'en')!;
  assert.notEqual(sv.checksum, en.checksum, 'the texts are part of the checksum');
});

test('generate keeps the PDF with its template and data hash; without a renderer it is unavailable', async () => {
  const rendered: string[] = [];
  const renderer: PdfRenderer = { render: async ({ html }) => (rendered.push(html), new TextEncoder().encode(`%PDF-1.7\n${html.length}`)) };
  let n = 0;
  const deps = { store: new InMemoryDocumentStore(), blobs: new InMemoryBlobStore(), clock: { now: () => ctx.now }, ids: { next: (p: string) => `${p}_${++n}` }, signingKey: new Uint8Array(32).fill(1), publicBaseUrl: 'https://p.example.test' };
  const s = new DocumentService({ ...deps, renderer });
  const input = { template: 'claim-decision', market: 'SE', language: 'sv', data: decision, context: ctx, owner: { noticeId: 'ntc_1', policyId: 'pol_bella', claimId: 'clm_1' }, partyIds: ['pty_owner001'] };
  const doc = await s.generate(input, 'h');
  const t = TEMPLATES.find((x) => x.name === 'claim-decision' && x.language === 'sv')!;
  assert.deepEqual([doc.kind, doc.mediaType, doc.template], ['generated', 'application/pdf', { name: 'claim-decision', market: 'SE', language: 'sv', version: 1, checksum: t.checksum, dataHash: sha256(new TextEncoder().encode(canonical(decision))) }]);
  assert.equal(rendered.length, 1);
  assert.deepEqual((await s.list({ noticeId: 'ntc_1' })).map((d) => d.id), [doc.id]);
  await assert.rejects(s.generate({ ...input, template: 'no-such' }, 'h'), (e: unknown) => e instanceof DocumentError && e.code === 'validation');
  await assert.rejects(new DocumentService(deps).generate(input, 'h'), (e: unknown) => e instanceof DocumentError && e.code === 'unavailable');
});

test('the invoice: what to pay, by when, the reference, where to pay and the installments (ADR 0040)', () => {
  const data = {
    invoiceId: 'inv_1',
    invoiceNo: 'SE-2026-000001',
    issueDate: '2026-11-22',
    dueDate: '2026-12-06',
    total: { amount: 82_900, currency: 'SEK' },
    reference: { type: 'ocr', value: '202600000121' },
    payment: 'Bankgiro 123-4567',
    lines: [
      { policyId: 'pol_bella', periodStart: '2026-12-01', periodEnd: '2027-01-01', premium: 40_000, tax: 0, fee: 2_900, amount: 42_900 },
      { policyId: 'pol_<x>', periodStart: '2026-12-15', periodEnd: '2027-01-15', premium: 40_000, tax: 0, fee: 0, amount: 40_000 },
    ],
  };
  const t = TEMPLATES.find((x) => x.name === 'invoice' && x.language === 'sv')!;
  const html = t.render(data, ctx);
  assert.match(html, /Faktura SE-2026-000001/);
  assert.match(html, /Betala 829,00\s*kr senast 6 december 2026\./);
  assert.match(html, /OCR-nummer<\/dt><dd class="mono">202600000121/);
  assert.match(html, /Bankgiro 123-4567/);
  assert.match(html, /1 december 2026 – 31 december 2026/, 'the period ends on its last day');
  assert.match(html, /Avgift/, 'a fee column when there is a fee');
  assert.doesNotMatch(html, /Skatt/, 'no tax column without tax');
  assert.match(html, /pol_&lt;x&gt;/, 'escaped');
  const en = TEMPLATES.find((x) => x.name === 'invoice' && x.language === 'en')!.render({ ...data, reference: { type: 'rf', value: 'RF422026000001' } }, ctx);
  assert.match(en, /Reference<\/dt><dd class="mono">RF422026000001/);
});
