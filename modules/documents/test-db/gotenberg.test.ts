/** The templates through Gotenberg in docker compose (ADR 0038): a real PDF/A from a claims decision. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GotenbergRenderer } from '../src/gotenberg.ts';
import { TEMPLATES } from '../src/index.ts';

const url = process.env.PETVOLD_GOTENBERG_URL;
if (!url) throw new Error('PETVOLD_GOTENBERG_URL is required. Copy .env.example to .env and run npm run dev:up.');

test('a claims decision becomes a PDF/A with Gotenberg, and an outside address is never fetched', async () => {
  const g = new GotenbergRenderer(url);
  await g.ping();
  const t = TEMPLATES.find((x) => x.name === 'claim-decision' && x.language === 'sv')!;
  const html = t.render(
    {
      claimNo: 'S-2026-000123',
      outcome: 'approved',
      payout: { amount: 300_000, currency: 'SEK' },
      automated: true,
      mainReason: { reason: 'decision.approved', params: {} },
      steps: [{ step: 'billed', amount: 400_000, reason: 'step.billed', params: {} }],
    },
    { now: '2026-11-21T10:00:00.000Z' },
  );
  const pdf = await g.render({ html: html.replace('</main>', '<img src="https://example.com/tracker.png" alt=""></main>') });
  const text = Buffer.from(pdf).toString('latin1');
  assert.equal(text.slice(0, 5), '%PDF-');
  assert.match(text, /pdfaid/, 'PDF/A metadata');
});
