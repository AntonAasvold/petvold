/**
 * <pv-erasure-detail>: a request to anonymize a party (ADR 0028). Approving
 * anonymizes the party for good, by someone other than the one who asked.
 * Rejecting a request from the data subject restricts the data until a date.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import { IdempotencyKeys } from '../decide.ts';
import { mayApprove, mayReject, rejectionBody, rejectionProblems } from '../erasure-logic.ts';
import { formatDate, formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { erasureBasisLabel, erasureOutcomeLabel, problemLabel } from './labels.ts';

type Request = components['schemas']['ErasureRequest'];

const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-erasure-detail')
export class ErasureDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'request-id' }) requestId = '';
  @state() private request: Request | null = null;
  @state() private problem: Problem | null = null;
  @state() private approveReason = '';
  @state() private reject = { reason: '', restrictUntil: '' };
  @state() private shown: string[] = [];
  @state() private notice: Notice | null = null;
  @state() private busy = '';
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
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
        margin: var(--space-2) 0 var(--space-8);
      }
      h1 {
        margin: 0;
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
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
      }
      .side {
        flex: 1 1 340px;
        max-width: 420px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      dd a {
        color: var(--ink);
      }
      .pv-card__body p {
        margin: 0;
      }
      @media (max-width: 900px) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('requestId') || changed.has('api')) void this.load();
  }

  private async load() {
    try {
      this.request = await unwrap(this.api.GET('/v1/erasure-requests/{requestId}', { params: { path: { requestId: this.requestId } } }));
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  render() {
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/erasures" @click=${(e: Event) => (e.preventDefault(), navigate('/erasures'))}>${msg('Erasure', { id: 'nav.erasures' })}</a>
      <span aria-hidden="true">/</span><span aria-current="page">${this.requestId}</span>
    </nav>`;
    if (this.problem) return html`${crumbs}<wa-callout variant="neutral">${msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' })}</wa-callout>`;
    const r = this.request;
    if (!r) return html`${crumbs}<wa-spinner></wa-spinner>`;
    const lang = getLocale();
    const row = (label: string, value: unknown) => html`<div class="pv-dl__row"><dt>${label}</dt><dd>${value}</dd></div>`;
    return html`
      ${crumbs}
      <div class="title">
        <h1>${msg('Request to erase', { id: 'erasure.title' })}</h1>
        <span class="pv-badge pv-badge--id">${r.id}</span>
        <span class="pv-badge ${r.decision ? 'pv-badge--solid' : 'pv-badge--pending'}">${r.decision ? erasureOutcomeLabel(r.decision.outcome) : msg('Waiting', { id: 'erasure.pending' })}</span>
      </div>
      ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>${this.notice.text}</wa-callout>` : nothing}
      <div class="cols">
        <section class="pv-card basis" aria-labelledby="request">
          <div class="pv-card__head"><h2 class="pv-card__title" id="request">${msg('Details', { id: 'claim.facts' })}</h2></div>
          <div class="pv-card__body">
            <dl class="pv-dl">
              ${row(msg('Party id', { id: 'party.id' }), html`<a href=${`/parties/${r.partyId}`} class="pv-mono" @click=${(e: Event) => (e.preventDefault(), navigate(`/parties/${encodeURIComponent(r.partyId)}`))}>${r.partyId}</a>`)}
              ${row(msg('Market', { id: 'claim.market' }), r.market)} ${row(msg('Basis', { id: 'erasure.basis' }), erasureBasisLabel(r.basis))}
              ${row(msg('Reason', { id: 'claim.reason' }), r.reason)} ${row(msg('Requested by', { id: 'erasure.by' }), `${r.requestedBy}, ${formatDateTime(r.requestedAt, lang)}`)}
              ${r.decision
                ? html`${row(msg('Decided by', { id: 'erasure.decidedBy' }), `${r.decision.decidedBy}, ${formatDateTime(r.decision.decidedAt, lang)}`)}
                  ${r.decision.reason ? row(msg('Why', { id: 'close.why' }), r.decision.reason) : nothing}
                  ${r.decision.restrictUntil ? row(msg('Restricted until', { id: 'party.restricted' }), formatDate(r.decision.restrictUntil, lang)) : nothing}`
                : nothing}
            </dl>
          </div>
        </section>
        <div class="side">${r.decision ? nothing : html`${this.approveCard(r)} ${mayReject(this.me, r) ? this.rejectCard(r) : nothing}`}</div>
      </div>
    `;
  }

  private approveCard(r: Request) {
    if (!this.me?.permissions.includes('parties:erase')) return nothing;
    if (!mayApprove(this.me, r)) {
      return html`<section class="pv-card" aria-labelledby="approve">
        <div class="pv-card__head"><h2 class="pv-card__title" id="approve">${msg('Approve', { id: 'approve.submit' })}</h2></div>
        <div class="pv-card__body"><p>${msg('Someone else must approve your request.', { id: 'erasure.fourEyes' })}</p></div>
      </section>`;
    }
    return html`<section class="pv-card pv-card--strong" aria-labelledby="approve">
      <div class="pv-card__head"><h2 class="pv-card__title" id="approve">${msg('Approve', { id: 'approve.submit' })}</h2></div>
      <form class="pv-card__body" @submit=${this.doApprove}>
        <p class="pv-note">${msg('Removes the personal data from every revision and the numbers. It cannot be undone.', { id: 'erasure.approveHow' })}</p>
        <wa-textarea label=${msg('Reason (optional)', { id: 'animal.reasonOptional' })} rows="2" .value=${this.approveReason} @input=${(e: Event) => (this.approveReason = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
        <wa-button type="submit" variant="brand" ?loading=${this.busy === 'approve'}>${msg('Anonymize the party', { id: 'erasure.submitApprove' })}</wa-button>
      </form>
    </section>`;
  }

  private rejectCard(r: Request) {
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    return html`<section class="pv-card" aria-labelledby="reject">
      <div class="pv-card__head"><h2 class="pv-card__title" id="reject">${msg('Reject', { id: 'decide.reject' })}</h2></div>
      <form class="pv-card__body" @submit=${(e: Event) => this.doReject(e, r)} novalidate>
        <p>${msg('When the data must be kept, e.g. for a claim in progress (GDPR article 17.3). A request from the person then restricts the data until a date.', { id: 'erasure.rejectHow' })}</p>
        <wa-textarea label=${msg('Reason', { id: 'claim.reason' })} rows="2" .value=${this.reject.reason} @input=${(e: Event) => (this.reject = { ...this.reject, reason: value(e) })}></wa-textarea>
        ${r.basis === 'subject-request'
          ? html`<wa-input type="date" label=${msg('Restricted until', { id: 'party.restricted' })} .value=${this.reject.restrictUntil} @input=${(e: Event) => (this.reject = { ...this.reject, restrictUntil: value(e) })}></wa-input>`
          : nothing}
        ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((x) => html`<div>${problemLabel(x)}</div>`)}</wa-callout>` : nothing}
        <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'reject'}>${msg('Reject the request', { id: 'erasure.submitReject' })}</wa-button>
      </form>
    </section>`;
  }

  private async doApprove(e: Event) {
    e.preventDefault();
    await this.send(
      'approve',
      (key) => this.api.POST('/v1/erasure-requests/{requestId}/approvals', { params: { path: { requestId: this.requestId }, header: { 'Idempotency-Key': key } }, body: this.approveReason.trim() ? { reason: this.approveReason.trim() } : {} }),
      msg('The party is anonymized.', { id: 'erasure.approved' }),
    );
  }

  private async doReject(e: Event, r: Request) {
    e.preventDefault();
    this.shown = rejectionProblems(this.reject, r.basis, today());
    if (this.shown.length) return;
    await this.send(
      'reject',
      (key) => this.api.POST('/v1/erasure-requests/{requestId}/rejections', { params: { path: { requestId: this.requestId }, header: { 'Idempotency-Key': key } }, body: rejectionBody(this.reject, r.basis) }),
      msg('The request is rejected.', { id: 'erasure.rejected' }),
    );
  }

  private async send(what: string, call: (key: string) => Promise<{ response: Response; error?: unknown }>, text: string) {
    this.busy = what;
    const key = `${what}:${this.requestId}`;
    const { ok, notice } = await act(() => call(this.keys.for(key)), () => ({ variant: 'success', text }));
    this.busy = '';
    this.notice = notice;
    if (ok) {
      this.keys.done(key);
      await this.load();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-erasure-detail': ErasureDetail;
  }
}
