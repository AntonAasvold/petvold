import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryPolicyStore, PolicyError, PolicyService, addMonths, type IssueInput, type ProductOffer } from '../src/index.ts';

const vetCare = { code: 'vet_care' as const, annualLimit: 6_000_000, deductible: { fixed: 200_000, fixedPer: 'period' as const, periodDays: 125, variableBp: 2500 }, waitingPeriodDays: 30 };
const offer = (o: Partial<ProductOffer> = {}): ProductOffer => ({
  market: 'SE',
  currency: 'SEK',
  species: ['dog'],
  onSale: true,
  vetCareTermsFor: (c) => {
    if (c.annualLimit !== undefined && c.annualLimit !== 6_000_000) throw new Error(`No annual limit ${c.annualLimit}`);
    return { ...vetCare, deductibleOption: c.deductible ?? 'standard' };
  },
  ...o,
});

function setup(offers: Record<string, ProductOffer | null> = { 'SE-HUND@1': offer() }) {
  let n = 0;
  return new PolicyService({
    store: new InMemoryPolicyStore(),
    products: { offer: async (pv) => offers[pv] ?? null },
    animals: {
      get: async (id) =>
        ({
          ani_rex: { market: 'SE', species: 'dog', birthDate: '2024-03-01' },
          ani_cat: { market: 'SE', species: 'cat', birthDate: '2024-03-01' },
          ani_dead: { market: 'SE', species: 'dog', birthDate: '2015-03-01', deceasedOn: '2026-10-01' },
        })[id] ?? null,
    },
    parties: { marketOf: async (id) => ({ pty_anna: 'SE', pty_dag: 'DE' })[id] ?? null },
    clock: { now: () => '2026-11-15T10:00:00.000Z' },
    ids: { next: (p) => `${p}_${++n}` },
  });
}
const by = 'seller@example.test';
const input = (o: Partial<IssueInput> = {}): IssueInput => ({
  market: 'SE',
  animalId: 'ani_rex',
  policyholderPartyId: 'pty_anna',
  productVersion: 'SE-HUND@1',
  startDate: '2026-12-01',
  premium: { amount: 480_000, currency: 'SEK' },
  ...o,
});
const rejects = (p: Promise<unknown>, code: string, msg?: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof PolicyError && e.code === code && (!msg || msg.test(e.message)));

test('months are added to the same day, or the last day of a shorter month', () => {
  assert.equal(addMonths('2026-12-01', 12), '2027-12-01');
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2028-02-29', 12), '2029-02-28');
});

test('a policy is issued with one term of a year, and the claims engine sees it', async () => {
  const s = setup();
  const p = await s.issue(input({ vetCare: { deductible: 'high' } }), by);
  assert.deepEqual([p.id, p.inceptionDate, p.terms.length, p.versions.length], ['pol_1', '2026-12-01', 1, 1]);
  const [t] = p.terms;
  assert.deepEqual([t!.startDate, t!.endDate, t!.productVersion, t!.premium, t!.deductibleOption], ['2026-12-01', '2027-12-01', 'SE-HUND@1', 480_000, 'high']);
  assert.deepEqual([p.versions[0]!.policyholderPartyId, p.versions[0]!.status], ['pty_anna', 'active']);
  const h = await s.history(p.id);
  assert.deepEqual(h.transactions[0]!.steps.map((x) => x.step), ['draft', 'priced', 'underwritten', 'issued']);

  const snap = await s.getPolicyAt(p.id, '2027-03-01');
  assert.deepEqual(
    [snap?.policyVersionId, snap?.currency, snap?.animalBirthDate, snap?.policyYearStart, snap?.policyYearEnd, snap?.inceptionDate, snap?.vetCare?.annualLimit],
    [p.versions[0]!.id, 'SEK', '2024-03-01', '2026-12-01', '2027-12-01', '2026-12-01', 6_000_000],
  );
  assert.equal(await s.getPolicyAt(p.id, '2026-11-30'), null);
  assert.equal(await s.getPolicyAt('pol_none', '2027-03-01'), null);
  assert.deepEqual((await s.findByAnimal('ani_rex')).map((x) => x.id), [p.id]);
  assert.deepEqual((await s.findByPolicyholder('pty_anna')).map((x) => x.id), [p.id]);
});

test('a policy never starts before the day it is issued, and an animal is insured once at a time', async () => {
  const s = setup();
  await rejects(s.issue(input({ startDate: '2026-11-14' }), by), 'validation', /before the day it is issued/);
  await s.issue(input({ startDate: '2026-11-15' }), by);
  await rejects(s.issue(input({ startDate: '2027-01-01' }), by), 'conflict', /already has a policy/);
});

test('invalid applications are refused', async () => {
  const s = setup({ 'SE-HUND@1': offer(), 'SE-OLD@1': offer({ onSale: false }), 'DE-HUND@1': offer({ market: 'DE', currency: 'EUR' }) });
  await rejects(s.issue(input({ market: 'NO' }), by), 'validation', /market profile/);
  await rejects(s.issue(input({ startDate: '2026-13-01' }), by), 'validation', /YYYY-MM-DD/);
  await rejects(s.issue(input({ animalId: 'ani_none' }), by), 'validation', /animal/);
  await rejects(s.issue(input({ animalId: 'ani_dead' }), by), 'validation', /died/);
  await rejects(s.issue(input({ animalId: 'ani_cat' }), by), 'validation', /does not cover cat/);
  await rejects(s.issue(input({ policyholderPartyId: 'pty_dag' }), by), 'validation', /party/);
  await rejects(s.issue(input({ productVersion: 'SE-NONE@1' }), by), 'validation', /does not exist/);
  await rejects(s.issue(input({ productVersion: 'SE-OLD@1' }), by), 'validation', /not on sale/);
  await rejects(s.issue(input({ productVersion: 'DE-HUND@1' }), by), 'validation', /not sold in market SE/);
  await rejects(s.issue(input({ vetCare: { annualLimit: 1 } }), by), 'validation', /annual limit/);
  await rejects(s.issue(input({ premium: { amount: 480_000, currency: 'EUR' } }), by), 'validation', /SEK/);
  await rejects(s.issue(input({ premium: { amount: 4800.5, currency: 'SEK' } }), by), 'validation', /whole number/);
  await rejects(s.get('pol_none'), 'not_found');
});

test('as an ActivitySource: ongoing while a version has not ended', async () => {
  const s = setup();
  await s.issue(input(), by);
  assert.deepEqual(await s.activityOf('pty_anna'), { ongoing: true });
  assert.equal(await s.activityOf('pty_bo'), null);
});
