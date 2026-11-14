/**
 * Skademotorns tjänst mot Postgres: samma flöden som i minnet, men med
 * beslut, ledger och perioder i databasen. Kontrollerar att det som sparas
 * går att räkna vidare på (omprövning, förbrukat belopp).
 */
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { ClaimsService } from '@petvold/claims-core';
import { FixedClock, InMemoryPolicyPort, SequentialIds, StaticRulesPort, fixtures } from '@petvold/claims-store-memory';
import { createPool, PostgresClaimsStore } from '../src/index.ts';

const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
const pool = createPool(process.env.CLAIMS_TEST_DATABASE_URL!, { max: 4 });
after(async () => {
  await pool.end();
  await owner.end();
});
beforeEach(async () => {
  await owner.query(
    `truncate claims.journal_line, claims.journal, claims.deductible_period, claims.decision,
              claims.claim_line, claims.claim, claims.outbox, claims.idempotency`,
  );
});

const { bellaPolicy, cruciateClaim, otitisClaim, RULES_SE_DOG, PRODUCT } = fixtures;

function setup() {
  const policies = new InMemoryPolicyPort([{ snapshot: bellaPolicy(), sysFrom: '2026-03-03T00:00:00Z' }]);
  const service = new ClaimsService({
    policies,
    rules: new StaticRulesPort({ [PRODUCT]: RULES_SE_DOG }, RULES_SE_DOG),
    store: new PostgresClaimsStore(pool),
    clock: new FixedClock('2026-11-13T14:00:00.000Z'),
    ids: new SequentialIds(),
  });
  return { service, policies };
}

test('automatisk reglering bokförs i balanserade journaler med valuta', async () => {
  const { service } = setup();
  const r = await service.registerClaim(otitisClaim());
  assert.equal(r.decision?.payout, 150_000);
  const { rows } = await owner.query(
    `select j.currency, sum(l.amount_minor)::int as balance from claims.journal j join claims.journal_line l on l.journal_id = j.id group by j.id, j.currency`,
  );
  assert.deepEqual(rows, [{ currency: 'SEK', balance: 0 }]);
});

test('handläggarbeslut, förbrukat belopp och omprövning utan ändring', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  const reg = await service.registerClaim(cruciateClaim());
  assert.equal(reg.decision, null);

  const a = await service.assessClaim(cruciateClaim().id);
  const d = await service.decide(cruciateClaim().id, { action: 'accept', decidedBy: 'h1', expectedInputHash: a.inputHash });
  assert.equal(d.outcome, 'partial');

  const limits = await service.getLimits('pol_bella', 'ani_bella', '2026-11-11');
  assert.equal(limits.consumed, 150_000 + d.payout);

  // Underlaget är oförändrat sedan beslutet: ingen ny omprövning.
  assert.equal(await service.reassess(cruciateClaim().id, 'h1', 'kontroll'), null);
});

test('självriskperioden från första ärendet används av nästa i samma grupp', async () => {
  const { service } = setup();
  await service.registerClaim(otitisClaim());
  const second = await service.registerClaim(
    otitisClaim({ id: 'clm_otit_2', claimNo: 'S-2', treatmentFrom: '2026-07-01', treatmentTo: '2026-07-01' }),
  );
  assert.equal(second.assessment.calculation?.deductibleFixed, 0);
});
