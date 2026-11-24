/**
 * The chart of accounts and the day close (ADR 0040, punkt 9).
 *
 * The chart maps Petvold's kinds of account to the insurer's account numbers,
 * per market, as a setting with versions (ADR 0020). The day close closes a
 * day of verifications for good and hands it to the insurer's system: as a
 * CSV file and as the event accounting.day_closed. A closed day never
 * changes; a verification for it that comes later is booked on the first
 * open day.
 */
import type { ISODate, Timestamp } from '@petvold/common';
import type { AccountKind, Verification } from './index.ts';

export interface ChartAccount {
  /** The insurer's account number, e.g. 1930. */
  number: string;
  name?: string;
}

/** A version of the chart of accounts. Never changes; a change is a new version. */
export interface ChartOfAccounts {
  version: number;
  /** Market -> kind -> the insurer's account. A kind not in it keeps its name in the file. */
  markets: Record<string, Partial<Record<AccountKind, ChartAccount>>>;
  changedBy: string;
  changedAt: Timestamp;
  reason: string;
}

/** A closed day. Never changes. */
export interface DayClose {
  market: string;
  day: ISODate;
  closedAt: Timestamp;
  closedBy: string;
  verificationCount: number;
  /** Per currency: debit and credit, which are equal. */
  totals: { currency: string; debit: number; credit: number }[];
  /** The chart version the file uses. 0: none yet. */
  chartVersion: number;
  /** Kinds with no account number in that chart. */
  unmapped: AccountKind[];
  /** SHA-256 of the file, so it can be made again and checked. */
  csvSha256: string;
}

const CSV_HEADER = [
  'verification',
  'booking_date',
  'event_date',
  'account',
  'account_name',
  'petvold_account',
  'debit',
  'credit',
  'currency',
  'text',
  'payer_account',
  'policy',
  'claim',
  'period_from',
  'period_to',
  'object_type',
  'object_id',
  'event_id',
];

/** Minor units as a decimal with a point, e.g. 41200 -> 412.00. All of Petvold's currencies have two decimals. */
export function decimal(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const a = Math.abs(minor);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/**
 * The day's verifications as CSV (RFC 4180, comma, UTF-8): one row per line,
 * the account by the chart, amounts as decimals with a point. Pure: the same
 * verifications and chart always give the same file.
 */
export function dayCsv(verifications: readonly Verification[], chart: Partial<Record<AccountKind, ChartAccount>>): string {
  const rows = [CSV_HEADER.join(',')];
  for (const v of [...verifications].sort((a, b) => (a.number < b.number ? -1 : 1))) {
    for (const l of v.lines) {
      const acc = chart[l.account];
      rows.push(
        [
          v.number,
          v.bookingDate,
          v.eventDate ?? v.bookingDate,
          acc?.number ?? l.account,
          acc?.name ?? '',
          l.account,
          l.debit ? decimal(l.debit) : '',
          l.credit ? decimal(l.credit) : '',
          v.currency,
          v.text,
          l.payerAccountId ?? '',
          l.policyId ?? '',
          l.claimId ?? '',
          l.period?.from ?? '',
          l.period?.to ?? '',
          v.source.objectType,
          v.source.objectId,
          v.source.eventId,
        ]
          .map(cell)
          .join(','),
      );
    }
  }
  return `${rows.join('\r\n')}\r\n`;
}

/** Debit and credit per currency, and the kinds the chart does not map. Pure. */
export function dayTotals(verifications: readonly Verification[], chart: Partial<Record<AccountKind, ChartAccount>>): Pick<DayClose, 'totals' | 'unmapped'> {
  const totals = new Map<string, { currency: string; debit: number; credit: number }>();
  const unmapped = new Set<AccountKind>();
  for (const v of verifications) {
    const t = totals.get(v.currency) ?? { currency: v.currency, debit: 0, credit: 0 };
    for (const l of v.lines) {
      t.debit += l.debit;
      t.credit += l.credit;
      if (!chart[l.account]) unmapped.add(l.account);
    }
    totals.set(v.currency, t);
  }
  return { totals: [...totals.values()].sort((a, b) => (a.currency < b.currency ? -1 : 1)), unmapped: [...unmapped].sort() };
}
