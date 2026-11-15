import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALCULATION_MODELS, ClaimsService } from '@petvold/claims-core';
import { FixedClock, InMemoryClaimsStore, InMemoryPolicyPort, SequentialIds, fixtures } from '@petvold/claims-store-memory';
import { PRICE_TERMS, TARIFF } from '@petvold/pricing-core/fixtures';
import { UNDERWRITING } from '@petvold/underwriting-core/fixtures';
import {
  DecisioningRulesPort,
  DecisioningService,
  InMemoryRuleSetStore,
  RuleSetError,
  ruleSetChecksum,
  type DraftInput,
} from '../src/index.ts';

const AUTHOR = 'author@example.test';
const PUBLISHER = 'publisher@example.test';

function setup() {
  const clock = new FixedClock('2026-11-14T10:00:00.000Z');
  const service = new DecisioningService({ store: new InMemoryRuleSetStore(), clock, calculationModels: Object.keys(CALCULATION_MODELS) });
  return { service, clock };
}

const { rulesVersion: _v, ...SE_CONTENT } = fixtures.RULES_SE_DOG;
const input = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  content: SE_CONTENT,
  calculationModel: 'vet-care.v1',
  effectiveFrom: '2026-01-01',
  ...overrides,
});
const code = (c: RuleSetError['code']) => (e: unknown) => e instanceof RuleSetError && e.code === c;

async function publish(service: DecisioningService, i: DraftInput) {
  const d = await service.createDraft('SE-HUND-VV', i, AUTHOR);
  await service.submit('SE-HUND-VV', d.version, AUTHOR);
  return service.publish('SE-HUND-VV', d.version, PUBLISHER);
}

test('the lifecycle: a draft is changed, submitted with a checksum and published by someone else', async () => {
  const { service } = setup();
  const d = await service.createDraft('SE-HUND-VV', input(), AUTHOR);
  assert.deepEqual([d.version, d.status], [1, 'draft']);
  const changed = await service.updateDraft('SE-HUND-VV', 1, input({ content: { ...SE_CONTENT, autoSettleMax: 500_000 } }));
  assert.equal(changed.content.autoSettleMax, 500_000);
  const r = await service.submit('SE-HUND-VV', 1, AUTHOR);
  assert.equal(r.status, 'in_review');
  assert.equal(r.checksum, ruleSetChecksum(changed));
  await assert.rejects(service.updateDraft('SE-HUND-VV', 1, input()), code('conflict'), 'locked for review');
  await assert.rejects(service.publish('SE-HUND-VV', 1, AUTHOR), code('forbidden'), 'four eyes');
  const p = await service.publish('SE-HUND-VV', 1, PUBLISHER);
  assert.deepEqual([p.status, p.publishedBy], ['published', PUBLISHER]);
  await assert.rejects(service.updateDraft('SE-HUND-VV', 1, input()), code('conflict'));
});

test('a version in review can be returned to draft with a reason, and loses its checksum', async () => {
  const { service } = setup();
  await service.createDraft('SE-HUND-VV', input(), AUTHOR);
  await service.submit('SE-HUND-VV', 1, AUTHOR);
  await assert.rejects(service.returnToDraft('SE-HUND-VV', 1, ' '), code('validation'));
  const back = await service.returnToDraft('SE-HUND-VV', 1, 'Add the new codes');
  assert.deepEqual([back.status, back.checksum, back.note], ['draft', undefined, 'Add the new codes']);
});

test('the rules in force: the latest published effectiveFrom not after the date; retired versions are not used', async () => {
  const { service } = setup();
  await publish(service, input());
  await publish(service, input({ effectiveFrom: '2026-07-01', content: { ...SE_CONTENT, autoSettleMax: 300_000 } }));
  await service.createDraft('SE-HUND-VV', input({ effectiveFrom: '2026-09-01' }), AUTHOR); // a draft is never used
  assert.equal((await service.rulesInForce('SE-HUND-VV', '2025-12-31')), null);
  const jan = await service.rulesInForce('SE-HUND-VV', '2026-06-30');
  assert.deepEqual([jan?.rulesVersion, jan?.autoSettleMax], ['SE-HUND-VV@1', 1_000_000]);
  const jul = await service.rulesInForce('SE-HUND-VV', '2026-10-01');
  assert.deepEqual([jul?.rulesVersion, jul?.autoSettleMax], ['SE-HUND-VV@2', 300_000]);
  assert.ok(jul?.rulesChecksum);
  await service.retire('SE-HUND-VV', 2, PUBLISHER, 'Limit too low');
  assert.equal((await service.rulesInForce('SE-HUND-VV', '2026-10-01'))?.rulesVersion, 'SE-HUND-VV@1');
});

test('two published versions cannot apply from the same date', async () => {
  const { service } = setup();
  await publish(service, input());
  await service.createDraft('SE-HUND-VV', input(), AUTHOR);
  await service.submit('SE-HUND-VV', 2, AUTHOR);
  await assert.rejects(service.publish('SE-HUND-VV', 2, PUBLISHER), code('conflict'));
});

test('invalid drafts are refused', async () => {
  const { service } = setup();
  const bad: Array<[string, DraftInput]> = [
    ['model', input({ calculationModel: 'vet-care.v99' })],
    ['date', input({ effectiveFrom: '2026-13-01' })],
    ['market', input({ content: { ...SE_CONTENT, market: 'se' } })],
    ['limit', input({ content: { ...SE_CONTENT, autoSettleMax: -1 } })],
    ['group', input({ content: { ...SE_CONTENT, diagnosisGroups: { 'ORA-OTIT': '' } } })],
    ['field', input({ content: { ...SE_CONTENT, extra: 1 } as never })],
  ];
  for (const [what, i] of bad) await assert.rejects(service.createDraft('SE-HUND-VV', i, AUTHOR), code('validation'), what);
  await assert.rejects(service.createDraft('se hund', input(), AUTHOR), code('validation'));
  await assert.rejects(service.get('SE-HUND-VV', 1), code('not_found'));
});

test('the claims engine assesses with the published rules in force on the treatment date', async () => {
  const { service: rules, clock } = setup();
  const claims = new ClaimsService({
    policies: new InMemoryPolicyPort([{ snapshot: fixtures.bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]),
    rules: new DecisioningRulesPort(rules, (pv) => (pv.startsWith('SE-HUND-VV') ? 'SE-HUND-VV' : pv)),
    store: new InMemoryClaimsStore(),
    clock,
    ids: new SequentialIds(),
  });
  await assert.rejects(claims.preview(fixtures.otitisClaim()), (e: unknown) => (e as { code?: string }).code === 'conflict', 'no published rules yet');
  await publish(rules, input());
  const a = await claims.preview(fixtures.otitisClaim());
  assert.equal(a.rulesVersion, 'SE-HUND-VV@1');
  assert.equal(a.mode, 'auto');
  await publish(rules, input({ effectiveFrom: '2026-06-01', content: { ...SE_CONTENT, autoSettleMax: 100_000 } }));
  const b = await claims.preview(fixtures.otitisClaim()); // treated 2026-06-04
  assert.deepEqual([b.rulesVersion, b.mode], ['SE-HUND-VV@2', 'manual'], 'SEK 1,500 is now above the auto limit');
  assert.notEqual(a.inputHash, b.inputHash);
});

test('a tariff series has the same lifecycle, and is never mixed with claims rules (ADR 0030)', async () => {
  const { service } = setup();
  const tariff = { content: TARIFF as never, calculationModel: 'tariff.v1', effectiveFrom: '2026-01-01' };
  await assert.rejects(service.createDraft('SE-HUND-TARIFF', { ...tariff, content: { ...TARIFF, roundTo: 0 } as never }, AUTHOR), /roundTo/);
  const d = await service.createDraft('SE-HUND-TARIFF', tariff, AUTHOR);
  await assert.rejects(service.createDraft('SE-HUND-TARIFF', input(), AUTHOR), /holds tariffs/);
  await assert.rejects(service.updateDraft('SE-HUND-TARIFF', d.version, input()), /holds tariffs/);
  assert.equal(await service.tariffInForce('SE-HUND-TARIFF', '2026-06-01'), null); // not published
  await service.submit('SE-HUND-TARIFF', d.version, AUTHOR);
  await assert.rejects(service.publish('SE-HUND-TARIFF', d.version, AUTHOR), code('forbidden'));
  const p = await service.publish('SE-HUND-TARIFF', d.version, PUBLISHER);
  const inForce = await service.tariffInForce('SE-HUND-TARIFF', '2026-06-01');
  assert.deepEqual(inForce?.ref, { series: 'SE-HUND-TARIFF', version: 1, checksum: p.checksum });
  assert.equal(inForce?.content.market, 'SE');
  assert.equal(await service.tariffInForce('SE-HUND-TARIFF', '2025-12-31'), null);
  assert.equal(await service.rulesInForce('SE-HUND-TARIFF', '2026-06-01'), null); // not claims rules
  await publish(service, input());
  assert.equal(await service.tariffInForce('SE-HUND-VV', '2026-06-01'), null);
  await assert.rejects(service.createDraft('SE-HUND-VV', tariff, AUTHOR), /holds claims rules/);
});

test('price terms are a series of their own, with the same lifecycle (ADR 0030)', async () => {
  const { service } = setup();
  const terms = { content: PRICE_TERMS as never, calculationModel: 'price-terms.v1', effectiveFrom: '2026-01-01' };
  await assert.rejects(service.createDraft('SE-HUND-TERMS', { ...terms, content: { ...PRICE_TERMS, maxTotalDiscountBp: 20_000 } as never }, AUTHOR), /maxTotalDiscountBp/);
  const d = await service.createDraft('SE-HUND-TERMS', terms, AUTHOR);
  await assert.rejects(service.createDraft('SE-HUND-TERMS', { content: TARIFF as never, calculationModel: 'tariff.v1', effectiveFrom: '2026-01-01' }, AUTHOR), /holds price terms/);
  await service.submit('SE-HUND-TERMS', d.version, AUTHOR);
  const p = await service.publish('SE-HUND-TERMS', d.version, PUBLISHER);
  assert.deepEqual((await service.priceTermsInForce('SE-HUND-TERMS', '2026-06-01'))?.ref, { series: 'SE-HUND-TERMS', version: 1, checksum: p.checksum });
  assert.equal(await service.tariffInForce('SE-HUND-TERMS', '2026-06-01'), null);
  assert.equal(await service.rulesInForce('SE-HUND-TERMS', '2026-06-01'), null);
});

test('underwriting rules are a series of their own, in force on the application date (ADR 0031)', async () => {
  const { service } = setup();
  const uw = { content: UNDERWRITING as never, calculationModel: 'underwriting.v1', effectiveFrom: '2026-01-01' };
  await assert.rejects(service.createDraft('SE-HUND-UW', { ...uw, content: { ...UNDERWRITING, ageLimits: [] } as never }, AUTHOR), /age limits/);
  const d = await service.createDraft('SE-HUND-UW', uw, AUTHOR);
  await assert.rejects(service.createDraft('SE-HUND-UW', input(), AUTHOR), /holds underwriting rules/);
  assert.equal(await service.underwritingInForce('SE-HUND-UW', '2026-06-01'), null); // not published
  await service.submit('SE-HUND-UW', d.version, AUTHOR);
  const p = await service.publish('SE-HUND-UW', d.version, PUBLISHER);
  const inForce = await service.underwritingInForce('SE-HUND-UW', '2026-06-01');
  assert.deepEqual(inForce?.ref, { series: 'SE-HUND-UW', version: 1, checksum: p.checksum });
  assert.equal(await service.underwritingInForce('SE-HUND-UW', '2025-12-31'), null);
  assert.equal(await service.tariffInForce('SE-HUND-UW', '2026-06-01'), null);
  assert.deepEqual((await service.allSeries()).map((s) => [s.series, s.kind]), [['SE-HUND-UW', 'underwriting']]);
});
