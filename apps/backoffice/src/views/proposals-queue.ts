/** <pv-proposals-queue>: proposals that wait for an answer: transfers to a new owner and cancellations when an animal died. */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { formatDate, formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { append, emptyPager, hasMore, type Pager } from '../pager.ts';
import { navigate } from '../router.ts';
import { proposalKindLabel } from './labels.ts';

type Proposal = components['schemas']['PolicyProposal'];

@customElement('pv-proposals-queue')
export class ProposalsQueue extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private pager: Pager<Proposal> = emptyPager();
  @state() private loading = false;
  @state() private error = '';

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    h2 {
      margin-top: 0;
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    if (!hasMore(this.pager) || this.loading) return;
    this.loading = true;
    this.error = '';
    try {
      this.pager = append(this.pager, await unwrap(this.api.GET('/v1/policy-proposals', { params: { query: { status: 'pending', limit: 50, ...(this.pager.next ? { cursor: this.pager.next } : {}) } } })));
    } catch (e) {
      this.error = (e as { title?: string }).title ?? msg('Something went wrong.', { id: 'common.error' });
    } finally {
      this.loading = false;
    }
  }

  private columns(): Column<Proposal>[] {
    const lang = getLocale();
    return [
      { key: 'kind', header: msg('Proposal', { id: 'claim.proposed' }), value: (p) => proposalKindLabel(p.kind) },
      { key: 'policy', header: msg('Policy', { id: 'claims.col.policy' }), value: (p) => p.policyId },
      { key: 'to', header: msg('To', { id: 'proposal.to' }), value: (p) => p.details.toPartyId ?? '–' },
      { key: 'created', header: msg('Received', { id: 'claims.col.received' }), value: (p) => formatDateTime(p.createdAt, lang) },
      { key: 'deadline', header: msg('Answer by', { id: 'proposal.deadline' }), value: (p) => (p.deadline ? formatDate(p.deadline, lang) : '–') },
    ];
  }

  render() {
    return html`
      <h2>${msg('Proposals', { id: 'proposals.title' })}</h2>
      <pv-data-grid
        .columns=${this.columns()}
        .rows=${this.pager.items}
        label=${msg('Proposals', { id: 'proposals.title' })}
        ?loading=${this.loading}
        ?has-more=${hasMore(this.pager) && this.pager.loaded}
        error=${this.error}
        empty-text=${msg('No proposals wait for an answer.', { id: 'proposals.none' })}
        more-text=${msg('Show more', { id: 'common.more' })}
        retry-text=${msg('Try again', { id: 'common.retry' })}
        @pv-load-more=${() => this.load()}
        @pv-row-activate=${(e: CustomEvent<{ row: Proposal }>) => navigate(`/policies/${encodeURIComponent(e.detail.row.policyId)}`)}
      ></pv-data-grid>
    `;
  }
}
