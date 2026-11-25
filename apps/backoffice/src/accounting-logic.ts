/**
 * The bookkeeping in the back office (ADR 0040, steg 8): closed days, balances,
 * verifications and the chart of accounts. Pure, so it is tested without a
 * browser. The API decides every call; this checks a chart before it is sent.
 */
import { can, type Me } from './permissions.ts';

/** Petvold's kinds of account: money in, premiums, then money out. */
export const ACCOUNT_KINDS = [
  'bank',
  'unmatched-payments',
  'premium-receivable',
  'premium-income',
  'premium-tax',
  'installment-fees',
  'customer-losses',
  'refunds-payable',
  'claims-cost',
  'claims-payable',
  'recoveries-receivable',
] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export type AccountingTab = 'days' | 'balances' | 'verifications' | 'chart';
export const accountingTabs = (me: Me | null): AccountingTab[] => (can(me, 'accounting:read') ? ['days', 'balances', 'verifications', 'chart'] : []);

export type ChartMarkets = Record<string, Partial<Record<AccountKind, { number: string; name?: string }>>>;

/** The chart with one account set, changed or (with an empty number) removed. Never changes the input. */
export function withAccount(markets: ChartMarkets, market: string, kind: AccountKind, number: string, name: string): ChartMarkets {
  const accounts = { ...(markets[market] ?? {}) };
  const n = number.trim();
  if (n) accounts[kind] = { number: n, ...(name.trim() ? { name: name.trim() } : {}) };
  else delete accounts[kind];
  return { ...markets, [market]: accounts };
}

export type ChartProblem = { kind: 'number'; market: string; account: AccountKind } | { kind: 'reason' } | { kind: 'market'; market: string };

/** What the API would refuse: a number of 1 to 20 letters, digits, dots and dashes, a name of at most 200, a market of two capitals, and a reason. */
export function chartProblems(markets: ChartMarkets, reason: string): ChartProblem[] {
  const out: ChartProblem[] = [];
  for (const [market, accounts] of Object.entries(markets)) {
    if (!/^[A-Z]{2}$/.test(market)) out.push({ kind: 'market', market });
    for (const [account, a] of Object.entries(accounts)) {
      if (!a || !/^[A-Za-z0-9.-]{1,20}$/.test(a.number) || (a.name?.length ?? 0) > 200) out.push({ kind: 'number', market, account: account as AccountKind });
    }
  }
  if (!reason.trim() || reason.trim().length > 2000) out.push({ kind: 'reason' });
  return out;
}

/** The kinds a market's chart has no number for: they keep their name in the day's file. */
export const unmappedKinds = (markets: ChartMarkets, market: string): AccountKind[] => ACCOUNT_KINDS.filter((k) => !markets[market]?.[k]);

/** Every currency's debit equals its credit. */
export const balanced = (totals: readonly { debit: number; credit: number }[]): boolean => totals.every((t) => t.debit === t.credit);

/** The file name for a closed day's file. */
export const dayFileName = (market: string, day: string): string => `petvold-verifications-${market}-${day}.csv`;
