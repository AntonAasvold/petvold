/** <pv-claims-queue>: the work queues for claims, a page at a time (GET /v1/claims). */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { append, emptyPager, hasMore, type Pager } from '../pager.ts';
import { navigate } from '../router.ts';
import { claimStatusLabel, statusVariant } from './labels.ts';
import type { Me } from '../permissions.ts';

type ClaimSummary = components['schemas']['ClaimSummary'];
type Status = ClaimSummary['status'];
const QUEUES: (Status | 'all')[] = ['awaiting-decision', 'awaiting-approval', 'review-requested', 'decided', 'withdrawn', 'dismissed', 'all'];

@customElement('pv-claims-queue')
export class ClaimsQueue extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @state() private queue: Status | 'all' = 'awaiting-decision';
  @state() private pager: Pager<ClaimSummary> = emptyPager();
  @state() private loading = false;
  @state() private error = '';
  /** Ignores answers to a queue no longer shown. */
  private request = 0;

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--wa-space-m);
    }
    h2 {
      margin-top: 0;
    }
    wa-tab-group {
      margin-bottom: var(--wa-space-m);
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    if (!hasMore(this.pager) || this.loading) return;
    const id = ++this.request;
    this.loading = true;
    this.error = '';
    try {
      const page = await unwrap(
        this.api.GET('/v1/claims', {
          params: { query: { ...(this.queue !== 'all' ? { status: this.queue } : {}), limit: 50, ...(this.pager.next ? { cursor: this.pager.next } : {}) } },
        }),
      );
      if (id === this.request) this.pager = append(this.pager, page);
    } catch (e) {
      if (id === this.request) this.error = (e as { title?: string }).title ?? msg('Something went wrong.', { id: 'common.error' });
    } finally {
      if (id === this.request) this.loading = false;
    }
  }

  private show(queue: Status | 'all') {
    this.queue = queue;
    this.pager = emptyPager();
    this.loading = false;
    void this.load();
  }

  private columns(): Column<ClaimSummary>[] {
    const lang = getLocale();
    return [
      { key: 'claimNo', header: msg('Claim number', { id: 'claims.col.claimNo' }), value: (c) => c.claimNo },
      { key: 'receivedAt', header: msg('Received', { id: 'claims.col.received' }), value: (c) => formatDateTime(c.receivedAt, lang) },
      { key: 'treatmentFrom', header: msg('Treatment from', { id: 'claims.col.treatment' }), value: (c) => formatDate(c.treatmentFrom, lang) },
      { key: 'diagnosisCode', header: msg('Diagnosis', { id: 'claims.col.diagnosis' }), value: (c) => c.diagnosisCode },
      { key: 'policyId', header: msg('Policy', { id: 'claims.col.policy' }), value: (c) => c.policyId },
      { key: 'status', header: msg('Status', { id: 'claims.col.status' }), value: (c) => html`<wa-badge variant=${statusVariant(c.status)}>${claimStatusLabel(c.status)}</wa-badge>` },
      { key: 'payout', header: msg('Payout', { id: 'claims.col.payout' }), align: 'end', value: (c) => (c.latestDecision ? formatMoney(c.latestDecision.payout, c.currency, lang) : '–') },
    ];
  }

  render() {
    return html`
      <div class="head">
        <h2>${msg('Claims', { id: 'claims.title' })}</h2>
        ${this.me?.permissions.includes('claims:register')
          ? html`<wa-button appearance="outlined" @click=${() => navigate('/claims/new')}><wa-icon slot="start" name="plus"></wa-icon>${msg('Register a claim', { id: 'register.title' })}</wa-button>`
          : nothing}
      </div>
      <wa-tab-group @wa-tab-show=${(e: CustomEvent<{ name: string }>) => this.show(e.detail.name as Status | 'all')}>
        ${QUEUES.map((q) => html`<wa-tab panel=${q} ?active=${q === this.queue}>${q === 'all' ? msg('All', { id: 'claims.all' }) : claimStatusLabel(q)}</wa-tab>`)}
      </wa-tab-group>
      <pv-data-grid
        .columns=${this.columns()}
        .rows=${this.pager.items}
        label=${msg('Claims', { id: 'claims.title' })}
        ?loading=${this.loading}
        ?has-more=${hasMore(this.pager) && this.pager.loaded}
        error=${this.error}
        empty-text=${msg('Nothing to show.', { id: 'common.empty' })}
        more-text=${msg('Show more', { id: 'common.more' })}
        retry-text=${msg('Try again', { id: 'common.retry' })}
        @pv-load-more=${() => this.load()}
        @pv-row-activate=${(e: CustomEvent<{ row: ClaimSummary }>) => navigate(`/claims/${encodeURIComponent(e.detail.row.id)}`)}
      ></pv-data-grid>
    `;
  }
}
