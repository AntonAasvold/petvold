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
  assert.equal(parseCamt054(xml, accounts)[0]?.reference, null, 'no reference, rather than an expanded one');
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
