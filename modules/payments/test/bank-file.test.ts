/** The bank file adapter: camt.054 from the bank into payments (ADR 0017, ADR 0040 punkt 12). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BankFileProvider, bankFileFromEnv, fileChecksum, minorUnits, parseCamt054 } from '../src/bank-file.ts';
import { ProviderNotificationError } from '../src/index.ts';

const file = (name: string) => readFileSync(new URL(`./files/${name}`, import.meta.url), 'utf8');
const accounts = [
  { id: '50501055', market: 'SE', currency: 'SEK' },
  { id: 'FI2112345600000785', market: 'FI', currency: 'EUR' },
];
const invalid = (re: RegExp) => (e: unknown) => e instanceof ProviderNotificationError && e.code === 'invalid' && re.test(e.message);

test('booked credits become payments, one per transaction, with the OCR as reference; debits and pending entries are left out', () => {
  assert.deepEqual(parseCamt054(file('camt054-se.xml'), accounts), [
    { kind: 'payment.received', providerRef: 'T-0001', market: 'SE', currency: 'SEK', amount: 41_200, reference: '202600000121', bookedOn: '2026-12-01' },
    { kind: 'payment.received', providerRef: 'T-0002', market: 'SE', currency: 'SEK', amount: 80_000, reference: null, bookedOn: '2026-12-01' },
    { kind: 'payment.received', providerRef: 'E-0002', market: 'SE', currency: 'SEK', amount: 5_050, reference: null, bookedOn: '2026-12-01' },
  ]);
});

test('camt.054.001.08: the status as a code, the booking date as a time, an IBAN with spaces and an RF reference', () => {
  assert.deepEqual(parseCamt054(file('camt054-fi-v08.xml'), accounts), [
    { kind: 'payment.received', providerRef: 'FI-T-1', market: 'FI', currency: 'EUR', amount: 4_120, reference: 'RF18539007547034', bookedOn: '2026-12-01' },
  ]);
});

test('a file that is not the insurer\'s, not camt.054 or not readable is refused whole', () => {
  assert.throws(() => parseCamt054(file('camt054-se.xml'), [{ id: '1234-5678', market: 'SE', currency: 'SEK' }]), invalid(/not one of the insurer's/));
  assert.throws(() => parseCamt054('<Document><Other/></Document>', accounts), invalid(/not a camt.054/));
  assert.throws(() => parseCamt054('<Document><BkToCstmrDbtCdtNtfctn>', accounts), invalid(/not a camt.054|well-formed/));
  assert.throws(() => parseCamt054(file('camt054-se.xml').replace('412.00', '412.005'), accounts), invalid(/cannot be read/));
  assert.throws(() => parseCamt054(file('camt054-se.xml').replace('<Amt Ccy="SEK">800.00', '<Amt Ccy="EUR">800.00'), accounts), invalid(/in EUR, the account in SEK/));
});

test('entities from a DOCTYPE are not expanded', () => {
  const xml = file('camt054-se.xml').replace('<?xml version="1.0" encoding="UTF-8"?>', '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x "999">]>').replace('<Ref>202600000121</Ref>', '<Ref>&x;</Ref>');
  assert.equal((parseCamt054(xml, accounts)[0] as { reference: string | null }).reference, null, 'no reference, rather than an expanded one');
});

test('amounts, checksums, capabilities and the environment', async () => {
  assert.equal(minorUnits('412.00', 'SEK'), 41_200);
  assert.equal(minorUnits('412', 'SEK'), 41_200);
  assert.equal(minorUnits('412.5', 'EUR'), 41_250);
  assert.equal(minorUnits('1500', 'JPY'), 1_500);
  assert.equal(minorUnits('1500.5', 'JPY'), null);
  assert.equal(minorUnits('-1.00', 'SEK'), null);
  assert.equal(fileChecksum('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const p = new BankFileProvider({ accounts });
  assert.deepEqual(p.capabilities().map((c) => [c.market, c.currency, c.kind]), [['SE', 'SEK', 'incoming'], ['FI', 'EUR', 'incoming']]);
  assert.equal(p.uploadOnly, true);
  assert.equal((await p.parseNotification({ headers: {}, body: file('camt054-se.xml') }, '2026-12-01T10:00:00.000Z')).length, 3);
  assert.deepEqual(bankFileFromEnv({ PETVOLD_BANK_FILE_ACCOUNTS: 'SE:SEK:5050-1055, FI:EUR:FI2112345600000785' })?.accounts, [
    { market: 'SE', currency: 'SEK', id: '5050-1055' },
    { market: 'FI', currency: 'EUR', id: 'FI2112345600000785' },
  ]);
  assert.equal(bankFileFromEnv({}), null);
  assert.throws(() => bankFileFromEnv({ PETVOLD_BANK_FILE_ACCOUNTS: 'SE-SEK' }), /market:currency:account/);
});

test('a bank file is imported by a signed-in person, kept with its checksum, and never through the open route', async () => {
  const { InMemoryPaymentsStore, PaymentsService, PaymentsError } = await import('../src/index.ts');
  let n = 0;
  const service = new PaymentsService({ store: new InMemoryPaymentsStore(), providers: [new BankFileProvider({ accounts })], clock: { now: () => '2026-12-01T10:00:00.000Z' }, ids: { next: (p) => `${p}_${++n}` } });
  const body = file('camt054-se.xml');
  const first = await service.importFile('bank-file', body, 'ekonomi@example.test');
  assert.deepEqual([first.received, first.duplicates, first.sha256, first.importedBy, first.paymentIds.length], [3, 0, fileChecksum(body), 'ekonomi@example.test', 3]);
  const again = await service.importFile('bank-file', body, 'ekonomi@example.test');
  assert.deepEqual([again.received, again.duplicates, again.paymentIds], [0, 3, []], 'the same file again adds nothing');
  assert.deepEqual((await service.paymentFiles()).map((f) => f.id), [again.id, first.id]);
  assert.equal((await service.payments({})).length, 3);
  const code = (x: Promise<unknown>) => x.then(() => 'ok', (e) => (e instanceof PaymentsError ? e.code : String(e)));
  assert.equal(await code(service.receive('bank-file', { headers: {}, body })), 'unknown_provider', 'no signature: not through the open route');
  await assert.rejects(service.importFile('bank-file', body.replace('5050-1055', '9999-9999'), 'ekonomi@example.test'), invalid(/not one of the insurer's/));
  assert.equal((await service.paymentFiles()).length, 2, 'a refused file is not kept');
});

const debitsFor = (paid: string, returned: string) => `<?xml version="1.0"?>
<!-- Made up for the tests: the bank's debit of one payout and the return of another. -->
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><GrpHdr><MsgId>M2</MsgId><CreDtTm>2026-12-02T06:00:00</CreDtTm></GrpHdr>
<Ntfctn><Id>N2</Id><Acct><Id><Othr><Id>5050-1055</Id></Othr></Id></Acct>
<Ntry><Amt Ccy="SEK">3200.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-12-02</Dt></BookgDt><AcctSvcrRef>D-1</AcctSvcrRef>
<NtryDtls><TxDtls><Refs><AcctSvcrRef>D-1-1</AcctSvcrRef><EndToEndId>${paid}</EndToEndId></Refs><Amt Ccy="SEK">3200.00</Amt></TxDtls>
<TxDtls><Refs><AcctSvcrRef>D-1-2</AcctSvcrRef><EndToEndId>someone-else</EndToEndId></Refs><Amt Ccy="SEK">99.00</Amt></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="SEK">500.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-12-03</Dt></BookgDt><AcctSvcrRef>R-1</AcctSvcrRef>
<NtryDtls><TxDtls><Refs><AcctSvcrRef>R-1-1</AcctSvcrRef><EndToEndId>${returned}</EndToEndId></Refs><Amt Ccy="SEK">500.00</Amt>
<RtrInf><Rsn><Cd>AC01</Cd></Rsn></RtrInf></TxDtls></NtryDtls></Ntry>
</Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`;

test("the bank's debit confirms a payout paid, a return fails it, and other debits are not Petvold's", () => {
  // A real payout id without its prefix: 32 characters.
  assert.equal((parseCamt054(debitsFor('05c7eeaeb843412a98fd15d77fde81ac', 'x1'), accounts)[0] as { payoutId: string }).payoutId, 'pyo_05c7eeaeb843412a98fd15d77fde81ac');
  assert.deepEqual(parseCamt054(debitsFor('abc123', 'def456'), accounts), [
    { kind: 'payout.confirmed', payoutId: 'pyo_abc123', outcome: 'paid', providerRef: 'D-1-1', bookedOn: '2026-12-02' },
    { kind: 'payout.confirmed', payoutId: 'pyo_def456', outcome: 'failed', providerRef: 'R-1-1', reason: 'Returned by the bank: AC01', bookedOn: '2026-12-03' },
  ]);
});

test('pain.001: one transfer per payout, the EndToEndId without its prefix, a Swedish account as BBAN with its clearing, an IBAN with its BIC', async () => {
  const { buildPain001, decimalAmount } = await import('../src/bank-file.ts');
  const { XMLParser } = await import('fast-xml-parser');
  const xml = buildPain001({
    msgId: 'abc',
    createdAt: '2026-12-01T10:00:00.000Z',
    debtorName: 'Example & Sons Insurance AB',
    debtorAccount: accounts[0]!,
    executionDate: '2026-12-01',
    transfers: [
      { payoutId: 'pyo_1a', amount: 320_000, currency: 'SEK', creditor: { name: 'Erik Example', account: { method: 'se-bank', clearing: '8327', account: '9412345678' } }, message: 'clm_1' },
      { payoutId: 'pyo_2b', amount: 50_050, currency: 'SEK', creditor: { name: 'Djurkliniken <AB>', account: { method: 'iban', iban: 'SE45 5000 0000 0583 9825 7466', bic: 'ESSESESS' } }, message: 'ref_9' },
    ],
  });
  assert.equal(xml, buildPain001({ msgId: 'abc', createdAt: '2026-12-01T10:00:00.000Z', debtorName: 'Example & Sons Insurance AB', debtorAccount: accounts[0]!, executionDate: '2026-12-01', transfers: [
    { payoutId: 'pyo_1a', amount: 320_000, currency: 'SEK', creditor: { name: 'Erik Example', account: { method: 'se-bank', clearing: '8327', account: '9412345678' } }, message: 'clm_1' },
    { payoutId: 'pyo_2b', amount: 50_050, currency: 'SEK', creditor: { name: 'Djurkliniken <AB>', account: { method: 'iban', iban: 'SE45 5000 0000 0583 9825 7466', bic: 'ESSESESS' } }, message: 'ref_9' },
  ] }), 'the same input, the same file');
  const doc = new XMLParser({ removeNSPrefix: true, parseTagValue: false, ignoreAttributes: false, attributeNamePrefix: '@', isArray: (n) => n === 'CdtTrfTxInf' }).parse(xml) as any;
  const root = doc.Document.CstmrCdtTrfInitn;
  assert.deepEqual([root.GrpHdr.NbOfTxs, root.GrpHdr.CtrlSum, root.GrpHdr.InitgPty.Nm], ['2', '3700.50', 'Example & Sons Insurance AB'], 'escaped and read back');
  assert.equal(root.PmtInf.DbtrAcct.Id.Othr.Id, '50501055');
  assert.equal(root.PmtInf.DbtrAcct.Id.Othr.SchmeNm.Prtry, 'BGNR');
  const [a, b] = root.PmtInf.CdtTrfTxInf;
  assert.deepEqual([a.PmtId.EndToEndId, a.Amt.InstdAmt['#text'], a.Amt.InstdAmt['@Ccy']], ['1a', '3200.00', 'SEK']);
  assert.deepEqual([a.CdtrAcct.Id.Othr.Id, a.CdtrAcct.Id.Othr.SchmeNm.Cd, a.CdtrAgt.FinInstnId.ClrSysMmbId.ClrSysId.Cd, a.CdtrAgt.FinInstnId.ClrSysMmbId.MmbId], ['83279412345678', 'BBAN', 'SESBA', '8327']);
  assert.deepEqual([b.PmtId.EndToEndId, b.CdtrAcct.Id.IBAN, b.CdtrAgt.FinInstnId.BIC, b.Cdtr.Nm, b.RmtInf.Ustrd], ['2b', 'SE4550000000058398257466', 'ESSESESS', 'Djurkliniken <AB>', 'ref_9']);
  assert.equal(decimalAmount(5, 'SEK'), '0.05');
  assert.equal(decimalAmount(1500, 'JPY'), '1500');
});

test('a payout by bank file waits for the file and the bank: pain.001 once, then paid or returned by camt.054; an erased payee empties the file', async () => {
  const { InMemoryPaymentsStore, PaymentsService, PaymentsError } = await import('../src/index.ts');
  let n = 0;
  const store = new InMemoryPaymentsStore();
  const service = new PaymentsService({
    store,
    providers: [new BankFileProvider({ accounts, debtorName: 'Example Insurance AB' })],
    clock: { now: () => '2026-12-01T10:00:00.000Z' },
    ids: { next: (p) => `${p}_${String(++n).padStart(3, '0')}` },
    policies: { policyholderOn: async () => 'pty_erik' },
    payeeNames: { nameOf: async (p) => (p.partyId === 'pty_erik' ? 'Erik Example' : null) },
  });
  const code = (x: Promise<unknown>) => x.then(() => 'ok', (e) => (e instanceof PaymentsError ? e.code : String(e)));
  await service.addPayeeAccount({ partyId: 'pty_erik' }, { market: 'SE', method: 'se-bank', details: { clearing: '8327', account: '9412345678' } }, 'kundservice@example.test');
  const order = (id: string, amount: number) => ({ id: `cev_${id}`, type: 'claim.payout_ordered', claimId: `clm_${id}`, market: 'SE', occurredAt: '2026-12-01T09:00:00.000Z', data: { payoutOrderId: id, decisionId: 'dec_1', policyId: 'pol_1', amount, currency: 'SEK', channel: 'customer' } });
  const one = (await service.handleClaimEvent(order('o1', 320_000)))!;
  const two = (await service.handleClaimEvent(order('o2', 50_000)))!;
  assert.deepEqual([one.status, two.status], ['pending', 'pending'], 'sent to the bank file, not yet paid');

  const file = await service.makePayoutFile({ provider: 'bank-file', market: 'SE', currency: 'SEK' }, 'ekonomi@example.test');
  assert.deepEqual([file.payoutIds, file.total, file.executionDate, file.createdBy], [[one.id, two.id], 370_000, '2026-12-01', 'ekonomi@example.test']);
  assert.match(file.content!, new RegExp(`<EndToEndId>${one.id.slice(4)}</EndToEndId>`));
  assert.equal(await code(service.makePayoutFile({ provider: 'bank-file', market: 'SE', currency: 'SEK' }, 'ekonomi@example.test')), 'conflict', 'each payout in one file');

  const r = await service.importFile('bank-file', debitsFor(one.id.slice(4), two.id.slice(4)), 'ekonomi@example.test');
  assert.deepEqual([r.received, r.duplicates], [0, 0], 'debits and returns are not payments in');
  assert.equal((await service.payout(one.id)).status, 'paid');
  const failed = await service.payout(two.id);
  assert.deepEqual([failed.status, failed.steps.at(-1)?.note], ['failed', 'Returned by the bank: AC01']);
  const events = (await store.pendingEvents(50)).map((e) => [e.type, e.payoutId]).filter(([t]) => t !== 'payment.succeeded');
  assert.deepEqual(events, [['payout.paid', one.id], ['payout.failed', two.id]]);
  await service.importFile('bank-file', debitsFor(one.id.slice(4), two.id.slice(4)), 'ekonomi@example.test');
  assert.equal((await store.pendingEvents(50)).length, 2, 'the same confirmations again change nothing');

  await service.erasePayee('pty_erik');
  assert.equal((await service.payoutFile(file.id)).content, null, 'the file held the name and account');
  assert.equal((await service.payoutFile(file.id)).sha256, file.sha256, 'its checksum stays');
});
