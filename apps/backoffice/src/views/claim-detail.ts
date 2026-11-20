/**
 * <pv-claim-detail>: a claim as the design system lays it out. A head with the
 * claim, its id and status, and who and what it concerns; then two columns:
 * the basis (calculation, assessment, details) and, beside it, the decision
 * and the history (docs/teknik/designsystem.md, "Underlaget bredvid beslutet").
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { navigate } from '../router.ts';
import { partyName, versionOn } from '../policy-logic.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { attachmentKindLabel, noticeStatusLabel, noticeTypeLabel, channelLabel, claimStatusLabel, correctionFieldLabel, dismissalLabel, informationItemLabel, outcomeLabel, recipientLabel, ruleStatusLabel, statusVariant } from './labels.ts';
import '../components/claim-actions.ts';
import '../components/claim-information.ts';
import '../components/claim-attachments.ts';
import { daysLeftToPay, decidedLate } from '../information-logic.ts';
import '../components/waterfall.ts';
import '../components/event-log.ts';
import type { LogEntry } from '../components/event-log.ts';
import { claimHistory, type HistoryEvent } from '../history.ts';
import '../components/explanation-dialog.ts';
import { claimStatus, mayCorrect } from '../decide.ts';
import type { Me } from '../permissions.ts';

type Claim = components['schemas']['Claim'];
type Assessment = components['schemas']['AssessmentWithRouting'];
type Animal = components['schemas']['Animal'];
type Party = components['schemas']['Party'];
type Decision = components['schemas']['Decision'];
type RuleResult = components['schemas']['RuleResult'];
type Proposal = components['schemas']['DecisionProposal'];
type ReviewRequest = components['schemas']['ReviewRequest'];
type InformationRequest = components['schemas']['InformationRequest'];
type ClaimRevision = components['schemas']['ClaimRevision'];
type Attachment = components['schemas']['ClaimAttachment'];
type Notice = components['schemas']['Notice'];

@customElement('pv-claim-detail')
export class ClaimDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'claim-id' }) claimId = '';
  @state() private proposals: Proposal[] = [];
  @state() private reviews: ReviewRequest[] = [];
  @state() private information: InformationRequest[] = [];
  @state() private revisions: ClaimRevision[] = [];
  @state() private attachments: Attachment[] = [];
  /** The notices to the customer about this claim (ADR 0036), for those who may read notices. */
  @state() private notices: Notice[] = [];
  @state() private claim: Claim | null = null;
  @state() private assessment: Assessment | null = null;
  @state() private decisions: Decision[] = [];
  @state() private problem: Problem | null = null;
  /** Who and what the claim concerns, for the head. Each may be missing if the caller may not read it. */
  @state() private animal: Animal | null = null;
  @state() private holder: Party | null = null;
  @state() private copied = false;

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
      :host {
        display: block;
      }
      .crumbs {
        display: flex;
        gap: var(--space-2);
        font-size: 13px;
        color: var(--text-muted);
      }
      .crumbs a {
        color: var(--text-secondary);
      }
      .title {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-3);
        margin: var(--space-2) 0 var(--space-3);
      }
      h1 {
        margin: 0;
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
      }
      button.pv-badge {
        cursor: pointer;
      }
      button.pv-badge:focus-visible,
      .crumbs a:focus-visible {
        outline: var(--border-strong) solid var(--focus);
        outline-offset: 2px;
      }
      .facts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-6);
        margin: 0 0 var(--space-8);
        padding: 0;
        list-style: none;
        font-size: 14px;
        color: var(--text-secondary);
      }
      .facts strong {
        color: var(--ink);
        font-weight: 600;
      }
      .facts a {
        color: var(--ink);
      }
      .cols {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-6);
      }
      .basis {
        flex: 999 1 520px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      .side {
        flex: 1 1 340px;
        max-width: 420px;
        min-width: 0;
        position: sticky;
        top: var(--space-6);
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      .pv-dl__row dd {
        font-variant-numeric: tabular-nums;
      }
      /* While the claim awaits information, that is what the handler acts on (ADR 0036). */
      .side .first {
        order: -1;
      }
      .proposal {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        align-items: center;
      }
      .sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      @media (max-width: 900px) {
        .side {
          position: static;
          max-width: none;
        }
      }
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('claimId') || changed.has('api')) void this.load();
  }

  private async load() {
    this.problem = null;
    const path = { params: { path: { claimId: this.claimId } } };
    try {
      const [claim, assessment, decisions, proposals, reviews, information, revisions, attachments] = await Promise.all([
        unwrap(this.api.GET('/v1/claims/{claimId}', path)),
        unwrap(this.api.GET('/v1/claims/{claimId}/assessment', path)),
        unwrap(this.api.GET('/v1/claims/{claimId}/decisions', path)),
        unwrap(this.api.GET('/v1/claims/{claimId}/proposals', path)),
        unwrap(this.api.GET('/v1/claims/{claimId}/review-requests', path)),
        unwrap(this.api.GET('/v1/claims/{claimId}/information-requests', path)),
        unwrap(this.api.GET('/v1/claims/{claimId}/revisions', path)),
        unwrap(this.api.GET('/v1/claims/{claimId}/attachments', path)),
      ]);
      this.claim = claim;
      this.assessment = assessment;
      this.decisions = decisions.items;
      this.proposals = proposals.items;
      this.reviews = reviews.items;
      this.information = information.items;
      this.revisions = revisions.items;
      this.attachments = attachments.items;
    } catch (e) {
      this.problem = e as Problem;
      return;
    }
    void this.loadWho();
    void this.loadNotices();
  }

  /** Notices are listed per policy; those about this claim name it in their content. Not needed to decide. */
  private async loadNotices() {
    if (!this.me?.permissions.includes('notices:read') || !this.claim) return;
    const c = this.claim;
    const { data } = await this.api.GET('/v1/notices', { params: { query: { policyId: c.policyId, limit: 200 } } }).catch(() => ({ data: undefined }));
    this.notices = (data?.items ?? []).filter((n) => (n.content as { claimId?: string }).claimId === c.id);
  }

  /** The animal and the policyholder for the head. Not needed to decide, so a missing permission only leaves them out. */
  private async loadWho() {
    const c = this.claim!;
    const [animal, policy] = await Promise.all([
      this.api.GET('/v1/animals/{animalId}', { params: { path: { animalId: c.animalId } } }).then((r) => r.data ?? null, () => null),
      this.api.GET('/v1/policies/{policyId}', { params: { path: { policyId: c.policyId } } }).then((r) => r.data ?? null, () => null),
    ]);
    this.animal = animal;
    const partyId = policy ? versionOn(policy.versions, c.treatmentFrom)?.policyholderPartyId : undefined;
    this.holder = partyId ? await this.api.GET('/v1/parties/{partyId}', { params: { path: { partyId } } }).then((r) => r.data ?? null, () => null) : null;
  }

  private async copyId() {
    await navigator.clipboard?.writeText(this.claimId).catch(() => undefined);
    this.copied = true;
    setTimeout(() => (this.copied = false), 2000);
  }

  render() {
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/claims" @click=${(e: Event) => (e.preventDefault(), navigate('/claims'))}>${msg('Claims', { id: 'nav.claims' })}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${this.claim?.claimNo ?? this.claimId}</span>
    </nav>`;
    if (this.problem) {
      const text =
        this.problem.status === 404
          ? msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' })
          : this.problem.status === 403
            ? msg('You are not permitted to do this.', { id: 'common.forbidden' })
            : this.problem.title;
      return html`${crumbs}<wa-callout variant=${this.problem.status === 404 || this.problem.status === 403 ? 'neutral' : 'danger'}>${text}</wa-callout>`;
    }
    if (!this.claim || !this.assessment) return html`${crumbs}<wa-spinner></wa-spinner>`;
    const c = this.claim;
    const a = this.assessment;
    const lang = getLocale();
    const money = (m: number) => formatMoney(m, c.currency, lang);
    const status = claimStatus({
      ...(c.closure ? { closed: c.closure.kind } : {}),
      openProposals: this.proposals.filter((p) => p.status === 'open').length,
      openInformation: this.information.filter((r) => r.status === 'open').length,
      openReviews: this.reviews.filter((r) => !r.closedAt).length,
      decisions: this.decisions.length,
      reopened: !!c.reopened,
    });
    const holder = partyName(this.holder);
    return html`
      ${crumbs}
      <div class="title">
        <h1>${msg('Claim', { id: 'claim.title' })} ${c.claimNo}</h1>
        <button class="pv-badge pv-badge--id" type="button" aria-label=${`${msg('Copy the id', { id: 'claim.copyId' })} ${c.id}`} @click=${() => this.copyId()}>
          ${c.id}<wa-icon name=${this.copied ? 'check' : 'copy'} aria-hidden="true"></wa-icon>
        </button>
        <span class="sr" role="status">${this.copied ? msg('Copied', { id: 'common.copied' }) : ''}</span>
        <span class="pv-badge ${status === 'decided' || c.closure ? 'pv-badge--solid' : 'pv-badge--pending'}">${claimStatusLabel(status)}</span>
        ${c.revision > 1 ? html`<span class="pv-badge pv-badge--id">${msg('Revision', { id: 'correct.revision' })} ${c.revision}</span>` : nothing}
        ${mayCorrect(this.me, status)
          ? html`<wa-button class="correct" size="small" appearance="outlined" @click=${() => navigate(`/claims/${encodeURIComponent(c.id)}/correct`)}
              ><wa-icon slot="start" name="pen"></wa-icon>${msg('Correct', { id: 'correct.crumb' })}</wa-button
            >`
          : nothing}
      </div>
      <ul class="facts">
        <li>${msg('Animal', { id: 'claim.animal' })}: <strong>${this.animal ? `${this.animal.name}` : c.animalId}</strong></li>
        <li>${msg('Customer', { id: 'claim.customer' })}: <strong>${holder || '–'}</strong></li>
        <li>
          ${msg('Policy', { id: 'claims.col.policy' })}:
          <a href=${`/policies/${c.policyId}`} @click=${(e: Event) => (e.preventDefault(), navigate(`/policies/${encodeURIComponent(c.policyId)}`))}><strong class="pv-mono">${c.policyId}</strong></a>
        </li>
        <li>${msg('Received', { id: 'claims.col.received' })}: <strong>${channelLabel(c.channel)}, ${formatDateTime(c.receivedAt, lang)}</strong></li>
        ${this.basisFact(c, status)}
      </ul>
      <div class="cols">
        <div class="basis">
          <section class="pv-card" aria-labelledby="calc">
            <div class="pv-card__head">
              <h2 class="pv-card__title" id="calc">${msg('Calculation', { id: 'claim.calculation' })}</h2>
              <span class="pv-card__meta pv-mono">${a.rulesVersion}</span>
            </div>
            <div class="pv-card__body">
              ${a.calculation
                ? html`<pv-waterfall .calculation=${a.calculation} currency=${c.currency} label=${msg('Calculation', { id: 'claim.calculation' })}></pv-waterfall>
                    <dl class="pv-dl">
                      <div class="pv-dl__row"><dt>${msg('Left of the annual limit', { id: 'calc.remainingBefore' })}</dt><dd>${money(a.calculation.remainingBefore)}</dd></div>
                      <div class="pv-dl__row"><dt>${msg('The customer pays', { id: 'calc.customerShare' })}</dt><dd>${money(a.calculation.customerShare)}</dd></div>
                    </dl>`
                : html`<p class="pv-note">${msg('No calculation: a rule stopped the assessment.', { id: 'claim.noCalculation' })}</p>`}
              <p class="proposal">
                ${msg('Proposal', { id: 'claim.proposed' })}: <strong>${outcomeLabel(a.proposedOutcome)}</strong> ·
                ${a.mode === 'auto' ? msg('May be settled automatically', { id: 'claim.mode.auto' }) : msg('Needs a claims handler', { id: 'claim.mode.manual' })}
              </p>
            </div>
          </section>
          <section class="pv-card" aria-labelledby="rules">
            <div class="pv-card__head"><h2 class="pv-card__title" id="rules">${msg('Assessment', { id: 'claim.assessment' })}</h2></div>
            <pv-data-grid .columns=${this.ruleColumns()} .rows=${a.rules} label=${msg('Assessment', { id: 'claim.assessment' })}></pv-data-grid>
          </section>
          <section class="pv-card" aria-labelledby="facts">
            <div class="pv-card__head"><h2 class="pv-card__title" id="facts">${msg('Details', { id: 'claim.facts' })}</h2></div>
            <div class="pv-card__body">
              <dl class="pv-dl">
                <div class="pv-dl__row"><dt>${msg('Treatment from', { id: 'claims.col.treatment' })}</dt><dd>${formatDate(c.treatmentFrom, lang)} – ${formatDate(c.treatmentTo, lang)}</dd></div>
                <div class="pv-dl__row"><dt>${msg('Diagnosis', { id: 'claims.col.diagnosis' })}</dt><dd class="pv-mono">${c.diagnosisCode}${a.diagnosisGroup ? ` (${a.diagnosisGroup})` : ''}</dd></div>
                <div class="pv-dl__row"><dt>${msg('Channel', { id: 'claims.col.channel' })}</dt><dd>${channelLabel(c.channel)}</dd></div>
                <div class="pv-dl__row"><dt>${msg('Product', { id: 'claim.product' })}</dt><dd class="pv-mono">${a.productVersion ?? '–'}</dd></div>
                <div class="pv-dl__row"><dt>${msg('Market', { id: 'claim.market' })}</dt><dd>${c.market}, ${c.currency}</dd></div>
              </dl>
            </div>
          </section>
          <pv-claim-attachments .api=${this.api} .me=${this.me} claim-id=${c.id} status=${status} .attachments=${this.attachments} @pv-changed=${() => this.load()}></pv-claim-attachments>
        </div>
        <div class="side">
          ${c.reopened
            ? html`<p class="pv-note">${msg('The claim was corrected after the decision and waits for a new decision by a person.', { id: 'correct.reopened' })}</p>`
            : nothing}
          <pv-claim-actions
            .api=${this.api}
            .me=${this.me}
            claim-id=${c.id}
            currency=${c.currency}
            status=${status}
            .assessment=${a}
            .decisions=${this.decisions}
            .proposals=${this.proposals}
            .reviews=${this.reviews}
            .closure=${c.closure ?? null}
            @pv-changed=${() => this.load()}
          ></pv-claim-actions>
          <pv-claim-information
            class=${status === 'awaiting-information' ? 'first' : ''}
            .api=${this.api}
            .me=${this.me}
            claim-id=${c.id}
            status=${status}
            .requests=${this.information}
            ?information-missing=${!!c.informationMissing}
            @pv-changed=${() => this.load()}
          ></pv-claim-information>
          <pv-event-log
            heading=${msg('History', { id: 'claim.history' })}
            empty=${msg('No decisions yet.', { id: 'claim.noDecisions' })}
            .entries=${claimHistory({
              claim: c,
              decisions: this.decisions,
              proposals: this.proposals,
              reviews: this.reviews,
              information: this.information,
              corrections: this.revisions.flatMap((r) => (r.correction ? [r.correction] : [])),
              attachments: this.attachments,
              notices: this.notices,
              ...(c.closure ? { closure: c.closure } : {}),
            }).map((e) => this.logEntry(e))}
          ></pv-event-log>
        </div>
      </div>
      <pv-explanation-dialog .api=${this.api}></pv-explanation-dialog>
    `;
  }

  /**
   * When the basis was complete, and for an undecided claim the days left of
   * the month in FAL 7 kap. 1 § (ADR 0036). Nothing while information is awaited.
   */
  private basisFact(c: Claim, status: string) {
    if (!c.basisCompleteAt || c.closure) return nothing;
    const lang = getLocale();
    const left = status === 'decided' ? null : daysLeftToPay(c.basisCompleteAt, new Date().toISOString());
    return html`<li>
      ${msg('Basis complete', { id: 'claim.basisComplete' })}: <strong>${formatDate(c.basisCompleteAt.slice(0, 10), lang)}</strong>
      ${left === null
        ? nothing
        : left < 0
          ? html`<span class="pv-badge pv-badge--solid">${msg('More than 30 days', { id: 'claim.overdue' })}</span>`
          : html`<span class="pv-badge pv-badge--pending">${left} ${msg('days left to pay', { id: 'claim.daysLeft' })}</span>`}
    </li>`;
  }

  private ruleColumns(): Column<RuleResult>[] {
    const variant = (s: string) => (s === 'pass' ? 'success' : s === 'fail' ? 'danger' : s === 'review' ? 'warning' : 'neutral');
    return [
      { key: 'code', header: msg('Rule', { id: 'claim.rule' }), value: (r) => r.code },
      { key: 'status', header: msg('Result', { id: 'claim.result' }), value: (r) => html`<wa-badge variant=${variant(r.status)}>${ruleStatusLabel(r.status)}</wa-badge>` },
      { key: 'message', header: msg('Reason', { id: 'claim.reason' }), value: (r) => r.message ?? r.reason },
    ];
  }

  /** A history event as a log entry: what happened in words, and the event's name and who in monospace. */
  private logEntry(e: HistoryEvent): LogEntry {
    const money = (m: number) => formatMoney(m, this.claim!.currency, getLocale());
    const key = `${e.type}:${'seq' in e ? e.seq : 'id' in e ? e.id : ''}`;
    switch (e.type) {
      case 'claim.received':
        return { key, at: e.at, state: 'solid', badge: msg('Received', { id: 'claims.col.received' }), line: channelLabel(e.channel), status: e.type };
      case 'claim.decided':
        return {
          key,
          at: e.at,
          state: 'solid',
          badge: `${msg('Decision', { id: 'decide.action' })} #${e.seq}`,
          line: `${outcomeLabel(e.outcome)} · ${money(e.payout)}${e.reason ? ` · ${e.reason}` : ''}`,
          status: `${e.type} · ${e.automated ? msg('Automatic', { id: 'claim.automated' }) : e.by}${e.revision > 1 ? ` · ${msg('Revision', { id: 'correct.revision' })} ${e.revision}` : ''}${decidedLate(e.at, this.claim!.basisCompleteAt) ? ` · ${msg('More than 30 days after the basis was complete', { id: 'claim.decidedLate' })}` : ''}`,
          action: html`<button type="button" aria-label=${`${msg('Why?', { id: 'claim.why' })} #${e.seq}`} @click=${() => this.explain(e.seq)}>${msg('Why?', { id: 'claim.why' })}</button>`,
        };
      case 'proposal.created':
        return {
          key,
          at: e.at,
          state: e.open ? 'pending' : 'solid',
          badge: e.open ? msg('Awaiting approval', { id: 'claims.status.awaiting-approval' }) : msg('Proposal', { id: 'claim.proposed' }),
          line: `${outcomeLabel(e.outcome)} · ${money(e.payout)}`,
          status: `${e.type} · ${e.by}`,
        };
      case 'proposal.returned':
        return { key, at: e.at, state: 'solid', badge: msg('Returned', { id: 'history.returned' }), line: e.reason ?? '', status: `${e.type} · ${e.by}` };
      case 'claim.withdrawn':
      case 'claim.dismissed':
        return {
          key,
          at: e.at,
          state: 'solid',
          badge: claimStatusLabel(e.type === 'claim.withdrawn' ? 'withdrawn' : 'dismissed'),
          line: `${e.reasonCode ? `${dismissalLabel(e.reasonCode)}${e.duplicateOf ? ` (${e.duplicateOf})` : ''} · ` : ''}${e.reason}`,
          status: `${e.type} · ${e.by}`,
        };
      case 'notice.created':
        return {
          key: `${e.type}:${e.id}`,
          at: e.at,
          state: e.status === 'sent' ? 'solid' : 'pending',
          badge: msg('To the customer', { id: 'history.toCustomer' }),
          line: `${noticeTypeLabel(e.noticeType)} · ${noticeStatusLabel(e.status)}`,
          status: `${e.type} · ${e.id}`,
          action: html`<button type="button" @click=${() => navigate(`/notices/${encodeURIComponent(e.id)}`)}>${msg('Open', { id: 'history.open' })}</button>`,
        };
      case 'claim.attachment_added':
        return {
          key: `${e.type}:${e.id}`,
          at: e.at,
          state: 'solid',
          badge: msg('Attachment', { id: 'history.attachment' }),
          line: `${attachmentKindLabel(e.kind)}${e.replaces ? ` · ${msg('Replaces', { id: 'attachment.replaces' })} ${e.replaces}` : ''}`,
          status: `${e.type} · ${e.by}`,
        };
      case 'claim.corrected':
        return {
          key: `${e.type}:${e.id}`,
          at: e.at,
          state: 'solid',
          badge: `${msg('Corrected', { id: 'history.corrected' })} · ${msg('Revision', { id: 'correct.revision' })} ${e.revision}`,
          line: `${e.fields.map((f) => correctionFieldLabel(f)).join(', ')} · ${e.reason}${e.reopens ? ` · ${msg('Reopened', { id: 'history.reopened' })}` : ''}`,
          status: `${e.type} · ${e.by}`,
        };
      case 'claim.information_requested':
      case 'claim.information_reminded':
      case 'claim.information_received':
      case 'claim.information_expired':
      case 'claim.information_cancelled':
        return {
          key: `${e.type}:${e.id}`,
          at: e.at,
          state: e.open ? 'pending' : 'solid',
          badge: this.informationBadge(e.type),
          line: `${recipientLabel(e.recipient)} · ${e.items.map((i) => informationItemLabel(i)).join(', ')}${e.note ? ` · ${e.note}` : ''}`,
          status: `${e.type} · ${e.by}`,
        };
      case 'review.requested':
        return {
          key,
          at: e.at,
          state: e.open ? 'pending' : 'solid',
          badge: msg('Review requested', { id: 'claims.status.review-requested' }),
          line: `${msg('Decision', { id: 'decide.action' })} #${e.seq}`,
          status: e.type,
        };
    }
  }

  private informationBadge(type: string): string {
    switch (type) {
      case 'claim.information_requested':
        return msg('Information requested', { id: 'history.infoRequested' });
      case 'claim.information_reminded':
        return msg('Reminder', { id: 'info.reminder' });
      case 'claim.information_received':
        return msg('Information received', { id: 'history.infoReceived' });
      case 'claim.information_expired':
        return msg('Expired', { id: 'info.expired' });
      default:
        return msg('Request cancelled', { id: 'history.infoCancelled' });
    }
  }

  private explain(seq: number) {
    void this.renderRoot.querySelector('pv-explanation-dialog')?.show(this.claimId, seq);
  }
}
