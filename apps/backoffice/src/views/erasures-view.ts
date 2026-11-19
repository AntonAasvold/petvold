/** <pv-erasures>: requests to anonymize a party (ADR 0028), waiting or decided. */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { erasureBasisLabel, erasureOutcomeLabel } from './labels.ts';

type Request = components['schemas']['ErasureRequest'];

@customElement('pv-erasures')
export class ErasuresView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private status: 'pending' | 'decided' = 'pending';
  @state() private items: Request[] = [];
  @state() private loading = false;

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      h1 {
        margin: 0;
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
      }
      p {
        margin: 0;
        max-width: 60ch;
        color: var(--text-secondary);
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    this.loading = true;
    try {
      this.items = (await unwrap(this.api.GET('/v1/erasure-requests', { params: { query: { status: this.status } } }))).items;
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html`
      <h1>${msg('Erasure', { id: 'nav.erasures' })}</h1>
      <p>${msg('Requests to anonymize a party. Another privacy officer approves; the one who asked never does. Anonymizing cannot be undone.', { id: 'erasure.lead' })}</p>
      <wa-tab-group @wa-tab-show=${(e: CustomEvent<{ name: string }>) => ((this.status = e.detail.name as 'pending' | 'decided'), void this.load())}>
        <wa-tab panel="pending" ?active=${this.status === 'pending'}>${msg('Waiting', { id: 'erasure.pending' })}</wa-tab>
        <wa-tab panel="decided" ?active=${this.status === 'decided'}>${msg('Decided', { id: 'claims.status.decided' })}</wa-tab>
      </wa-tab-group>
      <pv-data-grid
        .columns=${this.columns()}
        .rows=${this.items}
        ?loading=${this.loading}
        label=${msg('Erasure', { id: 'nav.erasures' })}
        empty-text=${msg('No requests.', { id: 'erasure.none' })}
        @pv-row-activate=${(e: CustomEvent<{ row: Request }>) => navigate(`/erasures/${encodeURIComponent(e.detail.row.id)}`)}
      ></pv-data-grid>
    `;
  }

  private columns(): Column<Request>[] {
    const lang = getLocale();
    return [
      { key: 'at', header: msg('Requested', { id: 'review.requested' }), value: (r) => formatDateTime(r.requestedAt, lang) },
      { key: 'party', header: msg('Party id', { id: 'party.id' }), value: (r) => r.partyId },
      { key: 'basis', header: msg('Basis', { id: 'erasure.basis' }), value: (r) => erasureBasisLabel(r.basis) },
      { key: 'by', header: msg('Requested by', { id: 'erasure.by' }), value: (r) => r.requestedBy },
      {
        key: 'outcome',
        header: msg('Result', { id: 'claim.result' }),
        value: (r) => (r.decision ? html`<wa-badge variant=${r.decision.outcome === 'approved' ? 'success' : 'neutral'}>${erasureOutcomeLabel(r.decision.outcome)}</wa-badge>` : '–'),
      },
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-erasures': ErasuresView;
  }
}
