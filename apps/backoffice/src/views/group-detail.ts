/**
 * <pv-group-detail>: a policy group (ADR 0007): a litter or a household with
 * one policyholder, and its members over time. Add a policy from a day, and
 * end a membership with a reason. Membership gives the group discount; it
 * never affects claims.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate, formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { groupKindLabel, problemLabel } from './labels.ts';

type Group = components['schemas']['PolicyGroup'];
type Member = Group['members'][number];

const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-group-detail')
export class GroupDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'group-id' }) groupId = '';
  @state() private group: Group | null = null;
  @state() private problem: Problem | null = null;
  @state() private add = { policyId: '', from: today() };
  @state() private ending: { policyId: string; to: string; reason: string } | null = null;
  @state() private notice: Notice | null = null;
  @state() private busy = false;
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
        max-width: 64rem;
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
        margin: var(--space-2) 0 var(--space-8);
      }
      h1 {
        margin: 0;
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-4);
      }
      .row > * {
        flex: 1 1 200px;
      }
      dd a {
        color: var(--ink);
      }
      .pv-card__body p {
        margin: 0;
      }
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('groupId') || changed.has('api')) void this.load();
  }

  private async load() {
    try {
      this.group = await unwrap(this.api.GET('/v1/policy-groups/{groupId}', { params: { path: { groupId: this.groupId } } }));
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  render() {
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/policies" @click=${(e: Event) => (e.preventDefault(), navigate('/policies'))}>${msg('Policies', { id: 'nav.policies' })}</a>
      <span aria-hidden="true">/</span><span aria-current="page">${this.groupId}</span>
    </nav>`;
    if (this.problem) return html`${crumbs}<wa-callout variant="neutral">${msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' })}</wa-callout>`;
    const g = this.group;
    if (!g) return html`${crumbs}<wa-spinner></wa-spinner>`;
    const writable = !!this.me?.permissions.includes('policies:write');
    const lang = getLocale();
    const link = (path: string, id: string) => html`<a href=${path} class="pv-mono" @click=${(e: Event) => (e.preventDefault(), navigate(path))}>${id}</a>`;
    return html`
      ${crumbs}
      <div class="title">
        <h1>${groupKindLabel(g.kind)}</h1>
        <span class="pv-badge pv-badge--id">${g.id}</span>
        <span class="pv-badge">${g.market}</span>
      </div>
      <div class="stack">
        ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>${this.notice.text}</wa-callout>` : nothing}
        <section class="pv-card" aria-labelledby="details">
          <div class="pv-card__head">
            <h2 class="pv-card__title" id="details">${msg('Details', { id: 'claim.facts' })}</h2>
            <span class="pv-card__meta">${g.createdBy}, ${formatDateTime(g.createdAt, lang)}</span>
          </div>
          <div class="pv-card__body">
            <dl class="pv-dl">
              <div class="pv-dl__row"><dt>${msg('Policyholder', { id: 'policy.holder' })}</dt><dd>${link(`/parties/${g.holderPartyId}`, g.holderPartyId)}</dd></div>
              ${g.litterId ? html`<div class="pv-dl__row"><dt>${msg('Litter', { id: 'litter.title' })}</dt><dd>${link(`/litters/${g.litterId}`, g.litterId)}</dd></div>` : nothing}
            </dl>
          </div>
        </section>
        <section class="pv-card" aria-labelledby="members">
          <div class="pv-card__head"><h2 class="pv-card__title" id="members">${msg('Members', { id: 'group.members' })}</h2></div>
          <pv-data-grid
            .columns=${this.columns(writable)}
            .rows=${g.members}
            label=${msg('Members', { id: 'group.members' })}
            empty-text=${msg('No members yet.', { id: 'group.noMembers' })}
          ></pv-data-grid>
        </section>
        ${writable && this.ending ? this.endCard() : nothing} ${writable ? this.addCard() : nothing}
      </div>
    `;
  }

  private columns(writable: boolean): Column<Member>[] {
    const lang = getLocale();
    return [
      { key: 'policy', header: msg('Policy', { id: 'claims.col.policy' }), value: (m) => m.policyId },
      { key: 'from', header: msg('From', { id: 'animal.from' }), value: (m) => formatDate(m.from, lang) },
      { key: 'to', header: msg('Until', { id: 'group.to' }), value: (m) => (m.to ? `${formatDate(m.to, lang)}${m.endReason ? ` · ${m.endReason}` : ''}` : '–') },
      ...(writable
        ? [
            {
              key: 'end',
              header: msg('Action', { id: 'jobs.col.action' }),
              value: (m: Member) =>
                m.to
                  ? nothing
                  : html`<wa-button size="small" appearance="outlined" @click=${(e: Event) => (e.stopPropagation(), (this.ending = { policyId: m.policyId, to: today(), reason: '' }))}
                      >${msg('End the membership', { id: 'group.end' })}</wa-button
                    >`,
            },
          ]
        : []),
    ];
  }

  private addCard() {
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    return html`<section class="pv-card" aria-labelledby="add">
      <div class="pv-card__head"><h2 class="pv-card__title" id="add">${msg('Add a policy', { id: 'group.add' })}</h2></div>
      <form class="pv-card__body" @submit=${this.doAdd}>
        <p>${msg("The group's policyholder must hold the policy, and a policy is in one group at a time.", { id: 'group.addHow' })}</p>
        <div class="row">
          <wa-input label=${msg('Policy id', { id: 'group.policyId' })} .value=${this.add.policyId} @input=${(e: Event) => (this.add = { ...this.add, policyId: value(e) })}></wa-input>
          <wa-input type="date" label=${msg('From', { id: 'animal.from' })} .value=${this.add.from} @input=${(e: Event) => (this.add = { ...this.add, from: value(e) })}></wa-input>
        </div>
        <wa-button type="submit" appearance="outlined" ?loading=${this.busy}>${msg('Add a policy', { id: 'group.add' })}</wa-button>
      </form>
    </section>`;
  }

  private endCard() {
    const e2 = this.ending!;
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    return html`<section class="pv-card pv-card--strong" aria-labelledby="end">
      <div class="pv-card__head"><h2 class="pv-card__title" id="end">${msg('End the membership', { id: 'group.end' })} · ${e2.policyId}</h2></div>
      <form class="pv-card__body" @submit=${this.doEnd}>
        <wa-input type="date" label=${msg('First day outside the group', { id: 'group.endTo' })} .value=${e2.to} @input=${(e: Event) => (this.ending = { ...e2, to: value(e) })}></wa-input>
        <wa-textarea label=${msg('Reason', { id: 'claim.reason' })} rows="2" .value=${e2.reason} @input=${(e: Event) => (this.ending = { ...e2, reason: value(e) })}></wa-textarea>
        <div class="row">
          <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('End the membership', { id: 'group.end' })}</wa-button>
          <wa-button appearance="plain" @click=${() => (this.ending = null)}>${msg('Cancel', { id: 'common.cancel' })}</wa-button>
        </div>
      </form>
    </section>`;
  }

  private async doAdd(e: Event) {
    e.preventDefault();
    const id = this.add.policyId.trim();
    if (!/^pol_[A-Za-z0-9]+$/.test(id)) {
      this.notice = { variant: 'danger', text: problemLabel('group.needPolicy') };
      return;
    }
    await this.send(
      `add:${id}`,
      (key) => this.api.POST('/v1/policy-groups/{groupId}/members', { params: { path: { groupId: this.groupId }, header: { 'Idempotency-Key': key } }, body: { policyId: id, ...(this.add.from ? { from: this.add.from } : {}) } }),
      msg('The policy is in the group.', { id: 'group.added' }),
      () => (this.add = { policyId: '', from: today() }),
    );
  }

  private async doEnd(e: Event) {
    e.preventDefault();
    const x = this.ending!;
    if (!x.reason.trim()) {
      this.notice = { variant: 'danger', text: problemLabel('settings.needReason') };
      return;
    }
    await this.send(
      `end:${x.policyId}`,
      (key) =>
        this.api.POST('/v1/policy-groups/{groupId}/members/{policyId}/endings', {
          params: { path: { groupId: this.groupId, policyId: x.policyId }, header: { 'Idempotency-Key': key } },
          body: { reason: x.reason.trim(), ...(x.to ? { to: x.to } : {}) },
        }),
      msg('The membership is ended.', { id: 'group.ended' }),
      () => (this.ending = null),
    );
  }

  private async send(key: string, call: (key: string) => Promise<{ response: Response; error?: unknown }>, text: string, after: () => void) {
    this.busy = true;
    const { ok, notice } = await act(() => call(this.keys.for(key)), () => ({ variant: 'success', text }));
    this.busy = false;
    this.notice = notice;
    if (ok) {
      this.keys.done(key);
      after();
      await this.load();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-group-detail': GroupDetail;
  }
}
