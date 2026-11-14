/**
 * Pengar enligt ADR 0005: heltal i minsta valutaenhet, procentsatser i
 * baspunkter, avrundning halvt uppåt på ett ställe och ingen växling.
 */
import { assertCurrencyCode, type CurrencyCode } from './market.ts';

/** Heltal i minsta valutaenhet (öre, cent, pence …). Aldrig flyttal. */
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
    super(`Valutorna skiljer sig åt: ${expected} och ${actual}. Belopp växlas aldrig.`);
  }
}

export function assertMinorUnits(n: MinorUnits, field: string): void {
  if (!Number.isSafeInteger(n)) throw new Error(`${field}: belopp måste vara heltal i minsta valutaenhet, fick ${n}`);
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
  assertMinorUnits(amount, 'resultat');
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

/** Summerar belopp i en valuta. Tom lista ger noll i `currency`. */
export function sumMoney(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce(addMoney, money(0, currency));
}

/** Baspunkter: 10 000 = 100 %. */
export type BasisPoints = number;

/**
 * Belopp × baspunkter, avrundat halvt uppåt till hel minsta enhet.
 * Den enda avrundningen av procentsatser i Petvold.
 */
export function applyBp(amount: MinorUnits, bp: BasisPoints): MinorUnits {
  assertMinorUnits(amount, 'amount');
  if (amount < 0) throw new Error('applyBp förväntar icke-negativt belopp');
  if (!Number.isSafeInteger(bp) || bp < 0) throw new Error(`applyBp: baspunkter måste vara icke-negativt heltal, fick ${bp}`);
  return checked(Math.floor((amount * bp + 5_000) / 10_000));
}
