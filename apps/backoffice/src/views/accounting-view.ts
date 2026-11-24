/**
 * <pv-accounting>: the bookkeeping (ADR 0040, steg 8). Closed days with their
 * totals and file, the balance per kind of account, the verifications, and the
 * chart of accounts, changed as a new version with a reason (ADR 0020).
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import { ACCOUNT_KINDS, accountingTabs, balanced, chartProblems, dayFileName, unmappedKinds, withAccount, type AccountKind, type AccountingTab, type ChartMarkets, type ChartProblem } from '../accounting-logic.ts';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { pvComponents } from '../styles/pv-components.ts';

type DayClose = components['schemas']['DayClose'];
type Verification = components['schemas']['Verification'];
type Balances = components['schemas']['AccountBalances'];
type Chart = components['schemas']['ChartOfAccounts'];

const value = (e: Event) => (e.target as HTMLInputElement).value;
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;

@customElement('pv-accounting')
export class AccountingView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @state() private tab: AccountingTab = 'days';
  @state() private market = 'SE';
  @state() private from = monthStart();
  @state() private to = today();
  @state() private days: DayClose[] = [];
  @state() private verifications: Verification[] = [];
  @state() private balances: Balances | null = null;
  @state() private chart: Chart | null = null;
  @state() private versions: Chart[] = [];
  @state() private draft: ChartMarkets = {};
  @state() private reason = '';
  @state() private shown: ChartProblem[] = [];
  @state() private selected: DayClose | Verification | null = null;
  @state() private loading = false;
  @state() private error = '';
  @state() private notice: Notice | null = null;
  @state() private busy = '';
  private request = 0;
  private keys = new IdempotencyKeys();

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
      wa-tab-group {
        margin-bottom: var(--space-4);
      }
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
        align-items: flex-end;
        margin-bottom: var(--space-4);
      }
      .filters wa-input {
        width: 11rem;
      }
      .cols {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-6);
      }
      .list {
        flex: 999 1 520px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .side {
        flex: 1 1 340px;
        max-width: 420px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .chart-row {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.6fr);
        gap: var(--space-3);
        align-items: center;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .pv-card__body p {
        margin: 0;
      }
      @media (max-width: 52rem) {
        .side {
          max-width: none;
        }
        .chart-row {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    const id = ++this.request;
    this.loading = true;
    this.error = '';
    try {
      const range = { market: this.market, from: this.from, to: this.to };
      switch (this.tab) {
        case 'days': {
          const page = await unwrap(this.api.GET('/v1/day-closes', { params: { query: { ...range, limit: 200 } } }));
          if (id === this.request) this.days = [...page.items].reverse();
          break;
        }
        case 'verifications': {
          const page = await unwrap(this.api.GET('/v1/verifications', { params: { query: { ...range, limit: 200 } } }));
          if (id === this.request) this.verifications = [...page.items].reverse();
          break;
        }
        case 'balances': {
          const b = await unwrap(this.api.GET('/v1/account-balances', { params: { query: range } }));
          if (id === this.request) this.balances = b;
          break;
        }
        case 'chart': {
          const [chart, versions] = await Promise.all([unwrap(this.api.GET('/v1/settings/chart-of-accounts')), unwrap(this.api.GET('/v1/settings/chart-of-accounts/versions'))]);
          if (id === this.request) {
            this.chart = chart;
            this.versions = [...versions.items].reverse();
            this.draft = (chart.markets ?? {}) as ChartMarkets;
          }
          break;
        }
      }
    } catch (e) {
      if (id === this.request) this.error = (e as { title?: string }).title ?? msg('Something went wrong.', { id: 'common.error' });
    } finally {
      if (id === this.request) this.loading = false;
    }
  }

  private show(tab: AccountingTab) {
    this.tab = tab;
    this.selected = null;
    this.notice = null;
    this.shown = [];
    void this.load();
  }

  private tabLabel(t: AccountingTab) {
    switch (t) {
      case 'days':
        return msg('Day closes', { id: 'accounting.tab.days' });
      case 'balances':
        return msg('Balances', { id: 'accounting.tab.balances' });
      case 'verifications':
        return msg('Verifications', { id: 'accounting.tab.verifications' });
      case 'chart':
        return msg('Chart of accounts', { id: 'accounting.tab.chart' });
    }
  }

  private kindLabel(k: string) {
    switch (k as AccountKind) {
      case 'bank':
        return msg('Bank', { id: 'account.kind.bank' });
      case 'unmatched-payments':
        return msg('Unmatched payments', { id: 'money.tab.unmatched' });
      case 'premium-receivable':
        return msg('Premium receivable', { id: 'account.kind.receivable' });
      case 'premium-income':
        return msg('Premium income', { id: 'account.kind.income' });
      case 'premium-tax':
        return msg('Premium tax', { id: 'account.kind.tax' });
      case 'installment-fees':
        return msg('Installment fees', { id: 'account.kind.fees' });
      case 'customer-losses':
        return msg('Customer losses', { id: 'account.kind.losses' });
      case 'refunds-payable':
        return msg('Refunds payable', { id: 'account.kind.refunds' });
      case 'claims-cost':
        return msg('Claims cost', { id: 'account.kind.claimsCost' });
      case 'claims-payable':
        return msg('Claims payable', { id: 'account.kind.claimsPayable' });
      default:
        return k;
    }
  }

  private totals(t: readonly { currency: string; debit: number; credit: number }[]) {
    const lang = getLocale();
    return t.length ? t.map((x) => formatMoney(x.debit, x.currency, lang)).join(', ') : '–';
  }

  private dayColumns(): Column<DayClose>[] {
    const lang = getLocale();
    return [
      { key: 'day', header: msg('Day', { id: 'accounting.day' }), value: (d) => formatDate(d.day, lang) },
      { key: 'count', header: msg('Verifications', { id: 'accounting.tab.verifications' }), value: (d) => d.verificationCount, align: 'end' },
      { key: 'totals', header: msg('Debit = credit', { id: 'accounting.totals' }), value: (d) => this.totals(d.totals), align: 'end' },
      {
        key: 'flags',
        header: msg('Needs', { id: 'notices.flags' }),
        value: (d) => html`${d.unmapped.length ? html`<span class="pv-badge pv-badge--pending">${msg('Accounts missing in the chart', { id: 'accounting.unmapped' })}</span>` : nothing}
        ${balanced(d.totals) ? nothing : html`<span class="pv-badge pv-badge--solid">${msg('Not balanced', { id: 'accounting.unbalanced' })}</span>`}`,
      },
    ];
  }

  private verificationColumns(): Column<Verification>[] {
    const lang = getLocale();
    const sum = (v: Verification) => v.lines.reduce((s, l) => s + l.debit, 0);
    return [
      { key: 'number', header: msg('Number', { id: 'accounting.number' }), value: (v) => html`<span class="pv-mono">${v.number}</span>` },
      { key: 'date', header: msg('Booked', { id: 'money.bookedOn' }), value: (v) => formatDate(v.bookingDate, lang) },
      { key: 'text', header: msg('Text', { id: 'accounting.text' }), value: (v) => v.text },
      { key: 'amount', header: msg('Amount', { id: 'money.amount' }), value: (v) => formatMoney(sum(v), v.currency, lang), align: 'end' },
    ];
  }

  private balanceColumns(): Column<Balances['items'][number]>[] {
    const lang = getLocale();
    return [
      { key: 'account', header: msg('Account', { id: 'payee.account' }), value: (b) => this.kindLabel(b.account) },
      { key: 'debit', header: msg('Debit', { id: 'accounting.debit' }), value: (b) => formatMoney(b.debit, b.currency, lang), align: 'end' },
      { key: 'credit', header: msg('Credit', { id: 'accounting.credit' }), value: (b) => formatMoney(b.credit, b.currency, lang), align: 'end' },
      { key: 'balance', header: msg('Balance', { id: 'accounting.balance' }), value: (b) => formatMoney(b.balance, b.currency, lang), align: 'end' },
    ];
  }

  private async download(d: DayClose) {
    this.busy = 'file';
    const { data, error } = await this.api.GET('/v1/day-closes/{market}/{day}/file', { params: { path: { market: d.market, day: d.day } }, parseAs: 'text' });
    this.busy = '';
    if (typeof data !== 'string') {
      this.notice = { variant: 'danger', text: (error as { title?: string } | undefined)?.title ?? msg('Something went wrong.', { id: 'common.error' }) };
      return;
    }
    const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = dayFileName(d.market, d.day);
    a.click();
    URL.revokeObjectURL(url);
  }

  private row(label: string, v: unknown, mono = false) {
    return html`<div class="pv-dl__row"><dt>${label}</dt><dd class=${mono ? 'pv-mono' : ''}>${v}</dd></div>`;
  }

  private dayCard(d: DayClose) {
    const lang = getLocale();
    return html`<section class="pv-card" aria-labelledby="sel">
      <div class="pv-card__head"><h2 class="pv-card__title" id="sel">${msg('Closed day', { id: 'accounting.closedDay' })} ${formatDate(d.day, lang)}</h2><span class="pv-card__meta">${d.market}</span></div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${this.row(msg('Verifications', { id: 'accounting.tab.verifications' }), d.verificationCount)}
          ${d.totals.map((t) => this.row(`${msg('Debit = credit', { id: 'accounting.totals' })} ${t.currency}`, `${formatMoney(t.debit, t.currency, lang)} = ${formatMoney(t.credit, t.currency, lang)}`))}
          ${this.row(msg('Chart version', { id: 'accounting.chartVersion' }), d.chartVersion || '–')}
          ${this.row(msg('Closed', { id: 'accounting.closedAt' }), `${formatDateTime(d.closedAt, lang)} · ${d.closedBy}`)}
          ${this.row('SHA-256', d.csvSha256.slice(0, 16) + '…', true)}
        </dl>
        ${d.unmapped.length
          ? html`<p>${msg('The chart had no account for these, so the file has their names:', { id: 'accounting.unmappedHow' })} ${d.unmapped.map((k) => this.kindLabel(k)).join(', ')}</p>`
          : nothing}
        <p>${msg('A closed day never changes. The file is made again from it and gives the same checksum.', { id: 'accounting.closedHow' })}</p>
        <wa-button variant="brand" ?loading=${this.busy === 'file'} @click=${() => this.download(d)}>${msg('Download the file (CSV)', { id: 'accounting.download' })}</wa-button>
      </div>
    </section>`;
  }

  private verificationCard(v: Verification) {
    const lang = getLocale();
    const money = (n: number) => (n ? formatMoney(n, v.currency, lang) : '');
    const lines: Column<Verification['lines'][number]>[] = [
      { key: 'account', header: msg('Account', { id: 'payee.account' }), value: (l) => this.kindLabel(l.account) },
      { key: 'debit', header: msg('Debit', { id: 'accounting.debit' }), value: (l) => money(l.debit), align: 'end' },
      { key: 'credit', header: msg('Credit', { id: 'accounting.credit' }), value: (l) => money(l.credit), align: 'end' },
    ];
    return html`<section class="pv-card" aria-labelledby="sel">
      <div class="pv-card__head"><h2 class="pv-card__title" id="sel">${v.number}</h2><span class="pv-card__meta">${formatDate(v.bookingDate, lang)}</span></div>
      <div class="pv-card__body">
        <p>${v.text}</p>
        <pv-data-grid .columns=${lines} .rows=${v.lines} label=${msg('Lines', { id: 'accounting.lines' })}></pv-data-grid>
        <dl class="pv-dl">
          ${this.row(msg('From', { id: 'money.from' }), `${v.source.eventType} · ${v.source.objectId}`, true)}
        </dl>
      </div>
    </section>`;
  }

  private async saveChart(e: Event) {
    e.preventDefault();
    this.shown = chartProblems(this.draft, this.reason);
    if (this.shown.length || !this.chart) return;
    this.busy = 'chart';
    const key = `chart:${this.chart.version}`;
    const { ok, notice } = await act(
      () =>
        this.api.POST('/v1/settings/chart-of-accounts/versions', {
          params: { header: { 'Idempotency-Key': this.keys.for(key) } },
          body: { basedOnVersion: this.chart!.version, markets: this.draft, reason: this.reason.trim() },
        }),
      () => ({ variant: 'success', text: msg('Saved as a new version. Days closed from now use it; a closed day keeps its own.', { id: 'accounting.chartSaved' }) }),
    );
    this.busy = '';
    this.notice = notice;
    if (ok) {
      this.keys.done(key);
      this.reason = '';
      await this.load();
    }
  }

  private chartView() {
    const c = this.chart;
    if (!c) return nothing;
    const writable = !!this.me?.permissions.includes('accounting:configure');
    const accounts = this.draft[this.market] ?? {};
    const problemFor = (k: AccountKind) => this.shown.some((p) => p.kind === 'number' && p.market === this.market && p.account === k);
    const lang = getLocale();
    const missing = unmappedKinds(this.draft, this.market);
    return html`<div class="cols">
      <div class="list">
        <section class="pv-card" aria-labelledby="chart">
          <div class="pv-card__head">
            <h2 class="pv-card__title" id="chart">${msg('Chart of accounts', { id: 'accounting.tab.chart' })} · ${this.market}</h2>
            <span class="pv-card__meta">${msg('Version', { id: 'accounting.version' })} ${c.version}</span>
          </div>
          <form class="pv-card__body" @submit=${(e: Event) => this.saveChart(e)} novalidate>
            <p>${msg("Petvold's kinds of account to your account numbers. A kind without a number keeps its name in the day's file.", { id: 'accounting.chartHow' })}</p>
            ${ACCOUNT_KINDS.map(
              (k) => html`<div class="chart-row">
                <span>${this.kindLabel(k)} <span class="pv-mono">${k}</span></span>
                <wa-input
                  label=${msg('Number', { id: 'accounting.number' })}
                  .value=${accounts[k]?.number ?? ''}
                  ?disabled=${!writable}
                  aria-invalid=${problemFor(k) ? 'true' : 'false'}
                  @change=${(e: Event) => (this.draft = withAccount(this.draft, this.market, k, value(e), accounts[k]?.name ?? ''))}
                ></wa-input>
                <wa-input
                  label=${msg('Name', { id: 'accounting.name' })}
                  .value=${accounts[k]?.name ?? ''}
                  ?disabled=${!writable || !accounts[k]}
                  @change=${(e: Event) => (this.draft = withAccount(this.draft, this.market, k, accounts[k]?.number ?? '', value(e)))}
                ></wa-input>
              </div>`,
            )}
            ${missing.length ? html`<p>${msg('Without a number:', { id: 'accounting.withoutNumber' })} ${missing.map((k) => this.kindLabel(k)).join(', ')}</p>` : nothing}
            ${writable
              ? html`<wa-textarea label=${msg('Reason for the change', { id: 'settings.reason' })} rows="2" .value=${this.reason} @input=${(e: Event) => (this.reason = value(e))}></wa-textarea>
                  ${this.shown.length
                    ? html`<wa-callout variant="danger" role="alert"
                        >${this.shown.map((p) =>
                          p.kind === 'reason'
                            ? html`<div>${msg('Give a reason for the change.', { id: 'settings.needReason' })}</div>`
                            : p.kind === 'number'
                              ? html`<div>${this.kindLabel(p.account)}: ${msg('a number is 1 to 20 letters, digits, dots or dashes.', { id: 'accounting.numberProblem' })}</div>`
                              : html`<div>${p.market}: ${msg('A market is two capital letters, e.g. SE.', { id: 'payee.marketProblem' })}</div>`,
                        )}</wa-callout
                      >`
                    : nothing}
                  <wa-button type="submit" variant="brand" ?loading=${this.busy === 'chart'}>${msg('Save a new version', { id: 'settings.save' })}</wa-button>`
              : nothing}
          </form>
        </section>
      </div>
      <div class="side">
        <section class="pv-card" aria-labelledby="versions">
          <div class="pv-card__head"><h2 class="pv-card__title" id="versions">${msg('Versions', { id: 'settings.versions' })}</h2></div>
          <div class="pv-card__body">
            <dl class="pv-dl">${this.versions.map((v) => this.row(`${msg('Version', { id: 'accounting.version' })} ${v.version}`, `${v.reason} · ${v.changedBy}, ${formatDateTime(v.changedAt, lang)}`))}</dl>
          </div>
        </section>
      </div>
    </div>`;
  }

  private filters() {
    return html`<form class="filters" @submit=${(e: Event) => (e.preventDefault(), this.load())}>
      <wa-input label=${msg('Market', { id: 'money.market' })} .value=${this.market} @change=${(e: Event) => ((this.market = value(e).toUpperCase()), this.tab === 'chart' ? this.requestUpdate() : this.load())}></wa-input>
      ${this.tab === 'chart'
        ? nothing
        : html`<wa-input type="date" label=${msg('From', { id: 'money.from' })} .value=${this.from} @change=${(e: Event) => ((this.from = value(e)), this.load())}></wa-input>
            <wa-input type="date" label=${msg('To', { id: 'money.to' })} .value=${this.to} @change=${(e: Event) => ((this.to = value(e)), this.load())}></wa-input>`}
    </form>`;
  }

  private grid<T>(columns: Column<T>[], rows: T[], label: string, select?: (r: T) => void) {
    return html`<pv-data-grid
      .columns=${columns}
      .rows=${rows}
      label=${label}
      ?loading=${this.loading}
      error=${this.error}
      empty-text=${msg('Nothing to show.', { id: 'common.empty' })}
      retry-text=${msg('Try again', { id: 'common.retry' })}
      @pv-row-activate=${(e: CustomEvent<{ row: T }>) => select?.(e.detail.row)}
    ></pv-data-grid>`;
  }

  private body() {
    switch (this.tab) {
      case 'chart':
        return this.chartView();
      case 'balances':
        return this.grid(this.balanceColumns(), this.balances?.items ?? [], this.tabLabel('balances'));
      case 'days':
      case 'verifications': {
        const s = this.selected;
        return html`<div class="cols">
          <div class="list">
            ${this.tab === 'days'
              ? this.grid(this.dayColumns(), this.days, this.tabLabel('days'), (r) => ((this.selected = r), (this.notice = null)))
              : this.grid(this.verificationColumns(), this.verifications, this.tabLabel('verifications'), (r) => ((this.selected = r), (this.notice = null)))}
          </div>
          ${s ? html`<div class="side">${'csvSha256' in s ? this.dayCard(s) : this.verificationCard(s)}</div>` : nothing}
        </div>`;
      }
    }
  }

  render() {
    return html`
      <h2>${msg('Bookkeeping', { id: 'nav.accounting' })}</h2>
      <wa-tab-group @wa-tab-show=${(e: CustomEvent<{ name: string }>) => this.show(e.detail.name as AccountingTab)}>
        ${accountingTabs(this.me).map((t) => html`<wa-tab panel=${t} ?active=${t === this.tab}>${this.tabLabel(t)}</wa-tab>`)}
      </wa-tab-group>
      ${this.filters()}
      ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'success' ? 'status' : 'alert'}>${this.notice.text}</wa-callout>` : nothing}
      ${this.body()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-accounting': AccountingView;
  }
}
