/**
 * <pv-payer-account>: a payer's account (ADR 0040, steg 8). What is still to
 * pay and the credit, the invoices with what is paid and credited, and the
 * refunds. A credit note or write-off on an invoice (a proposal above the
 * caller's limit), and paying back the credit.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/radio-group/radio-group.js';
import '@awesome.me/webawesome/dist/components/radio/radio.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import { creditBody, creditMax, creditProblems, dunningState, refundBody, refundProblems, type CreditForm, type CreditProblem, type RefundProblem } from '../account-logic.ts';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';

type PayerAccount = components['schemas']['PayerAccount'];
type Invoice = components['schemas']['Invoice'];
type Refund = components['schemas']['Refund'];

const value = (e: Event) => (e.target as HTMLInputElement).value;

@customElement('pv-payer-account')
export class PayerAccountView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'account-id' }) accountId = '';
  @state() private account: PayerAccount | null = null;
  @state() private invoices: Invoice[] = [];
  @state() private refunds: Refund[] = [];
  @state() private missing = false;
  @state() private selected: Invoice | null = null;
  @state() private credit: CreditForm = { kind: 'credit', amount: '', reason: '' };
  @state() private creditShown: CreditProblem[] = [];
  @state() private refund = { amount: '', note: '' };
  @state() private refundShown: RefundProblem[] = [];
  @state() private notice: Notice | null = null;
  @state() private busy = '';
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
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
        gap: var(--space-2);
        margin: var(--space-3) 0 var(--space-5);
      }
      .title h1 {
        margin: 0;
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
        gap: var(--space-4);
      }
      form {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .pv-card__body p {
        margin: 0;
      }
      @media (max-width: 900px) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('accountId') && this.accountId) void this.load();
  }

  private async load() {
    try {
      const query = { accountId: this.accountId, limit: 200 };
      const [account, invoices, refunds] = await Promise.all([
        unwrap(this.api.GET('/v1/payer-accounts/{accountId}', { params: { path: { accountId: this.accountId } } })),
        unwrap(this.api.GET('/v1/invoices', { params: { query } })),
        unwrap(this.api.GET('/v1/refunds', { params: { query } })),
      ]);
      this.account = account;
      // Newest first: the one the customer asks about is usually the last.
      this.invoices = [...invoices.items].reverse();
      this.refunds = [...refunds.items].reverse();
      this.selected = this.selected ? (this.invoices.find((i) => i.id === this.selected!.id) ?? null) : null;
    } catch {
      this.missing = true;
    }
  }

  private may(p: string): boolean {
    return !!this.me?.permissions.includes(p);
  }

  private statusLabel(s: Invoice['status']) {
    switch (s) {
      case 'open':
        return msg('Unpaid', { id: 'invoice.open' });
      case 'partly-paid':
        return msg('Partly paid', { id: 'invoice.partlyPaid' });
      case 'paid':
        return msg('Paid', { id: 'invoice.paid' });
      case 'credited':
        return msg('Credited', { id: 'invoice.credited' });
    }
  }

  private dunningLabel(step: string | null) {
    switch (step) {
      case 'reminded':
        return msg('Reminded', { id: 'invoice.reminded' });
      case 'cancellation-noticed':
        return msg('Notice of cancellation', { id: 'invoice.noticed' });
      case 'cancellation-voided':
        return msg('Cancellation reversed', { id: 'invoice.voided' });
      case 'cancellation-void-failed':
        return msg('Reversal failed: a person must', { id: 'invoice.voidFailed' });
      default:
        return '';
    }
  }

  private invoiceColumns(currency: string): Column<Invoice>[] {
    const lang = getLocale();
    const money = (n: number) => formatMoney(n, currency, lang);
    return [
      { key: 'number', header: msg('Invoice', { id: 'money.invoice' }), value: (i) => html`<span class="pv-mono">${i.number}</span>` },
      { key: 'due', header: msg('Due', { id: 'invoice.due' }), value: (i) => formatDate(i.dueDate, lang) },
      { key: 'total', header: msg('Total', { id: 'invoice.total' }), value: (i) => money(i.total), align: 'end' },
      { key: 'open', header: msg('To pay', { id: 'account.open' }), value: (i) => money(i.open), align: 'end' },
      {
        key: 'status',
        header: msg('Status', { id: 'claims.col.status' }),
        value: (i) => html`${this.statusLabel(i.status)}${dunningState(i) ? html` <span class="pv-badge pv-badge--pending">${this.dunningLabel(dunningState(i))}</span>` : nothing}`,
      },
    ];
  }

  private refundColumns(currency: string): Column<Refund>[] {
    const lang = getLocale();
    return [
      { key: 'at', header: msg('Date', { id: 'document.date' }), value: (r) => formatDateTime(r.at, lang) },
      { key: 'amount', header: msg('Amount', { id: 'money.amount' }), value: (r) => formatMoney(r.amount, currency, lang), align: 'end' },
      {
        key: 'reason',
        header: msg('Why', { id: 'account.refundWhy' }),
        value: (r) => (r.reason === 'requested' ? msg('The payer asked', { id: 'account.requested' }) : msg('Nothing more to bill', { id: 'account.nothingMore' })),
      },
    ];
  }

  private select(i: Invoice) {
    this.selected = i;
    this.credit = { kind: 'credit', amount: '', reason: '' };
    this.creditShown = [];
    this.notice = null;
  }

  private async send(what: string, call: (key: string) => Promise<{ response: Response; error?: unknown }>, success: (status: number) => string): Promise<boolean> {
    this.busy = what;
    const key = `${what}:${this.selected?.id ?? this.accountId}`;
    const { ok, notice } = await act(() => call(this.keys.for(key)), (status) => ({ variant: 'success', text: success(status) }));
    this.busy = '';
    this.notice = notice;
    if (ok) {
      this.keys.done(key);
      await this.load();
    }
    return ok;
  }

  private async doCredit(e: Event, inv: Invoice) {
    e.preventDefault();
    this.creditShown = creditProblems(this.credit, inv, inv.currency);
    if (this.creditShown.length) return;
    const ok = await this.send(
      'credit',
      (key) => this.api.POST('/v1/invoices/{invoiceId}/credit-notes', { params: { path: { invoiceId: inv.id }, header: { 'Idempotency-Key': key } }, body: creditBody(this.credit, inv.currency) }),
      (status) =>
        status === 202
          ? msg('Above your limit: it is a proposal for someone else to approve, under Money.', { id: 'account.proposed' })
          : msg('Done. The credit note is made.', { id: 'account.credited' }),
    );
    if (ok) this.credit = { kind: this.credit.kind, amount: '', reason: '' };
  }

  private async doRefund(e: Event, a: PayerAccount) {
    e.preventDefault();
    this.refundShown = refundProblems(this.refund, a.balance.credit, a.currency);
    if (this.refundShown.length) return;
    const ok = await this.send(
      'refund',
      (key) => this.api.POST('/v1/payer-accounts/{accountId}/refunds', { params: { path: { accountId: a.id }, header: { 'Idempotency-Key': key } }, body: refundBody(this.refund, a.currency) }),
      () => msg('The refund is ordered. Payments pays it out to the payer.', { id: 'account.refunded' }),
    );
    if (ok) this.refund = { amount: '', note: '' };
  }

  private creditProblemText(p: CreditProblem, inv: Invoice) {
    const max = formatMoney(creditMax(inv, this.credit.kind), inv.currency, getLocale());
    switch (p) {
      case 'amount':
        return msg('Give an amount, e.g. 195,07.', { id: 'account.amountProblem' });
      case 'too-much':
        return `${msg('More than the invoice allows. At most:', { id: 'account.tooMuch' })} ${max}`;
      case 'reason':
        return msg('Give a reason.', { id: 'money.reasonProblem' });
    }
  }

  private invoiceCard(inv: Invoice) {
    const lang = getLocale();
    const money = (n: number) => formatMoney(n, inv.currency, lang);
    const row = (label: string, v: unknown, mono = false) => html`<div class="pv-dl__row"><dt>${label}</dt><dd class=${mono ? 'pv-mono' : ''}>${v}</dd></div>`;
    const kinds: CreditForm['kind'][] = ['credit', 'write-off'];
    return html`<section class="pv-card" aria-labelledby="invoice">
      <div class="pv-card__head"><h2 class="pv-card__title" id="invoice">${msg('Invoice', { id: 'money.invoice' })} ${inv.number}</h2><span class="pv-card__meta pv-mono">${inv.id}</span></div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${row(msg('Issued', { id: 'invoice.issued' }), formatDate(inv.issueDate, lang))}
          ${row(msg('Due', { id: 'invoice.due' }), formatDate(inv.dueDate, lang))}
          ${row(msg('Reference', { id: 'money.reference' }), inv.reference.value, true)}
          ${row(msg('Total', { id: 'invoice.total' }), money(inv.total))}
          ${row(msg('Credited', { id: 'invoice.credited' }), money(inv.credited))}
          ${row(msg('Paid', { id: 'invoice.paid' }), money(inv.paid))}
          ${row(msg('To pay', { id: 'account.open' }), money(inv.open))}
          ${row(msg('Policies', { id: 'invoice.policies' }), [...new Set(inv.lines.map((l) => l.policyId))].join(', '), true)}
        </dl>
        ${this.may('billing:credit') && creditMax(inv, 'credit') > 0
          ? html`<form @submit=${(e: Event) => this.doCredit(e, inv)} novalidate>
              <wa-radio-group
                label=${msg('Take off', { id: 'account.takeOff' })}
                .value=${this.credit.kind}
                @change=${(e: Event) => (this.credit = { ...this.credit, kind: value(e) as CreditForm['kind'] })}
              >
                ${kinds.map(
                  (k) =>
                    html`<wa-radio value=${k} ?disabled=${creditMax(inv, k) < 1}
                      >${k === 'credit' ? msg('Credit note: less to pay', { id: 'account.kindCredit' }) : msg('Write-off: give up what is unpaid', { id: 'account.kindWriteOff' })}
                      (${msg('at most', { id: 'account.atMost' })} ${money(creditMax(inv, k))})</wa-radio
                    >`,
                )}
              </wa-radio-group>
              <wa-input label=${msg('Amount', { id: 'money.amount' })} inputmode="decimal" .value=${this.credit.amount} @input=${(e: Event) => (this.credit = { ...this.credit, amount: value(e) })}></wa-input>
              <wa-textarea label=${msg('Reason', { id: 'money.reason' })} rows="2" .value=${this.credit.reason} @input=${(e: Event) => (this.credit = { ...this.credit, reason: value(e) })}></wa-textarea>
              ${this.creditShown.length ? html`<wa-callout variant="danger" role="alert">${this.creditShown.map((p) => html`<div>${this.creditProblemText(p, inv)}</div>`)}</wa-callout>` : nothing}
              <p>${msg('Within your limit it is made at once; above it, someone else approves it.', { id: 'account.limitHow' })}</p>
              <wa-button type="submit" variant="brand" ?loading=${this.busy === 'credit'}>${msg('Make it', { id: 'account.make' })}</wa-button>
            </form>`
          : nothing}
      </div>
    </section>`;
  }

  private refundCard(a: PayerAccount) {
    const money = formatMoney(a.balance.credit, a.currency, getLocale());
    const problem = (p: RefundProblem) =>
      p === 'too-much' ? `${msg('More than the credit. At most:', { id: 'account.refundTooMuch' })} ${money}` : msg('Give an amount, e.g. 195,07, or leave it empty for all of it.', { id: 'account.refundAmount' });
    return html`<section class="pv-card" aria-labelledby="refund">
      <div class="pv-card__head"><h2 class="pv-card__title" id="refund">${msg('Pay back the credit', { id: 'account.refundTitle' })}</h2></div>
      <form class="pv-card__body" @submit=${(e: Event) => this.doRefund(e, a)} novalidate>
        <p>${msg('The credit run uses the credit on the next invoice, or pays it back when there is nothing more to bill. Pay it back here when the payer asks.', { id: 'account.refundHow' })}</p>
        <wa-input label=${msg('Amount (empty: all of it)', { id: 'account.refundAmountLabel' })} inputmode="decimal" .value=${this.refund.amount} @input=${(e: Event) => (this.refund = { ...this.refund, amount: value(e) })}></wa-input>
        <wa-textarea label=${msg('How the payer asked (optional)', { id: 'account.refundNote' })} rows="2" .value=${this.refund.note} @input=${(e: Event) => (this.refund = { ...this.refund, note: value(e) })}></wa-textarea>
        ${this.refundShown.length ? html`<wa-callout variant="danger" role="alert">${this.refundShown.map((p) => html`<div>${problem(p)}</div>`)}</wa-callout>` : nothing}
        <wa-button type="submit" variant="brand" ?loading=${this.busy === 'refund'}>${msg('Pay back', { id: 'account.refund' })}</wa-button>
      </form>
    </section>`;
  }

  render() {
    const a = this.account;
    const party = a?.partyId;
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/parties" @click=${(e: Event) => (e.preventDefault(), navigate('/parties'))}>${msg('Parties', { id: 'nav.parties' })}</a>
      ${party
        ? html`<span aria-hidden="true">/</span><a href="/parties/${party}" @click=${(e: Event) => (e.preventDefault(), navigate(`/parties/${encodeURIComponent(party)}`))}>${party}</a>`
        : nothing}
      <span aria-hidden="true">/</span><span aria-current="page">${this.accountId}</span>
    </nav>`;
    if (this.missing) return html`${crumbs}<wa-callout variant="neutral">${msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' })}</wa-callout>`;
    if (!a) return html`${crumbs}<wa-spinner></wa-spinner>`;
    const lang = getLocale();
    return html`
      ${crumbs}
      <div class="title">
        <h1>${msg('Payer account', { id: 'money.account' })}</h1>
        <span class="pv-badge pv-badge--id">${a.id}</span>
        <span class="pv-badge">${a.market} · ${a.currency}</span>
      </div>
      <div class="pv-figures">
        <div class="pv-figure"><span class="pv-figure__label">${msg('To pay', { id: 'account.open' })}</span><span class="pv-figure__value">${formatMoney(a.balance.open, a.currency, lang)}</span></div>
        <div class="pv-figure"><span class="pv-figure__label">${msg('Credit', { id: 'account.credit' })}</span><span class="pv-figure__value">${formatMoney(a.balance.credit, a.currency, lang)}</span></div>
      </div>
      ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'success' ? 'status' : 'alert'}>${this.notice.text}</wa-callout>` : nothing}
      <div class="cols">
        <div class="basis">
          <section class="pv-card" aria-labelledby="invoices">
            <div class="pv-card__head"><h2 class="pv-card__title" id="invoices">${msg('Invoices', { id: 'account.invoices' })}</h2></div>
            <pv-data-grid
              .columns=${this.invoiceColumns(a.currency)}
              .rows=${this.invoices}
              label=${msg('Invoices', { id: 'account.invoices' })}
              empty-text=${msg('No invoices yet.', { id: 'account.noInvoices' })}
              @pv-row-activate=${(e: CustomEvent<{ row: Invoice }>) => this.select(e.detail.row)}
            ></pv-data-grid>
          </section>
          <section class="pv-card" aria-labelledby="refunds">
            <div class="pv-card__head"><h2 class="pv-card__title" id="refunds">${msg('Refunds', { id: 'account.refunds' })}</h2></div>
            <pv-data-grid
              .columns=${this.refundColumns(a.currency)}
              .rows=${this.refunds}
              label=${msg('Refunds', { id: 'account.refunds' })}
              empty-text=${msg('No refunds.', { id: 'account.noRefunds' })}
            ></pv-data-grid>
          </section>
        </div>
        <div class="side">
          ${this.selected ? this.invoiceCard(this.selected) : html`<p>${msg('Choose an invoice to see it, or to credit it.', { id: 'account.choose' })}</p>`}
          ${this.may('billing:write') && a.balance.credit > 0 ? this.refundCard(a) : nothing}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-payer-account': PayerAccountView;
  }
}
