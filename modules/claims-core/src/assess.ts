import type {
  Assessment,
  Calculation,
  Claim,
  ClaimsRules,
  DeductiblePeriod,
  ISODate,
  Outcome,
  MinorUnits,
  PolicySnapshot,
  RuleResult,
  VetCareTerms,
} from './types.ts';
import { addDays, applyBp, assertDate, assertMinorUnits, dateLt, dateLte } from '@petvold/common';
import { sha256 } from './util.ts';

/** Allt bedömningen behöver. Ren data in, ren data ut: inga anrop, ingen klocka, ingen text. */
export interface AssessmentInput {
  claim: Claim;
  policy: PolicySnapshot | null;
  rules: ClaimsRules;
  /**
   * Gällande självriskperiod för ärendets omfattning (se deductibleScope),
   * eller null om ingen finns. Ignoreras när självrisken tas per skada.
   */
  openDeductiblePeriod: DeductiblePeriod | null;
  /** Förbrukat försäkringsbelopp innan detta ärende, för samma försäkringsår. */
  consumedBefore: MinorUnits;
}

export function validateClaim(claim: Claim): void {
  assertDate(claim.treatmentFrom, 'treatmentFrom');
  assertDate(claim.treatmentTo, 'treatmentTo');
  if (claim.treatmentTo < claim.treatmentFrom) throw new Error('treatmentTo är före treatmentFrom');
  if (!/^[A-Z]{2}$/.test(claim.market)) throw new Error(`market: ogiltig marknadskod '${claim.market}'`);
  if (!/^[A-Z]{3}$/.test(claim.currency)) throw new Error(`currency: ogiltig valutakod '${claim.currency}'`);
  if (claim.lines.length === 0) throw new Error('Skadeärendet saknar fakturarader');
  for (const l of claim.lines) {
    assertMinorUnits(l.amount, `lines[${l.id}].amount`);
    if (l.amount < 0) throw new Error(`lines[${l.id}].amount får inte vara negativt`);
    if (l.vat !== undefined) {
      assertMinorUnits(l.vat, `lines[${l.id}].vat`);
      if (l.vat < 0 || l.vat > l.amount) throw new Error(`lines[${l.id}].vat måste ligga mellan 0 och amount`);
    }
  }
}

/** Djurets ålder i hela år på ett datum. */
export function ageInYears(birthDate: ISODate, onDate: ISODate): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [y, m, d] = onDate.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/**
 * Vilken självriskperiod ett ärende hör till, enligt produktens självriskmodell.
 * null betyder att fast självrisk tas på varje skada och ingen period spåras.
 */
export function deductibleScope(
  claim: Claim,
  policy: PolicySnapshot,
  diagnosisGroup: string | null,
): { diagnosisGroup: string; validFrom: ISODate; validTo: ISODate } | null {
  const d = policy.vetCare?.deductible;
  if (!d) return null;
  switch (d.fixedPer) {
    case 'claim':
      return null;
    case 'policy_year':
      return { diagnosisGroup: '*', validFrom: policy.policyYearStart, validTo: policy.policyYearEnd };
    case 'period': {
      if (!d.periodDays) throw new Error('Självriskmodellen "period" kräver periodDays');
      return {
        diagnosisGroup: diagnosisGroup ?? `code:${claim.diagnosisCode}`,
        validFrom: claim.treatmentFrom,
        validTo: addDays(claim.treatmentFrom, d.periodDays),
      };
    }
  }
}

/**
 * Bedömer ett skadeärende. Deterministisk: samma indata ger alltid samma
 * bedömning och samma inputHash, så att beslut kan återskapas exakt.
 */
export function assess(input: AssessmentInput): Assessment {
  const { claim, policy, rules } = input;
  validateClaim(claim);

  const out: RuleResult[] = [];
  const rule = (code: RuleResult['code'], status: RuleResult['status'], reason: string, params: RuleResult['params'] = {}) =>
    out.push({ code, status, reason, params });

  const diagnosisGroup = rules.diagnosisGroups[claim.diagnosisCode] ?? null;
  const base = {
    claimId: claim.id,
    market: claim.market,
    currency: claim.currency,
    policyVersionId: policy?.policyVersionId ?? null,
    productVersion: policy?.productVersion ?? null,
    rulesVersion: rules.rulesVersion,
    diagnosisGroup,
    inputHash: sha256(input),
  };
  const stop = (): Assessment => ({ ...base, rules: out, calculation: null, proposedOutcome: 'rejected', mode: 'manual' });

  // 1. Gällande policyversion på behandlingsdatumet
  if (!policy) {
    rule('POLICY_FOUND', 'fail', 'policy.not_found', { date: claim.treatmentFrom });
    return stop();
  }
  rule('POLICY_FOUND', 'pass', 'policy.found', { version: policy.policyVersionId, date: claim.treatmentFrom });

  // 2. Marknad och valuta måste stämma – vi växlar aldrig valuta i en skada
  if (claim.market !== policy.market || claim.market !== rules.market) {
    rule('MARKET_CURRENCY', 'fail', 'market.mismatch', { claimMarket: claim.market, policyMarket: policy.market });
    return stop();
  }
  if (claim.currency !== policy.currency) {
    rule('MARKET_CURRENCY', 'fail', 'currency.mismatch', { claimCurrency: claim.currency, policyCurrency: policy.currency });
    return stop();
  }
  rule('MARKET_CURRENCY', 'pass', 'market.ok', { market: claim.market, currency: claim.currency });

  if (policy.animalId !== claim.animalId) rule('ANIMAL_MATCHES', 'fail', 'animal.mismatch');

  if (policy.status !== 'active') {
    rule('POLICY_ACTIVE', 'fail', 'policy.inactive');
  } else if (policy.validTo && !dateLt(claim.treatmentTo, policy.validTo)) {
    rule('POLICY_ACTIVE', 'review', 'policy.ends_during_treatment', { validTo: policy.validTo });
  } else {
    rule('POLICY_ACTIVE', 'pass', 'policy.active');
  }

  // 3. Moment
  const terms = policy.vetCare;
  if (!terms) {
    rule('COVERAGE', 'fail', 'coverage.missing', { coverage: 'vet_care' });
    return stop();
  }
  rule('COVERAGE', 'pass', 'coverage.ok', { coverage: 'vet_care' });

  // 4. Karenstid
  const waitingEnds = addDays(policy.inceptionDate, terms.waitingPeriodDays);
  if (dateLt(claim.treatmentFrom, waitingEnds)) rule('WAITING_PERIOD', 'fail', 'waiting.within', { endsOn: waitingEnds });
  else rule('WAITING_PERIOD', 'pass', 'waiting.passed');

  // 5. Diagnos känd av produktens regler
  if (!diagnosisGroup) rule('DIAGNOSIS_KNOWN', 'review', 'diagnosis.unknown', { diagnosisCode: claim.diagnosisCode });
  else rule('DIAGNOSIS_KNOWN', 'pass', 'diagnosis.known', { diagnosisGroup });

  // 6. Förbehåll: exakt kod = undantag, samma diagnosgrupp = möjlig koppling
  out.push(...riderRules(claim, policy, rules, diagnosisGroup));

  // 7. Beräkning
  const usePeriod = terms.deductible.fixedPer !== 'claim';
  const calculation = calculate(claim, policy, terms, rules, usePeriod ? input.openDeductiblePeriod : null, input.consumedBefore);
  if (calculation.cappedByLimit) {
    rule('LIMIT', 'info', 'limit.capped', { remaining: calculation.remainingBefore, currency: claim.currency });
  }

  const proposedOutcome = proposeOutcome(out, calculation);
  const allClear = out.every((r) => r.status === 'pass' || r.status === 'info');
  const mode = allClear && proposedOutcome !== 'rejected' && calculation.payout <= rules.autoSettleMax ? 'auto' : 'manual';

  return { ...base, rules: out, calculation, proposedOutcome, mode };
}

function riderRules(claim: Claim, policy: PolicySnapshot, rules: ClaimsRules, diagnosisGroup: string | null): RuleResult[] {
  const out: RuleResult[] = [];
  const active = policy.riders.filter(
    (r) => dateLte(r.validFrom, claim.treatmentFrom) && (!r.validTo || dateLt(claim.treatmentFrom, r.validTo)),
  );
  const codes = new Set([claim.diagnosisCode, ...claim.lines.flatMap((l) => (l.diagnosisCode ? [l.diagnosisCode] : []))]);

  for (const rider of active) {
    if (rider.diagnosisCodes.some((c) => codes.has(c))) {
      out.push({ code: 'RIDER', status: 'fail', reason: 'rider.excluded', params: { riderId: rider.id, description: rider.description } });
      continue;
    }
    const riderGroups = new Set(rider.diagnosisCodes.map((c) => rules.diagnosisGroups[c]).filter(Boolean));
    if (diagnosisGroup && riderGroups.has(diagnosisGroup)) {
      out.push({
        code: 'RIDER',
        status: 'review',
        reason: 'rider.possible',
        params: { riderId: rider.id, description: rider.description, diagnosisGroup },
      });
    }
  }
  if (out.length === 0) out.push({ code: 'RIDER', status: 'pass', reason: 'rider.none', params: {} });
  return out;
}

export function variableBpFor(terms: VetCareTerms, ageYears: number): number {
  const steps = (terms.deductible.variableBpByAge ?? []).filter((s) => ageYears >= s.fromAgeYears);
  return steps.reduce((bp, s) => Math.max(bp, s.bp), terms.deductible.variableBp);
}

export function calculate(
  claim: Claim,
  policy: PolicySnapshot,
  terms: VetCareTerms,
  rules: ClaimsRules,
  openPeriod: DeductiblePeriod | null,
  consumedBefore: MinorUnits,
): Calculation {
  const nonReimb = new Set(rules.nonReimbursableCategories);
  const billed = claim.lines.reduce((s, l) => s + l.amount, 0);
  const nonReimbursableLines = claim.lines.filter((l) => nonReimb.has(l.category));
  const nonReimbursable = nonReimbursableLines.reduce((s, l) => s + l.amount, 0);
  const vatExcluded = rules.vatReimbursable
    ? 0
    : claim.lines.filter((l) => !nonReimb.has(l.category)).reduce((s, l) => s + (l.vat ?? 0), 0);
  const base = billed - nonReimbursable - vatExcluded;

  const d = terms.deductible;
  const chargeFixed = d.fixedPer === 'claim' || openPeriod === null;
  const deductibleFixed = chargeFixed ? Math.min(d.fixed, base) : 0;
  const afterFixed = base - deductibleFixed;
  const deductibleVariableBp = variableBpFor(terms, ageInYears(policy.animalBirthDate, claim.treatmentFrom));
  const deductibleVariable = applyBp(afterFixed, deductibleVariableBp);
  const payableBeforeLimit = afterFixed - deductibleVariable;

  const remainingBefore = Math.max(0, terms.annualLimit - consumedBefore);
  const payout = Math.min(payableBeforeLimit, remainingBefore);

  return {
    currency: claim.currency,
    billed,
    nonReimbursable,
    vatExcluded,
    base,
    opensDeductiblePeriod: chargeFixed && d.fixedPer !== 'claim',
    deductibleFixed,
    deductibleVariableBp,
    deductibleVariable,
    payableBeforeLimit,
    annualLimit: terms.annualLimit,
    consumedBefore,
    remainingBefore,
    payout,
    customerShare: billed - payout,
    cappedByLimit: payout < payableBeforeLimit,
  };
}

function proposeOutcome(rules: RuleResult[], calc: Calculation): Outcome {
  if (rules.some((r) => r.status === 'fail')) return 'rejected';
  if (calc.payout === 0) return 'rejected';
  if (calc.cappedByLimit || calc.nonReimbursable > 0 || calc.vatExcluded > 0) return 'partial';
  return 'approved';
}
