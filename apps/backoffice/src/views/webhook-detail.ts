/** <pv-webhook-detail>: a subscription with its deliveries: send again, turn off and on, and a new secret (ADR 0033). */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import '../components/data-grid.ts';
import '../components/secret-callout.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { mayManageWebhooks } from '../integration-logic.ts';
import type { Me } from '../permissions.ts';
import { navigate } from '../router.ts';

type Subscription = components['schemas']['WebhookSubscription'];
type Delivery = components['schemas']['WebhookDelivery'];
type Status = Delivery['status'];

@customElement('pv-webhook-detail')
export class WebhookDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'subscription-id' }) subscriptionId = '';
  @state() private subscription: Subscription | null = null;
  @state() private deliveries: Delivery[] = [];
  @state() private status: Status = 'dead';
  @state() private problem: Problem | null = null;
  @state() private notice: Notice | null = null;
  @state() private secret = '';
  @state() private busy = '';
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    .head {
      display: flex;
      align-items: center;
      gap: var(--wa-space-m);
      flex-wrap: wrap;
    }
    .head h2 {
      margin: 0;
      overflow-wrap: anywhere;
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
    }
    .row {
      display: flex;
      gap: var(--wa-space-s);
      flex-wrap: wrap;
      margin-top: var(--wa-space-m);
    }
    wa-card,
    wa-tab-group {
      margin-top: var(--wa-space-l);
    }
  `;

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('subscriptionId') || changed.has('api')) void this.load();
  }

  private async load() {
    this.problem = null;
    try {
      const path = { subscriptionId: this.subscriptionId };
      const [s, d] = await Promise.all([
        unwrap(this.api.GET('/v1/webhook-subscriptions/{subscriptionId}', { params: { path } })),
        unwrap(this.api.GET('/v1/webhook-subscriptions/{subscriptionId}/deliveries', { params: { path, query: { status: this.status, limit: 200 } } })),
      ]);
      this.subscription = s;
      this.deliveries = d.items;
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  render() {
    const back = html`<wa-button appearance="plain" size="small" @click=${() => navigate('/webhooks')}
      ><wa-icon slot="start" name="arrow-left"></wa-icon>${msg('Back', { id: 'common.back' })}</wa-button
    >`;
    if (this.problem) {
      const text = this.problem.status === 404 ? msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' }) : this.problem.title;
      return html`${back}<wa-callout variant=${this.problem.status === 404 ? 'neutral' : 'danger'}>${text}</wa-callout>`;
    }
    const s = this.subscription;
    if (!s) return html`${back}<wa-spinner></wa-spinner>`;
    const lang = getLocale();
    const manage = mayManageWebhooks(this.me);
    return html`
      ${back}
      <div class="head">
        <h2>${s.description ?? s.url}</h2>
        <wa-badge variant=${s.status === 'active' ? 'success' : 'danger'}>${s.status === 'active' ? msg('Active', { id: 'policy.status.active' }) : msg('Disabled', { id: 'webhooks.disabled' })}</wa-badge>
      </div>
      ${this.notice
        ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}
            >${this.notice.text}
            ${this.notice.reload ? html`<wa-button size="small" appearance="outlined" @click=${() => this.load()}>${msg('Reload', { id: 'common.reload' })}</wa-button>` : nothing}</wa-callout
          >`
        : nothing}
      ${this.secret ? html`<pv-secret-callout secret=${this.secret}></pv-secret-callout>` : nothing}
      <wa-card>
        <dl>
          <dt>${msg('Address', { id: 'webhooks.url' })}</dt>
          <dd>${s.url}</dd>
          <dt>${msg('Events', { id: 'webhooks.types' })}</dt>
          <dd>${s.eventTypes.join(', ')}</dd>
          <dt>${msg('Markets', { id: 'webhooks.markets' })}</dt>
          <dd>${s.markets === '*' ? '*' : s.markets.join(', ')}</dd>
          ${s.disabledReason ? html`<dt>${msg('Why disabled', { id: 'webhooks.disabledReason' })}</dt><dd>${s.disabledReason}</dd>` : nothing}
          ${s.failingSince ? html`<dt>${msg('Failing since', { id: 'webhooks.failingSince' })}</dt><dd>${formatDateTime(s.failingSince, lang)}</dd>` : nothing}
          ${s.previousSecretUntil ? html`<dt>${msg('The previous secret signs until', { id: 'webhooks.previousUntil' })}</dt><dd>${formatDateTime(s.previousSecretUntil, lang)}</dd>` : nothing}
          <dt>${msg('Changed', { id: 'webhooks.changed' })}</dt>
          <dd>${s.changedBy}, ${formatDateTime(s.changedAt, lang)}</dd>
        </dl>
        ${manage
          ? html`<div class="row">
              <wa-button appearance="outlined" ?loading=${this.busy === 'toggle'} @click=${() => this.toggle(s)}
                >${s.status === 'active' ? msg('Turn off', { id: 'webhooks.turnOff' }) : msg('Turn on', { id: 'webhooks.turnOn' })}</wa-button
              >
              <wa-button appearance="outlined" ?loading=${this.busy === 'rotate'} @click=${() => this.rotate()}
                ><wa-icon slot="start" name="key"></wa-icon>${msg('New secret', { id: 'webhooks.rotate' })}</wa-button
              >
              ${this.status === 'dead' && this.deliveries.some((d) => !d.prunedAt)
                ? html`<wa-button variant="brand" ?loading=${this.busy === 'retryAll'} @click=${() => this.retryAll()}
                    ><wa-icon slot="start" name="rotate-right"></wa-icon>${msg('Send all again', { id: 'webhooks.retryAll' })}</wa-button
                  >`
                : nothing}
            </div>`
          : nothing}
      </wa-card>
      <wa-tab-group @wa-tab-show=${(e: CustomEvent<{ name: string }>) => ((this.status = e.detail.name as Status), void this.load())}>
        <wa-tab panel="dead" ?active=${this.status === 'dead'}>${msg('Did not arrive', { id: 'webhooks.dead' })}</wa-tab>
        <wa-tab panel="pending" ?active=${this.status === 'pending'}>${msg('Waiting', { id: 'notices.tab.pending' })}</wa-tab>
        <wa-tab panel="delivered" ?active=${this.status === 'delivered'}>${msg('Delivered', { id: 'webhooks.delivered' })}</wa-tab>
      </wa-tab-group>
      <pv-data-grid
        .columns=${this.columns(manage)}
        .rows=${this.deliveries}
        label=${msg('Deliveries', { id: 'notice.deliveries' })}
        empty-text=${msg('Nothing to show.', { id: 'common.empty' })}
      ></pv-data-grid>
    `;
  }

  private columns(manage: boolean): Column<Delivery>[] {
    const lang = getLocale();
    return [
      { key: 'type', header: msg('Event', { id: 'webhooks.event' }), value: (d) => d.eventType },
      { key: 'subject', header: msg('About', { id: 'notices.about' }), value: (d) => d.event.subject },
      { key: 'attempts', header: msg('Attempts', { id: 'webhooks.attempts' }), align: 'end', value: (d) => d.attempts },
      { key: 'last', header: msg('Last answer', { id: 'webhooks.lastAnswer' }), value: (d) => d.lastError ?? (d.lastStatus ? `HTTP ${d.lastStatus}` : '–') },
      { key: 'at', header: msg('Last attempt', { id: 'webhooks.lastAttempt' }), value: (d) => (d.lastAttemptAt ? formatDateTime(d.lastAttemptAt, lang) : '–') },
      ...(manage && this.status === 'dead'
        ? [
            {
              key: 'retry',
              header: '',
              value: (d: Delivery) =>
                d.prunedAt
                  ? msg('Data removed', { id: 'webhooks.pruned' })
                  : html`<wa-button size="small" appearance="outlined" @click=${(e: Event) => (e.stopPropagation(), this.retry(d))}>${msg('Send again', { id: 'webhooks.retry' })}</wa-button>`,
            },
          ]
        : []),
    ];
  }

  private async run(key: string, call: () => Promise<{ response: Response; error?: unknown }>, text: string) {
    this.busy = key;
    const r = await act(call, () => ({ variant: 'success', text }));
    this.busy = '';
    this.notice = r.notice;
    if (r.ok) {
      this.keys.done(key);
      void this.load();
    }
    return r.ok;
  }

  private async toggle(s: Subscription) {
    await this.run(
      'toggle',
      () =>
        this.api.PUT('/v1/webhook-subscriptions/{subscriptionId}', {
          params: { path: { subscriptionId: s.id } },
          body: { basedOnRevision: s.revision, url: s.url, eventTypes: s.eventTypes, markets: s.markets, ...(s.description ? { description: s.description } : {}), status: s.status === 'active' ? 'disabled' : 'active' },
        }),
      s.status === 'active' ? msg('Turned off.', { id: 'webhooks.turnedOff' }) : msg('Turned on. Waiting events are sent.', { id: 'webhooks.turnedOn' }),
    );
  }

  private async rotate() {
    let secret = '';
    const ok = await this.run(
      'rotate',
      async () => {
        const res = await this.api.POST('/v1/webhook-subscriptions/{subscriptionId}/secret-rotations', {
          params: { path: { subscriptionId: this.subscriptionId }, header: { 'Idempotency-Key': this.keys.for('rotate') } },
        });
        secret = res.data?.secret ?? '';
        return res;
      },
      msg('A new secret. The previous one also signs for 24 hours.', { id: 'webhooks.rotated' }),
    );
    if (ok) this.secret = secret;
  }

  private async retry(d: Delivery) {
    await this.run(
      `retry:${d.id}`,
      () =>
        this.api.POST('/v1/webhook-subscriptions/{subscriptionId}/deliveries/{deliveryId}/retries', {
          params: { path: { subscriptionId: this.subscriptionId, deliveryId: d.id }, header: { 'Idempotency-Key': this.keys.for(`retry:${d.id}`) } },
        }),
      msg('Sent again.', { id: 'webhooks.retried' }),
    );
  }

  private async retryAll() {
    await this.run(
      'retryAll',
      () =>
        this.api.POST('/v1/webhook-subscriptions/{subscriptionId}/delivery-retries', {
          params: { path: { subscriptionId: this.subscriptionId }, header: { 'Idempotency-Key': this.keys.for('retryAll') } },
        }),
      msg('Every dead event is sent again.', { id: 'webhooks.retriedAll' }),
    );
  }
}
