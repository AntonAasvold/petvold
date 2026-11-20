/**
 * <pv-party-documents>: every document about a customer, wherever it is kept
 * (ADR 0038 point 8): Petvold's archive opens through a link that works 15
 * minutes, the insurer's archive at its address, and a letter the insurer's
 * document system sent shows its archive id.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import type { Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { formatSize } from '../attachment-logic.ts';
import { openWith } from '../document-logic.ts';
import { formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { attachmentKindLabel, noticeTypeLabel } from '../views/labels.ts';
import './data-grid.ts';
import type { Column } from './data-grid.ts';

type CustomerDocument = components['schemas']['CustomerDocument'];

@customElement('pv-party-documents')
export class PartyDocuments extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: 'party-id' }) partyId = '';
  @state() private items: CustomerDocument[] = [];
  @state() private loading = true;
  @state() private error = '';

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
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('partyId') && this.partyId) void this.load();
  }

  private async load() {
    this.loading = true;
    const { data, error } = await this.api.GET('/v1/parties/{partyId}/documents', { params: { path: { partyId: this.partyId }, query: { limit: 200 } } });
    this.items = data?.items ?? [];
    this.error = data ? '' : ((error as { title?: string } | undefined)?.title ?? msg('Something went wrong.', { id: 'common.error' }));
    this.loading = false;
  }

  private async open(documentId: string) {
    const { data, error } = await this.api.POST('/v1/documents/{documentId}/links', {
      params: { path: { documentId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { audience: 'internal' },
    });
    if (data) window.open(data.url, '_blank', 'noopener');
    else this.error = (error as { title?: string } | undefined)?.title ?? msg('Something went wrong.', { id: 'common.error' });
  }

  private columns(): Column<CustomerDocument>[] {
    const lang = getLocale();
    const go = (path: string) => (e: Event) => (e.preventDefault(), e.stopPropagation(), navigate(path));
    return [
      { key: 'at', header: msg('Date', { id: 'document.date' }), value: (d) => formatDateTime(d.at, lang) },
      {
        key: 'what',
        header: msg('Document', { id: 'document.what' }),
        value: (d) => (d.type === 'notice' && d.noticeType ? noticeTypeLabel(d.noticeType) : d.kind ? attachmentKindLabel(d.kind) : (d.filename ?? '–')),
      },
      {
        key: 'about',
        header: msg('About', { id: 'document.about' }),
        value: (d) =>
          d.claimId
            ? html`<a href=${`/claims/${d.claimId}`} @click=${go(`/claims/${encodeURIComponent(d.claimId)}`)} class="pv-mono">${d.claimId}</a>`
            : d.policyId
              ? html`<a href=${`/policies/${d.policyId}`} @click=${go(`/policies/${encodeURIComponent(d.policyId)}`)} class="pv-mono">${d.policyId}</a>`
              : '–',
      },
      {
        key: 'where',
        header: msg('Kept in', { id: 'document.where' }),
        value: (d) => (d.source === 'petvold' ? msg("Petvold's archive", { id: 'document.petvold' }) : msg("The insurer's archive", { id: 'document.insurer' })),
      },
      { key: 'size', header: msg('Size', { id: 'document.size' }), align: 'end', value: (d) => (d.size ? formatSize(d.size) : '–') },
      {
        key: 'open',
        header: msg('Open', { id: 'history.open' }),
        value: (d) => {
          const how = openWith(d);
          if (how.kind === 'link') {
            return html`<wa-button size="small" appearance="outlined" @click=${(e: Event) => (e.stopPropagation(), void this.open(how.documentId))}>${msg('Open', { id: 'history.open' })}</wa-button>`;
          }
          if (how.kind === 'address') return html`<a href=${how.url} target="_blank" rel="noopener noreferrer">${msg('Open in the archive', { id: 'attachment.open' })}</a>`;
          if (how.kind === 'reference') return html`<span class="pv-mono" title=${msg("The id in the insurer's archive", { id: 'document.archiveId' })}>${how.id}</span>`;
          return d.erased ? msg('Erased', { id: 'document.erased' }) : '–';
        },
      },
    ];
  }

  render() {
    return html`<section class="pv-card" aria-labelledby="documents">
      <div class="pv-card__head">
        <h2 class="pv-card__title" id="documents">${msg('Documents', { id: 'document.title' })}</h2>
        <span class="pv-card__meta">${msg("Petvold's and the insurer's archive", { id: 'document.meta' })}</span>
      </div>
      ${this.error ? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>` : nothing}
      <pv-data-grid
        .columns=${this.columns()}
        .rows=${this.items}
        ?loading=${this.loading}
        label=${msg('Documents', { id: 'document.title' })}
        empty-text=${msg('No documents.', { id: 'document.none' })}
      ></pv-data-grid>
    </section>`;
  }
}
