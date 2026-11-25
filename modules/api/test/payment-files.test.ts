/** The bank's camt.054 through the API (ADR 0040, punkt 12): read in by a person, matched to the invoice by its OCR. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';

const camt = readFileSync(new URL('../../payments/test/files/camt054-se.xml', import.meta.url), 'utf8');

test('a clerk reads in the bank file; the payment with the OCR pays the invoice, and the file is kept', async () => {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock, payments: { bankFile: { accounts: [{ id: '5050-1055', market: 'SE', currency: 'SEK' }] } } });
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  await inst.deps.billing!.invoicingRun({ market: 'SE', onDate: '2026-11-15', dryRun: false }, 'scheduler');
  const tokens: Record<string, Principal> = {
    clerk: { subject: 'ekonomi@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    handler: { subject: 'h@example.test', roles: ['handler'], markets: ['SE'] },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let k = 0;
  const upload = async (token: string, xml: string) => {
    const form = new FormData();
    form.append('file', new File([xml], 'camt054.xml', { type: 'application/xml' }));
    const res = await app.request('/v1/payment-files', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'idempotency-key': `key-pfl-${String(++k).padStart(4, '0')}` }, body: form });
    return { status: res.status, body: (await res.json()) as any };
  };
  const get = async (path: string) => (await app.request(path, { headers: { authorization: 'Bearer clerk' } })).json() as Promise<any>;

  const invoice = (await get('/v1/invoices?status=open')).items[0];
  // The file's first payment carries this invoice's OCR and amount.
  const xml = camt.replace('202600000121', invoice.reference.value).replace('<Amt Ccy="SEK">412.00</Amt>', `<Amt Ccy="SEK">${(invoice.total / 100).toFixed(2)}</Amt>`);

  assert.equal((await upload('handler', xml)).status, 403);
  const r = await upload('clerk', xml);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(validatorFor('PaymentFile')(structuredClone(r.body)), JSON.stringify(validatorFor('PaymentFile').errors));
  assert.deepEqual([r.body.received, r.body.duplicates, r.body.importedBy], [3, 0, 'ekonomi@example.test']);
  while ((await inst.relay.tick()) > 0);
  assert.equal((await get(`/v1/invoices/${invoice.id}`)).status, 'paid');

  const again = await upload('clerk', xml);
  assert.deepEqual([again.status, again.body.received, again.body.duplicates], [201, 0, 3], 'the same file again adds nothing');
  const wrong = await upload('clerk', xml.replace('5050-1055', '1111-2222'));
  assert.equal(wrong.status, 422);
  assert.match(wrong.body.detail ?? wrong.body.title, /not one of the insurer's/);
  assert.deepEqual((await get('/v1/payment-files')).items.map((f: any) => f.id), [again.body.id, r.body.id]);

  // Never through the open notification route: a bank file has no signature.
  const open = await app.request('/provider-notifications/bank-file', { method: 'POST', headers: { 'content-type': 'application/xml' }, body: xml });
  assert.equal(open.status, 404);
});
