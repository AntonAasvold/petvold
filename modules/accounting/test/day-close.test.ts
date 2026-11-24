/** The day close and the chart of accounts (ADR 0040, punkt 9). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountingError, AccountingService, InMemoryAccountingStore, dayCsv, decimal, type MoneyEvent } from '../src/index.ts';

function setup() {
  let n = 0;
  let now = '2026-12-01T10:00:00.000Z';
  const store = new InMemoryAccountingStore();
  const service = new AccountingService({ store, sources: { invoice: async () => null, creditNote: async () => null }, clock: { now: () => now }, ids: { next: (p) => `${p}_${++n}` } });
  return { service, store, at: (t: string) => (now = t) };
}
const paid = (id: string, bookedOn: string, amount = 41_200, reference = '202600000121'): MoneyEvent => ({
  id,
  type: 'payment.succeeded',
  paymentId: `pay_${id}`,
  market: 'SE',
  occurredAt: `${bookedOn}T09:00:00.000Z`,
  data: { direction: 'incoming', amount, currency: 'SEK', reference, bookedOn },
});

test('each day up to yesterday is closed once, in order, with totals and accounting.day_closed', async () => {
  const s = setup();
  await s.service.handleEvent(paid('e1', '2026-12-01'));
  await s.service.handleEvent(paid('e2', '2026-12-03', 10_000));
  assert.deepEqual((await s.service.closeDays({ market: 'SE', onDate: '2026-12-04', dryRun: true }, 'scheduler')).days, ['2026-12-01', '2026-12-02', '2026-12-03']);
  assert.deepEqual(await s.service.dayCloses(), [], 'a dry run closes nothing');
  const r = await s.service.closeDays({ market: 'SE', onDate: '2026-12-04', dryRun: false }, 'scheduler');
  assert.deepEqual(r.closes.map((c) => [c.day, c.verificationCount, c.totals]), [
    ['2026-12-01', 1, [{ currency: 'SEK', debit: 41_200, credit: 41_200 }]],
    ['2026-12-02', 0, []],
    ['2026-12-03', 1, [{ currency: 'SEK', debit: 10_000, credit: 10_000 }]],
  ]);
  assert.deepEqual(r.closes[0]?.unmapped, ['bank', 'unmatched-payments'], 'no chart yet');
  assert.deepEqual((await s.service.closeDays({ market: 'SE', onDate: '2026-12-04', dryRun: false }, 'scheduler')).days, [], 'once');
  const events = await s.store.pendingEvents(10);
  assert.deepEqual(events.map((e) => [e.type, e.day]), [['accounting.day_closed', '2026-12-01'], ['accounting.day_closed', '2026-12-02'], ['accounting.day_closed', '2026-12-03']]);
  // Nothing booked in the market yet: nothing to close.
  assert.deepEqual((await s.service.closeDays({ market: 'FI', onDate: '2026-12-04', dryRun: false }, 'scheduler')).days, []);
});

test('a payment for a closed day is booked on the first open day, its own day kept', async () => {
  const s = setup();
  await s.service.handleEvent(paid('e1', '2026-12-01'));
  await s.service.closeDays({ market: 'SE', onDate: '2026-12-02', dryRun: false }, 'scheduler');
  const late = await s.service.handleEvent(paid('e2', '2026-12-01', 5_000));
  assert.deepEqual([late?.bookingDate, late?.eventDate], ['2026-12-02', '2026-12-01']);
  assert.equal((await s.service.dayFile('SE', '2026-12-01')).close.verificationCount, 1, 'the closed day is unchanged');
});

test('the file uses the chart in force at the close, is made again the same, and is checked', async () => {
  const s = setup();
  await s.service.handleEvent(paid('e1', '2026-12-01', 41_250, 'OCR, "with" comma'));
  const chart = await s.service.changeChart({ basedOnVersion: 0, markets: { SE: { bank: { number: '1930', name: 'Bank' }, 'unmatched-payments': { number: '2990' } } }, reason: 'Our accounts' }, 'redovisning@example.test');
  assert.equal(chart.version, 1);
  await s.service.closeDays({ market: 'SE', onDate: '2026-12-02', dryRun: false }, 'scheduler');
  // A later chart does not change the closed day's file.
  await s.service.changeChart({ basedOnVersion: 1, markets: { SE: { bank: { number: '1940' } } }, reason: 'New bank' }, 'redovisning@example.test');
  const { close, csv } = await s.service.dayFile('SE', '2026-12-01');
  assert.deepEqual([close.chartVersion, close.unmapped], [1, []]);
  const rows = csv.trimEnd().split('\r\n');
  assert.equal(rows.length, 3);
  assert.ok(rows[0]!.startsWith('verification,booking_date,event_date,account,account_name,petvold_account,debit,credit,currency,text'));
  assert.ok(rows[1]!.startsWith('V-SE-2026-000001,2026-12-01,2026-12-01,1930,Bank,bank,412.50,,SEK,"Payment received, reference OCR, ""with"" comma"'), rows[1]);
  assert.ok(rows[2]!.includes(',2990,,unmatched-payments,,412.50,SEK,'), rows[2]);
  await assert.rejects(s.service.dayFile('SE', '2026-12-05'), (e) => e instanceof AccountingError && e.code === 'not_found');
});

test('the chart is checked, and changed only from the version in force', async () => {
  const s = setup();
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AccountingError ? e.code : String(e)));
  assert.equal((await s.service.chart()).version, 0);
  assert.equal(await code(s.service.changeChart({ basedOnVersion: 0, markets: { SE: { cash: { number: '1910' } } as never }, reason: 'x' }, 'a')), 'validation');
  assert.equal(await code(s.service.changeChart({ basedOnVersion: 0, markets: { SE: { bank: { number: 'no spaces' } } }, reason: 'x' }, 'a')), 'validation');
  assert.equal(await code(s.service.changeChart({ basedOnVersion: 0, markets: { se: {} }, reason: 'x' }, 'a')), 'validation');
  await s.service.changeChart({ basedOnVersion: 0, markets: { SE: { bank: { number: '1930' } } }, reason: 'x' }, 'a');
  assert.equal(await code(s.service.changeChart({ basedOnVersion: 0, markets: {}, reason: 'x' }, 'a')), 'conflict');
  assert.deepEqual((await s.service.chartVersions()).map((c) => c.version), [1]);
});

test('decimals and the file are pure', () => {
  assert.deepEqual([decimal(0), decimal(5), decimal(41_200), decimal(-150)], ['0.00', '0.05', '412.00', '-1.50']);
  assert.equal(dayCsv([], {}), 'verification,booking_date,event_date,account,account_name,petvold_account,debit,credit,currency,text,payer_account,policy,claim,period_from,period_to,object_type,object_id,event_id\r\n');
});
