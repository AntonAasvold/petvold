/**
 * A claim's history as events, newest first: received, decisions, proposals
 * for approval, requests for review and requests for information. Pure; the view adds text. The event
 * names are the ones the API and webhooks use, so a handler and a developer
 * see the same thing (docs/teknik/designsystem.md, "Visa systemet").
 */

export interface HistoryInput {
  claim: { receivedAt: string; channel: string };
  decisions: { seq: number; outcome: string; payout: number; decidedBy: string; decidedAt: string; automated: boolean; reason?: string; claimRevision?: number }[];
  proposals: { id: string; outcome: string; payout: number; proposedBy: string; proposedAt: string; status: string; closedBy?: string; closedAt?: string; returnReason?: string }[];
  reviews: { id: string; decisionSeq: number; requestedAt: string; closedAt?: string }[];
  closure?: { id: string; kind: 'withdrawn' | 'dismissed'; reasonCode?: string; reason: string; duplicateOf?: string; closedBy: string; closedAt: string };
  /** Corrections (ADR 0036): the claim's revisions after the first. */
  corrections?: { id: string; revision: number; fields: string[]; reason: string; correctedBy: string; correctedAt: string; reopens: boolean }[];
  /** Notices to the customer about the claim (ADR 0036). */
  notices?: { id: string; type: string; createdAt: string; status: string }[];
  /** Attachments (ADR 0036). */
  attachments?: { id: string; kind: string; addedBy: string; addedAt: string; replaces?: string }[];
  /** Requests for information (ADR 0036). */
  information?: {
    id: string;
    recipient: string;
    items: string[];
    requestedBy: string;
    requestedAt: string;
    status: string;
    remindedAt?: string;
    receivedAt?: string;
    closedBy?: string;
    closedAt?: string;
    closingNote?: string;
  }[];
}

/** What happened to a request for information, by the event names the API and webhooks use. */
export type InformationEventType = 'claim.information_requested' | 'claim.information_reminded' | 'claim.information_received' | 'claim.information_expired' | 'claim.information_cancelled';

export type HistoryEvent =
  | { type: 'claim.received'; at: string; channel: string }
  | { type: 'claim.decided'; at: string; seq: number; outcome: string; payout: number; by: string; automated: boolean; reason?: string; revision: number }
  | { type: 'proposal.created'; at: string; id: string; outcome: string; payout: number; by: string; open: boolean }
  | { type: 'proposal.returned'; at: string; id: string; by: string; reason?: string }
  | { type: 'review.requested'; at: string; id: string; seq: number; open: boolean }
  | { type: 'claim.withdrawn' | 'claim.dismissed'; at: string; id: string; by: string; reason: string; reasonCode?: string; duplicateOf?: string }
  | { type: 'notice.created'; at: string; id: string; noticeType: string; status: string }
  | { type: 'claim.attachment_added'; at: string; id: string; by: string; kind: string; replaces?: string }
  | { type: 'claim.corrected'; at: string; id: string; by: string; revision: number; fields: string[]; reason: string; reopens: boolean }
  | { type: InformationEventType; at: string; id: string; by: string; recipient: string; items: string[]; open: boolean; note?: string };

export function claimHistory(i: HistoryInput): HistoryEvent[] {
  const out: HistoryEvent[] = [{ type: 'claim.received', at: i.claim.receivedAt, channel: i.claim.channel }];
  for (const d of i.decisions) {
    out.push({ type: 'claim.decided', at: d.decidedAt, seq: d.seq, outcome: d.outcome, payout: d.payout, by: d.decidedBy, automated: d.automated, ...(d.reason ? { reason: d.reason } : {}), revision: d.claimRevision ?? 1 });
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
  for (const n of i.notices ?? []) out.push({ type: 'notice.created', at: n.createdAt, id: n.id, noticeType: n.type, status: n.status });
  for (const a of i.attachments ?? []) {
    out.push({ type: 'claim.attachment_added', at: a.addedAt, id: a.id, by: a.addedBy, kind: a.kind, ...(a.replaces ? { replaces: a.replaces } : {}) });
  }
  for (const k of i.corrections ?? []) {
    out.push({ type: 'claim.corrected', at: k.correctedAt, id: k.id, by: k.correctedBy, revision: k.revision, fields: k.fields, reason: k.reason, reopens: k.reopens });
  }
  for (const r of i.information ?? []) {
    const base = { id: r.id, recipient: r.recipient, items: r.items };
    out.push({ type: 'claim.information_requested', at: r.requestedAt, by: r.requestedBy, ...base, open: r.status === 'open' });
    if (r.remindedAt) out.push({ type: 'claim.information_reminded', at: r.remindedAt, by: 'system', ...base, open: false });
    if (r.closedAt) {
      const type = r.status === 'answered' ? 'claim.information_received' : r.status === 'expired' ? 'claim.information_expired' : 'claim.information_cancelled';
      out.push({ type, at: r.closedAt, by: r.closedBy ?? '', ...base, open: false, ...(r.closingNote ? { note: r.closingNote } : {}) });
    }
  }
  // Newest first; at the same moment, the later kind of event first (a decision after its proposal).
  const order = [
    'claim.received',
    'claim.information_requested',
    'claim.information_reminded',
    'claim.information_expired',
    'claim.information_received',
    'claim.information_cancelled',
    'claim.attachment_added',
    'claim.corrected',
    'proposal.created',
    'review.requested',
    'proposal.returned',
    'claim.decided',
    'notice.created',
    'claim.withdrawn',
    'claim.dismissed',
  ];
  return out.sort((a, b) => b.at.localeCompare(a.at) || order.indexOf(b.type) - order.indexOf(a.type));
}
