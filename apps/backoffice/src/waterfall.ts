/**
 * The calculation as a waterfall: what was billed, each deduction with the rule
 * behind it, and the payout. Bars are in percent of the billed amount; a
 * deduction is drawn where it falls, from what is left after it to what was
 * left before it. Pure; tested with node:test. Text is added by the view.
 */

export interface CalculationLike {
  billed: number;
  nonReimbursable: number;
  vatExcluded: number;
  deductibleFixed: number;
  deductibleVariable: number;
  deductibleVariableBp: number;
  opensDeductiblePeriod: boolean;
  payableBeforeLimit: number;
  remainingBefore: number;
  payout: number;
  cappedByLimit: boolean;
}

export type StepKey = 'billed' | 'nonReimbursable' | 'vatExcluded' | 'deductibleFixed' | 'deductibleVariable' | 'limit' | 'payout';

export interface Step {
  key: StepKey;
  kind: 'total' | 'minus' | 'result';
  amount: number;
  /** Where the bar starts and ends, in percent of the billed amount. */
  from: number;
  to: number;
  /** Values for the note with the rule, e.g. the variable deductible in percent. */
  params: Record<string, number | boolean>;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 100 : 0);

/** The steps of a calculation, leaving out deductions that are zero. */
export function waterfallSteps(c: CalculationLike): Step[] {
  const steps: Step[] = [{ key: 'billed', kind: 'total', amount: c.billed, from: 0, to: c.billed > 0 ? 100 : 0, params: {} }];
  let left = c.billed;
  const minus = (key: StepKey, amount: number, params: Step['params'] = {}) => {
    if (amount <= 0) return;
    steps.push({ key, kind: 'minus', amount, from: pct(left - amount, c.billed), to: pct(left, c.billed), params });
    left -= amount;
  };
  minus('nonReimbursable', c.nonReimbursable);
  minus('vatExcluded', c.vatExcluded);
  minus('deductibleFixed', c.deductibleFixed, { opensPeriod: c.opensDeductiblePeriod });
  minus('deductibleVariable', c.deductibleVariable, { percent: c.deductibleVariableBp / 100 });
  if (c.cappedByLimit) minus('limit', c.payableBeforeLimit - c.payout, { remaining: c.remainingBefore });
  steps.push({ key: 'payout', kind: 'result', amount: c.payout, from: 0, to: pct(c.payout, c.billed), params: {} });
  return steps;
}
