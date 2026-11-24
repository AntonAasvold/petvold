/**
 * <pv-payee-accounts>: where a payee is paid (ADR 0040): a party's or a
 * clinic's account details, masked but for the last four, the current one
 * first, and a form to give new ones. New details replace the old and hold a
 * payout until someone else releases it (UTB-05, UTB-07). For a party it also
 * lists the payouts to them.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/radio-group/radio-group.js';
import '@awesome.me/webawesome/dist/components/radio/radio.js';
import type { Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { detailsLine, payeeBody, payeeProblems, type PayeeForm, type PayeeProblem } from '../payee-logic.ts';
import type { Me } from '../permissions.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { payoutStatusLabel } from '../views/labels.ts';
import './data-grid.ts';
import type { Column } from './data-grid.ts';

type PayeeAccount = components['schemas']['PayeeAccount'];
type Payout = components['schemas']['Payout'];

const value = (e: Event) => (e.target as HTMLInputElement).value;

@customElement('pv-payee-accounts')
export class PayeeAccounts extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'party-id' }) partyId = '';
  @property({ attribute: 'clinic-id' }) clinicId = '';
  /** The market the form starts with. */
  @property() market = 'SE';
  @state() private items: PayeeAccount[] = [];
  @state() private payouts: Payout[] = [];
  @state() private loading = true;
  @state() private error = '';
  @state() private open = false;
  @state() private form: PayeeForm = { market: 'SE', method: 'se-bank', clearing: '', account: '', iban: '', bic: '' };
  @state() private shown: PayeeProblem[] = [];
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
      }
      form {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        margin-top: var(--space-3);
      }
      .pair {
        display: flex;
        gap: var(--space-3);
      }
      .pair > * {
        flex: 1 1 0;
        min-width: 0;
      }
      .pv-card__body p {
        margin: 0;
      }
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if ((changed.has('partyId') || changed.has('clinicId')) && (this.partyId || this.clinicId)) {
      this.form = { ...this.form, market: this.market };
      void this.load();
    }
  }

  private async load() {
    this.loading = true;
    const accounts = this.partyId
      ? await this.api.GET('/v1/payees/{partyId}/accounts', { params: { path: { partyId: this.partyId } } })
      : await this.api.GET('/v1/clinics/{clinicId}/accounts', { params: { path: { clinicId: this.clinicId } } });
    // Newest first: the current one is the newest in its market.
    this.items = [...(accounts.data?.items ?? [])].reverse();
    this.error = accounts.data ? '' : ((accounts.error as { title?: string } | undefined)?.title ?? msg('Something went wrong.', { id: 'common.error' }));
    if (this.partyId) {
      const { data } = await this.api.GET('/v1/payouts', { params: { query: { partyId: this.partyId, limit: 100 } } });
      this.payouts = [...(data?.items ?? [])].reverse();
    }
    this.loading = false;
  }

  private columns(): Column<PayeeAccount>[] {
    const lang = getLocale();
    return [
      { key: 'details', header: msg('Account', { id: 'payee.account' }), value: (a) => html`<span class="pv-mono">${detailsLine(a)}</span>` },
      { key: 'market', header: msg('Market', { id: 'money.market' }), value: (a) => a.market },
      { key: 'given', header: msg('Given', { id: 'payee.given' }), value: (a) => `${formatDateTime(a.createdAt, lang)} · ${a.createdBy}` },
      { key: 'current', header: msg('In use', { id: 'payee.current' }), value: (a) => (a.current ? html`<span class="pv-badge pv-badge--solid">${msg('In use', { id: 'payee.current' })}</span>` : '') },
    ];
  }

  private payoutColumns(): Column<Payout>[] {
    const lang = getLocale();
    return [
      { key: 'at', header: msg('Ordered', { id: 'payee.ordered' }), value: (p) => formatDateTime(p.createdAt, lang) },
      { key: 'amount', header: msg('Amount', { id: 'money.amount' }), value: (p) => formatMoney(p.amount, p.currency, lang), align: 'end' },
      { key: 'status', header: msg('Status', { id: 'claims.col.status' }), value: (p) => payoutStatusLabel(p.status) },
    ];
  }

  private async submit(e: Event) {
    e.preventDefault();
    this.shown = payeeProblems(this.form);
    if (this.shown.length) return;
    this.busy = true;
    const key = `payee:${this.partyId || this.clinicId}`;
    const body = payeeBody(this.form);
    const call = (k: string) =>
      this.partyId
        ? this.api.POST('/v1/payees/{partyId}/accounts', { params: { path: { partyId: this.partyId }, header: { 'Idempotency-Key': k } }, body })
        : this.api.POST('/v1/clinics/{clinicId}/accounts', { params: { path: { clinicId: this.clinicId }, header: { 'Idempotency-Key': k } }, body });
    const { ok, notice } = await act(() => call(this.keys.for(key)), () => ({
      variant: 'success',
      text: msg('Saved. A payout to the new details waits until someone else releases it, if the market holds new details.', { id: 'payee.saved' }),
    }));
    this.busy = false;
    this.notice = notice;
    if (ok) {
      this.keys.done(key);
      this.open = false;
      this.form = { ...this.form, clearing: '', account: '', iban: '', bic: '' };
      await this.load();
    }
  }

  private problemText(p: PayeeProblem) {
    switch (p) {
      case 'market':
        return msg('A market is two capital letters, e.g. SE.', { id: 'payee.marketProblem' });
      case 'clearing':
        return msg('The clearing number has 4 or 5 digits.', { id: 'payee.clearingProblem' });
      case 'account':
        return msg('The account number has 6 to 12 digits.', { id: 'payee.accountProblem' });
      case 'iban':
        return msg('The IBAN is not valid: check the digits.', { id: 'payee.ibanProblem' });
      case 'bic':
        return msg('A BIC has 8 or 11 characters.', { id: 'payee.bicProblem' });
    }
  }

  private formView() {
    const f = this.form;
    const set = (patch: Partial<PayeeForm>) => (this.form = { ...f, ...patch });
    return html`<form @submit=${(e: Event) => this.submit(e)} novalidate>
      <wa-radio-group label=${msg('Kind of account', { id: 'payee.method' })} .value=${f.method} @change=${(e: Event) => set({ method: value(e) as PayeeForm['method'] })}>
        <wa-radio value="se-bank">${msg('Swedish bank account', { id: 'payee.seBank' })}</wa-radio>
        <wa-radio value="iban">IBAN</wa-radio>
      </wa-radio-group>
      <wa-input label=${msg('Market', { id: 'money.market' })} .value=${f.market} @input=${(e: Event) => set({ market: value(e).toUpperCase() })}></wa-input>
      ${f.method === 'se-bank'
        ? html`<div class="pair">
            <wa-input label=${msg('Clearing number', { id: 'payee.clearing' })} inputmode="numeric" .value=${f.clearing} @input=${(e: Event) => set({ clearing: value(e) })}></wa-input>
            <wa-input label=${msg('Account number', { id: 'payee.accountNo' })} inputmode="numeric" .value=${f.account} @input=${(e: Event) => set({ account: value(e) })}></wa-input>
          </div>`
        : html`<wa-input label="IBAN" .value=${f.iban} @input=${(e: Event) => set({ iban: value(e) })}></wa-input>
            <wa-input label=${msg('BIC (optional)', { id: 'payee.bic' })} .value=${f.bic} @input=${(e: Event) => set({ bic: value(e) })}></wa-input>`}
      ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${this.problemText(p)}</div>`)}</wa-callout>` : nothing}
      <p>${msg('Take the details from the payee, never from a message you cannot check. The number is shown masked afterwards.', { id: 'payee.how' })}</p>
      <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Save the details', { id: 'payee.save' })}</wa-button>
    </form>`;
  }

  render() {
    const writable = !!this.me?.permissions.includes('payments:payee-write');
    return html`<section class="pv-card" aria-labelledby="payee">
      <div class="pv-card__head">
        <h2 class="pv-card__title" id="payee">${msg('Payout details', { id: 'payee.title' })}</h2>
        ${writable && !this.open
          ? html`<wa-button size="small" appearance="outlined" @click=${() => ((this.open = true), (this.notice = null))}>${msg('Give new details', { id: 'payee.new' })}</wa-button>`
          : nothing}
      </div>
      <div class="pv-card__body">
        ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'success' ? 'status' : 'alert'}>${this.notice.text}</wa-callout>` : nothing}
        <pv-data-grid
          .columns=${this.columns()}
          .rows=${this.items}
          label=${msg('Payout details', { id: 'payee.title' })}
          ?loading=${this.loading}
          error=${this.error}
          empty-text=${msg('No details given. A payout waits until they are.', { id: 'payee.none' })}
        ></pv-data-grid>
        ${this.open ? this.formView() : nothing}
        ${this.partyId && this.payouts.length
          ? html`<pv-data-grid .columns=${this.payoutColumns()} .rows=${this.payouts} label=${msg('Payouts', { id: 'payee.payouts' })}></pv-data-grid>`
          : nothing}
      </div>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-payee-accounts': PayeeAccounts;
  }
}
