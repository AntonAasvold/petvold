/** <pv-applications-queue>: applications, first the queue for manual underwriting (ADR 0031). */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { append, emptyPager, hasMore, type Pager } from '../pager.ts';
import { navigate } from '../router.ts';
import { applicationStatusLabel } from './labels.ts';

type Application = components['schemas']['Application'];
type Status = Application['status'];
const TABS: (Status | 'all')[] = ['referred', 'accepted', 'declined', 'all'];

@customElement('pv-applications-queue')
export class ApplicationsQueue extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private tab: Status | 'all' = 'referred';
  @state() private pager: Pager<Application> = emptyPager();
  @state() private loading = false;
  @state() private error = '';
  private request = 0;

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
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
        this.api.GET('/v1/applications', { params: { query: { ...(this.tab !== 'all' ? { status: this.tab } : {}), limit: 50, ...(this.pager.next ? { cursor: this.pager.next } : {}) } } }),
      );
      if (id === this.request) this.pager = append(this.pager, page);
    } catch (e) {
      if (id === this.request) this.error = (e as { title?: string }).title ?? msg('Something went wrong.', { id: 'common.error' });
    } finally {
      if (id === this.request) this.loading = false;
    }
  }

  private show(tab: Status | 'all') {
    this.tab = tab;
    this.pager = emptyPager();
    this.loading = false;
    void this.load();
  }

  private columns(): Column<Application>[] {
    const lang = getLocale();
    return [
      { key: 'id', header: msg('Application', { id: 'application.title' }), value: (a) => a.id },
      { key: 'received', header: msg('Received', { id: 'claims.col.received' }), value: (a) => formatDateTime(a.receivedAt, lang) },
      { key: 'animal', header: msg('Animal', { id: 'policy.animal' }), value: (a) => a.animalId },
      { key: 'product', header: msg('Product', { id: 'policy.product' }), value: (a) => a.productVersion },
      { key: 'reasons', header: msg('Reasons', { id: 'application.reasons' }), value: (a) => a.underwriting.result.reasons.join(', ') || '–' },
      { key: 'deadline', header: msg('Decide by', { id: 'application.deadline' }), value: (a) => (a.deadline ? formatDate(a.deadline, lang) : '–') },
      { key: 'status', header: msg('Status', { id: 'claims.col.status' }), value: (a) => applicationStatusLabel(a.status) },
      { key: 'premium', header: msg('Premium', { id: 'policy.premium' }), align: 'end', value: (a) => formatMoney(a.premium.amount, a.premium.currency, lang) },
    ];
  }

  render() {
    return html`
      <h2>${msg('Applications', { id: 'applications.title' })}</h2>
      <wa-tab-group @wa-tab-show=${(e: CustomEvent<{ name: string }>) => this.show(e.detail.name as Status | 'all')}>
        ${TABS.map((t) => html`<wa-tab panel=${t} ?active=${t === this.tab}>${t === 'all' ? msg('All', { id: 'claims.all' }) : applicationStatusLabel(t)}</wa-tab>`)}
      </wa-tab-group>
      <pv-data-grid
        .columns=${this.columns()}
        .rows=${this.pager.items}
        label=${msg('Applications', { id: 'applications.title' })}
        ?loading=${this.loading}
        ?has-more=${hasMore(this.pager) && this.pager.loaded}
        error=${this.error}
        empty-text=${msg('Nothing to show.', { id: 'common.empty' })}
        more-text=${msg('Show more', { id: 'common.more' })}
        retry-text=${msg('Try again', { id: 'common.retry' })}
        @pv-load-more=${() => this.load()}
        @pv-row-activate=${(e: CustomEvent<{ row: Application }>) => navigate(`/applications/${encodeURIComponent(e.detail.row.id)}`)}
      ></pv-data-grid>
    `;
  }
}
