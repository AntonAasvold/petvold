import type { CurrencyCode, ISODate } from './types.ts';

/**
 * One annual limit: an animal's coverage in one policy year, in the policy's
 * currency. The currency is part of the key, so amounts in different
 * currencies are never added together (ADR 0014).
 */
export interface LimitKey {
  animalId: string;
  coverage: string;
  policyYearStart: ISODate;
  currency: CurrencyCode;
}

/**
 * Account names in the claims ledger. Every account for insurance amounts
 * starts with its kind and currency, so the ledger is self-describing.
 * Built here only; stores and tests use these functions instead of formatting
 * names themselves.
 */
export const accounts = {
  limitConsumed: (k: LimitKey) => `limit_consumed:${limitSuffix(k)}`,
  limitAvailable: (k: LimitKey) => `limit_available:${limitSuffix(k)}`,
  claimExpense: (currency: CurrencyCode, claimId: string) => `claim_expense:${currency}:${claimId}`,
  claimPayable: (currency: CurrencyCode, claimId: string) => `claim_payable:${currency}:${claimId}`,
};

function limitSuffix(k: LimitKey): string {
  return `${k.currency}:${k.animalId}:${k.coverage}:${k.policyYearStart}`;
}
