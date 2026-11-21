/**
 * Billing arithmetic (ADR 0040): the premium plan for a term, how a payment is
 * allocated to what is owed, how a premium change is spread over the term, and
 * what a cancellation means against what is already invoiced and paid.
 *
 * No I/O, no framework, no text for users. All amounts are integers in minor
 * units of one currency. The same input always gives the same result, and the
 * plan carries a hash of its input and its model, so a saved plan can be
 * recomputed and compared (ADR 0018).
 */
import { createHash } from 'node:crypto';

export type ISODate = string;

/** The calculation models a premium plan can have. A change in the result is a new model; old ones stay. */
export const PLAN_MODELS = ['premium-plan.v1'] as const;
export type PlanModel = (typeof PLAN_MODELS)[number];

export const PAYMENT_INTERVALS = ['year', 'half-year', 'quarter', 'month'] as const;
export type PaymentInterval = (typeof PAYMENT_INTERVALS)[number];

/** Months per interval. */
export const INTERVAL_MONTHS: Readonly<Record<PaymentInterval, number>> = { year: 12, 'half-year': 6, quarter: 3, month: 1 };

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingError';
  }
}

export interface PlanInput {
  currency: string;
  /** The term's first day. */
  termStart: ISODate;
  /** The term's last day, exclusive. */
  termEnd: ISODate;
  /** The premium for the whole term, without tax. */
  termPremium: number;
  interval: PaymentInterval;
  /** A fee per installment, from the product. Only taken when the interval is shorter than a year. */
  installmentFee?: number;
  /** Tax on the premium from the market profile, in basis points (10 000 = 100 %). */
  premiumTaxBp?: number;
  /**
   * The insurance's first premium (in Sweden FAL 5 kap. 1 §): due payWithinDays
   * after the notice was sent, but never before the period starts. Omitted at
   * renewal, where every installment is due on its period's first day.
   */
  firstPremium?: { noticeSentOn: ISODate; payWithinDays: number };
}

export interface Installment {
  /** 1, 2, 3 … in period order. */
  seq: number;
  periodStart: ISODate;
  /** Exclusive. */
  periodEnd: ISODate;
  dueDate: ISODate;
  premium: number;
  tax: number;
  fee: number;
  /** premium + tax + fee. */
  amount: number;
}

export interface PremiumPlan {
  model: PlanModel;
  currency: string;
  termStart: ISODate;
  termEnd: ISODate;
  interval: PaymentInterval;
  termPremium: number;
  premiumTaxBp: number;
  /** Tax on termPremium, rounded half up once. */
  tax: number;
  fees: number;
  /** termPremium + tax + fees. */
  total: number;
  installments: Installment[];
  /** sha256 of the model and the input, canonical JSON. */
  inputHash: string;
}

/**
 * The premium plan for a term (ADR 0040, punkt 3).
 *
 * Periods start on the term's first day and step by the interval in calendar
 * months, always counted from the term start so a day 31 never drifts
 * (31 Jan, 28 Feb, 31 Mar …). Only the last period can be shorter, when the
 * term does not end on a boundary.
 *
 * Amounts: a short last period gets its share per day, rounded down. The rest
 * is divided equally over the full periods, and what is left after the
 * division goes on the first installment. The tax is split the same way, so
 * the installments always add up to exactly the term's premium and tax.
 */
export function premiumPlan(input: PlanInput): PremiumPlan {
  validatePlanInput(input);
  const months = INTERVAL_MONTHS[input.interval];
  const periods: { start: ISODate; end: ISODate }[] = [];
  for (let k = 0; ; k++) {
    const start = addMonths(input.termStart, k * months);
    if (start >= input.termEnd) break;
    const next = addMonths(input.termStart, (k + 1) * months);
    periods.push({ start, end: next < input.termEnd ? next : input.termEnd });
  }
  const last = periods[periods.length - 1]!;
  const lastIsShort = periods.length > 1 && last.end !== addMonths(input.termStart, periods.length * months);
  const termDays = daysBetween(input.termStart, input.termEnd);
  const shortDays = lastIsShort ? daysBetween(last.start, last.end) : 0;

  const taxBp = input.premiumTaxBp ?? 0;
  const tax = applyBpHalfUp(input.termPremium, taxBp);
  const premiums = split(input.termPremium, periods.length, shortDays, termDays);
  const taxes = split(tax, periods.length, shortDays, termDays);
  const fee = input.interval === 'year' ? 0 : (input.installmentFee ?? 0);

  const installments = periods.map((p, i): Installment => {
    const premium = premiums[i]!;
    const t = taxes[i]!;
    const due = i === 0 && input.firstPremium ? maxDate(p.start, addDays(input.firstPremium.noticeSentOn, input.firstPremium.payWithinDays)) : p.start;
    return { seq: i + 1, periodStart: p.start, periodEnd: p.end, dueDate: due, premium, tax: t, fee, amount: premium + t + fee };
  });
  const fees = fee * installments.length;
  const model: PlanModel = 'premium-plan.v1';
  return {
    model,
    currency: input.currency,
    termStart: input.termStart,
    termEnd: input.termEnd,
    interval: input.interval,
    termPremium: input.termPremium,
    premiumTaxBp: taxBp,
    tax,
    fees,
    total: input.termPremium + tax + fees,
    installments,
    inputHash: hashOf({ model, input }),
  };
}

/** Splits total over n periods where the last may be short (shortDays > 0). See premiumPlan. */
function split(total: number, n: number, shortDays: number, termDays: number): number[] {
  const shortShare = shortDays > 0 ? Number((BigInt(total) * BigInt(shortDays)) / BigInt(termDays)) : 0;
  const full = shortDays > 0 ? n - 1 : n;
  const rest = total - shortShare;
  const each = Math.floor(rest / full);
  const out = Array.from({ length: full }, () => each);
  out[0]! += rest - each * full;
  if (shortDays > 0) out.push(shortShare);
  return out;
}

function validatePlanInput(i: PlanInput): void {
  assertDate(i.termStart, 'termStart');
  assertDate(i.termEnd, 'termEnd');
  if (i.termEnd <= i.termStart) throw new BillingError('termEnd: must be after termStart');
  assertAmount(i.termPremium, 'termPremium');
  if (!PAYMENT_INTERVALS.includes(i.interval)) throw new BillingError(`interval: unknown '${i.interval}'`);
  if (i.installmentFee !== undefined) assertAmount(i.installmentFee, 'installmentFee');
  if (i.premiumTaxBp !== undefined) assertAmount(i.premiumTaxBp, 'premiumTaxBp');
  if (!/^[A-Z]{3}$/.test(i.currency)) throw new BillingError(`currency: invalid '${i.currency}'`);
  if (i.firstPremium) {
    assertDate(i.firstPremium.noticeSentOn, 'firstPremium.noticeSentOn');
    assertAmount(i.firstPremium.payWithinDays, 'firstPremium.payWithinDays');
  }
}

/** Recomputes a saved plan from its input and says whether the result is the same (ADR 0018). */
export function replayPlan(input: PlanInput, saved: PremiumPlan): { same: boolean; recomputed: PremiumPlan } {
  if (!PLAN_MODELS.includes(saved.model)) throw new BillingError(`model: unknown '${saved.model}'`);
  const recomputed = premiumPlan(input);
  return { same: canonicalJson(recomputed) === canonicalJson(saved), recomputed };
}

// --- Allocation of a payment (ADR 0040, punkt 6) ---

export interface OpenItem {
  id: string;
  dueDate: ISODate;
  /** What is still unpaid. */
  open: number;
}

export interface PaymentAllocation {
  allocations: { id: string; amount: number }[];
  /** What is left after every item is paid: a credit balance for the payer. */
  unallocated: number;
}

/**
 * Allocates a payment to open items, oldest due date first (ties by id). An
 * item never gets more than is open on it, and what is left over is returned
 * as unallocated.
 */
export function allocatePayment(amount: number, items: readonly OpenItem[]): PaymentAllocation {
  assertAmount(amount, 'amount');
  for (const it of items) {
    assertDate(it.dueDate, `items[${it.id}].dueDate`);
    assertAmount(it.open, `items[${it.id}].open`);
  }
  assertUniqueIds(items);
  let left = amount;
  const allocations: { id: string; amount: number }[] = [];
  for (const it of [...items].sort(byDueThenId)) {
    if (left === 0) break;
    const take = Math.min(left, it.open);
    if (take > 0) allocations.push({ id: it.id, amount: take });
    left -= take;
  }
  return { allocations, unallocated: left };
}

// --- A premium change during the term (ADR 0040, punkt 4) ---

export type AdjustmentOutcome =
  | { kind: 'none' }
  /** Added to the installments not yet invoiced, equally, the rest on the first. */
  | { kind: 'spread'; parts: { seq: number; amount: number }[] }
  /** Nothing left to add to: its own invoice. */
  | { kind: 'separate'; amount: number }
  /** A negative adjustment: a credit to the payer. */
  | { kind: 'credit'; amount: number };

/**
 * Where a premium adjustment from policy.changed goes. Positive: spread over
 * the installments not yet invoiced, or its own invoice if there are none.
 * Negative: a credit.
 */
export function distributeAdjustment(adjustment: number, uninvoicedSeqs: readonly number[]): AdjustmentOutcome {
  if (!Number.isSafeInteger(adjustment)) throw new BillingError('adjustment: must be an integer in minor units');
  if (adjustment === 0) return { kind: 'none' };
  if (adjustment < 0) return { kind: 'credit', amount: -adjustment };
  if (uninvoicedSeqs.length === 0) return { kind: 'separate', amount: adjustment };
  const seqs = [...new Set(uninvoicedSeqs)].sort((a, b) => a - b);
  const amounts = split(adjustment, seqs.length, 0, 1);
  return { kind: 'spread', parts: seqs.map((seq, i) => ({ seq, amount: amounts[i]! })) };
}

// --- Settlement at cancellation (ADR 0040, punkt 4) ---

export interface InstallmentState {
  seq: number;
  invoiced: boolean;
  /** Paid on this installment so far. Only an invoiced installment can be paid. */
  paid: number;
}

export interface CancellationInput {
  plan: PremiumPlan;
  /** One per installment in the plan. */
  states: readonly InstallmentState[];
  /** The premium back from policy.cancelled, without tax. */
  refund: number;
}

export interface CancellationSettlement {
  /** The term's premium after the cancellation. */
  newPremium: number;
  /** Tax on newPremium, rounded half up. */
  newTax: number;
  /** Fees on the installments already invoiced; the others are not taken. */
  fees: number;
  /** newPremium + newTax + fees: what the term costs in all. */
  newTotal: number;
  paid: number;
  /** Not invoiced: taken out of the plan. */
  removed: number[];
  /** Invoiced and still owed, oldest first. */
  kept: { seq: number; open: number }[];
  /** Invoiced but no longer owed: credited. */
  credited: { seq: number; amount: number }[];
  /** Owed beyond what is invoiced: a new charge. */
  newCharge: number;
  /** Paid beyond what the term costs: a credit balance for the payer. */
  creditBalance: number;
}

/**
 * What a cancellation means against what is invoiced and paid. The term's
 * premium is reduced by the refund and the tax is recomputed on what is left.
 * Installments not yet invoiced are removed. What is still owed stays on the
 * invoiced installments, oldest first, and the rest of them is credited. If
 * they are not enough, the difference is a new charge; if more is paid than
 * the term costs, the difference is a credit balance.
 *
 * Always: paid + kept + newCharge − creditBalance = newTotal.
 */
export function settleCancellation(input: CancellationInput): CancellationSettlement {
  const { plan, refund } = input;
  assertAmount(refund, 'refund');
  if (refund > plan.termPremium) throw new BillingError('refund: more than the term premium');
  const bySeq = new Map(input.states.map((s) => [s.seq, s]));
  if (bySeq.size !== input.states.length || bySeq.size !== plan.installments.length || plan.installments.some((i) => !bySeq.has(i.seq))) {
    throw new BillingError('states: must have exactly one state per installment in the plan');
  }
  for (const inst of plan.installments) {
    const s = bySeq.get(inst.seq)!;
    assertAmount(s.paid, `states[${s.seq}].paid`);
    if (s.paid > inst.amount) throw new BillingError(`states[${s.seq}].paid: more than the installment`);
    if (!s.invoiced && s.paid > 0) throw new BillingError(`states[${s.seq}].paid: an installment not invoiced cannot be paid`);
  }

  const newPremium = plan.termPremium - refund;
  const newTax = applyBpHalfUp(newPremium, plan.premiumTaxBp);
  const invoiced = plan.installments.filter((i) => bySeq.get(i.seq)!.invoiced);
  const fees = invoiced.reduce((s, i) => s + i.fee, 0);
  const newTotal = newPremium + newTax + fees;
  const paid = input.states.reduce((s, x) => s + x.paid, 0);

  let need = Math.max(0, newTotal - paid);
  const kept: { seq: number; open: number }[] = [];
  const credited: { seq: number; amount: number }[] = [];
  for (const inst of [...invoiced].sort((a, b) => (a.dueDate === b.dueDate ? a.seq - b.seq : a.dueDate < b.dueDate ? -1 : 1))) {
    const open = inst.amount - bySeq.get(inst.seq)!.paid;
    if (open === 0) continue;
    const keep = Math.min(open, need);
    need -= keep;
    if (keep > 0) kept.push({ seq: inst.seq, open: keep });
    if (open - keep > 0) credited.push({ seq: inst.seq, amount: open - keep });
  }
  return {
    newPremium,
    newTax,
    fees,
    newTotal,
    paid,
    removed: plan.installments.filter((i) => !bySeq.get(i.seq)!.invoiced).map((i) => i.seq),
    kept,
    credited,
    newCharge: need,
    creditBalance: Math.max(0, paid - newTotal),
  };
}

// --- Helpers ---

/** Rounds amount × bp / 10 000 half up. */
export function applyBpHalfUp(amount: number, bp: number): number {
  return Number((BigInt(amount) * BigInt(bp) * 2n + 10_000n) / 20_000n);
}

/** Adds calendar months; a day that does not exist in the target month becomes its last day. */
export function addMonths(d: ISODate, months: number): ISODate {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${String(ty).padStart(4, '0')}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function addDays(d: ISODate, days: number): ISODate {
  return new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Days from `from` to `to`, `to` exclusive. */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);
const byDueThenId = (a: OpenItem, b: OpenItem) => (a.dueDate === b.dueDate ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.dueDate < b.dueDate ? -1 : 1);

function assertDate(d: string, field: string): void {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (!ok) throw new BillingError(`${field}: invalid date '${d}', expected YYYY-MM-DD`);
}

function assertAmount(n: number, field: string): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new BillingError(`${field}: must be a non-negative integer`);
}

function assertUniqueIds(items: readonly OpenItem[]): void {
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new BillingError('items: ids must be unique');
}

function hashOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
