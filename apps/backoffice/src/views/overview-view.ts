/**
 * <pv-overview>: the back office's start page. What waits for a person, per
 * queue the caller may see, the queues with something first; and for those
 * who follow them, runs that failed and the last closed day.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import type { Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { formatDate } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { failedJobs, ordered, queuesFor, type Queue } from '../overview-logic.ts';
import { can, countLabel, type Me } from '../permissions.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';

type DayClose = components['schemas']['DayClose'];
type Row = { queue: Queue; count: string };

@customElement('pv-overview')
export class OverviewView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @state() private rows: Row[] = [];
  @state() private failed: { id: string; markets: string[] }[] | null = null;
  @state() private lastDays: DayClose[] | null = null;
  @state() private loading = true;

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
      h2 {
        margin-top: 0;
      }
      section + section {
        margin-top: var(--space-6);
      }
      h3 {
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-secondary);
        margin: 0 0 var(--space-3);
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
        gap: var(--space-3);
      }
      a.queue {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        padding: var(--space-4);
        border: var(--border-strong) solid var(--line-control);
        border-radius: var(--radius-md);
        color: inherit;
        text-decoration: none;
        background: var(--paper);
      }
      a.queue:hover,
      a.queue:focus-visible {
        border-color: var(--ink);
      }
      a.queue.empty {
        border-style: dashed;
        color: var(--text-secondary);
      }
      .count {
        font: 700 28px/1.1 var(--font-display, var(--font-sans));
      }
      .title {
        font-weight: 600;
      }
      .desc {
        font-size: 13px;
        color: var(--text-secondary);
      }
      .pv-card__body p {
        margin: 0;
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('me') && changed.get('me') === null && this.me) void this.load();
  }

  private async load() {
    if (!this.me) return;
    this.loading = true;
    const get = this.api.GET as (p: string, o: unknown) => Promise<{ data?: { items: unknown[]; nextCursor?: string } }>;
    const rows = await Promise.all(
      queuesFor(this.me).map(async (queue) => {
        const { data } = await get(queue.api, { params: { query: { ...queue.query, limit: 100 } } }).catch(() => ({ data: undefined }));
        return { queue, count: data ? countLabel(data) : '' };
      }),
    );
    this.rows = ordered(rows);
    if (can(this.me, 'jobs:read')) {
      const { data } = await this.api.GET('/v1/jobs').catch(() => ({ data: undefined }));
      this.failed = data ? failedJobs(data.items) : null;
    }
    if (can(this.me, 'accounting:read')) {
      const { data } = await this.api.GET('/v1/day-closes', { params: { query: { limit: 200 } } }).catch(() => ({ data: undefined }));
      // The last closed day per market.
      const last = new Map<string, DayClose>();
      for (const d of data?.items ?? []) if (!last.has(d.market) || last.get(d.market)!.day < d.day) last.set(d.market, d);
      this.lastDays = [...last.values()].sort((a, b) => a.market.localeCompare(b.market));
    }
    this.loading = false;
  }

  private text(key: string): [string, string] {
    switch (key) {
      case 'claims.decide':
        return [msg('Claims to decide', { id: 'overview.claimsDecide' }), msg('Waiting for a handler', { id: 'overview.claimsDecideDesc' })];
      case 'claims.approve':
        return [msg('Proposals to approve', { id: 'overview.claimsApprove' }), msg('Above the handler’s limit', { id: 'overview.claimsApproveDesc' })];
      case 'claims.review':
        return [msg('Reviews asked for', { id: 'overview.claimsReview' }), msg('The customer asked a person to review an automated decision', { id: 'overview.claimsReviewDesc' })];
      case 'applications':
        return [msg('Applications to underwrite', { id: 'overview.applications' }), msg('The rules referred them to a person', { id: 'overview.applicationsDesc' })];
      case 'proposals':
        return [msg('Proposals to answer', { id: 'overview.proposals' }), msg('A new owner or an animal that died', { id: 'overview.proposalsDesc' })];
      case 'notices':
        return [msg('Notices that need a person', { id: 'overview.notices' }), msg('Failed, late, or missing a text the law asks for', { id: 'overview.noticesDesc' })];
      case 'money.unmatched':
        return [msg('Unmatched payments', { id: 'money.tab.unmatched' }), msg('Came in without a usable reference', { id: 'overview.unmatchedDesc' })];
      case 'money.held':
        return [msg('Held payouts', { id: 'money.tab.held' }), msg('New payee details: someone else releases them', { id: 'overview.heldDesc' })];
      case 'money.awaiting':
        return [msg('Awaiting details', { id: 'payout.awaitingDetails' }), msg('The payee has given no account', { id: 'overview.awaitingDesc' })];
      case 'money.proposals':
        return [msg('Credit proposals', { id: 'money.tab.proposals' }), msg('Credit notes and write-offs above a limit', { id: 'overview.creditDesc' })];
      case 'money.recoveries':
        return [msg('Recoveries', { id: 'money.tab.recoveries' }), msg('A payout lowered after it was ordered', { id: 'overview.recoveriesDesc' })];
      case 'erasures':
        return [msg('Erasures to decide', { id: 'overview.erasures' }), msg('Someone else approves or rejects', { id: 'overview.erasuresDesc' })];
      case 'webhooks':
        return [msg('Webhooks that did not arrive', { id: 'overview.webhooks' }), msg('Send them again when the receiver answers', { id: 'overview.webhooksDesc' })];
      case 'jobs':
        return [msg('Events stuck in the relay', { id: 'overview.relay' }), msg('A module could not take them', { id: 'overview.relayDesc' })];
      default:
        return [key, ''];
    }
  }

  private groupTitle(g: Queue['group']) {
    switch (g) {
      case 'claims':
        return msg('Claims', { id: 'nav.claims' });
      case 'policies':
        return msg('Policies and customers', { id: 'overview.policies' });
      case 'money':
        return msg('Money', { id: 'money.title' });
      case 'operations':
        return msg('Operations and personal data', { id: 'overview.operations' });
    }
  }

  private card(r: Row) {
    const [title, desc] = this.text(r.queue.key);
    const empty = r.count === '0' || r.count === '';
    return html`<a class="queue ${empty ? 'empty' : ''}" href=${r.queue.href} @click=${(e: Event) => (e.preventDefault(), navigate(r.queue.href))}>
      <span class="count">${r.count === '' ? '–' : r.count}</span>
      <span class="title">${title}</span>
      <span class="desc">${empty ? msg('Nothing waits', { id: 'overview.nothing' }) : desc}</span>
    </a>`;
  }

  private status() {
    if (this.failed === null && this.lastDays === null) return nothing;
    const lang = getLocale();
    return html`<section aria-labelledby="status">
      <h3 id="status">${msg('Operations and bookkeeping', { id: 'overview.status' })}</h3>
      <div class="cards">
        ${this.failed !== null
          ? html`<a class="queue ${this.failed.length ? '' : 'empty'}" href="/jobs" @click=${(e: Event) => (e.preventDefault(), navigate('/jobs'))}>
              <span class="count">${this.failed.length}</span>
              <span class="title">${msg('Runs that failed', { id: 'overview.failedRuns' })}</span>
              <span class="desc">${this.failed.length ? this.failed.map((f) => `${f.id} (${f.markets.join(', ')})`).join(', ') : msg('The last run of every job went well', { id: 'overview.runsOk' })}</span>
            </a>`
          : nothing}
        ${this.lastDays !== null
          ? html`<a class="queue ${this.lastDays.some((d) => d.unmapped.length) ? '' : 'empty'}" href="/accounting" @click=${(e: Event) => (e.preventDefault(), navigate('/accounting'))}>
              <span class="title">${msg('Last closed day', { id: 'overview.lastDay' })}</span>
              <span class="desc"
                >${this.lastDays.length
                  ? this.lastDays.map((d) => `${d.market} ${formatDate(d.day, lang)}${d.unmapped.length ? ` · ${msg('accounts missing in the chart', { id: 'overview.unmapped' })}` : ''}`).join(' · ')
                  : msg('No day is closed yet', { id: 'overview.noDay' })}</span
              >
            </a>`
          : nothing}
      </div>
    </section>`;
  }

  render() {
    const groups = (['claims', 'policies', 'money', 'operations'] as const).map((g) => ({ g, rows: this.rows.filter((r) => r.queue.group === g) })).filter((x) => x.rows.length);
    return html`
      <h2>${msg('Overview', { id: 'nav.overview' })}</h2>
      ${this.loading && !this.rows.length ? html`<p>${msg('Counting what waits…', { id: 'overview.loading' })}</p>` : nothing}
      ${groups.map(
        ({ g, rows }) => html`<section aria-labelledby=${`g-${g}`}>
          <h3 id=${`g-${g}`}>${this.groupTitle(g)}</h3>
          <div class="cards">${rows.map((r) => this.card(r))}</div>
        </section>`,
      )}
      ${this.status()}
      ${!this.loading && !groups.length && this.failed === null && this.lastDays === null
        ? html`<p>${msg('Your role has no queues. The menu has what you may see.', { id: 'overview.noQueues' })}</p>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-overview': OverviewView;
  }
}
