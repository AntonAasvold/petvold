/**
 * A claim's history as events, newest first: received, decisions, proposals
 * for approval and requests for review. Pure; the view adds text. The event
 * names are the ones the API and webhooks use, so a handler and a developer
 * see the same thing (docs/teknik/designsystem.md, "Visa systemet").
 */

export interface HistoryInput {
  claim: { receivedAt: string; channel: string };
  decisions: { seq: number; outcome: string; payout: number; decidedBy: string; decidedAt: string; automated: boolean; reason?: string }[];
  proposals: { id: string; outcome: string; payout: number; proposedBy: string; proposedAt: string; status: string; closedBy?: string; closedAt?: string; returnReason?: string }[];
  reviews: { id: string; decisionSeq: number; requestedAt: string; closedAt?: string }[];
  closure?: { id: string; kind: 'withdrawn' | 'dismissed'; reasonCode?: string; reason: string; duplicateOf?: string; closedBy: string; closedAt: string };
}

export type HistoryEvent =
  | { type: 'claim.received'; at: string; channel: string }
  | { type: 'claim.decided'; at: string; seq: number; outcome: string; payout: number; by: string; automated: boolean; reason?: string }
  | { type: 'proposal.created'; at: string; id: string; outcome: string; payout: number; by: string; open: boolean }
  | { type: 'proposal.returned'; at: string; id: string; by: string; reason?: string }
  | { type: 'review.requested'; at: string; id: string; seq: number; open: boolean }
  | { type: 'claim.withdrawn' | 'claim.dismissed'; at: string; id: string; by: string; reason: string; reasonCode?: string; duplicateOf?: string };

export function claimHistory(i: HistoryInput): HistoryEvent[] {
  const out: HistoryEvent[] = [{ type: 'claim.received', at: i.claim.receivedAt, channel: i.claim.channel }];
  for (const d of i.decisions) {
    out.push({ type: 'claim.decided', at: d.decidedAt, seq: d.seq, outcome: d.outcome, payout: d.payout, by: d.decidedBy, automated: d.automated, ...(d.reason ? { reason: d.reason } : {}) });
  }
  for (const p of i.proposals) {
    out.push({ type: 'proposal.created', at: p.proposedAt, id: p.id, outcome: p.outcome, payout: p.payout, by: p.proposedBy, open: p.status === 'open' });
    if (p.status === 'returned' && p.closedAt) out.push({ type: 'proposal.returned', at: p.closedAt, id: p.id, by: p.closedBy ?? '', ...(p.returnReason ? { reason: p.returnReason } : {}) });
  }
  for (const r of i.reviews) out.push({ type: 'review.requested', at: r.requestedAt, id: r.id, seq: r.decisionSeq, open: !r.closedAt });
  const k = i.closure;
  if (k) {
    out.push({
      type: k.kind === 'withdrawn' ? 'claim.withdrawn' : 'claim.dismissed',
      at: k.closedAt,
      id: k.id,
      by: k.closedBy,
      reason: k.reason,
      ...(k.reasonCode ? { reasonCode: k.reasonCode } : {}),
      ...(k.duplicateOf ? { duplicateOf: k.duplicateOf } : {}),
    });
  }
  // Newest first; at the same moment, the later kind of event first (a decision after its proposal).
  const order = ['claim.received', 'proposal.created', 'review.requested', 'proposal.returned', 'claim.decided', 'claim.withdrawn', 'claim.dismissed'];
  return out.sort((a, b) => b.at.localeCompare(a.at) || order.indexOf(b.type) - order.indexOf(a.type));
}
