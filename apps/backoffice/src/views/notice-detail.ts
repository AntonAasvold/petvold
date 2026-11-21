/**
 * <pv-notice-detail>: a notice as the design system lays out a detail page
 * (docs/teknik/designsystem.md, "Detaljsidan"): its content, legal basis and
 * deliveries beside reporting a delivery, the PDF and the history (ADR 0032, 0038).
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice as ActionNotice } from '../actions.ts';
import '../components/data-grid.ts';
import '../components/event-log.ts';
import type { LogEntry } from '../components/event-log.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { partyName } from '../policy-logic.ts';
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
  /** The recipient by name, for the head; left as an id without parties:read. */
  @state() private recipient: components['schemas']['Party'] | null = null;
  private keys = new IdempotencyKeys();

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
      a {
        color: var(--ink);
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
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      .pv-card__body p {
        margin: 0;
      }
      .pv-dl__row dd {
        overflow-wrap: anywhere;
      }
      ul.docs {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      ul.docs li {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2) 0;
      }
      ul.law {
        margin: 0;
        padding-left: var(--space-5);
      }
      form {
        display: grid;
        gap: var(--space-4);
      }
      fieldset {
        display: grid;
        gap: var(--space-3);
        margin: 0;
        padding: 0;
        border: 0;
      }
      legend {
        padding: 0 0 var(--space-2);
        font: 500 13px/1.4 var(--font-sans);
        color: var(--text-secondary);
      }
      .pv-choice:focus-within {
        outline: var(--border-strong) solid var(--focus);
        outline-offset: 2px;
      }
      /* A structured value takes the whole row, under its label, left-aligned. */
      .pv-dl__row:has(pre) {
        flex-direction: column;
      }
      .pv-dl__row:has(pre) dd {
        text-align: left;
        font-weight: 400;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        font: 12px/1.5 var(--font-mono);
        text-align: left;
      }
      @media (max-width: 900px) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('noticeId') || changed.has('api')) void this.load();
  }

  private async load() {
    this.problem = null;
    try {
      this.notice = await unwrap(this.api.GET('/v1/notices/{noticeId}', { params: { path: { noticeId: this.noticeId } } }));
    } catch (e) {
      this.problem = e as Problem;
      return;
    }
    const partyId = this.notice.recipientPartyId;
    void this.api.GET('/v1/parties/{partyId}', { params: { path: { partyId } } }).then((r) => (this.recipient = r.data ?? null), () => undefined);
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
    return html`<section class="pv-card" aria-labelledby="pdf">
      <div class="pv-card__head"><h2 class="pv-card__title" id="pdf">${msg('PDF from Petvold', { id: 'notice.pdfTitle' })}</h2></div>
      <div class="pv-card__body">
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
      </div>
    </section>`;
  }

  render() {
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/notices" @click=${(e: Event) => (e.preventDefault(), navigate('/notices'))}>${msg('Notices', { id: 'notices.title' })}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${this.noticeId}</span>
    </nav>`;
    if (this.problem) {
      const text = this.problem.status === 404 ? msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' }) : this.problem.title;
      return html`${crumbs}<wa-callout variant=${this.problem.status === 404 ? 'neutral' : 'danger'}>${text}</wa-callout>`;
    }
    const n = this.notice;
    if (!n) return html`${crumbs}<wa-spinner></wa-spinner>`;
    const lang = getLocale();
    const link = (href: string, text: string, mono = false) =>
      html`<a href=${href} @click=${(e: Event) => (e.preventDefault(), navigate(href))}><strong class=${mono ? 'pv-mono' : ''}>${text}</strong></a>`;
    const row = (label: string, value: unknown, mono = false) => html`<div class="pv-dl__row"><dt>${label}</dt><dd class=${mono ? 'pv-mono' : ''}>${value}</dd></div>`;
    return html`
      ${crumbs}
      <div class="title">
        <h1>${noticeTypeLabel(n.type)}</h1>
        <span class="pv-badge pv-badge--id">${n.id}</span>
        <span class="pv-badge ${n.status === 'pending' ? 'pv-badge--pending' : 'pv-badge--solid'}">${noticeStatusLabel(n.status)}</span>
        ${noticeFlags(n).map((f) => html`<span class="pv-badge pv-badge--pending">${noticeFlagLabel(f)}</span>`)}
      </div>
      <ul class="facts">
        <li>${msg('Recipient', { id: 'notices.recipient' })}: ${link(`/parties/${n.recipientPartyId}`, partyName(this.recipient) || n.recipientPartyId)} (${n.language})</li>
        ${n.policyId ? html`<li>${msg('Policy', { id: 'claims.col.policy' })}: ${link(`/policies/${n.policyId}`, n.policyId, true)}</li>` : nothing}
        ${n.applicationId ? html`<li>${msg('Application', { id: 'application.title' })}: ${link(`/applications/${n.applicationId}`, n.applicationId, true)}</li>` : nothing}
        ${typeof n.content.claimId === 'string'
          ? html`<li>${msg('Claim', { id: 'claim.title' })}: ${link(`/claims/${n.content.claimId}`, String(n.content.claimNo ?? n.content.claimId), true)}</li>`
          : nothing}
        <li>${msg('Send by', { id: 'notices.dueBy' })}: <strong>${formatDate(n.dueBy, lang)}</strong></li>
      </ul>
      ${this.result ? html`<wa-callout variant=${this.result.variant} role=${this.result.variant === 'danger' ? 'alert' : 'status'}>${this.result.text}</wa-callout>` : nothing}
      ${n.incomplete?.length && n.status !== 'sent'
        ? html`<wa-callout variant="danger"
            >${msg("The insurer's settings lack a text the law requires:", { id: 'notice.incompleteHelp' })} ${n.incomplete.join(', ')}</wa-callout
          >`
        : nothing}
      <div class="cols">
        <div class="basis">
          <section class="pv-card" aria-labelledby="content">
            <div class="pv-card__head">
              <h2 class="pv-card__title" id="content">${msg('Content', { id: 'notice.content' })}</h2>
              <span class="pv-card__meta pv-mono">${n.schema}</span>
            </div>
            <div class="pv-card__body">
              <dl class="pv-dl">
                ${Object.entries(n.content).map(([k, v]) => row(k, typeof v === 'object' ? html`<pre>${JSON.stringify(v, null, 2)}</pre>` : String(v)))}
              </dl>
            </div>
          </section>
          <section class="pv-card" aria-labelledby="law">
            <div class="pv-card__head"><h2 class="pv-card__title" id="law">${msg('Legal basis', { id: 'notice.legalBasis' })}</h2></div>
            <div class="pv-card__body">
              ${n.legalBasis.length ? html`<ul class="law">${n.legalBasis.map((l) => html`<li>${l}</li>`)}</ul>` : html`<p>${msg('Not required by law.', { id: 'notice.noLaw' })}</p>`}
            </div>
          </section>
          <section class="pv-card" aria-labelledby="deliveries">
            <div class="pv-card__head"><h2 class="pv-card__title" id="deliveries">${msg('Deliveries', { id: 'notice.deliveries' })}</h2></div>
            <pv-data-grid
              .columns=${this.deliveryColumns()}
              .rows=${n.deliveries}
              label=${msg('Deliveries', { id: 'notice.deliveries' })}
              empty-text=${msg('Not sent yet.', { id: 'notice.notSent' })}
            ></pv-data-grid>
          </section>
          <section class="pv-card" aria-labelledby="details">
            <div class="pv-card__head"><h2 class="pv-card__title" id="details">${msg('Details', { id: 'claim.facts' })}</h2></div>
            <div class="pv-card__body">
              <dl class="pv-dl">
                ${row(msg('Made from', { id: 'notice.source' }), `${n.source.eventType}, ${formatDateTime(n.source.occurredAt, lang)}`)}
                ${row(
                  msg('The document is made by', { id: 'notice.documentMaker' }),
                  html`${n.documentMaker === 'petvold' ? msg('Petvold', { id: 'settings.makerPetvold' }) : msg("The insurer's document system", { id: 'settings.makerInsurer' })}
                  ${n.documentMaker === 'petvold' && !n.document ? html`<span class="pv-badge pv-badge--pending">${msg('Not made yet', { id: 'notice.pdfPending' })}</span>` : nothing}`,
                )}
                ${n.settingsVersion ? row(msg('Settings version', { id: 'notice.settingsVersion' }), n.settingsVersion) : nothing}
              </dl>
            </div>
          </section>
        </div>
        <div class="side">
          ${this.documentsCard(n)} ${mayReportDelivery(this.me) ? this.reportForm() : nothing}
          <pv-event-log heading=${msg('History', { id: 'claim.history' })} .entries=${this.historyEntries(n)}></pv-event-log>
        </div>
      </div>
    `;
  }

  /** Made, the PDF, and every delivery report: newest first. */
  private historyEntries(n: Notice): LogEntry[] {
    const out: LogEntry[] = [
      { key: 'created', at: n.createdAt, state: 'solid', badge: msg('Made', { id: 'notice.made' }), line: n.source.eventType, status: 'notice.created' },
    ];
    if (n.document) {
      out.push({ key: 'document', at: n.document.madeAt, state: 'solid', badge: 'PDF', line: n.document.id, status: `notice.document_made · ${n.document.madeBy}` });
    }
    for (const d of n.deliveries) {
      out.push({
        key: d.id,
        at: d.reportedAt,
        state: d.outcome === 'sent' ? 'solid' : 'pending',
        badge: d.outcome === 'sent' ? msg('Sent', { id: 'notices.tab.sent' }) : msg('Failed', { id: 'notice.failed' }),
        line: d.outcome === 'sent' ? `${d.channel ?? ''}${d.documentId ? ` · ${d.documentId}` : ''}` : (d.reason ?? ''),
        status: `notice.${d.outcome === 'sent' ? 'delivered' : 'failed'} · ${d.reportedBy}`,
      });
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  private reportForm() {
    const choice = (value: 'sent' | 'failed', title: string, desc: string) => html`<label class="pv-choice">
      <input type="radio" name="outcome" value=${value} .checked=${this.outcome === value} @change=${() => (this.outcome = value)} />
      <span>
        <span class="pv-choice__title">${title}</span>
        <span class="pv-choice__desc">${desc}</span>
      </span>
    </label>`;
    return html`<section class="pv-card ${this.notice?.status === 'sent' ? '' : 'pv-card--strong'}" aria-labelledby="report">
      <div class="pv-card__head"><h2 class="pv-card__title" id="report">${msg('Report a delivery', { id: 'notice.report' })}</h2></div>
      <form class="pv-card__body" @submit=${this.report}>
        <fieldset>
          <legend>${msg('Result', { id: 'claim.result' })}</legend>
          ${choice('sent', msg('Sent', { id: 'notices.tab.sent' }), msg('The customer got it: with the channel and, unless Petvold made it, the document in the archive.', { id: 'notice.sentDesc' }))}
          ${choice('failed', msg('Failed', { id: 'notice.failed' }), msg('It could not be sent, e.g. no address. The notice stays in the queue.', { id: 'notice.failedDesc' }))}
        </fieldset>
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
    </section>`;
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
