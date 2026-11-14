import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimsService, DomainError, StoreConflictError, type ClaimsEvent } from '@petvold/claims-core';
import {
  FixedClock,
  InMemoryClaimsStore,
  InMemoryPolicyPort,
  SequentialIds,
  StaticRulesPort,
  fixtures,
} from '@petvold/claims-store-memory';

const { bellaPolicy, cruciateClaim, otitisClaim, RULES_SE_DOG, PRODUCT, eurPolicy, eurClaim, RULES_EUR_EXAMPLE, PRODUCT_EUR } = fixtures;

function setup() {
  const store = new InMemoryClaimsStore();
  const policies = new InMemoryPolicyPort([
    { snapshot: bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' },
    { snapshot: eurPolicy(), sysFrom: '2025-12-01T00:00:00Z' },
  ]);
  const clock = new FixedClock('2026-11-13T14:00:00Z');
  const events: ClaimsEvent[] = [];
  const service = new ClaimsService({
    policies,
    rules: new StaticRulesPort({ [PRODUCT]: RULES_SE_DOG, [PRODUCT_EUR]: RULES_EUR_EXAMPLE }, RULES_SE_DOG),
    store,
    clock,
    ids: new SequentialIds(),
    events: { publish: async (e) => void events.push(e) },
  });
  return { service, store, policies, clock, events };
}

function assertBalanced(store: InMemoryClaimsStore) {
  for (const j of store.dump().journals) {
    assert.equal(j.lines.reduce((s, l) => s + l.amount, 0), 0, `journal ${j.id} balanserar inte`);
  }
}

test('liten skada regleras automatiskt, bokförs och öppnar självriskperiod', async () => {
  const { service, store, events } = setup();
  const r = await service.registerClaim(otitisClaim());
  assert.equal(r.assessment.mode, 'auto');
  assert.ok(r.decision);
  assert.equal(r.decision.payout, 150_000);
  assert.equal(r.decision.decidedBy, 'auto');
  assertBalanced(store);
  assert.equal(store.dump().periods.length, 1);
  assert.deepEqual(events.map((e) => e.type), ['claim.registered', 'claim.decided']);

  const limits = await service.getLimits('pol_bella', 'ani_bella', '2026-11-13');
  assert.equal(limits.consumed, 150_000);
  assert.equal(limits.remaining, 6_000_000 - 150_000);
  assert.equal(limits.currency, 'SEK');
});

test('andra skadan i samma diagnosgrupp inom självriskperioden får ingen fast självrisk', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  const second = await service.registerClaim(
    otitisClaim({ id: 'clm_2', claimNo: 'S-2', treatmentFrom: '2026-07-01', treatmentTo: '2026-07-01' }),
  );
  assert.equal(second.assessment.calculation!.deductibleFixed, 0);
  assert.equal(second.assessment.calculation!.payout, 300_000); // 4 000 kr − 25 %
});

test('designexemplet går till handläggare och beslutas med expectedInputHash', async () => {
  const { service, store } = setup();
  const r = await service.registerClaim(cruciateClaim());
  assert.equal(r.decision, null);
  assert.equal(r.assessment.mode, 'manual');

  const d = await service.decide('clm_048213', {
    action: 'accept',
    decidedBy: 'handlaggare@example.test',
    reason: 'Korsband vänster, ingen koppling till förbehållet',
    expectedInputHash: r.assessment.inputHash,
  });
  assert.equal(d.outcome, 'partial');
  assert.equal(d.payout, 1_216_500); // 12 165 kr, som i designen
  assertBalanced(store);
});

test('beslut på inaktuellt underlag avvisas', async () => {
  const { service } = setup();
  const r = await service.registerClaim(cruciateClaim());
  await service.registerClaim(otitisClaim()); // ändrar förbrukat belopp
  await assert.rejects(
    service.decide('clm_048213', { action: 'accept', decidedBy: 'h', expectedInputHash: r.assessment.inputHash }),
    (e: unknown) => e instanceof DomainError && e.code === 'conflict',
  );
});

test('retroaktiv policyändring: omprövning bokar bara skillnaden, och knownAt visar gamla bilden', async () => {
  const { service, store, policies, clock } = setup();
  await service.registerClaim(otitisClaim()); // 1 500 kr
  assert.equal((await service.getLimits('pol_bella', 'ani_bella', '2026-06-04')).consumed, 150_000);

  // Den 20 juni registreras en ändring som gäller från 1 april: lägre rörlig självrisk.
  policies.supersede('pv_bella_v4', '2026-06-20T10:00:00Z');
  policies.add({
    snapshot: bellaPolicy({
      policyVersionId: 'pv_bella_v5',
      vetCare: { ...bellaPolicy().vetCare!, deductible: { fixed: 200_000, fixedPer: 'period', periodDays: 125, variableBp: 1500 } },
    }),
    sysFrom: '2026-06-20T10:00:00Z',
  });
  clock.set('2026-06-21T09:00:00Z');

  const before = await service.assessClaim('clm_021877', '2026-06-10T00:00:00Z');
  assert.equal(before.policyVersionId, 'pv_bella_v4');

  const d = await service.reassess('clm_021877', 'system', 'Retroaktiv ändring av självrisk');
  assert.ok(d);
  assert.equal(d.seq, 2);
  assert.equal(d.payout, 170_000); // 2 000 kr − 15 %
  assert.equal(d.assessment.policyVersionId, 'pv_bella_v5');

  const journals = store.dump().journals;
  assert.equal(journals.length, 2);
  assert.equal(journals[1]!.lines[0]!.amount, 20_000); // bara skillnaden
  assertBalanced(store);
  assert.equal((await service.getLimits('pol_bella', 'ani_bella', '2026-06-04')).consumed, 170_000);

  // Ingen ändring i underlaget => inget nytt beslut
  assert.equal(await service.reassess('clm_021877', 'system', 'igen'), null);
});

test('avslag vid omprövning återför hela beloppet och stänger självriskperioden', async () => {
  const { service, store, policies } = setup();
  await service.registerClaim(otitisClaim());
  policies.supersede('pv_bella_v4', '2026-06-20T10:00:00Z');
  policies.add({
    snapshot: bellaPolicy({
      policyVersionId: 'pv_bella_v5',
      riders: [{ id: 'r2', description: 'Öron', diagnosisCodes: ['ORA-OTIT'], validFrom: '2026-01-01' }],
    }),
    sysFrom: '2026-06-20T10:00:00Z',
  });
  const d = await service.reassess('clm_021877', 'system', 'Förbehåll registrerat retroaktivt');
  assert.equal(d!.outcome, 'rejected');
  assert.equal(d!.payout, 0);
  assert.equal((await service.getLimits('pol_bella', 'ani_bella', '2026-06-04')).consumed, 0);
  assert.equal(store.dump().periods.length, 0);
  assertBalanced(store);
});

test('förslag om avslag kan inte godkännas', async () => {
  const { service } = setup();
  await service.registerClaim(cruciateClaim({ id: 'c_x', claimNo: 'X', diagnosisCode: 'ORT-HALTA-HB-H' }));
  await assert.rejects(service.decide('c_x', { action: 'accept', decidedBy: 'h' }), (e: unknown) => e instanceof DomainError && e.code === 'validation');
  const d = await service.decide('c_x', { action: 'reject', decidedBy: 'h', reason: 'Förbehåll' });
  assert.equal(d.outcome, 'rejected');
  assert.equal(d.payout, 0);
});

test('samma ärende kan inte registreras två gånger', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  await assert.rejects(service.registerClaim(otitisClaim()), (e: unknown) => e instanceof DomainError && e.code === 'conflict');
});

test('förhandsbesked sparar och reserverar ingenting', async () => {
  const { service, store } = setup();
  const a = await service.preview(otitisClaim());
  assert.equal(a.calculation!.payout, 150_000);
  assert.equal(store.dump().decisions.length, 0);
  assert.equal(store.dump().periods.length, 0);
});

test('EUR-marknad genom hela flödet: bokförs i EUR', async () => {
  const { service, store } = setup();
  const r = await service.registerClaim(eurClaim());
  assert.equal(r.decision!.payout, 17_500);
  assert.ok(store.dump().journals[0]!.lines.some((l) => l.account.startsWith('claim_payable:EUR:')));
  // Självrisk per skada: ingen period sparas
  assert.equal(store.dump().periods.length, 0);
  const second = await service.registerClaim(eurClaim({ id: 'clm_rex_2', claimNo: 'X-2' }));
  assert.equal(second.assessment.calculation!.deductibleFixed, 5_000);
});

test('en krock i lagringen blir conflict, inte internt fel', async () => {
  // Simulerar att ett annat beslut hann före mellan bedömning och sparande.
  const { service, store } = setup();
  store.commitDecision = async () => {
    throw new StoreConflictError('decision_exists', 'Beslut clm_021877#1 finns redan');
  };
  await assert.rejects(service.registerClaim(otitisClaim()), (e: unknown) => e instanceof DomainError && e.code === 'conflict');
});
