import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreementBody, agreementProblems, detailsLine, endingProblems, ibanOk, inForce, payeeBody, payeeProblems, type PayeeForm } from '../src/payee-logic.ts';

const form = (f: Partial<PayeeForm>): PayeeForm => ({ market: 'SE', method: 'se-bank', clearing: '', account: '', iban: '', bic: '', ...f });

test('an IBAN is checked by ISO 13616', () => {
  // The examples from the standard's registry.
  assert.equal(ibanOk('SE45 5000 0000 0583 9825 7466'), true);
  assert.equal(ibanOk('FI2112345600000785'), true);
  assert.equal(ibanOk('SE45 5000 0000 0583 9825 7467'), false, 'one digit wrong');
  assert.equal(ibanOk('SE45'), false);
});

test('Swedish details are a clearing and an account number', () => {
  assert.deepEqual(payeeProblems(form({ clearing: '8327-9', account: '123 456 789' })), []);
  assert.deepEqual(payeeBody(form({ clearing: '8327-9', account: '123 456 789' })), { market: 'SE', method: 'se-bank', details: { clearing: '83279', account: '123456789' } });
  assert.deepEqual(payeeProblems(form({ clearing: '83', account: '12' })), ['clearing', 'account']);
  assert.deepEqual(payeeProblems(form({ market: 'se', clearing: '8327', account: '1234567' })), ['market']);
});

test('IBAN details, with an optional BIC', () => {
  assert.deepEqual(payeeProblems(form({ market: 'FI', method: 'iban', iban: 'fi21 1234 5600 0007 85' })), []);
  assert.deepEqual(payeeBody(form({ market: 'FI', method: 'iban', iban: 'fi21 1234 5600 0007 85', bic: 'nordfihh' })).details, { iban: 'FI2112345600000785', bic: 'NORDFIHH' });
  assert.deepEqual(payeeProblems(form({ method: 'iban', iban: 'FI2112345600000785', bic: 'X1' })), ['bic']);
  assert.deepEqual(payeeProblems(form({ method: 'iban', iban: 'FI2112345600000786' })), ['iban']);
  assert.equal(detailsLine({ method: 'iban', details: { iban: 'FI21 **** 0785', bic: 'NORDFIHH' } }), 'FI21 **** 0785 · NORDFIHH');
  assert.equal(detailsLine({ method: 'se-bank', details: { clearing: '8327', account: '*****6789' } }), '8327 *****6789');
});

test('an agreement on direct settlement, and when it is in force', () => {
  const ok = { clinicId: 'clinic-djursjukhuset', market: 'SE', validFrom: '2026-12-01', validTo: '' };
  assert.deepEqual(agreementProblems(ok), []);
  assert.deepEqual(agreementBody(ok), { clinicId: 'clinic-djursjukhuset', market: 'SE', validFrom: '2026-12-01' });
  assert.deepEqual(agreementProblems({ ...ok, clinicId: ' ', validTo: '2026-12-01' }), ['clinic', 'to']);
  const a = { validFrom: '2026-12-01' };
  assert.equal(inForce(a, '2026-11-30'), false);
  assert.equal(inForce(a, '2026-12-01'), true);
  assert.equal(inForce({ ...a, ended: { validTo: '2027-01-01' } }, '2027-01-01'), false, 'validTo is exclusive');
  assert.equal(inForce({ ...a, validTo: '2027-06-01' }, '2027-05-31'), true);
  assert.deepEqual(endingProblems(a, '2026-12-01', ''), ['to', 'reason']);
  assert.deepEqual(endingProblems(a, '2027-01-01', 'The clinic closed'), []);
});
