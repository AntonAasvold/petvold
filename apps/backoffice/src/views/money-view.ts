/**
 * <pv-money>: the money queues (ADR 0040, steg 8). Payments that came in
 * without a usable reference, matched by hand; payouts held for new payee
 * details, released by someone else; and credit notes and write-offs above
 * the proposer's limit, approved or returned by someone else.
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
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { heldSince, matchBody, matchProblems, mayDecideProposal, mayRelease, moneyTabs, returnReasonOk, type MoneyTab } from '../money-logic.ts';
import { append, emptyPager, hasMore, type Pager } from '../pager.ts';
import type { Me } from '../permissions.ts';
import { pvComponents } from '../styles/pv-components.ts';

type Payment = components['schemas']['ReceivedPayment'];
type Payout = components['schemas']['Payout'];
type Proposal = components['schemas']['CreditProposal'];
type Row = Payment | Payout | Proposal;

const value = (e: Event) => (e.target as HTMLInputElement).value;

@customElement('pv-money')
export class MoneyView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @state() private tab: MoneyTab | null = null;
  @state() private pager: Pager<Row> = emptyPager();
  @state() private loading = false;
  @state() private error = '';
  @state() private selected: Row | null = null;
  @state() private match = { target: '', note: '' };
  @state() private note = '';
  @state() private problems: string[] = [];
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
      .cols {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-6);
      }
      .list {
        flex: 999 1 520px;
        min-width: 0;
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
      @media (max-width: 52rem) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    this.tab = moneyTabs(this.me)[0] ?? null;
    void this.load();
  }

  protected willUpdate(changed: Map<string, unknown>): void {
    // /v1/me can come after the view: pick the first tab then.
    if (changed.has('me') && !this.tab && moneyTabs(this.me).length) {
      this.tab = moneyTabs(this.me)[0]!;
      void this.load();
    }
  }

  private async page(cursor?: string): Promise<{ items: Row[]; nextCursor?: string }> {
    const query = { limit: 50, ...(cursor ? { cursor } : {}) };
    switch (this.tab) {
      case 'unmatched':
        return unwrap(this.api.GET('/v1/received-payments', { params: { query: { ...query, status: 'unmatched' } } }));
      case 'held':
        return unwrap(this.api.GET('/v1/payouts', { params: { query: { ...query, status: 'held' } } }));
      default:
        return unwrap(this.api.GET('/v1/credit-proposals', { params: { query: { ...query, status: 'proposed' } } }));
    }
  }

  private async load() {
    if (!this.tab || !hasMore(this.pager) || this.loading) return;
    const id = ++this.request;
    this.loading = true;
    this.error = '';
    try {
      const page = await this.page(this.pager.next);
      if (id === this.request) this.pager = append(this.pager, page);
    } catch (e) {
      if (id === this.request) this.error = (e as { title?: string }).title ?? msg('Something went wrong.', { id: 'common.error' });
    } finally {
      if (id === this.request) this.loading = false;
    }
  }

  private reset() {
    this.pager = emptyPager();
    this.loading = false;
    this.selected = null;
    this.problems = [];
    void this.load();
  }

  private show(tab: MoneyTab) {
    this.tab = tab;
    this.notice = null;
    this.reset();
  }

  private select(row: Row) {
    this.selected = row;
    this.match = { target: '', note: '' };
    this.note = '';
    this.problems = [];
    this.notice = null;
  }

  private tabLabel(t: MoneyTab) {
    switch (t) {
      case 'unmatched':
        return msg('Unmatched payments', { id: 'money.tab.unmatched' });
      case 'held':
        return msg('Held payouts', { id: 'money.tab.held' });
      case 'proposals':
        return msg('Credit proposals', { id: 'money.tab.proposals' });
    }
  }

  private kindLabel(kind: string) {
    return kind === 'write-off' ? msg('Write-off', { id: 'money.writeOff' }) : msg('Credit note', { id: 'money.creditNote' });
  }

  private purposeLabel(purpose: string) {
    return purpose === 'premium-refund' ? msg('Premium refund', { id: 'money.premiumRefund' }) : msg('Claim', { id: 'money.claimPayout' });
  }

  private columns(): Column<Row>[] {
    const lang = getLocale();
    const amount = (r: { amount: number; currency: string }) => formatMoney(r.amount, r.currency, lang);
    switch (this.tab) {
      case 'unmatched':
        return [
          { key: 'bookedOn', header: msg('Booked', { id: 'money.bookedOn' }), value: (r) => formatDate((r as Payment).bookedOn, lang) },
          { key: 'amount', header: msg('Amount', { id: 'money.amount' }), value: (r) => amount(r as Payment), align: 'end' },
          { key: 'reference', header: msg('Reference', { id: 'money.reference' }), value: (r) => (r as Payment).reference ?? '–' },
          { key: 'market', header: msg('Market', { id: 'money.market' }), value: (r) => (r as Payment).market },
        ];
      case 'held':
        return [
          { key: 'heldSince', header: msg('Held since', { id: 'money.heldSince' }), value: (r) => (heldSince(r as Payout) ? formatDateTime(heldSince(r as Payout)!, lang) : '–') },
          { key: 'amount', header: msg('Amount', { id: 'money.amount' }), value: (r) => amount(r as Payout), align: 'end' },
          { key: 'payee', header: msg('Payee', { id: 'money.payee' }), value: (r) => (r as Payout).clinicId ?? (r as Payout).partyId ?? '–' },
          { key: 'purpose', header: msg('For', { id: 'money.purpose' }), value: (r) => this.purposeLabel((r as Payout).purpose) },
        ];
      default:
        return [
          { key: 'proposedAt', header: msg('Proposed', { id: 'money.proposedAt' }), value: (r) => formatDateTime((r as Proposal).proposedAt, lang) },
          { key: 'kind', header: msg('Kind', { id: 'money.kind' }), value: (r) => this.kindLabel((r as Proposal).kind) },
          { key: 'amount', header: msg('Amount', { id: 'money.amount' }), value: (r) => amount(r as Proposal), align: 'end' },
          { key: 'invoice', header: msg('Invoice', { id: 'money.invoice' }), value: (r) => (r as Proposal).invoiceId },
          { key: 'by', header: msg('Proposed by', { id: 'money.proposedBy' }), value: (r) => (r as Proposal).proposedBy },
        ];
    }
  }

  private async send(what: string, id: string, call: (key: string) => Promise<{ response: Response; error?: unknown }>, text: string) {
    this.busy = what;
    const key = `${what}:${id}`;
    const { ok, notice } = await act(() => call(this.keys.for(key)), () => ({ variant: 'success', text }));
    this.busy = '';
    if (ok) {
      this.keys.done(key);
      this.reset();
    }
    this.notice = notice;
  }

  private async doMatch(e: Event, p: Payment) {
    e.preventDefault();
    this.problems = matchProblems(this.match);
    if (this.problems.length) return;
    await this.send(
      'match',
      p.paymentId,
      (key) => this.api.POST('/v1/received-payments/{paymentId}/matches', { params: { path: { paymentId: p.paymentId }, header: { 'Idempotency-Key': key } }, body: matchBody(this.match) }),
      msg('The payment is matched.', { id: 'money.matched' }),
    );
  }

  private async doRelease(e: Event, p: Payout) {
    e.preventDefault();
    const note = this.note.trim();
    await this.send(
      'release',
      p.id,
      (key) => this.api.POST('/v1/payouts/{payoutId}/releases', { params: { path: { payoutId: p.id }, header: { 'Idempotency-Key': key } }, body: note ? { note } : {} }),
      msg('The payout is released.', { id: 'money.released' }),
    );
  }

  private async doApprove(p: Proposal) {
    await this.send(
      'approve',
      p.id,
      (key) => this.api.POST('/v1/credit-proposals/{proposalId}/approvals', { params: { path: { proposalId: p.id }, header: { 'Idempotency-Key': key } }, body: {} }),
      msg('Approved. The credit note is made.', { id: 'money.approved' }),
    );
  }

  private async doReturn(e: Event, p: Proposal) {
    e.preventDefault();
    this.problems = returnReasonOk(this.note) ? [] : ['reason'];
    if (this.problems.length) return;
    await this.send(
      'return',
      p.id,
      (key) => this.api.POST('/v1/credit-proposals/{proposalId}/returns', { params: { path: { proposalId: p.id }, header: { 'Idempotency-Key': key } }, body: { reason: this.note.trim() } }),
      msg('The proposal is returned.', { id: 'money.returned' }),
    );
  }

  private row(label: string, v: unknown, mono = false) {
    return html`<div class="pv-dl__row"><dt>${label}</dt><dd class=${mono ? 'pv-mono' : ''}>${v}</dd></div>`;
  }

  private paymentCard(p: Payment) {
    const lang = getLocale();
    return html`<section class="pv-card" aria-labelledby="sel">
      <div class="pv-card__head"><h2 class="pv-card__title" id="sel">${msg('Match the payment', { id: 'money.matchTitle' })}</h2><span class="pv-card__meta pv-mono">${p.paymentId}</span></div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${this.row(msg('Amount', { id: 'money.amount' }), formatMoney(p.amount, p.currency, lang))}
          ${this.row(msg('Booked', { id: 'money.bookedOn' }), formatDate(p.bookedOn, lang))}
          ${this.row(msg('Reference', { id: 'money.reference' }), p.reference ?? '–', true)}
        </dl>
        ${this.me?.permissions.includes('billing:write')
          ? html`<form @submit=${(e: Event) => this.doMatch(e, p)} novalidate>
              <wa-input
                label=${msg('Payer account or invoice', { id: 'money.target' })}
                hint=${msg('bac_… pays the oldest due invoice first; inv_… pays that invoice first.', { id: 'money.targetHint' })}
                .value=${this.match.target}
                @input=${(e: Event) => (this.match = { ...this.match, target: value(e) })}
              ></wa-input>
              <wa-textarea label=${msg('Why (optional)', { id: 'money.why' })} rows="2" .value=${this.match.note} @input=${(e: Event) => (this.match = { ...this.match, note: value(e) })}></wa-textarea>
              ${this.problems.length
                ? html`<wa-callout variant="danger" role="alert">${this.problems.includes('target') ? msg('Give a payer account (bac_…) or an invoice (inv_…).', { id: 'money.targetProblem' }) : msg('At most 2,000 characters.', { id: 'money.tooLong' })}</wa-callout>`
                : nothing}
              <wa-button type="submit" variant="brand" ?loading=${this.busy === 'match'}>${msg('Match', { id: 'money.match' })}</wa-button>
            </form>`
          : nothing}
      </div>
    </section>`;
  }

  private payoutCard(p: Payout) {
    const lang = getLocale();
    const since = heldSince(p);
    return html`<section class="pv-card" aria-labelledby="sel">
      <div class="pv-card__head"><h2 class="pv-card__title" id="sel">${msg('Release the payout', { id: 'money.releaseTitle' })}</h2><span class="pv-card__meta pv-mono">${p.id}</span></div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${this.row(msg('Amount', { id: 'money.amount' }), formatMoney(p.amount, p.currency, lang))}
          ${this.row(msg('Payee', { id: 'money.payee' }), p.clinicId ?? p.partyId ?? '–', true)}
          ${this.row(msg('For', { id: 'money.purpose' }), this.purposeLabel(p.purpose))}
          ${p.claimId ? this.row(msg('Claim', { id: 'money.claimPayout' }), p.claimId, true) : nothing}
          ${since ? this.row(msg('Held since', { id: 'money.heldSince' }), formatDateTime(since, lang)) : nothing}
        </dl>
        <p>${msg("The payee's account details are new. Check them with the payee, on a number from the register, before releasing. The one who gave the details cannot release it.", { id: 'money.releaseHow' })}</p>
        ${mayRelease(p, this.me)
          ? html`<form @submit=${(e: Event) => this.doRelease(e, p)} novalidate>
              <wa-textarea label=${msg('How the details were checked (optional)', { id: 'money.checked' })} rows="2" .value=${this.note} @input=${(e: Event) => (this.note = value(e))}></wa-textarea>
              <wa-button type="submit" variant="brand" ?loading=${this.busy === 'release'}>${msg('Release', { id: 'money.release' })}</wa-button>
            </form>`
          : nothing}
      </div>
    </section>`;
  }

  private proposalCard(p: Proposal) {
    const lang = getLocale();
    const own = p.proposedBy === this.me?.subject;
    return html`<section class="pv-card" aria-labelledby="sel">
      <div class="pv-card__head"><h2 class="pv-card__title" id="sel">${this.kindLabel(p.kind)}</h2><span class="pv-card__meta pv-mono">${p.id}</span></div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${this.row(msg('Amount', { id: 'money.amount' }), formatMoney(p.amount, p.currency, lang))}
          ${this.row(msg('Invoice', { id: 'money.invoice' }), p.invoiceId, true)}
          ${this.row(msg('Payer account', { id: 'money.account' }), p.accountId, true)}
          ${this.row(msg('Reason', { id: 'money.reason' }), p.reason)}
          ${this.row(msg('Proposed by', { id: 'money.proposedBy' }), `${p.proposedBy}, ${formatDateTime(p.proposedAt, lang)}`)}
        </dl>
        ${own ? html`<p>${msg('You proposed this. Someone else approves or returns it.', { id: 'money.ownProposal' })}</p>` : nothing}
        ${mayDecideProposal(p, this.me)
          ? html`<wa-button variant="brand" ?loading=${this.busy === 'approve'} @click=${() => this.doApprove(p)}>${msg('Approve', { id: 'money.approve' })}</wa-button>
              <form @submit=${(e: Event) => this.doReturn(e, p)} novalidate>
                <wa-textarea label=${msg('Reason for returning', { id: 'money.returnReason' })} rows="2" .value=${this.note} @input=${(e: Event) => (this.note = value(e))}></wa-textarea>
                ${this.problems.length ? html`<wa-callout variant="danger" role="alert">${msg('Give a reason.', { id: 'money.reasonProblem' })}</wa-callout>` : nothing}
                <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'return'}>${msg('Return', { id: 'money.return' })}</wa-button>
              </form>`
          : nothing}
      </div>
    </section>`;
  }

  private side() {
    const s = this.selected;
    const card = !s ? nothing : 'paymentId' in s ? this.paymentCard(s) : 'purpose' in s ? this.payoutCard(s) : this.proposalCard(s);
    if (!this.notice && !s) return nothing;
    return html`<div class="side">
      ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'success' ? 'status' : 'alert'}>${this.notice.text}</wa-callout>` : nothing}
      ${card}
    </div>`;
  }

  render() {
    const tabs = moneyTabs(this.me);
    return html`
      <h2>${msg('Money', { id: 'money.title' })}</h2>
      <wa-tab-group @wa-tab-show=${(e: CustomEvent<{ name: string }>) => this.show(e.detail.name as MoneyTab)}>
        ${tabs.map((t) => html`<wa-tab panel=${t} ?active=${t === this.tab}>${this.tabLabel(t)}</wa-tab>`)}
      </wa-tab-group>
      <div class="cols">
        <div class="list">
          <pv-data-grid
            .columns=${this.columns()}
            .rows=${this.pager.items}
            label=${this.tab ? this.tabLabel(this.tab) : ''}
            ?loading=${this.loading}
            ?has-more=${hasMore(this.pager) && this.pager.loaded}
            error=${this.error}
            empty-text=${msg('Nothing to show.', { id: 'common.empty' })}
            more-text=${msg('Show more', { id: 'common.more' })}
            retry-text=${msg('Try again', { id: 'common.retry' })}
            @pv-load-more=${() => this.load()}
            @pv-row-activate=${(e: CustomEvent<{ row: Row }>) => this.select(e.detail.row)}
          ></pv-data-grid>
        </div>
        ${this.side()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-money': MoneyView;
  }
}
