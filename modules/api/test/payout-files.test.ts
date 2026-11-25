/** Payouts by the bank's files through the API (ADR 0040, punkt 12): pain.001 out, camt.054 back. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose } from '../src/composition.ts';
import { seedSampleData } from '../src/seed.ts';
import { createApp, validatorFor, type Principal } from '../src/index.ts';

test('a clerk makes the pain.001 for the pending payouts, fetches it, and the bank\'s debit pays them', async () => {
  const clock = { now: () => '2026-11-15T10:00:00.000Z' };
  const inst = await compose({ databases: {}, engineVersion: 'test', clock, payments: { bankFile: { accounts: [{ id: '5050-1055', market: 'SE', currency: 'SEK' }], debtorName: 'Example Insurance AB' } } });
  await seedSampleData(inst, clock);
  while ((await inst.relay.tick()) > 0);
  const tokens: Record<string, Principal> = {
    clerk: { subject: 'ekonomi@example.test', roles: ['billing-clerk'], markets: ['SE'] },
    reader: { subject: 'r@example.test', roles: ['accountant'], markets: ['SE'] },
  };
  const app = createApp({ ...inst.deps, auth: { authenticate: async (t) => (t ? (tokens[t] ?? null) : null) } });
  let k = 0;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': `key-pof-${String(++k).padStart(4, '0')}` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text } as { status: number; headers: Headers; body: any };
  };

  // The sample claims' payouts wait for the payees' details; given, they go to the bank file and wait there.
  const waiting = (await call('GET', '/v1/payouts?status=awaiting-details', 'clerk')).body.items;
  assert.ok(waiting.length > 0, 'the sample data has payouts');
  for (const partyId of new Set<string>(waiting.map((p: any) => p.partyId))) {
    assert.equal((await call('POST', `/v1/payees/${partyId}/accounts`, 'clerk', { market: 'SE', method: 'se-bank', details: { clearing: '8327', account: '9412345678' } })).status, 201);
  }
  const pending = (await call('GET', '/v1/payouts?status=pending', 'clerk')).body.items;
  assert.equal(pending.length, waiting.length);

  assert.equal((await call('POST', '/v1/payout-files', 'reader', { market: 'SE', currency: 'SEK' })).status, 403);
  const made = await call('POST', '/v1/payout-files', 'clerk', { market: 'SE', currency: 'SEK', executionDate: '2026-11-16' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.ok(validatorFor('PayoutFile')(structuredClone(made.body)), JSON.stringify(validatorFor('PayoutFile').errors));
  assert.deepEqual([made.body.payoutIds.length, made.body.erased, 'content' in made.body], [pending.length, false, false]);
  assert.equal((await call('POST', '/v1/payout-files', 'clerk', { market: 'SE', currency: 'SEK' })).status, 409, 'each payout in one file');

  const file = await call('GET', `/v1/payout-files/${made.body.id}/file`, 'clerk');
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('x-content-sha256'), made.body.sha256);
  assert.match(file.body, /<CstmrCdtTrfInitn>/);
  assert.match(file.body, /<ReqdExctnDt>2026-11-16<\/ReqdExctnDt>/);
  assert.equal((await call('GET', `/v1/payout-files/${made.body.id}/file`, 'reader')).status, 403, 'names and accounts: payments:export');
  assert.deepEqual((await call('GET', '/v1/payout-files', 'reader')).body.items.map((f: any) => f.id), [made.body.id]);

  // The bank's camt.054 with a debit per payout.
  const txs = pending.map((p: any, i: number) => `<TxDtls><Refs><AcctSvcrRef>D-${i}</AcctSvcrRef><EndToEndId>${p.id.slice(4)}</EndToEndId></Refs><Amt Ccy="SEK">${(p.amount / 100).toFixed(2)}</Amt></TxDtls>`).join('');
  const camt = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><Ntfctn><Id>N</Id><Acct><Id><Othr><Id>5050-1055</Id></Othr></Id></Acct><Ntry><Amt Ccy="SEK">1.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-11-16</Dt></BookgDt><AcctSvcrRef>D</AcctSvcrRef><NtryDtls>${txs}</NtryDtls></Ntry></Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;
  const form = new FormData();
  form.append('file', new File([camt], 'camt.xml', { type: 'application/xml' }));
  const read = await app.request('/v1/payment-files', { method: 'POST', headers: { authorization: 'Bearer clerk', 'idempotency-key': 'key-pof-camt-0001' }, body: form });
  assert.equal(read.status, 201);
  assert.deepEqual((await call('GET', '/v1/payouts?status=paid', 'clerk')).body.items.map((p: any) => p.id).sort(), pending.map((p: any) => p.id).sort());
});
