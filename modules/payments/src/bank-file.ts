/**
 * The bank file adapter (ADR 0017, ADR 0040 punkt 12): the bank's ISO 20022
 * notification of credits, camt.054 (BankToCustomerDebitCreditNotification),
 * read into payments. Works with every bank that gives camt.054, e.g. for a
 * bankgiro with OCR or an account with RF references.
 *
 * A file is uploaded by a signed-in person or integration (POST
 * /v1/payment-files), never through the open notification route: a bank file
 * has no signature of its own.
 *
 * What is read, by the message definition at iso20022.org:
 *   Document/BkToCstmrDbtCdtNtfctn/Ntfctn: the account (Acct/Id/IBAN or Othr/Id)
 *     Ntry: a booked credit (CdtDbtInd CRDT, Sts BOOK), its booking date (BookgDt/Dt)
 *       NtryDtls/TxDtls: one payment each, with its amount, the bank's reference
 *         (Refs/AcctSvcrRef) and the payer's structured reference
 *         (RmtInf/Strd/CdtrRefInf/Ref, the OCR or RF).
 * Debits (DBIT) and entries not booked are left out: they are the payouts'
 * confirmations (steg 7b) or not yet money.
 */
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import type { Timestamp } from '@petvold/common';
import { ProviderNotificationError, type PaymentProvider, type ProviderCapability, type ProviderNotification, type RawNotification } from './index.ts';

/** One of the insurer's accounts the bank reports on. */
export interface BankAccount {
  /** The IBAN, or the bankgiro or account number as the bank writes it in Acct/Id/Othr/Id. Compared without spaces and dashes. */
  id: string;
  market: string;
  currency: string;
}

/** Digits after the decimal point. Petvold's currencies have two. */
const DECIMALS: Record<string, number> = { JPY: 0, ISK: 0 };

/** "412.00" in SEK as 41200. null if it is not a plain decimal with at most the currency's digits. Pure. */
export function minorUnits(text: string, currency: string): number | null {
  const d = DECIMALS[currency] ?? 2;
  const m = /^(\d{1,15})(?:\.(\d+))?$/.exec(text.trim());
  if (!m || (m[2]?.length ?? 0) > d) return null;
  return Number(m[1]) * 10 ** d + Number((m[2] ?? '').padEnd(d, '0') || 0);
}

const compact = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  // Values stay text: an OCR number must keep its leading zeros.
  parseTagValue: false,
  parseAttributeValue: false,
  // No entities from a DOCTYPE: a bank file has none, and they are a way to attack a parser.
  processEntities: false,
  isArray: (name) => ['Ntfctn', 'Ntry', 'NtryDtls', 'TxDtls', 'Strd', 'Ustrd', 'CdtrRefInf'].includes(name),
});

type Node = Record<string, unknown>;
const obj = (v: unknown): Node => (v && typeof v === 'object' ? (v as Node) : {});
const arr = (v: unknown): Node[] => (Array.isArray(v) ? v.map(obj) : v === undefined ? [] : [obj(v)]);
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim() : v && typeof v === 'object' && typeof (v as Node)['#text'] === 'string' ? ((v as Node)['#text'] as string).trim() : undefined);

/** The payer's reference: the first structured creditor reference, letters and digits only. */
function referenceOf(tx: Node): string | null {
  for (const s of arr(obj(tx.RmtInf).Strd)) {
    for (const c of arr(s.CdtrRefInf)) {
      const r = text(c.Ref)?.replace(/\s/g, '');
      if (r && /^[A-Za-z0-9]{1,35}$/.test(r)) return r;
    }
  }
  return null;
}

/** The payment's amount: on the transaction (Amt, or AmtDtls/TxAmt/Amt), else the entry's. */
function amountOf(tx: Node, entry: Node): unknown {
  return [tx.Amt, obj(obj(tx.AmtDtls).TxAmt).Amt, entry.Amt].find((a) => text(a) !== undefined);
}

/** An entry's status: Sts is a code in camt.054.001.02 and Sts/Cd from .001.08. */
const statusOf = (e: Node) => text(e.Sts) ?? text(obj(e.Sts).Cd);

/**
 * The credits in a camt.054 file as payments. Throws ProviderNotificationError
 * when the file is not camt.054, an account is not the insurer's, or an amount
 * is not readable: the whole file is refused, so it can be sent again when
 * corrected. Pure.
 */
export function parseCamt054(xml: string, accounts: readonly BankAccount[]): ProviderNotification[] {
  const bad = (m: string) => new ProviderNotificationError('invalid', m);
  let doc: Node;
  try {
    doc = obj(parser.parse(xml, true));
  } catch (e) {
    throw bad(`The file is not well-formed XML: ${(e as Error).message}`);
  }
  const root = obj(obj(doc.Document).BkToCstmrDbtCdtNtfctn);
  if (!Object.keys(root).length) throw bad('The file is not a camt.054 notification (BkToCstmrDbtCdtNtfctn)');
  const out: ProviderNotification[] = [];
  for (const [ni, n] of arr(root.Ntfctn).entries()) {
    const id = obj(obj(n.Acct).Id);
    const accountId = text(id.IBAN) ?? text(obj(id.Othr).Id);
    const account = accountId ? accounts.find((a) => compact(a.id) === compact(accountId)) : undefined;
    if (!account) throw bad(`Notification ${ni + 1} is for account ${accountId ?? '(none)'}, which is not one of the insurer's`);
    const notificationId = text(n.Id) ?? `ntf${ni + 1}`;
    for (const [ei, e] of arr(n.Ntry).entries()) {
      if (text(e.CdtDbtInd) !== 'CRDT' || statusOf(e) !== 'BOOK') continue;
      const bookedOn = text(obj(e.BookgDt).Dt) ?? text(obj(e.BookgDt).DtTm)?.slice(0, 10);
      if (!bookedOn) throw bad(`Entry ${ei + 1} has no booking date`);
      const entryRef = text(e.AcctSvcrRef) ?? text(e.NtryRef) ?? `${notificationId}/${ei + 1}`;
      const txs = arr(e.NtryDtls).flatMap((d) => arr(d.TxDtls));
      // An entry without details is one payment.
      for (const [ti, tx] of (txs.length ? txs : [e]).entries()) {
        const amt = amountOf(tx, e);
        const currency = (obj(amt)['@Ccy'] as string | undefined) ?? account.currency;
        if (currency !== account.currency) throw bad(`Entry ${entryRef} is in ${currency}, the account in ${account.currency}`);
        const amount = minorUnits(text(amt) ?? '', currency);
        if (amount === null || amount <= 0) throw bad(`Entry ${entryRef} has an amount that cannot be read: ${text(amt) ?? '(none)'}`);
        const txRef = text(obj(tx.Refs).AcctSvcrRef) ?? (txs.length > 1 ? `${entryRef}#${ti + 1}` : entryRef);
        out.push({ kind: 'payment.received', providerRef: txRef, market: account.market, currency, amount, reference: referenceOf(tx), bookedOn });
      }
    }
  }
  return out;
}

/** The SHA-256 of a file, lowercase hex: the same file read twice has the same. */
export const fileChecksum = (body: string): string => createHash('sha256').update(body, 'utf8').digest('hex');

export class BankFileProvider implements PaymentProvider {
  readonly id = 'bank-file';
  /** Files come through POST /v1/payment-files, never through the open notification route. */
  readonly uploadOnly = true;

  constructor(private readonly o: { accounts: BankAccount[] }) {
    if (!o.accounts.length) throw new Error('The bank file adapter needs at least one account');
  }

  capabilities(): ProviderCapability[] {
    return this.o.accounts.map((a) => ({ market: a.market, currency: a.currency, kind: 'incoming' as const }));
  }

  async parseNotification(raw: RawNotification, _now: Timestamp): Promise<ProviderNotification[]> {
    return parseCamt054(raw.body, this.o.accounts);
  }
}

/**
 * The accounts from the environment: PETVOLD_BANK_FILE_ACCOUNTS, e.g.
 * "SE:SEK:5050-1055,FI:EUR:FI2112345600000785" (market, currency and the
 * account as the bank writes it). null without it.
 */
export function bankFileFromEnv(env: Record<string, string | undefined>): { accounts: BankAccount[] } | null {
  const v = env.PETVOLD_BANK_FILE_ACCOUNTS?.trim();
  if (!v) return null;
  const accounts = v.split(',').map((part) => {
    const [market, currency, ...rest] = part.trim().split(':');
    const id = rest.join(':');
    if (!/^[A-Z]{2}$/.test(market ?? '') || !/^[A-Z]{3}$/.test(currency ?? '') || !id) {
      throw new Error(`PETVOLD_BANK_FILE_ACCOUNTS: "${part}" is not market:currency:account, e.g. SE:SEK:5050-1055`);
    }
    return { market: market!, currency: currency!, id };
  });
  return { accounts };
}
