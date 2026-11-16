/** <pv-notices-queue>: notices to the customer, first the ones that need a person (ADR 0032). */
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
import { formatDate } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { noticeFlags } from '../integration-logic.ts';
import { append, emptyPager, hasMore, type Pager } from '../pager.ts';
import { navigate } from '../router.ts';
import { noticeFlagLabel, noticeStatusLabel, noticeTypeLabel } from './labels.ts';

type Notice = components['schemas']['Notice'];
type Tab = 'attention' | 'pending' | 'sent' | 'late' | 'all';
const TABS: Tab[] = ['attention', 'pending', 'sent', 'late', 'all'];

@customElement('pv-notices-queue')
export class NoticesQueue extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private tab: Tab = 'attention';
  @state() private pager: Pager<Notice> = emptyPager();
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
    wa-badge + wa-badge {
      margin-inline-start: var(--wa-space-2xs);
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private query(): Record<string, string | boolean> {
    switch (this.tab) {
      case 'attention':
        return { attention: true };
      case 'late':
        return { late: true };
      case 'pending':
      case 'sent':
        return { status: this.tab };
      default:
        return {};
    }
  }

  private async load() {
    if (!hasMore(this.pager) || this.loading) return;
    const id = ++this.request;
    this.loading = true;
    this.error = '';
    try {
      const page = await unwrap(this.api.GET('/v1/notices', { params: { query: { ...this.query(), limit: 50, ...(this.pager.next ? { cursor: this.pager.next } : {}) } } }));
      if (id === this.request) this.pager = append(this.pager, page);
    } catch (e) {
      if (id === this.request) this.error = (e as { title?: string }).title ?? msg('Something went wrong.', { id: 'common.error' });
    } finally {
      if (id === this.request) this.loading = false;
    }
  }

  private show(tab: Tab) {
    this.tab = tab;
    this.pager = emptyPager();
    this.loading = false;
    void this.load();
  }

  private tabLabel(t: Tab) {
    switch (t) {
      case 'attention':
        return msg('Needs a person', { id: 'notices.tab.attention' });
      case 'pending':
        return msg('Waiting', { id: 'notices.tab.pending' });
      case 'sent':
        return msg('Sent', { id: 'notices.tab.sent' });
      case 'late':
        return msg('Sent late', { id: 'notices.tab.late' });
      default:
        return msg('All', { id: 'claims.all' });
    }
  }

  private columns(): Column<Notice>[] {
    const lang = getLocale();
    return [
      { key: 'type', header: msg('Notice', { id: 'notices.notice' }), value: (n) => noticeTypeLabel(n.type) },
      { key: 'recipient', header: msg('Recipient', { id: 'notices.recipient' }), value: (n) => n.recipientPartyId },
      { key: 'about', header: msg('About', { id: 'notices.about' }), value: (n) => n.policyId ?? n.applicationId ?? '–' },
      { key: 'dueBy', header: msg('Send by', { id: 'notices.dueBy' }), value: (n) => formatDate(n.dueBy, lang) },
      { key: 'status', header: msg('Status', { id: 'claims.col.status' }), value: (n) => noticeStatusLabel(n.status) },
      {
        key: 'flags',
        header: msg('Needs', { id: 'notices.flags' }),
        value: (n) => html`${noticeFlags(n).map((f) => html`<wa-badge variant=${f === 'late' ? 'warning' : 'danger'}>${noticeFlagLabel(f)}</wa-badge>`)}`,
      },
    ];
  }

  render() {
    return html`
      <h2>${msg('Notices', { id: 'notices.title' })}</h2>
      <wa-tab-group @wa-tab-show=${(e: CustomEvent<{ name: string }>) => this.show(e.detail.name as Tab)}>
        ${TABS.map((t) => html`<wa-tab panel=${t} ?active=${t === this.tab}>${this.tabLabel(t)}</wa-tab>`)}
      </wa-tab-group>
      <pv-data-grid
        .columns=${this.columns()}
        .rows=${this.pager.items}
        label=${msg('Notices', { id: 'notices.title' })}
        ?loading=${this.loading}
        ?has-more=${hasMore(this.pager) && this.pager.loaded}
        error=${this.error}
        empty-text=${msg('Nothing to show.', { id: 'common.empty' })}
        more-text=${msg('Show more', { id: 'common.more' })}
        retry-text=${msg('Try again', { id: 'common.retry' })}
        @pv-load-more=${() => this.load()}
        @pv-row-activate=${(e: CustomEvent<{ row: Notice }>) => navigate(`/notices/${encodeURIComponent(e.detail.row.id)}`)}
      ></pv-data-grid>
    `;
  }
}
