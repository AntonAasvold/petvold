/**
 * Money per ADR 0014: integers in the smallest currency unit, percentages in
 * basis points, round half up in one place, and no currency conversion.
 */
import { assertCurrencyCode, type CurrencyCode } from './market.ts';

/** Integer in the smallest currency unit (cents, pence …). Never a float. */
export type MinorUnits = number;

export interface Money {
  amount: MinorUnits;
  currency: CurrencyCode;
}

export class CurrencyMismatchError extends Error {
  constructor(
    public readonly expected: CurrencyCode,
    public readonly actual: CurrencyCode,
  ) {
    super(`Currencies differ: ${expected} and ${actual}. Amounts are never converted.`);
  }
}

export function assertMinorUnits(n: MinorUnits, field: string): void {
  if (!Number.isSafeInteger(n)) throw new Error(`${field}: amount must be an integer in the smallest currency unit, got ${n}`);
}

export function money(amount: MinorUnits, currency: CurrencyCode): Money {
  assertMinorUnits(amount, 'amount');
  assertCurrencyCode(currency, 'currency');
  return { amount, currency };
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

function checked(amount: number): MinorUnits {
  assertMinorUnits(amount, 'result');
  return amount;
}

export function addMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return { amount: checked(a.amount + b.amount), currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return { amount: checked(a.amount - b.amount), currency: a.currency };
}

/** Sums amounts in one currency. An empty list gives zero in `currency`. */
export function sumMoney(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce(addMoney, money(0, currency));
}

/** Basis points: 10 000 = 100 %. */
export type BasisPoints = number;

/**
 * Amount × basis points, rounded half up to a whole minor unit.
 * The only rounding of percentages in Petvold.
 */
export function applyBp(amount: MinorUnits, bp: BasisPoints): MinorUnits {
  assertMinorUnits(amount, 'amount');
  if (amount < 0) throw new Error('applyBp expects a non-negative amount');
  if (!Number.isSafeInteger(bp) || bp < 0) throw new Error(`applyBp: basis points must be a non-negative integer, got ${bp}`);
  return checked(Math.floor((amount * bp + 5_000) / 10_000));
}
