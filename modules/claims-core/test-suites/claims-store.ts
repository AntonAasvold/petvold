/**
 * Gemensam testsvit för ClaimsStore (lager 4, ADR 0012).
 *
 * Varje implementation (minne, Postgres …) kör samma svit med sin egen fabrik:
 *
 *   claimsStoreSuite('InMemoryClaimsStore', async () => ({ store: new InMemoryClaimsStore() }));
 *
 * Sviten är porten `ClaimsStore` uttryckt som tester. Det som står här gäller
 * för alla implementationer, och en ny implementation är klar när den går igenom.
 * Tidsstämplar anges i kanonisk form (`Date#toISOString`) och ska komma tillbaka oförändrade.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { StoreConflictError, type ClaimsStore, type DecisionCommit } from '../src/ports.ts';
import type { Assessment, Claim, ClaimDecision, DeductiblePeriod, LedgerJournal } from '../src/types.ts';

export interface StoreHarness {
  store: ClaimsStore;
  /** Körs efter varje test, t.ex. för att stänga en anslutning. */
  cleanup?: () => Promise<void>;
}

/** Skapar en ny, tom lagring för varje test. */
export type StoreFactory = () => Promise<StoreHarness>;

// ---------------------------------------------------------------------------
// Påhittade testdata
// ---------------------------------------------------------------------------

const YEAR = '2026-04-01';

function claim(id: string, overrides: Partial<Claim> = {}): Claim {
  return {
    id,
    claimNo: `S-${id}`,
    policyId: 'pol_suite',
    animalId: 'ani_suite',
    market: 'SE',
    currency: 'SEK',
    channel: 'customer',
    treatmentFrom: '2026-10-01',
    treatmentTo: '2026-10-02',
    diagnosisCode: 'ORA-OTIT',
    lines: [
      { id: 'l1', description: 'Undersökning', category: 'examination', amount: 65_000, vat: 13_000 },
      { id: 'l2', description: 'Läkemedel', category: 'medication', amount: 35_000, diagnosisCode: 'ORA-OTIT' },
    ],
    receivedAt: '2026-10-02T09:15:00.000Z',
    ...overrides,
  };
}

function assessment(claimId: string): Assessment {
  return {
    claimId,
    market: 'SE',
    currency: 'SEK',
    policyVersionId: 'pv_suite',
    productVersion: 'SE-HUND-SUITE@1',
    rulesVersion: 'SE-HUND-SUITE.1',
    rules: [{ code: 'POLICY_ACTIVE', status: 'pass', reason: 'policy.active', params: { policyId: 'pol_suite' } }],
    calculation: null,
    proposedOutcome: 'approved',
    mode: 'auto',
    diagnosisGroup: 'ora',
    inputHash: `hash-${claimId}`,
  };
}

function decision(claimId: string, seq: number, payout: number, overrides: Partial<ClaimDecision> = {}): ClaimDecision {
  return {
    id: `dec_${claimId}_${seq}`,
    claimId,
    seq,
    outcome: 'approved',
    payout,
    assessment: assessment(claimId),
    decidedBy: 'auto',
    decidedAt: `2026-10-0${2 + seq}T10:00:00.000Z`,
    ...overrides,
  };
}

/** Journal som förbrukar `amount` av djurets försäkringsbelopp, som tjänsten bokför. */
function consumption(d: ClaimDecision, amount: number, animalId = 'ani_suite', yearStart = YEAR): LedgerJournal {
  const key = `${animalId}:vet_care:${yearStart}`;
  return {
    id: `jrn_${d.id}`,
    sourceType: 'claim_decision',
    sourceId: d.id,
    claimId: d.claimId,
    currency: 'SEK',
    bookedAt: d.decidedAt,
    lines: [
      { account: `limit_consumed:${key}`, amount },
      { account: `limit_available:${key}`, amount: -amount },
      { account: `claim_expense:SEK:${d.claimId}`, amount },
      { account: `claim_payable:SEK:${d.claimId}`, amount: -amount },
    ],
  };
}

function period(id: string, openedByClaimId: string, validFrom: string, validTo: string, overrides: Partial<DeductiblePeriod> = {}): DeductiblePeriod {
  return { id, animalId: 'ani_suite', diagnosisGroup: 'ora', validFrom, validTo, openedByClaimId, ...overrides };
}

function commit(d: ClaimDecision, journals: LedgerJournal[] = [], deductiblePeriod: DeductiblePeriod | null = null): DecisionCommit {
  return { decision: d, journals, deductiblePeriod };
}

const isConflict = (reason: StoreConflictError['reason']) => (e: unknown) =>
  e instanceof StoreConflictError && e.reason === reason;

// ---------------------------------------------------------------------------
// Sviten
// ---------------------------------------------------------------------------

export function claimsStoreSuite(name: string, factory: StoreFactory): void {
  describe(`ClaimsStore: ${name}`, () => {
    /** Kör ett test mot en ny, tom lagring. */
    const it = (title: string, fn: (store: ClaimsStore) => Promise<void>) =>
      test(title, async () => {
        const h = await factory();
        try {
          await fn(h.store);
        } finally {
          await h.cleanup?.();
        }
      });

    // Ärenden ---------------------------------------------------------------

    it('ett sparat ärende läses tillbaka oförändrat', async (store) => {
      const c = claim('clm_a');
      await store.saveClaim(c);
      assert.deepEqual(await store.getClaim('clm_a'), c);
    });

    it('ett okänt ärende ger null', async (store) => {
      assert.equal(await store.getClaim('clm_finns_inte'), null);
    });

    it('ett ärende med samma id kan inte sparas två gånger', async (store) => {
      await store.saveClaim(claim('clm_a'));
      await assert.rejects(store.saveClaim(claim('clm_a', { diagnosisCode: 'GI-ENTERIT' })), isConflict('claim_exists'));
      assert.equal((await store.getClaim('clm_a'))?.diagnosisCode, 'ORA-OTIT');
    });

    it('ändringar i ett läst objekt påverkar inte lagringen', async (store) => {
      await store.saveClaim(claim('clm_a'));
      const read = (await store.getClaim('clm_a'))!;
      read.lines[0]!.amount = 1;
      assert.equal((await store.getClaim('clm_a'))?.lines[0]?.amount, 65_000);
    });

    // Beslut ------------------------------------------------------------------

    it('ett ärende utan beslut har en tom lista', async (store) => {
      await store.saveClaim(claim('clm_a'));
      assert.deepEqual(await store.getDecisions('clm_a'), []);
    });

    it('beslut läses tillbaka oförändrade och i ordning', async (store) => {
      await store.saveClaim(claim('clm_a'));
      const first = decision('clm_a', 1, 50_000);
      const second = decision('clm_a', 2, 30_000, { decidedBy: 'handlaggare@example.test', reason: 'Omprövning' });
      await store.commitDecision(commit(first, [consumption(first, 50_000)]));
      await store.commitDecision(commit(second, [consumption(second, -20_000)]));
      assert.deepEqual(await store.getDecisions('clm_a'), [first, second]);
    });

    it('samma löpnummer kan inte beslutas två gånger', async (store) => {
      await store.saveClaim(claim('clm_a'));
      const d = decision('clm_a', 1, 50_000);
      await store.commitDecision(commit(d, [consumption(d, 50_000)]));
      const again = decision('clm_a', 1, 70_000, { id: 'dec_annat' });
      await assert.rejects(store.commitDecision(commit(again, [consumption(again, 70_000)])), isConflict('decision_exists'));
      assert.deepEqual(await store.getDecisions('clm_a'), [d]);
      assert.equal(await store.getConsumed('ani_suite', 'vet_care', YEAR), 50_000);
    });

    it('beslut kräver ett sparat ärende', async (store) => {
      await assert.rejects(store.commitDecision(commit(decision('clm_saknas', 1, 0))));
    });

    // Ledger ------------------------------------------------------------------

    it('en journal som inte balanserar avvisas och inget sparas', async (store) => {
      await store.saveClaim(claim('clm_a'));
      const d = decision('clm_a', 1, 50_000);
      const bad = consumption(d, 50_000);
      bad.lines[1]!.amount = -49_999;
      await assert.rejects(store.commitDecision(commit(d, [bad], period('dp_a', 'clm_a', '2026-10-01', '2027-02-03'))));
      assert.deepEqual(await store.getDecisions('clm_a'), []);
      assert.equal(await store.getConsumed('ani_suite', 'vet_care', YEAR), 0);
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-11-01'), null);
    });

    it('förbrukat belopp är summan av ärendenas journaler för djur och försäkringsår', async (store) => {
      for (const id of ['clm_a', 'clm_b', 'clm_annat_djur', 'clm_annat_ar']) await store.saveClaim(claim(id));
      const a1 = decision('clm_a', 1, 50_000);
      const a2 = decision('clm_a', 2, 30_000);
      const b = decision('clm_b', 1, 10_000);
      const other = decision('clm_annat_djur', 1, 99_000);
      const otherYear = decision('clm_annat_ar', 1, 88_000);
      await store.commitDecision(commit(a1, [consumption(a1, 50_000)]));
      await store.commitDecision(commit(a2, [consumption(a2, -20_000)])); // omprövning bokar skillnaden
      await store.commitDecision(commit(b, [consumption(b, 10_000)]));
      await store.commitDecision(commit(other, [consumption(other, 99_000, 'ani_annat')]));
      await store.commitDecision(commit(otherYear, [consumption(otherYear, 88_000, 'ani_suite', '2025-04-01')]));

      assert.equal(await store.getConsumed('ani_suite', 'vet_care', YEAR), 40_000);
      assert.equal(await store.getConsumed('ani_suite', 'vet_care', YEAR, 'clm_a'), 10_000);
      assert.equal(await store.getConsumed('ani_suite', 'vet_care', '2025-04-01'), 88_000);
      assert.equal(await store.getConsumed('ani_okant', 'vet_care', YEAR), 0);
    });

    // Självriskperioder -------------------------------------------------------

    it('en självriskperiod gäller från första dagen till dagen före slutdatum', async (store) => {
      await store.saveClaim(claim('clm_a'));
      const p = period('dp_a', 'clm_a', '2026-10-01', '2027-02-03');
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], p));
      assert.deepEqual(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-10-01'), p);
      assert.deepEqual(await store.findDeductiblePeriod('ani_suite', 'ora', '2027-02-02'), p);
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2027-02-03'), null);
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-09-30'), null);
    });

    it('självriskperioder gäller bara samma djur och diagnosgrupp', async (store) => {
      await store.saveClaim(claim('clm_a'));
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], period('dp_a', 'clm_a', '2026-10-01', '2027-02-03')));
      assert.equal(await store.findDeductiblePeriod('ani_annat', 'ora', '2026-11-01'), null);
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'mag-tarm', '2026-11-01'), null);
    });

    it('perioder som ärendet självt öppnat kan uteslutas', async (store) => {
      await store.saveClaim(claim('clm_a'));
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], period('dp_a', 'clm_a', '2026-10-01', '2027-02-03')));
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-11-01', 'clm_a'), null);
      assert.notEqual(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-11-01', 'clm_annat'), null);
    });

    it('ett nytt beslut ersätter perioden som ärendet öppnat, och null tar bort den', async (store) => {
      await store.saveClaim(claim('clm_a'));
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], period('dp_1', 'clm_a', '2026-10-01', '2027-02-03')));
      const moved = period('dp_2', 'clm_a', '2026-10-05', '2027-02-07');
      await store.commitDecision(commit(decision('clm_a', 2, 0), [], moved));
      assert.deepEqual(await store.findDeductiblePeriod('ani_suite', 'ora', '2027-02-05'), moved);
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-10-02'), null);

      await store.commitDecision(commit(decision('clm_a', 3, 0), [], null));
      assert.equal(await store.findDeductiblePeriod('ani_suite', 'ora', '2026-11-01'), null);
    });

    it('perioder för samma djur och grupp får inte överlappa, och inget sparas', async (store) => {
      await store.saveClaim(claim('clm_a'));
      await store.saveClaim(claim('clm_b'));
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], period('dp_a', 'clm_a', '2026-10-01', '2027-02-03')));
      const b = decision('clm_b', 1, 10_000);
      await assert.rejects(
        store.commitDecision(commit(b, [consumption(b, 10_000)], period('dp_b', 'clm_b', '2027-02-02', '2027-06-07'))),
        isConflict('period_overlaps'),
      );
      assert.deepEqual(await store.getDecisions('clm_b'), []);
      assert.equal(await store.getConsumed('ani_suite', 'vet_care', YEAR), 0);
    });

    it('en period får börja samma dag som en annan slutar', async (store) => {
      await store.saveClaim(claim('clm_a'));
      await store.saveClaim(claim('clm_b'));
      await store.commitDecision(commit(decision('clm_a', 1, 0), [], period('dp_a', 'clm_a', '2026-10-01', '2027-02-03')));
      const next = period('dp_b', 'clm_b', '2027-02-03', '2027-06-08');
      await store.commitDecision(commit(decision('clm_b', 1, 0), [], next));
      assert.deepEqual(await store.findDeductiblePeriod('ani_suite', 'ora', '2027-02-03'), next);
    });
  });
}
