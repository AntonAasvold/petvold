/**
 * Requests for information (ADR 0036): the dates of a new request, and what the
 * requests say about the claim. Pure functions, used by the service and the stores.
 */
import { addDays } from '@petvold/common';
import {
  DEFAULT_INFORMATION_REQUEST_RULES,
  type ISODate,
  type InformationRequest,
  type InformationRequestRules,
  type Timestamp,
} from './types.ts';

/** The longest a handler may give the recipient, in days. */
export const MAX_INFORMATION_DAYS = 365;

/**
 * The reminder day and the due date of a request made on `onDate`. The due
 * date is the handler's if given, else from the rules. A reminder that would
 * fall on or after the due date is left out.
 */
export function informationDates(
  onDate: ISODate,
  rules: InformationRequestRules | undefined,
  dueDate?: ISODate,
): { dueDate: ISODate; remindOn?: ISODate } {
  const r = rules ?? DEFAULT_INFORMATION_REQUEST_RULES;
  const due = dueDate ?? addDays(onDate, r.expiresAfterDays);
  const remindOn = addDays(onDate, r.reminderAfterDays);
  return { dueDate: due, ...(remindOn < due ? { remindOn } : {}) };
}

const later = (a: Timestamp, b: Timestamp) => (Date.parse(b) > Date.parse(a) ? b : a);

/**
 * When the basis was complete, for FAL 7 kap. 1 § (ADR 0036): when the claim was
 * received, or later, when a request was answered (the time the information came
 * in) or expired (the handler then decides on what there is). A cancelled
 * request was not needed and does not move it. undefined while a request is open.
 */
export function basisCompleteAt(receivedAt: Timestamp, requests: readonly InformationRequest[]): Timestamp | undefined {
  if (requests.some((r) => r.status === 'open')) return undefined;
  let at = receivedAt;
  for (const r of requests) {
    if (r.status === 'answered') at = later(at, r.receivedAt ?? r.closedAt!);
    if (r.status === 'expired') at = later(at, r.closedAt!);
  }
  return at;
}

/** The latest request that was not cancelled expired without an answer: "the information never came in". */
export function informationMissing(requests: readonly InformationRequest[]): boolean {
  const relevant = requests.filter((r) => r.status !== 'cancelled');
  const latest = relevant.reduce<InformationRequest | undefined>((a, r) => (!a || r.requestedAt >= a.requestedAt ? r : a), undefined);
  return latest?.status === 'expired';
}

/** Whole days from `from` to `to`, rounded down; at least 0. */
export function daysBetween(from: Timestamp, to: Timestamp): number {
  return Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000));
}

/** What the daily run does with an open request on `onDate`: remind, expire or nothing. */
export function dueAction(r: InformationRequest, onDate: ISODate): 'remind' | 'expire' | null {
  if (r.status !== 'open') return null;
  if (r.dueDate < onDate) return 'expire';
  if (r.remindOn && r.remindOn <= onDate && !r.remindedAt) return 'remind';
  return null;
}
