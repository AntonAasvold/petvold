/**
 * Simulation of rules against stored decisions (ADR 0018, 0021).
 *
 * Each stored input is assessed again with other rules (e.g. a draft), and the
 * result is compared with what was decided. Pure: nothing is stored or booked.
 * Each decision is simulated on its own, with the deductible period and consumed
 * limit it had; knock-on effects between claims are not simulated.
 */
import { CALCULATION_MODELS } from './replay.ts';
import type { ClaimDecision, ClaimsRules, CurrencyCode, DecisionEvidence, DecisionMode, MinorUnits, Outcome } from './types.ts';

export interface SimulatedDecision {
  claimId: string;
  decisionId: string;
  seq: number;
  currency: CurrencyCode;
  stored: { rulesVersion: string; proposedOutcome: Outcome; mode: DecisionMode; payout: MinorUnits };
  simulated: { proposedOutcome: Outcome; mode: DecisionMode; payout: MinorUnits };
  /** simulated.payout − stored.payout */
  payoutDelta: MinorUnits;
  changed: boolean;
}

export interface SimulationTotals {
  currency: CurrencyCode;
  decisions: number;
  storedPayout: MinorUnits;
  simulatedPayout: MinorUnits;
}

export interface SimulationResult {
  rulesVersion: string;
  calculationModel: string;
  decisions: number;
  changed: number;
  /** Decisions that would have moved between automatic and manual handling. */
  modeChanged: { autoToManual: number; manualToAuto: number };
  /** Payouts per currency: never added across currencies (ADR 0014). */
  totals: SimulationTotals[];
  /** The changed decisions, at most 200. */
  items: SimulatedDecision[];
}

const MAX_ITEMS = 200;

/**
 * Simulates `rules` with `calculationModel` against stored decisions. The stored
 * payout is the decided one; the simulated payout is what the proposal would
 * have paid. A stored decision against the proposal keeps its own outcome.
 */
export function simulate(
  stored: ReadonlyArray<{ decision: ClaimDecision; evidence: DecisionEvidence }>,
  rules: ClaimsRules,
  calculationModel: string,
): SimulationResult {
  const model = CALCULATION_MODELS[calculationModel];
  if (!model) throw new Error(`Unknown calculation model '${calculationModel}'`);
  const all: SimulatedDecision[] = stored.map(({ decision: d, evidence: e }) => {
    const a = model({ ...e.input, rules });
    const proposedPayout = a.proposedOutcome === 'rejected' ? 0 : (a.calculation?.payout ?? 0);
    const payout = d.deviatesFromProposal ? d.payout : proposedPayout;
    const s = d.assessment;
    const changed = a.proposedOutcome !== s.proposedOutcome || a.mode !== s.mode || payout !== d.payout;
    return {
      claimId: d.claimId,
      decisionId: d.id,
      seq: d.seq,
      currency: s.currency,
      stored: { rulesVersion: s.rulesVersion, proposedOutcome: s.proposedOutcome, mode: s.mode, payout: d.payout },
      simulated: { proposedOutcome: a.proposedOutcome, mode: a.mode, payout },
      payoutDelta: payout - d.payout,
      changed,
    };
  });
  const totals = new Map<CurrencyCode, SimulationTotals>();
  for (const x of all) {
    const t = totals.get(x.currency) ?? { currency: x.currency, decisions: 0, storedPayout: 0, simulatedPayout: 0 };
    t.decisions += 1;
    t.storedPayout += x.stored.payout;
    t.simulatedPayout += x.simulated.payout;
    totals.set(x.currency, t);
  }
  const changed = all.filter((x) => x.changed);
  return {
    rulesVersion: rules.rulesVersion,
    calculationModel,
    decisions: all.length,
    changed: changed.length,
    modeChanged: {
      autoToManual: all.filter((x) => x.stored.mode === 'auto' && x.simulated.mode === 'manual').length,
      manualToAuto: all.filter((x) => x.stored.mode === 'manual' && x.simulated.mode === 'auto').length,
    },
    totals: [...totals.values()].sort((a, b) => (a.currency < b.currency ? -1 : 1)),
    items: changed.slice(0, MAX_ITEMS),
  };
}
