/**
 * Unpaid premium (ADR 0040, punkt 7): a reminder when an invoice is overdue,
 * and if that does not help, notice of cancellation of the policies on it.
 * The cancellation takes effect after the market's notice period (in Sweden
 * fourteen days, FAL 5 kap. 2 §) unless the premium is paid before: then it
 * has no effect, and billing reverses it.
 *
 * What was done to an invoice is kept as steps that never change.
 */
import { addDays } from '@petvold/common';
import type { ISODate, Timestamp } from '@petvold/common';

/** The days of unpaid premium, per market. A later step needs the earlier one. */
export interface DunningRules {
  /** Days after the due date that an open invoice gets a reminder. */
  reminderAfterDays: number;
  /** Days after the due date that the policies on a still open invoice get notice of cancellation. Never sooner after the reminder than the gap between the two. */
  cancellationNoticeAfterDays: number;
}

/** A policy given notice of cancellation for an unpaid invoice. */
export interface NoticedCancellation {
  policyId: string;
  /** The policy module's cancellation transaction. */
  transactionId: string;
  /** The day it takes effect if the premium is not paid before. */
  effectiveDate: ISODate;
}

export type DunningStep =
  | { step: 'reminded'; on: ISODate; at: Timestamp; by: string }
  | {
      step: 'cancellation-noticed';
      on: ISODate;
      at: Timestamp;
      by: string;
      cancellations: NoticedCancellation[];
      /** Policies that could not be given notice, e.g. already cancelled, with why. */
      skipped: { policyId: string; reason: string }[];
    }
  /** The invoice was paid before the cancellation took effect: reversed, by law without effect. */
  | { step: 'cancellation-voided'; on: ISODate; at: Timestamp; by: string; policyId: string; transactionId: string }
  /** Paid in time, but the policy module could not reverse it, e.g. something happened to the policy since: a person must. */
  | { step: 'cancellation-void-failed'; on: ISODate; at: Timestamp; by: string; policyId: string; transactionId: string; reason: string };

/**
 * What the dunning run does to an open invoice on a day: remind, give notice
 * of cancellation, or nothing. Pure.
 *
 * - A reminder when the invoice has been due reminderAfterDays.
 * - Notice when it has been due cancellationNoticeAfterDays and was reminded,
 *   and never sooner after the reminder than the gap between the two, so a late
 *   reminder still leaves the customer the same time to pay.
 */
export function nextDunningAction(invoice: { dueDate: ISODate; open: number }, steps: readonly DunningStep[], onDate: ISODate, rules: DunningRules): 'remind' | 'notice' | null {
  if (invoice.open <= 0) return null;
  const reminded = steps.find((s) => s.step === 'reminded');
  if (!reminded) return onDate >= addDays(invoice.dueDate, rules.reminderAfterDays) ? 'remind' : null;
  if (steps.some((s) => s.step === 'cancellation-noticed')) return null;
  const gap = rules.cancellationNoticeAfterDays - rules.reminderAfterDays;
  const from = maxDate(addDays(invoice.dueDate, rules.cancellationNoticeAfterDays), addDays(reminded.on, gap));
  return onDate >= from ? 'notice' : null;
}

/**
 * The noticed cancellations a payment on a day voids: those not yet in force,
 * and not already voided or failed. A payment on the effective date is too
 * late. Pure.
 */
export function cancellationsToVoid(steps: readonly DunningStep[], paidOn: ISODate): NoticedCancellation[] {
  const done = new Set(steps.flatMap((s) => (s.step === 'cancellation-voided' || s.step === 'cancellation-void-failed' ? [s.transactionId] : [])));
  return steps.flatMap((s) => (s.step === 'cancellation-noticed' ? s.cancellations : [])).filter((c) => paidOn < c.effectiveDate && !done.has(c.transactionId));
}

const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);
