/**
 * <pv-policy-actions>: what a person may do with a policy (ADR 0029), each a
 * card with a reason or a note: change the choices from a day, cancel with
 * the reason the law knows, reverse the latest cancellation, and renew by hand.
 * Without a tariff the person gives the premium for a term. Emits pv-changed.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import type { Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import {
  CANCELLATION_REASONS,
  cancelBody,
  cancelProblems,
  changeBody,
  changeProblems,
  reversibleCancellation,
  type CancelForm,
  type ChangeForm,
  type ProductLike,
} from '../policy-form.ts';
import { toMinorUnits } from '../settings-logic.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { cancellationLabel, problemLabel } from '../views/labels.ts';

type Policy = components['schemas']['PolicyRecord'];
type Transaction = components['schemas']['PolicyTransaction'];

const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-policy-actions')
export class PolicyActions extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) policy!: Policy;
  @property({ attribute: false }) transactions: Transaction[] = [];
  @state() private product: ProductLike | null = null;
  @state() private open: '' | 'change' | 'cancel' | 'reinstate' | 'renew' = '';
  @state() private change: ChangeForm = { from: today(), annualLimit: null, deductible: '', premium: '', reason: '' };
  @state() private cancel: CancelForm = { reason: '', receivedOn: today(), effectiveDate: '', note: '' };
  @state() private note = '';
  @state() private renewPremium = '';
  @state() private shown: string[] = [];
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
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      /* In the side column the actions stand on top of each other, as on a claim. */
      .buttons {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--space-3);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-4);
      }
      .row > * {
        flex: 1 1 180px;
      }
      .pv-card__body p {
        margin: 0;
      }
    `,
  ];

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('policy') && this.policy) void this.loadProduct();
  }

  private term() {
    return this.policy.terms.at(-1)!;
  }

  /** The latest term's product version, for its choices and whether it has a tariff. */
  private async loadProduct() {
    const [product, version] = this.term().productVersion.split('@') as [string, string];
    const { data } = await this.api.GET('/v1/products/{product}/versions/{version}', { params: { path: { product, version } } }).catch(() => ({ data: undefined }));
    this.product = (data as unknown as ProductLike) ?? null;
    const t = this.term();
    this.change = { ...this.change, annualLimit: t.vetCare.annualLimit, deductible: t.deductibleOption };
  }

  render() {
    const cancellation = reversibleCancellation(this.transactions);
    return html`
      <section class="pv-card" aria-labelledby="actions">
        <div class="pv-card__head"><h2 class="pv-card__title" id="actions">${msg('Policy actions', { id: 'policy.actions' })}</h2></div>
        <div class="pv-card__body buttons" role="group" aria-labelledby="actions">
          ${!cancellation
            ? html`<wa-button appearance="outlined" @click=${() => this.toggle('change')}>${msg('Change the choices', { id: 'policy.changeChoices' })}</wa-button>
                <wa-button appearance="outlined" @click=${() => this.toggle('cancel')}>${msg('Cancel the policy', { id: 'policy.cancel' })}</wa-button>
                <wa-button appearance="outlined" @click=${() => this.toggle('renew')}>${msg('Renew by hand', { id: 'policy.renew' })}</wa-button>`
            : html`<wa-button appearance="outlined" @click=${() => this.toggle('reinstate')}>${msg('Reverse the cancellation', { id: 'policy.reinstate' })}</wa-button>`}
        </div>
      </section>
      ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>${this.notice.text}</wa-callout>` : nothing}
      ${this.open === 'change' ? this.changeCard() : nothing} ${this.open === 'cancel' ? this.cancelCard() : nothing}
      ${this.open === 'reinstate' && cancellation ? this.reinstateCard(cancellation) : nothing} ${this.open === 'renew' ? this.renewCard() : nothing}
    `;
  }

  private toggle(what: PolicyActions['open']) {
    this.open = this.open === what ? '' : what;
    this.shown = [];
    this.notice = null;
  }

  private problems() {
    return this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((x) => html`<div>${problemLabel(x)}</div>`)}</wa-callout>` : nothing;
  }

  private premiumInput(value: string, set: (v: string) => void) {
    if (this.product?.content.tariffSeries) return html`<p>${msg('The tariff prices it.', { id: 'policy.tariffPrices' })}</p>`;
    return html`<wa-input label=${msg('Premium per term', { id: 'policy.premiumPerTerm' })} inputmode="decimal" .value=${value} @input=${(e: Event) => set((e.target as HTMLInputElement).value)}></wa-input>`;
  }

  private changeCard() {
    const p = this.product;
    const lang = getLocale();
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    const money = (m: number) => formatMoney(m, this.policy.terms.at(-1)!.currency, lang);
    return html`<section class="pv-card pv-card--strong" aria-labelledby="change">
      <div class="pv-card__head"><h2 class="pv-card__title" id="change">${msg('Change the choices', { id: 'policy.changeChoices' })}</h2></div>
      <form class="pv-card__body" @submit=${this.doChange} novalidate>
        <p>${msg('From a day in the current term, today or later. The days left are charged or refunded at the new rate.', { id: 'policy.changeHow' })}</p>
        <div class="row">
          <wa-input type="date" label=${msg('From', { id: 'animal.from' })} .value=${this.change.from} @input=${(e: Event) => (this.change = { ...this.change, from: value(e) })}></wa-input>
          <wa-select label=${msg('Annual limit', { id: 'policy.annualLimit' })} value=${String(this.change.annualLimit ?? '')} @change=${(e: Event) => (this.change = { ...this.change, annualLimit: Number(value(e)) })}>
            ${(p?.content.vetCare.annualLimits ?? []).map((l) => html`<wa-option value=${String(l)}>${money(l)}</wa-option>`)}
          </wa-select>
          <wa-select label=${msg('Deductible', { id: 'policy.deductible' })} value=${this.change.deductible} @change=${(e: Event) => (this.change = { ...this.change, deductible: value(e) })}>
            ${(p?.content.vetCare.deductibles ?? []).map((d) => html`<wa-option value=${d.code}>${d.labels?.[lang] ?? d.labels?.en ?? d.code}</wa-option>`)}
          </wa-select>
        </div>
        ${this.premiumInput(this.change.premium, (v) => (this.change = { ...this.change, premium: v }))}
        <wa-textarea label=${msg('Reason', { id: 'claim.reason' })} rows="2" .value=${this.change.reason} @input=${(e: Event) => (this.change = { ...this.change, reason: value(e) })}></wa-textarea>
        ${this.problems()}
        <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Change the choices', { id: 'policy.changeChoices' })}</wa-button>
      </form>
    </section>`;
  }

  private cancelCard() {
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    const r = this.cancel.reason;
    return html`<section class="pv-card pv-card--strong" aria-labelledby="cancel">
      <div class="pv-card__head"><h2 class="pv-card__title" id="cancel">${msg('Cancel the policy', { id: 'policy.cancel' })}</h2></div>
      <form class="pv-card__body" @submit=${this.doCancel} novalidate>
        <p>${msg("The reason decides from when, by the market's law and the product. A refund is the premium per day for the days lost.", { id: 'policy.cancelHow' })}</p>
        <wa-select label=${msg('Reason', { id: 'claim.reason' })} value=${r} @change=${(e: Event) => (this.cancel = { ...this.cancel, reason: value(e) as CancelForm['reason'] })}>
          ${CANCELLATION_REASONS.map((x) => html`<wa-option value=${x}>${cancellationLabel(x)}</wa-option>`)}
        </wa-select>
        <div class="row">
          <wa-input type="date" label=${msg('Notice received or sent', { id: 'policy.receivedOn' })} .value=${this.cancel.receivedOn} @input=${(e: Event) => (this.cancel = { ...this.cancel, receivedOn: value(e) })}></wa-input>
          ${r === 'need-ceased' || r === 'customer-immediate'
            ? html`<wa-input type="date" label=${msg('Effective date', { id: 'policy.effectiveDate' })} .value=${this.cancel.effectiveDate} @input=${(e: Event) => (this.cancel = { ...this.cancel, effectiveDate: value(e) })}></wa-input>`
            : nothing}
        </div>
        <wa-textarea label=${msg('Note, without personal data', { id: 'policy.noteNoPersonal' })} rows="2" .value=${this.cancel.note} @input=${(e: Event) => (this.cancel = { ...this.cancel, note: value(e) })}></wa-textarea>
        ${this.problems()}
        <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Cancel the policy', { id: 'policy.cancel' })}</wa-button>
      </form>
    </section>`;
  }

  private reinstateCard(c: Transaction) {
    return html`<section class="pv-card pv-card--strong" aria-labelledby="reinstate">
      <div class="pv-card__head"><h2 class="pv-card__title" id="reinstate">${msg('Reverse the cancellation', { id: 'policy.reinstate' })}</h2></div>
      <form class="pv-card__body" @submit=${(e: Event) => this.doReinstate(e, c)} novalidate>
        <p>${msg('For example a death registered by mistake. The versions it ended apply again, and the refund is reversed.', { id: 'policy.reinstateHow' })}</p>
        <wa-textarea label=${msg('Note, without personal data', { id: 'policy.noteNoPersonal' })} rows="2" .value=${this.note} @input=${(e: Event) => (this.note = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
        ${this.problems()}
        <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Reverse the cancellation', { id: 'policy.reinstate' })}</wa-button>
      </form>
    </section>`;
  }

  private renewCard() {
    return html`<section class="pv-card pv-card--strong" aria-labelledby="renew">
      <div class="pv-card__head"><h2 class="pv-card__title" id="renew">${msg('Renew by hand', { id: 'policy.renew' })}</h2></div>
      <form class="pv-card__body" @submit=${this.doRenew} novalidate>
        <p>${msg('The next term starts the day this one ends, with the version on sale then and the same choices. For a policy the renewal run listed for a decision.', { id: 'policy.renewHow' })}</p>
        ${this.premiumInput(this.renewPremium, (v) => (this.renewPremium = v))}
        <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Renew by hand', { id: 'policy.renew' })}</wa-button>
      </form>
    </section>`;
  }

  private async doChange(e: Event) {
    e.preventDefault();
    const priced = !!this.product?.content.tariffSeries;
    const currency = this.term().currency;
    this.shown = changeProblems(this.change, today(), priced, currency);
    if (this.shown.length) return;
    await this.send('change', (key) => this.api.POST('/v1/policies/{policyId}/changes', { params: { path: { policyId: this.policy.id }, header: { 'Idempotency-Key': key } }, body: changeBody(this.change, priced, currency) as never }), msg('The choices are changed.', { id: 'policy.changed' }));
  }

  private async doCancel(e: Event) {
    e.preventDefault();
    this.shown = cancelProblems(this.cancel, today());
    if (this.shown.length) return;
    await this.send('cancel', (key) => this.api.POST('/v1/policies/{policyId}/cancellations', { params: { path: { policyId: this.policy.id }, header: { 'Idempotency-Key': key } }, body: cancelBody(this.cancel) as never }), msg('The policy is cancelled.', { id: 'policy.cancelled' }));
  }

  private async doReinstate(e: Event, c: Transaction) {
    e.preventDefault();
    this.shown = this.note.trim() ? [] : ['policy.needNote'];
    if (this.shown.length) return;
    await this.send(
      'reinstate',
      (key) => this.api.POST('/v1/policies/{policyId}/reinstatements', { params: { path: { policyId: this.policy.id }, header: { 'Idempotency-Key': key } }, body: { cancellationId: c.id, note: this.note.trim() } }),
      msg('The cancellation is reversed.', { id: 'policy.reinstated' }),
    );
  }

  private async doRenew(e: Event) {
    e.preventDefault();
    const priced = !!this.product?.content.tariffSeries;
    const currency = this.term().currency;
    const premium = priced ? null : toMinorUnits(this.renewPremium, currency);
    this.shown = !priced && premium === null ? ['policy.needPremium'] : [];
    if (this.shown.length) return;
    await this.send(
      'renew',
      (key) => this.api.POST('/v1/policies/{policyId}/renewals', { params: { path: { policyId: this.policy.id }, header: { 'Idempotency-Key': key } }, body: premium !== null ? { premium: { amount: premium, currency } } : {} }),
      msg('The policy is renewed.', { id: 'policy.renewed' }),
    );
  }

  private async send(what: string, call: (key: string) => Promise<{ response: Response; error?: unknown }>, text: string) {
    this.busy = true;
    const key = `${what}:${this.policy.id}`;
    const { ok, notice } = await act(() => call(this.keys.for(key)), () => ({ variant: 'success', text }));
    this.busy = false;
    this.notice = notice;
    if (ok) {
      this.keys.done(key);
      this.open = '';
      this.dispatchEvent(new CustomEvent('pv-changed', { bubbles: true, composed: true }));
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-policy-actions': PolicyActions;
  }
}
