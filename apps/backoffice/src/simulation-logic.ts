/**
 * Simulating a rule set version against stored decisions in the back office
 * (ADR 0018): the period as the API wants it, and the result in words. Pure,
 * so it is tested without a browser.
 */

/** The days as the API's [from, to): from the first day's start to the day after the last, in UTC. Or the problem. */
export function simulationRange(fromDay: string, toDay: string): { from: string; to: string } | 'from' | 'to' {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(fromDay)) return 'from';
  if (!day.test(toDay) || toDay < fromDay) return 'to';
  const next = new Date(`${toDay}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { from: `${fromDay}T00:00:00.000Z`, to: next.toISOString() };
}

/** The last 90 days up to today, as days. Pure, given today. */
export function defaultDays(today: string): { from: string; to: string } {
  const d = new Date(`${today}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 90);
  return { from: d.toISOString().slice(0, 10), to: today };
}

/** What changed in one decision: the outcome, the handling or the payout, as keys for labels. Pure. */
export function changes(stored: { proposedOutcome: string; mode: string; payout: number }, simulated: { proposedOutcome: string; mode: string; payout: number }): ('outcome' | 'mode' | 'payout')[] {
  const out: ('outcome' | 'mode' | 'payout')[] = [];
  if (stored.proposedOutcome !== simulated.proposedOutcome) out.push('outcome');
  if (stored.mode !== simulated.mode) out.push('mode');
  if (stored.payout !== simulated.payout) out.push('payout');
  return out;
}
