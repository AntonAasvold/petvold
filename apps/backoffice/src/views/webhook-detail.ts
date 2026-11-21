/**
 * <pv-webhook-detail>: a subscription as the design system lays out a detail
 * page (docs/teknik/designsystem.md, "Detaljsidan"): its deliveries beside
 * sending again, turning off and on, and a new secret (ADR 0033).
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
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
import { pvComponents } from '../styles/pv-components.ts';
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
        overflow-wrap: anywhere;
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
        overflow-wrap: anywhere;
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
      .pv-dl__row dd {
        overflow-wrap: anywhere;
      }
      .pv-card__body p {
        margin: 0;
      }
      .buttons {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--space-3);
      }
      wa-tab-group {
        padding: 0 var(--space-6);
      }
      @media (max-width: 900px) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

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
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/webhooks" @click=${(e: Event) => (e.preventDefault(), navigate('/webhooks'))}>${msg('Webhooks', { id: 'nav.webhooks' })}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${this.subscriptionId}</span>
    </nav>`;
    if (this.problem) {
      const text = this.problem.status === 404 ? msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' }) : this.problem.title;
      return html`${crumbs}<wa-callout variant=${this.problem.status === 404 ? 'neutral' : 'danger'}>${text}</wa-callout>`;
    }
    const s = this.subscription;
    if (!s) return html`${crumbs}<wa-spinner></wa-spinner>`;
    const lang = getLocale();
    const manage = mayManageWebhooks(this.me);
    const row = (label: string, value: unknown, mono = false) => html`<div class="pv-dl__row"><dt>${label}</dt><dd class=${mono ? 'pv-mono' : ''}>${value}</dd></div>`;
    return html`
      ${crumbs}
      <div class="title">
        <h1>${s.description ?? s.url}</h1>
        <span class="pv-badge pv-badge--id">${s.id}</span>
        <span class="pv-badge ${s.status === 'active' ? 'pv-badge--solid' : 'pv-badge--pending'}"
          >${s.status === 'active' ? msg('Active', { id: 'policy.status.active' }) : msg('Disabled', { id: 'webhooks.disabled' })}</span
        >
        ${s.failingSince ? html`<span class="pv-badge pv-badge--pending">${msg('Failing since', { id: 'webhooks.failingSince' })} ${formatDateTime(s.failingSince, lang)}</span>` : nothing}
      </div>
      <ul class="facts">
        <li>${msg('Address', { id: 'webhooks.url' })}: <strong class="pv-mono">${s.url}</strong></li>
        <li>${msg('Markets', { id: 'webhooks.markets' })}: <strong>${s.markets === '*' ? '*' : s.markets.join(', ')}</strong></li>
        <li>${msg('Changed', { id: 'webhooks.changed' })}: <strong>${s.changedBy}, ${formatDateTime(s.changedAt, lang)}</strong></li>
      </ul>
      ${this.notice
        ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}
            >${this.notice.text}
            ${this.notice.reload ? html`<wa-button size="small" appearance="outlined" @click=${() => this.load()}>${msg('Reload', { id: 'common.reload' })}</wa-button>` : nothing}</wa-callout
          >`
        : nothing}
      <div class="cols">
        <div class="basis">
          <section class="pv-card" aria-labelledby="deliveries">
            <div class="pv-card__head"><h2 class="pv-card__title" id="deliveries">${msg('Deliveries', { id: 'notice.deliveries' })}</h2></div>
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
          </section>
          <section class="pv-card" aria-labelledby="details">
            <div class="pv-card__head"><h2 class="pv-card__title" id="details">${msg('Details', { id: 'claim.facts' })}</h2></div>
            <div class="pv-card__body">
              <dl class="pv-dl">
                ${row(msg('Events', { id: 'webhooks.types' }), s.eventTypes.join(', '), true)}
                ${s.disabledReason ? row(msg('Why disabled', { id: 'webhooks.disabledReason' }), s.disabledReason) : nothing}
                ${s.previousSecretUntil ? row(msg('The previous secret signs until', { id: 'webhooks.previousUntil' }), formatDateTime(s.previousSecretUntil, lang)) : nothing}
                ${row(msg('Revision', { id: 'correct.revision' }), s.revision)}
              </dl>
            </div>
          </section>
        </div>
        <div class="side">
          ${this.secret ? html`<pv-secret-callout secret=${this.secret}></pv-secret-callout>` : nothing}
          ${manage
            ? html`<section class="pv-card pv-card--strong" aria-labelledby="actions">
                <div class="pv-card__head"><h2 class="pv-card__title" id="actions">${msg('Subscription actions', { id: 'webhooks.actions' })}</h2></div>
                <div class="pv-card__body buttons">
                  ${this.status === 'dead' && this.deliveries.some((d) => !d.prunedAt)
                    ? html`<wa-button variant="brand" ?loading=${this.busy === 'retryAll'} @click=${() => this.retryAll()}
                        ><wa-icon slot="start" name="rotate-right"></wa-icon>${msg('Send all again', { id: 'webhooks.retryAll' })}</wa-button
                      >`
                    : nothing}
                  <wa-button appearance="outlined" ?loading=${this.busy === 'toggle'} @click=${() => this.toggle(s)}
                    >${s.status === 'active' ? msg('Turn off', { id: 'webhooks.turnOff' }) : msg('Turn on', { id: 'webhooks.turnOn' })}</wa-button
                  >
                  <wa-button appearance="outlined" ?loading=${this.busy === 'rotate'} @click=${() => this.rotate()}
                    ><wa-icon slot="start" name="key"></wa-icon>${msg('New secret', { id: 'webhooks.rotate' })}</wa-button
                  >
                  <p class="pv-note">${msg('A new secret is shown once. The previous one also signs for 24 hours, so the receiver can change without losing events.', { id: 'webhooks.rotateHow' })}</p>
                </div>
              </section>`
            : nothing}
        </div>
      </div>
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
