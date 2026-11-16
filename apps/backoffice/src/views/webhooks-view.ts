/** <pv-webhooks>: webhook subscriptions and the events that did not arrive (ADR 0033). */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import '../components/data-grid.ts';
import '../components/secret-callout.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { mayManageWebhooks, subscriptionBody, subscriptionProblems } from '../integration-logic.ts';
import type { Me } from '../permissions.ts';
import { navigate } from '../router.ts';
import { problemLabel } from './labels.ts';

type Subscription = components['schemas']['WebhookSubscription'];
type Delivery = components['schemas']['WebhookDelivery'];

@customElement('pv-webhooks')
export class WebhooksView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @state() private tab: 'subscriptions' | 'dead' = 'subscriptions';
  @state() private subscriptions: Subscription[] = [];
  @state() private dead: Delivery[] = [];
  @state() private loading = false;
  @state() private error = '';
  @state() private form = { url: '', eventTypes: '', markets: '', description: '' };
  @state() private shown: string[] = [];
  @state() private notice: Notice | null = null;
  @state() private secret = '';
  @state() private busy = false;
  private keys = new IdempotencyKeys();

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
    form {
      display: grid;
      gap: var(--wa-space-m);
      max-width: 40rem;
    }
    wa-card {
      margin-top: var(--wa-space-l);
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    this.loading = true;
    this.error = '';
    try {
      // Subscriptions are few; the dead list is the queue for a person.
      const [subs, dead] = await Promise.all([
        unwrap(this.api.GET('/v1/webhook-subscriptions', { params: { query: { limit: 200 } } })),
        unwrap(this.api.GET('/v1/webhook-deliveries', { params: { query: { status: 'dead', limit: 200 } } })),
      ]);
      this.subscriptions = subs.items;
      this.dead = dead.items;
    } catch (e) {
      this.error = (e as { title?: string }).title ?? msg('Something went wrong.', { id: 'common.error' });
    } finally {
      this.loading = false;
    }
  }

  private subscriptionColumns(): Column<Subscription>[] {
    const lang = getLocale();
    return [
      { key: 'url', header: msg('Address', { id: 'webhooks.url' }), value: (s) => s.url },
      { key: 'description', header: msg('Description', { id: 'webhooks.description' }), value: (s) => s.description ?? '–' },
      { key: 'types', header: msg('Events', { id: 'webhooks.types' }), value: (s) => s.eventTypes.join(', ') },
      { key: 'markets', header: msg('Markets', { id: 'webhooks.markets' }), value: (s) => (s.markets === '*' ? '*' : s.markets.join(', ')) },
      {
        key: 'status',
        header: msg('Status', { id: 'claims.col.status' }),
        value: (s) =>
          html`<wa-badge variant=${s.status === 'active' ? (s.failingSince ? 'warning' : 'success') : 'danger'}
            >${s.status === 'active' ? (s.failingSince ? msg('Failing', { id: 'webhooks.failing' }) : msg('Active', { id: 'policy.status.active' })) : msg('Disabled', { id: 'webhooks.disabled' })}</wa-badge
          >`,
      },
      { key: 'changed', header: msg('Changed', { id: 'webhooks.changed' }), value: (s) => formatDateTime(s.changedAt, lang) },
    ];
  }

  private deadColumns(): Column<Delivery>[] {
    const lang = getLocale();
    return [
      { key: 'type', header: msg('Event', { id: 'webhooks.event' }), value: (d) => d.eventType },
      { key: 'subject', header: msg('About', { id: 'notices.about' }), value: (d) => d.event.subject },
      { key: 'subscription', header: msg('Subscription', { id: 'webhooks.subscription' }), value: (d) => this.subscriptions.find((s) => s.id === d.subscriptionId)?.url ?? d.subscriptionId },
      { key: 'attempts', header: msg('Attempts', { id: 'webhooks.attempts' }), align: 'end', value: (d) => d.attempts },
      { key: 'error', header: msg('Last error', { id: 'webhooks.lastError' }), value: (d) => d.lastError ?? '–' },
      { key: 'at', header: msg('Last attempt', { id: 'webhooks.lastAttempt' }), value: (d) => (d.lastAttemptAt ? formatDateTime(d.lastAttemptAt, lang) : '–') },
    ];
  }

  private async create(e: Event) {
    e.preventDefault();
    this.shown = subscriptionProblems(this.form);
    if (this.shown.length) return;
    this.busy = true;
    this.secret = '';
    let secret = '';
    const r = await act(
      async () => {
        const res = await this.api.POST('/v1/webhook-subscriptions', { params: { header: { 'Idempotency-Key': this.keys.for('create') } }, body: subscriptionBody(this.form) });
        secret = res.data?.secret ?? '';
        return res;
      },
      () => ({ variant: 'success', text: msg('The subscription is created.', { id: 'webhooks.created' }) }),
    );
    this.busy = false;
    this.notice = r.notice;
    if (r.ok) {
      this.keys.done('create');
      this.secret = secret;
      this.form = { url: '', eventTypes: '', markets: '', description: '' };
      void this.load();
    }
  }

  render() {
    return html`
      <h2>${msg('Webhooks', { id: 'webhooks.title' })}</h2>
      ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>${this.notice.text}</wa-callout>` : nothing}
      ${this.secret ? html`<pv-secret-callout secret=${this.secret}></pv-secret-callout>` : nothing}
      <wa-tab-group @wa-tab-show=${(e: CustomEvent<{ name: string }>) => (this.tab = e.detail.name as 'subscriptions' | 'dead')}>
        <wa-tab panel="subscriptions" ?active=${this.tab === 'subscriptions'}>${msg('Subscriptions', { id: 'webhooks.subscriptions' })}</wa-tab>
        <wa-tab panel="dead" ?active=${this.tab === 'dead'}>${msg('Did not arrive', { id: 'webhooks.dead' })} (${this.dead.length})</wa-tab>
      </wa-tab-group>
      ${this.tab === 'subscriptions'
        ? html`<pv-data-grid
              .columns=${this.subscriptionColumns()}
              .rows=${this.subscriptions}
              label=${msg('Subscriptions', { id: 'webhooks.subscriptions' })}
              ?loading=${this.loading}
              error=${this.error}
              empty-text=${msg('No subscriptions.', { id: 'webhooks.none' })}
              @pv-row-activate=${(e: CustomEvent<{ row: Subscription }>) => navigate(`/webhooks/${encodeURIComponent(e.detail.row.id)}`)}
            ></pv-data-grid>
            ${mayManageWebhooks(this.me) ? this.createForm() : nothing}`
        : html`<pv-data-grid
            .columns=${this.deadColumns()}
            .rows=${this.dead}
            label=${msg('Did not arrive', { id: 'webhooks.dead' })}
            ?loading=${this.loading}
            error=${this.error}
            empty-text=${msg('Every event arrived.', { id: 'webhooks.noneDead' })}
            @pv-row-activate=${(e: CustomEvent<{ row: Delivery }>) => navigate(`/webhooks/${encodeURIComponent(e.detail.row.subscriptionId)}`)}
          ></pv-data-grid>`}
    `;
  }

  private createForm() {
    const set = (k: keyof WebhooksView['form']) => (e: Event) => (this.form = { ...this.form, [k]: (e.target as HTMLInputElement).value });
    return html`<wa-card>
      <h3 slot="header">${msg('New subscription', { id: 'webhooks.new' })}</h3>
      <form @submit=${this.create}>
        <wa-input label=${msg('Address', { id: 'webhooks.url' })} hint="https://…" .value=${this.form.url} @input=${set('url')}></wa-input>
        <wa-input
          label=${msg('Events', { id: 'webhooks.types' })}
          hint=${msg('e.g. policy.*, claim.decided, or * for all', { id: 'webhooks.typesHint' })}
          .value=${this.form.eventTypes}
          @input=${set('eventTypes')}
        ></wa-input>
        <wa-input label=${msg('Markets', { id: 'webhooks.markets' })} hint=${msg('e.g. SE, or * for all', { id: 'webhooks.marketsHint' })} .value=${this.form.markets} @input=${set('markets')}></wa-input>
        <wa-input label=${msg('Description', { id: 'webhooks.description' })} .value=${this.form.description} @input=${set('description')}></wa-input>
        ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing}
        <wa-button type="submit" variant="brand" ?loading=${this.busy}><wa-icon slot="start" name="plus"></wa-icon>${msg('Create', { id: 'webhooks.create' })}</wa-button>
      </form>
    </wa-card>`;
  }
}
