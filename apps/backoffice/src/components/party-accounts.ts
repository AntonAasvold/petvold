/**
 * <pv-party-accounts>: a party's payer accounts (ADR 0040), one per market
 * and currency, with what is still to pay and the credit. Opens the account.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import type { Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import './data-grid.ts';
import type { Column } from './data-grid.ts';

type PayerAccount = components['schemas']['PayerAccount'];

@customElement('pv-party-accounts')
export class PartyAccounts extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: 'party-id' }) partyId = '';
  @state() private items: PayerAccount[] = [];
  @state() private loading = true;
  @state() private error = '';

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
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('partyId') && this.partyId) void this.load();
  }

  private async load() {
    this.loading = true;
    const { data, error } = await this.api.GET('/v1/payer-accounts', { params: { query: { partyId: this.partyId } } });
    this.items = data?.items ?? [];
    this.error = data ? '' : ((error as { title?: string } | undefined)?.title ?? msg('Something went wrong.', { id: 'common.error' }));
    this.loading = false;
  }

  private columns(): Column<PayerAccount>[] {
    const lang = getLocale();
    return [
      { key: 'market', header: msg('Market', { id: 'money.market' }), value: (a) => `${a.market} · ${a.currency}` },
      { key: 'open', header: msg('To pay', { id: 'account.open' }), value: (a) => formatMoney(a.balance.open, a.currency, lang), align: 'end' },
      { key: 'credit', header: msg('Credit', { id: 'account.credit' }), value: (a) => formatMoney(a.balance.credit, a.currency, lang), align: 'end' },
    ];
  }

  render() {
    return html`<section class="pv-card" aria-labelledby="accounts">
      <div class="pv-card__head"><h2 class="pv-card__title" id="accounts">${msg('Payer accounts', { id: 'account.title' })}</h2></div>
      <pv-data-grid
        .columns=${this.columns()}
        .rows=${this.items}
        label=${msg('Payer accounts', { id: 'account.title' })}
        ?loading=${this.loading}
        error=${this.error}
        empty-text=${msg('No payer account. One is made with the first policy.', { id: 'account.none' })}
        @pv-row-activate=${(e: CustomEvent<{ row: PayerAccount }>) => navigate(`/payer-accounts/${encodeURIComponent(e.detail.row.id)}`)}
      ></pv-data-grid>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-party-accounts': PartyAccounts;
  }
}
