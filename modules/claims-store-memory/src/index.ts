import { StoreConflictError, accounts, basisCompleteAt, informationMissing } from '@petvold/claims-core';
import type {
  ClaimFilter,
  ClaimState,
  ClaimSummary,
  Claim,
  ClaimClosure,
  ClaimDecision,
  ClaimsEvent,
  ClaimsOutbox,
  ClaimsStore,
  OutboxEntry,
  DecisionCommit,
  DecisionEvidence,
  DeductiblePeriod,
  ISODate,
  LedgerJournal,
  LimitKey,
  MinorUnits,
  PolicyPort,
  PolicySnapshot,
  RulesPort,
  ReviewRequest,
  DecisionProposal,
  ClaimsRules,
  Clock,
  InformationRequest,
  InformationRequestStatus,
  MarketCode,
  ClaimCorrection,
  ClaimData,
  ClaimRevision,
  ClaimAttachment,
  IdGenerator,
  Timestamp,
} from '@petvold/claims-core';

/**
 * In-memory store with the same semantics as the Postgres schema: decisions
 * and journals are append-only, and every journal must balance.
 * For tests and local development.
 */
export class InMemoryClaimsStore implements ClaimsStore, ClaimsOutbox {
  private claims = new Map<string, Claim>();
  private numberSeries = new Map<number, number>();
  private closures = new Map<string, ClaimClosure>();
  private decisions: ClaimDecision[] = [];
  private evidence = new Map<string, DecisionEvidence>();
  private journals: LedgerJournal[] = [];
  private periods: DeductiblePeriod[] = [];
  private reviews: ReviewRequest[] = [];
  private proposals: DecisionProposal[] = [];
  private information: InformationRequest[] = [];
  private attachments: ClaimAttachment[] = [];
  /** Corrections per claim, revision 2 and on (ADR 0036). The claim itself stays as registered. */
  private corrections = new Map<string, { correction: ClaimCorrection; data: ClaimData }[]>();
  private outbox: Array<OutboxEntry & { publishedAt?: Timestamp }> = [];
  private outboxSeq = 0;

  async saveClaim(claim: Claim, events: ClaimsEvent[], journals: LedgerJournal[] = []) {
    if (this.claims.has(claim.id)) throw new StoreConflictError('claim_exists', `Claim ${claim.id} already exists`);
    for (const j of journals) {
      assertBalanced(j);
      if (j.claimId !== claim.id || j.sourceType !== 'claim_reserve' || j.sourceId !== claim.id) {
        throw new Error(`Journal ${j.id} does not reserve claim ${claim.id}`);
      }
    }
    this.claims.set(claim.id, structuredClone(claim));
    this.journals.push(...structuredClone(journals));
    this.appendEvents(events);
  }

  async getBalance(account: string): Promise<MinorUnits> {
    return this.journals
      .flatMap((j) => j.lines)
      .filter((l) => l.account === account)
      .reduce((s, l) => s + l.amount, 0);
  }

  async claimNoTaken(claimNo: string): Promise<boolean> {
    return [...this.claims.values()].some((c) => c.claimNo === claimNo);
  }

  async nextClaimNumber(year: number): Promise<number> {
    const next = (this.numberSeries.get(year) ?? 0) + 1;
    this.numberSeries.set(year, next);
    return next;
  }

  async getClaim(id: string) {
    const c = this.current(id);
    return c ? structuredClone(c) : null;
  }

  /** The claim with its latest revision's details. */
  private current(id: string): Claim | undefined {
    const c = this.claims.get(id);
    const last = this.corrections.get(id)?.at(-1);
    return c && last ? { ...c, ...last.data, revision: last.correction.revision } : c;
  }

  /** A correction after the latest decision reopened the claim for a person. */
  private reopened(claimId: string, latest: ClaimDecision | undefined): boolean {
    return !!latest && (this.corrections.get(claimId) ?? []).some((x) => x.correction.revision > (latest.claimRevision ?? 1) && x.correction.reopens);
  }

  async correctClaim(correction: ClaimCorrection, data: ClaimData, events: ClaimsEvent[]) {
    const c = this.current(correction.claimId);
    if (!c) throw new Error(`Claim ${correction.claimId} does not exist`);
    if (this.closures.has(correction.claimId)) throw new StoreConflictError('claim_closed', `Claim ${correction.claimId} is closed`);
    if ((c.revision ?? 1) !== correction.revision - 1) {
      throw new StoreConflictError('revision_changed', `Claim ${correction.claimId} is at revision ${c.revision ?? 1}`);
    }
    const list = this.corrections.get(correction.claimId) ?? [];
    list.push(structuredClone({ correction, data }));
    this.corrections.set(correction.claimId, list);
    this.appendEvents(events);
  }

  async saveAttachment(attachment: ClaimAttachment, events: ClaimsEvent[]) {
    if (!this.claims.has(attachment.claimId)) throw new Error(`Claim ${attachment.claimId} does not exist`);
    if (this.attachments.some((a) => a.id === attachment.id)) throw new Error(`Attachment ${attachment.id} already exists`);
    if (attachment.replaces !== undefined) {
      if (!this.attachments.some((a) => a.id === attachment.replaces && a.claimId === attachment.claimId)) {
        throw new Error(`Attachment ${attachment.replaces} is not on claim ${attachment.claimId}`);
      }
      if (this.attachments.some((a) => a.replaces === attachment.replaces)) {
        throw new StoreConflictError('attachment_replaced', `Attachment ${attachment.replaces} is replaced already`);
      }
    }
    if (attachment.informationRequestId !== undefined && !this.information.some((r) => r.id === attachment.informationRequestId && r.claimId === attachment.claimId)) {
      throw new Error(`Request ${attachment.informationRequestId} is not on claim ${attachment.claimId}`);
    }
    if (this.closures.has(attachment.claimId)) throw new StoreConflictError('claim_closed', `Claim ${attachment.claimId} is closed`);
    this.attachments.push(structuredClone(attachment));
    this.appendEvents(events);
  }

  async getAttachments(claimId: string) {
    return this.attachments
      .filter((a) => a.claimId === claimId)
      .sort((a, b) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : a.id < b.id ? -1 : 1))
      .map((a) => structuredClone(a));
  }

  async getRevisions(claimId: string): Promise<ClaimRevision[]> {
    const c = this.claims.get(claimId);
    if (!c) return [];
    const first: ClaimRevision = { revision: 1, data: { channel: c.channel, treatmentFrom: c.treatmentFrom, treatmentTo: c.treatmentTo, diagnosisCode: c.diagnosisCode, lines: c.lines } };
    return structuredClone([first, ...(this.corrections.get(claimId) ?? []).map((x) => ({ revision: x.correction.revision, data: x.data, correction: x.correction }))]);
  }

  async findDeductiblePeriod(animalId: string, group: string, onDate: ISODate, excludeClaimId?: string) {
    const hit = this.periods.find(
      (p) =>
        p.animalId === animalId &&
        p.diagnosisGroup === group &&
        p.validFrom <= onDate &&
        onDate < p.validTo &&
        p.openedByClaimId !== excludeClaimId,
    );
    return hit ? { ...hit } : null;
  }

  async getConsumed(limit: LimitKey, excludeClaimId?: string): Promise<MinorUnits> {
    const account = accounts.limitConsumed(limit);
    return this.journals
      .filter((j) => j.claimId !== excludeClaimId)
      .flatMap((j) => j.lines)
      .filter((l) => l.account === account)
      .reduce((s, l) => s + l.amount, 0);
  }

  async getDecisions(claimId: string) {
    return this.decisions
      .filter((d) => d.claimId === claimId)
      .sort((a, b) => a.seq - b.seq)
      .map((d) => structuredClone(d));
  }

  async latestDecisionsWithEvidence(from: Timestamp, to: Timestamp, limit: number) {
    const latest = new Map<string, ClaimDecision>();
    for (const d of this.decisions) if ((latest.get(d.claimId)?.seq ?? 0) < d.seq) latest.set(d.claimId, d);
    return [...latest.values()]
      .filter((d) => d.decidedAt >= from && d.decidedAt < to && this.evidence.has(d.id))
      .sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map((d) => ({ decision: structuredClone(d), evidence: structuredClone(this.evidence.get(d.id)!) }));
  }

  async listClaims(filter: ClaimFilter): Promise<ClaimSummary[]> {
    const out: ClaimSummary[] = [];
    for (const id of this.claims.keys()) {
      const c = this.current(id)!;
      if (filter.market && c.market !== filter.market) continue;
      if (filter.policyId && c.policyId !== filter.policyId) continue;
      if (filter.animalId && c.animalId !== filter.animalId) continue;
      if (filter.clinicId && c.clinicId !== filter.clinicId) continue;
      const latest = this.decisions.filter((d) => d.claimId === c.id).sort((a, b) => b.seq - a.seq)[0];
      const closure = this.closures.get(c.id);
      const requests = this.information.filter((r) => r.claimId === c.id);
      const state: ClaimState = closure
        ? closure.kind
        : this.proposals.some((p) => p.claimId === c.id && p.status === 'open')
        ? 'awaiting-approval'
        : requests.some((r) => r.status === 'open')
        ? 'awaiting-information'
        : this.reviews.some((r) => r.claimId === c.id && !r.closedAt)
          ? 'review-requested'
          : latest && !this.reopened(c.id, latest)
            ? 'decided'
            : 'awaiting-decision';
      if (filter.state && state !== filter.state) continue;
      const complete = basisCompleteAt(c.receivedAt, requests);
      out.push({
        id: c.id,
        claimNo: c.claimNo,
        policyId: c.policyId,
        animalId: c.animalId,
        market: c.market,
        currency: c.currency,
        channel: c.channel,
        ...(c.clinicId ? { clinicId: c.clinicId } : {}),
        treatmentFrom: c.treatmentFrom,
        diagnosisCode: c.diagnosisCode,
        receivedAt: c.receivedAt,
        state,
        ...(latest ? { latestDecision: { seq: latest.seq, outcome: latest.outcome, payout: latest.payout, decidedAt: latest.decidedAt } } : {}),
        ...(complete ? { basisCompleteAt: complete } : {}),
        ...(informationMissing(requests) ? { informationMissing: true } : {}),
      });
    }
    return structuredClone(out.sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.id < b.id ? -1 : 1)));
  }

  async claimActivity(policyId: string, from: ISODate, to: ISODate) {
    let open = false;
    let lastAt: string | undefined;
    for (const id of this.claims.keys()) {
      const c = this.current(id)!;
      if (c.policyId !== policyId || c.treatmentFrom < from || c.treatmentFrom >= to) continue;
      const decided = this.decisions.filter((d) => d.claimId === c.id);
      const closure = this.closures.get(c.id);
      const waiting = this.information.some((r) => r.claimId === c.id && r.status === 'open');
      const latest = decided.reduce<ClaimDecision | undefined>((a, d) => (!a || d.seq > a.seq ? d : a), undefined);
      if (!closure && (!decided.length || waiting || this.reopened(c.id, latest) || this.reviews.some((r) => r.claimId === c.id && !r.closedAt) || this.proposals.some((p) => p.claimId === c.id && p.status === 'open'))) open = true;
      for (const t of [c.receivedAt, ...decided.map((d) => d.decidedAt), ...(closure ? [closure.closedAt] : [])]) if (!lastAt || t > lastAt) lastAt = t;
    }
    return { open, ...(lastAt ? { lastAt } : {}) };
  }

  async claimsDecidedOnPolicyVersions(policyVersionIds: string[]) {
    const latest = new Map<string, ClaimDecision>();
    for (const d of this.decisions) if ((latest.get(d.claimId)?.seq ?? 0) < d.seq) latest.set(d.claimId, d);
    return [...latest.values()]
      .filter((d) => d.assessment.policyVersionId !== null && policyVersionIds.includes(d.assessment.policyVersionId))
      .map((d) => d.claimId)
      .sort();
  }

  async getEvidence(decisionId: string) {
    const e = this.evidence.get(decisionId);
    return e ? structuredClone(e) : null;
  }

  /** Checks everything first and then changes, so an error never leaves half a decision behind. */
  async commitDecision({ decision, journals, deductiblePeriod, evidence, events, closesReviewRequestId, closesProposalId }: DecisionCommit) {
    if (!this.claims.has(decision.claimId)) throw new Error(`Claim ${decision.claimId} does not exist`);
    if (this.closures.has(decision.claimId)) throw new StoreConflictError('claim_closed', `Claim ${decision.claimId} is closed`);
    const review = closesReviewRequestId ? this.reviews.find((r) => r.id === closesReviewRequestId) : undefined;
    if (closesReviewRequestId && (!review || review.claimId !== decision.claimId || review.closedAt)) {
      throw new Error(`Review request ${closesReviewRequestId} is not open for claim ${decision.claimId}`);
    }
    if (closesReviewRequestId && (decision.automated || decision.reviewRequestId !== closesReviewRequestId)) {
      throw new Error(`Review request ${closesReviewRequestId} must be closed by the human decision that answers it`);
    }
    const proposal = closesProposalId ? this.proposals.find((p) => p.id === closesProposalId) : undefined;
    if (closesProposalId) {
      if (!proposal || proposal.claimId !== decision.claimId) throw new Error(`Proposal ${closesProposalId} does not belong to claim ${decision.claimId}`);
      if (proposal.status !== 'open') throw new StoreConflictError('proposal_closed', `Proposal ${closesProposalId} is ${proposal.status}`);
      if (decision.proposalId !== proposal.id || !decision.approvedBy || decision.approvedBy === proposal.proposedBy) {
        throw new Error(`Proposal ${closesProposalId} must be closed by a decision approved by someone other than the proposer`);
      }
    } else if (decision.proposalId || decision.approvedBy) {
      throw new Error('An approved decision must close its proposal');
    }
    if (evidence.decisionId !== decision.id) throw new Error(`Evidence for ${evidence.decisionId} given with decision ${decision.id}`);
    for (const j of journals) assertBalanced(j);
    if (this.decisions.some((d) => d.claimId === decision.claimId && d.seq === decision.seq)) {
      throw new StoreConflictError('decision_exists', `Decision ${decision.claimId}#${decision.seq} already exists`);
    }
    const remaining = this.periods.filter((p) => p.openedByClaimId !== decision.claimId);
    if (deductiblePeriod) {
      const clash = remaining.find(
        (p) =>
          p.animalId === deductiblePeriod.animalId &&
          p.diagnosisGroup === deductiblePeriod.diagnosisGroup &&
          p.validFrom < deductiblePeriod.validTo &&
          deductiblePeriod.validFrom < p.validTo,
      );
      if (clash) throw new StoreConflictError('period_overlaps', `The deductible period clashes with ${clash.id}`);
    }
    this.decisions.push(structuredClone(decision));
    this.evidence.set(decision.id, structuredClone(evidence));
    this.journals.push(...structuredClone(journals));
    this.periods = remaining;
    if (deductiblePeriod) this.periods.push({ ...deductiblePeriod });
    if (review) Object.assign(review, { closedByDecisionId: decision.id, closedAt: decision.decidedAt });
    if (proposal) {
      Object.assign(proposal, { status: 'approved', closedBy: decision.approvedBy, closedAt: decision.decidedAt, decisionId: decision.id });
    }
    this.appendEvents(events);
  }

  async saveReviewRequest(request: ReviewRequest, events: ClaimsEvent[]) {
    const decision = this.decisions.find((d) => d.id === request.decisionId);
    if (!decision || decision.claimId !== request.claimId || decision.seq !== request.decisionSeq) {
      throw new Error(`Decision ${request.decisionId} does not match claim ${request.claimId}#${request.decisionSeq}`);
    }
    if (!decision.automated) throw new Error(`Decision ${request.decisionId} is not automated`);
    if (this.reviews.some((r) => r.id === request.id)) throw new Error(`Review request ${request.id} already exists`);
    if (this.reviews.some((r) => r.claimId === request.claimId && !r.closedAt)) {
      throw new StoreConflictError('review_open', `Claim ${request.claimId} already has an open review request`);
    }
    this.reviews.push(structuredClone(request));
    this.appendEvents(events);
  }

  async saveProposal(proposal: DecisionProposal, events: ClaimsEvent[]) {
    if (!this.claims.has(proposal.claimId)) throw new Error(`Claim ${proposal.claimId} does not exist`);
    if (proposal.status !== 'open') throw new Error('A proposal is stored open');
    if (this.proposals.some((p) => p.id === proposal.id)) throw new Error(`Proposal ${proposal.id} already exists`);
    if (this.proposals.some((p) => p.claimId === proposal.claimId && p.status === 'open')) {
      throw new StoreConflictError('proposal_open', `Claim ${proposal.claimId} already has an open proposal`);
    }
    this.proposals.push(structuredClone(proposal));
    this.appendEvents(events);
  }

  async getProposals(claimId: string) {
    return this.proposals.filter((p) => p.claimId === claimId).map((p) => structuredClone(p));
  }

  async closeClaim(closure: ClaimClosure, events: ClaimsEvent[], journals: LedgerJournal[]) {
    if (this.closures.has(closure.claimId)) throw new StoreConflictError('claim_closed', `Claim ${closure.claimId} is closed already`);
    if (this.decisions.some((d) => d.claimId === closure.claimId)) throw new StoreConflictError('claim_decided', `Claim ${closure.claimId} has a decision`);
    for (const j of journals) assertBalanced(j);
    this.closures.set(closure.claimId, structuredClone(closure));
    for (const p of this.proposals) {
      if (p.claimId === closure.claimId && p.status === 'open') Object.assign(p, { status: 'returned', closedBy: closure.closedBy, closedAt: closure.closedAt, returnReason: closure.reason });
    }
    for (const r of this.information) {
      if (r.claimId === closure.claimId && r.status === 'open') Object.assign(r, { status: 'cancelled', closedBy: closure.closedBy, closedAt: closure.closedAt, closingNote: closure.reason });
    }
    this.journals.push(...structuredClone(journals));
    this.appendEvents(events);
  }

  async saveInformationRequest(request: InformationRequest, events: ClaimsEvent[]) {
    if (!this.claims.has(request.claimId)) throw new Error(`Claim ${request.claimId} does not exist`);
    if (request.status !== 'open') throw new Error('A request for information is stored open');
    if (this.information.some((r) => r.id === request.id)) throw new Error(`Request ${request.id} already exists`);
    if (this.closures.has(request.claimId)) throw new StoreConflictError('claim_closed', `Claim ${request.claimId} is closed`);
    if (this.information.some((r) => r.claimId === request.claimId && r.recipient === request.recipient && r.status === 'open')) {
      throw new StoreConflictError('information_open', `Claim ${request.claimId} already has an open request to the ${request.recipient}`);
    }
    this.information.push(structuredClone(request));
    this.appendEvents(events);
  }

  async getInformationRequests(claimId: string) {
    return this.information
      .filter((r) => r.claimId === claimId)
      .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : a.id < b.id ? -1 : 1))
      .map((r) => structuredClone(r));
  }

  async updateInformationRequest(next: InformationRequest, from: { statuses: InformationRequestStatus[]; notReminded?: boolean }, events: ClaimsEvent[]) {
    const i = this.information.findIndex((r) => r.id === next.id);
    const cur = this.information[i];
    if (!cur) throw new Error(`Request ${next.id} does not exist`);
    if (cur.claimId !== next.claimId) throw new Error(`Request ${next.id} belongs to claim ${cur.claimId}`);
    if (!from.statuses.includes(cur.status) || (from.notReminded && cur.remindedAt)) {
      throw new StoreConflictError('information_closed', `Request ${next.id} is ${cur.status}${cur.remindedAt ? ', reminded' : ''}`);
    }
    this.information[i] = structuredClone(next);
    this.appendEvents(events);
  }

  async informationRequestsDue(market: MarketCode, onDate: ISODate) {
    return this.information
      .filter((r) => r.status === 'open' && this.claims.get(r.claimId)?.market === market)
      .filter((r) => r.dueDate < onDate || (r.remindOn !== undefined && r.remindOn <= onDate && !r.remindedAt))
      .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : a.id < b.id ? -1 : 1))
      .map((r) => structuredClone(r));
  }

  async getClosure(claimId: string) {
    const k = this.closures.get(claimId);
    return k ? structuredClone(k) : null;
  }

  async returnProposal(proposalId: string, closedBy: string, closedAt: Timestamp, reason: string, events: ClaimsEvent[]) {
    const p = this.proposals.find((x) => x.id === proposalId);
    if (!p || p.status !== 'open') throw new StoreConflictError('proposal_closed', `Proposal ${proposalId} is not open`);
    Object.assign(p, { status: 'returned', closedBy, closedAt, returnReason: reason });
    this.appendEvents(events);
  }

  async getReviewRequests(claimId: string) {
    return this.reviews.filter((r) => r.claimId === claimId).map((r) => structuredClone(r));
  }

  async pendingEvents(limit: number): Promise<OutboxEntry[]> {
    return this.outbox
      .filter((e) => !e.publishedAt)
      .slice(0, limit)
      .map((e) => ({ id: e.id, event: structuredClone(e.event) }));
  }

  async markPublished(ids: string[], at: Timestamp): Promise<void> {
    for (const e of this.outbox) if (ids.includes(e.id) && !e.publishedAt) e.publishedAt = at;
  }

  private appendEvents(events: ClaimsEvent[]) {
    for (const event of events) this.outbox.push({ id: String(++this.outboxSeq), event: structuredClone(event) });
  }

  /** For tests and debugging only. */
  dump() {
    return { decisions: this.decisions, journals: this.journals, periods: this.periods, outbox: this.outbox };
  }
}

function assertBalanced(j: LedgerJournal): void {
  const sum = j.lines.reduce((s, l) => s + l.amount, 0);
  if (sum !== 0) throw new Error(`Journal ${j.id} does not balance (${sum})`);
}

/**
 * In-memory policy port supporting bitemporal lookups: every version has
 * valid time and system time.
 */
export interface StoredPolicyVersion {
  snapshot: PolicySnapshot;
  /** When the version was recorded. */
  sysFrom: Timestamp;
  /** When the version was superseded; omitted = still current. */
  sysTo?: Timestamp;
}

export class InMemoryPolicyPort implements PolicyPort {
  constructor(private readonly versions: StoredPolicyVersion[] = []) {}

  add(v: StoredPolicyVersion) {
    this.versions.push(v);
  }

  /** Supersedes a version in system time (retroactive change). */
  supersede(policyVersionId: string, at: Timestamp) {
    const v = this.versions.find((x) => x.snapshot.policyVersionId === policyVersionId && !x.sysTo);
    if (!v) throw new Error(`No current version ${policyVersionId}`);
    v.sysTo = at;
  }

  async getPolicyAt(policyId: string, onDate: ISODate, knownAt?: Timestamp) {
    const known = (v: StoredPolicyVersion) =>
      knownAt === undefined ? !v.sysTo : v.sysFrom <= knownAt && (!v.sysTo || knownAt < v.sysTo);
    const hit = this.versions.find(
      (v) =>
        v.snapshot.policyId === policyId &&
        known(v) &&
        v.snapshot.validFrom <= onDate &&
        (!v.snapshot.validTo || onDate < v.snapshot.validTo),
    );
    return hit ? structuredClone(hit.snapshot) : null;
  }
}

export class StaticRulesPort implements RulesPort {
  constructor(private readonly byProduct: Record<string, ClaimsRules>, private readonly fallback: ClaimsRules) {}
  async getRules(productVersion: string, _onDate: ISODate) {
    return this.byProduct[productVersion] ?? this.fallback;
  }
}

export class FixedClock implements Clock {
  constructor(private t: Timestamp) {}
  now() {
    return this.t;
  }
  set(t: Timestamp) {
    this.t = t;
  }
}

export class SequentialIds implements IdGenerator {
  private n = 0;
  next(prefix: string) {
    this.n += 1;
    return `${prefix}_${String(this.n).padStart(6, '0')}`;
  }
}

export * as fixtures from './fixtures.ts';
