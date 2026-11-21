/** <pv-notice-detail>: a notice with its content, legal basis and deliveries, and reporting a delivery (ADR 0032). */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/radio-group/radio-group.js';
import '@awesome.me/webawesome/dist/components/radio/radio.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice as ActionNotice } from '../actions.ts';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate, formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { mayReportDelivery, noticeFlags } from '../integration-logic.ts';
import type { Me } from '../permissions.ts';
import { navigate } from '../router.ts';
import { noticeFlagLabel, noticeStatusLabel, noticeTypeLabel } from './labels.ts';
import { formatSize } from '../attachment-logic.ts';

type StoredDocument = components['schemas']['Document'];

/** The notice types Petvold has templates for (ADR 0038). */
const TEMPLATED = ['claim-decision', 'policy-confirmation'];

type Notice = components['schemas']['Notice'];
type Delivery = components['schemas']['Delivery'];
type Channel = NonNullable<components['schemas']['DeliveryRequest']['channel']>;
const CHANNELS: Channel[] = ['letter', 'email', 'digital-mailbox', 'customer-portal'];

@customElement('pv-notice-detail')
export class NoticeDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'notice-id' }) noticeId = '';
  @state() private notice: Notice | null = null;
  @state() private problem: Problem | null = null;
  @state() private result: ActionNotice | null = null;
  @state() private outcome: 'sent' | 'failed' = 'sent';
  @state() private channel: Channel = 'letter';
  @state() private documentId = '';
  @state() private sha256 = '';
  @state() private reason = '';
  @state() private busy = false;
  /** The notice's documents in Petvold's archive (ADR 0038). */
  @state() private documents: StoredDocument[] = [];
  @state() private rendering = false;
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    ul.docs {
      list-style: none;
      margin: 0 0 var(--wa-space-m);
      padding: 0;
    }
    ul.docs li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--wa-space-s);
      padding: var(--wa-space-xs) 0;
    }
    .head {
      display: flex;
      align-items: center;
      gap: var(--wa-space-m);
      flex-wrap: wrap;
    }
    .head h2 {
      margin: 0;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
      gap: var(--wa-space-l);
      margin-top: var(--wa-space-l);
    }
    .wide {
      grid-column: 1 / -1;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--wa-space-2xs) var(--wa-space-m);
      margin: 0;
    }
    dt {
      color: var(--wa-color-text-quiet);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    form {
      display: grid;
      gap: var(--wa-space-m);
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      font-size: var(--wa-font-size-s);
    }
  `;

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('noticeId') || changed.has('api')) void this.load();
  }

  private async load() {
    this.problem = null;
    try {
      this.notice = await unwrap(this.api.GET('/v1/notices/{noticeId}', { params: { path: { noticeId: this.noticeId } } }));
    } catch (e) {
      this.problem = e as Problem;
    }
    if (this.me?.permissions.includes('documents:read')) {
      const { data } = await this.api.GET('/v1/documents', { params: { query: { noticeId: this.noticeId } } });
      this.documents = data?.items ?? [];
    }
  }

  /** Petvold makes the notice a PDF from its template, with Gotenberg (ADR 0038). */
  private async renderPdf() {
    this.rendering = true;
    const { ok, notice } = await act(
      () =>
        this.api.POST('/v1/notices/{noticeId}/documents', {
          params: { path: { noticeId: this.noticeId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
          body: {},
        }),
      () => ({ variant: 'success', text: msg('The PDF is made.', { id: 'notice.pdfMade' }) }),
    );
    this.rendering = false;
    this.result = { ...notice, reload: false };
    if (ok) await this.load();
  }

  private async openDocument(documentId: string) {
    const { data } = await this.api.POST('/v1/documents/{documentId}/links', {
      params: { path: { documentId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { audience: 'internal' },
    });
    if (data) window.open(data.url, '_blank', 'noopener');
  }

  private documentsCard(n: { type: string }) {
    const may = this.me?.permissions.includes('notices:deliver') && TEMPLATED.includes(n.type);
    if (!this.documents.length && !may) return nothing;
    const lang = getLocale();
    return html`<wa-card>
      <h3 slot="header">${msg('PDF from Petvold', { id: 'notice.pdfTitle' })}</h3>
      ${this.documents.length
        ? html`<ul class="docs">
            ${this.documents.map(
              (d) => html`<li>
                <span>${formatDateTime(d.createdAt, lang)} · ${formatSize(d.size)}${d.template ? html` · <span class="pv-mono">${d.template.name} v${d.template.version}</span>` : nothing}</span>
                <wa-button size="small" appearance="outlined" @click=${() => this.openDocument(d.id)}>${msg('Open', { id: 'history.open' })}</wa-button>
              </li>`,
            )}
          </ul>`
        : html`<p>${msg("No PDF yet. The insurer's document system makes the letter, unless Petvold makes it here.", { id: 'notice.noPdf' })}</p>`}
      ${may
        ? html`<wa-button appearance="outlined" ?loading=${this.rendering} @click=${() => this.renderPdf()}>${msg('Make a PDF', { id: 'notice.makePdf' })}</wa-button>`
        : nothing}
    </wa-card>`;
  }

  render() {
    const back = html`<wa-button appearance="plain" size="small" @click=${() => navigate('/notices')}
      ><wa-icon slot="start" name="arrow-left"></wa-icon>${msg('Back', { id: 'common.back' })}</wa-button
    >`;
    if (this.problem) {
      const text = this.problem.status === 404 ? msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' }) : this.problem.title;
      return html`${back}<wa-callout variant=${this.problem.status === 404 ? 'neutral' : 'danger'}>${text}</wa-callout>`;
    }
    const n = this.notice;
    if (!n) return html`${back}<wa-spinner></wa-spinner>`;
    const lang = getLocale();
    return html`
      ${back}
      <div class="head">
        <h2>${noticeTypeLabel(n.type)}</h2>
        <wa-badge variant=${n.status === 'sent' ? 'success' : n.status === 'failed' ? 'danger' : 'brand'}>${noticeStatusLabel(n.status)}</wa-badge>
        ${noticeFlags(n).map((f) => html`<wa-badge variant=${f === 'late' ? 'warning' : 'danger'}>${noticeFlagLabel(f)}</wa-badge>`)}
      </div>
      ${this.result ? html`<wa-callout variant=${this.result.variant} role=${this.result.variant === 'danger' ? 'alert' : 'status'}>${this.result.text}</wa-callout>` : nothing}
      ${n.incomplete?.length && n.status !== 'sent'
        ? html`<wa-callout variant="danger"
            >${msg("The insurer's settings lack a text the law requires:", { id: 'notice.incompleteHelp' })} ${n.incomplete.join(', ')}</wa-callout
          >`
        : nothing}
      <div class="cards">
        ${this.documentsCard(n)}
        <wa-card>
          <h3 slot="header">${msg('Details', { id: 'claim.facts' })}</h3>
          <dl>
            <dt>${msg('Recipient', { id: 'notices.recipient' })}</dt>
            <dd>${n.recipientPartyId} (${n.language})</dd>
            ${n.policyId
              ? html`<dt>${msg('Policy', { id: 'claims.col.policy' })}</dt>
                  <dd><a href="/policies/${n.policyId}" @click=${(e: Event) => (e.preventDefault(), navigate(`/policies/${n.policyId}`))}>${n.policyId}</a></dd>`
              : nothing}
            ${n.applicationId
              ? html`<dt>${msg('Application', { id: 'application.title' })}</dt>
                  <dd><a href="/applications/${n.applicationId}" @click=${(e: Event) => (e.preventDefault(), navigate(`/applications/${n.applicationId}`))}>${n.applicationId}</a></dd>`
              : nothing}
            <dt>${msg('Send by', { id: 'notices.dueBy' })}</dt>
            <dd>${formatDate(n.dueBy, lang)}</dd>
            <dt>${msg('Made from', { id: 'notice.source' })}</dt>
            <dd>${n.source.eventType}, ${formatDateTime(n.source.occurredAt, lang)}</dd>
            <dt>${msg('Schema', { id: 'notice.schema' })}</dt>
            <dd>${n.schema}</dd>
            <dt>${msg('The document is made by', { id: 'notice.documentMaker' })}</dt>
            <dd>
              ${n.documentMaker === 'petvold' ? msg('Petvold', { id: 'settings.makerPetvold' }) : msg("The insurer's document system", { id: 'settings.makerInsurer' })}
              ${n.documentMaker === 'petvold' && !n.document ? html`<span class="pv-badge pv-badge--pending">${msg('Not made yet', { id: 'notice.pdfPending' })}</span>` : nothing}
            </dd>
          </dl>
        </wa-card>
        <wa-card>
          <h3 slot="header">${msg('Legal basis', { id: 'notice.legalBasis' })}</h3>
          ${n.legalBasis.length ? html`<ul>${n.legalBasis.map((l) => html`<li>${l}</li>`)}</ul>` : html`<p>${msg('Not required by law.', { id: 'notice.noLaw' })}</p>`}
        </wa-card>
        ${mayReportDelivery(this.me) ? this.reportForm() : nothing}
        <div class="wide">
          <h3>${msg('Content', { id: 'notice.content' })}</h3>
          <wa-card>
            <dl>
              ${Object.entries(n.content).map(
                ([k, v]) => html`<dt>${k}</dt>
                  <dd>${typeof v === 'object' ? html`<pre>${JSON.stringify(v, null, 2)}</pre>` : String(v)}</dd>`,
              )}
            </dl>
          </wa-card>
        </div>
        <div class="wide">
          <h3>${msg('Deliveries', { id: 'notice.deliveries' })}</h3>
          <pv-data-grid
            .columns=${this.deliveryColumns()}
            .rows=${n.deliveries}
            label=${msg('Deliveries', { id: 'notice.deliveries' })}
            empty-text=${msg('Not sent yet.', { id: 'notice.notSent' })}
          ></pv-data-grid>
        </div>
      </div>
    `;
  }

  private reportForm() {
    return html`<wa-card>
      <h3 slot="header">${msg('Report a delivery', { id: 'notice.report' })}</h3>
      <form @submit=${this.report}>
        <wa-radio-group label=${msg('Result', { id: 'claim.result' })} value=${this.outcome} @change=${(e: Event) => (this.outcome = (e.target as HTMLInputElement).value as 'sent' | 'failed')}>
          <wa-radio value="sent">${msg('Sent', { id: 'notices.tab.sent' })}</wa-radio>
          <wa-radio value="failed">${msg('Failed', { id: 'notice.failed' })}</wa-radio>
        </wa-radio-group>
        <wa-select label=${msg('Channel', { id: 'claims.col.channel' })} value=${this.channel} @change=${(e: Event) => (this.channel = (e.target as HTMLSelectElement).value as Channel)}>
          ${CHANNELS.map((c) => html`<wa-option value=${c}>${c}</wa-option>`)}
        </wa-select>
        ${this.outcome === 'sent' && this.notice?.documentMaker === 'petvold'
          ? html`<p>${this.notice.document
              ? msg("Petvold made the document: the report names only channel and time.", { id: 'notice.petvoldDocument' })
              : msg('Petvold has not made the PDF yet. Make it above, then report.', { id: 'notice.petvoldPending' })}</p>`
          : this.outcome === 'sent'
          ? html`<wa-input label=${msg("The document's id in the archive", { id: 'notice.documentId' })} .value=${this.documentId} @input=${(e: Event) => (this.documentId = (e.target as HTMLInputElement).value)}></wa-input>
              <wa-input label="sha256" .value=${this.sha256} @input=${(e: Event) => (this.sha256 = (e.target as HTMLInputElement).value)}></wa-input>`
          : html`<wa-input label=${msg('Why it failed, without personal data', { id: 'notice.failReason' })} .value=${this.reason} @input=${(e: Event) => (this.reason = (e.target as HTMLInputElement).value)}></wa-input>`}
        <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Report', { id: 'notice.reportSubmit' })}</wa-button>
      </form>
    </wa-card>`;
  }

  private async report(e: Event) {
    e.preventDefault();
    this.busy = true;
    const body =
      this.outcome === 'sent' && this.notice?.documentMaker === 'petvold'
        ? { outcome: 'sent' as const, channel: this.channel, sentAt: new Date().toISOString() }
        : this.outcome === 'sent'
        ? { outcome: 'sent' as const, channel: this.channel, sentAt: new Date().toISOString(), documentId: this.documentId.trim(), sha256: this.sha256.trim() }
        : { outcome: 'failed' as const, channel: this.channel, reason: this.reason.trim() };
    const r = await act(
      () => this.api.POST('/v1/notices/{noticeId}/deliveries', { params: { path: { noticeId: this.noticeId }, header: { 'Idempotency-Key': this.keys.for('report') } }, body }),
      () => ({ variant: 'success', text: msg('Reported.', { id: 'notice.reported' }) }),
    );
    this.busy = false;
    this.result = r.notice;
    if (r.ok) {
      this.keys.done('report');
      void this.load();
    }
  }

  private deliveryColumns(): Column<Delivery>[] {
    const lang = getLocale();
    return [
      { key: 'outcome', header: msg('Result', { id: 'claim.result' }), value: (d) => (d.outcome === 'sent' ? msg('Sent', { id: 'notices.tab.sent' }) : msg('Failed', { id: 'notice.failed' })) },
      { key: 'channel', header: msg('Channel', { id: 'claims.col.channel' }), value: (d) => d.channel ?? '–' },
      { key: 'sentAt', header: msg('When', { id: 'policy.when' }), value: (d) => formatDateTime(d.sentAt ?? d.reportedAt, lang) },
      { key: 'document', header: msg('Document or reason', { id: 'notice.documentOrReason' }), value: (d) => d.documentId ?? d.reason ?? '–' },
      { key: 'by', header: msg('By', { id: 'policy.by' }), value: (d) => d.reportedBy },
    ];
  }
}
