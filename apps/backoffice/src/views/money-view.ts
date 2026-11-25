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
import { agreementBody, agreementProblems, endingProblems, inForce, type AgreementForm } from '../payee-logic.ts';
import '../components/payee-accounts.ts';
import { navigate } from '../router.ts';
import { append, emptyPager, hasMore, type Pager } from '../pager.ts';
import type { Me } from '../permissions.ts';
import { pvComponents } from '../styles/pv-components.ts';

type Payment = components['schemas']['ReceivedPayment'];
type Payout = components['schemas']['Payout'];
type Proposal = components['schemas']['CreditProposal'];
type Agreement = components['schemas']['ClinicAgreement'];
type PaymentFile = components['schemas']['PaymentFile'];
type PayoutFile = components['schemas']['PayoutFile'];
type Row = Payment | Payout | Proposal | Agreement | PaymentFile;

const today = () => new Date().toISOString().slice(0, 10);

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
  @state() private agreement: AgreementForm = { clinicId: '', market: 'SE', validFrom: today(), validTo: '' };
  @state() private ending = { validTo: '', reason: '' };
  @state() private bankFile: File | null = null;
  @state() private payoutFiles: PayoutFile[] = [];
  @state() private payoutFileFor = { market: 'SE', currency: 'SEK' };
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
      case 'awaiting':
        return unwrap(this.api.GET('/v1/payouts', { params: { query: { ...query, status: 'awaiting-details' } } }));
      case 'clinics':
        return unwrap(this.api.GET('/v1/clinic-agreements', { params: { query } }));
      case 'files':
        return unwrap(this.api.GET('/v1/payment-files', { params: { query } }));
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
    if (tab === 'files') void this.loadPayoutFiles();
  }

  private async loadPayoutFiles() {
    const { data } = await this.api.GET('/v1/payout-files', { params: { query: { limit: 20 } } });
    this.payoutFiles = data?.items ?? [];
  }

  private select(row: Row) {
    this.selected = row;
    this.match = { target: '', note: '' };
    this.note = '';
    this.problems = [];
    this.notice = null;
    this.ending = { validTo: '', reason: '' };
  }

  private tabLabel(t: MoneyTab) {
    switch (t) {
      case 'unmatched':
        return msg('Unmatched payments', { id: 'money.tab.unmatched' });
      case 'held':
        return msg('Held payouts', { id: 'money.tab.held' });
      case 'awaiting':
        return msg('Awaiting details', { id: 'payout.awaitingDetails' });
      case 'proposals':
        return msg('Credit proposals', { id: 'money.tab.proposals' });
      case 'clinics':
        return msg('Clinics', { id: 'money.tab.clinics' });
      case 'files':
        return msg('Bank files', { id: 'money.tab.files' });
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
      case 'awaiting':
        return [
          { key: 'ordered', header: msg('Ordered', { id: 'payee.ordered' }), value: (r) => formatDateTime((r as Payout).createdAt, lang) },
          { key: 'amount', header: msg('Amount', { id: 'money.amount' }), value: (r) => amount(r as Payout), align: 'end' },
          { key: 'payee', header: msg('Payee', { id: 'money.payee' }), value: (r) => (r as Payout).clinicId ?? (r as Payout).partyId ?? '–' },
          { key: 'purpose', header: msg('For', { id: 'money.purpose' }), value: (r) => this.purposeLabel((r as Payout).purpose) },
        ];
      case 'files':
        return [
          { key: 'at', header: msg('Read in', { id: 'money.importedAt' }), value: (r) => formatDateTime((r as PaymentFile).importedAt, lang) },
          { key: 'by', header: msg('By', { id: 'money.importedBy' }), value: (r) => (r as PaymentFile).importedBy },
          { key: 'received', header: msg('New payments', { id: 'money.received' }), value: (r) => (r as PaymentFile).received, align: 'end' },
          { key: 'duplicates', header: msg('Already read', { id: 'money.duplicates' }), value: (r) => (r as PaymentFile).duplicates, align: 'end' },
        ];
      case 'clinics':
        return [
          { key: 'clinic', header: msg('Clinic', { id: 'money.clinic' }), value: (r) => html`<span class="pv-mono">${(r as Agreement).clinicId}</span>` },
          { key: 'market', header: msg('Market', { id: 'money.market' }), value: (r) => (r as Agreement).market },
          { key: 'from', header: msg('From', { id: 'money.from' }), value: (r) => formatDate((r as Agreement).validFrom, lang) },
          { key: 'to', header: msg('To', { id: 'money.to' }), value: (r) => { const a = r as Agreement; const to = a.ended?.validTo ?? a.validTo; return to ? formatDate(to, lang) : '–'; } },
          { key: 'inForce', header: msg('In force', { id: 'money.inForce' }), value: (r) => (inForce(r as Agreement, today()) ? html`<span class="pv-badge pv-badge--solid">${msg('In force', { id: 'money.inForce' })}</span>` : '') },
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

  private async send(what: string, id: string, call: (key: string) => Promise<{ response: Response; error?: unknown }>, text: string): Promise<boolean> {
    this.busy = what;
    const key = `${what}:${id}`;
    const { ok, notice } = await act(() => call(this.keys.for(key)), () => ({ variant: 'success', text }));
    this.busy = '';
    if (ok) {
      this.keys.done(key);
      this.reset();
    }
    this.notice = notice;
    return ok;
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

  private async doAddAgreement(e: Event) {
    e.preventDefault();
    this.problems = agreementProblems(this.agreement);
    if (this.problems.length) return;
    await this.send(
      'agreement',
      this.agreement.clinicId,
      (key) => this.api.POST('/v1/clinic-agreements', { params: { header: { 'Idempotency-Key': key } }, body: agreementBody(this.agreement) }),
      msg('The agreement is made. Payout orders naming the clinic go to it while it is in force.', { id: 'money.agreementMade' }),
    );
    if (!this.problems.length && this.notice?.variant === 'success') this.agreement = { clinicId: '', market: this.agreement.market, validFrom: today(), validTo: '' };
  }

  private async doEnd(e: Event, a: Agreement) {
    e.preventDefault();
    this.problems = endingProblems(a, this.ending.validTo, this.ending.reason);
    if (this.problems.length) return;
    await this.send(
      'end',
      a.id,
      (key) =>
        this.api.POST('/v1/clinic-agreements/{agreementId}/endings', {
          params: { path: { agreementId: a.id }, header: { 'Idempotency-Key': key } },
          body: { validTo: this.ending.validTo, reason: this.ending.reason.trim() },
        }),
      msg('The agreement is ended. From that day, payouts go to the policyholder.', { id: 'money.agreementEnded' }),
    );
  }

  private awaitingCard(p: Payout) {
    const lang = getLocale();
    return html`<section class="pv-card" aria-labelledby="sel">
        <div class="pv-card__head"><h2 class="pv-card__title" id="sel">${msg('Awaiting details', { id: 'payout.awaitingDetails' })}</h2><span class="pv-card__meta pv-mono">${p.id}</span></div>
        <div class="pv-card__body">
          <dl class="pv-dl">
            ${this.row(msg('Amount', { id: 'money.amount' }), formatMoney(p.amount, p.currency, lang))}
            ${this.row(msg('Payee', { id: 'money.payee' }), p.clinicId ?? p.partyId ?? '–', true)}
            ${this.row(msg('For', { id: 'money.purpose' }), this.purposeLabel(p.purpose))}
          </dl>
          <p>${msg('The payee has given no account. The payout is sent when they do.', { id: 'money.awaitingHow' })}</p>
          ${p.partyId
            ? html`<wa-button appearance="outlined" @click=${() => navigate(`/parties/${encodeURIComponent(p.partyId!)}`)}>${msg('Open the payee', { id: 'money.openPayee' })}</wa-button>`
            : nothing}
        </div>
      </section>
      ${p.clinicId ? html`<pv-payee-accounts .api=${this.api} .me=${this.me} clinic-id=${p.clinicId} market=${p.market}></pv-payee-accounts>` : nothing}`;
  }

  private agreementProblemText(p: string) {
    switch (p) {
      case 'clinic':
        return msg("Give the clinic's id.", { id: 'money.clinicProblem' });
      case 'market':
        return msg('A market is two capital letters, e.g. SE.', { id: 'payee.marketProblem' });
      case 'from':
        return msg('Give the first day.', { id: 'money.fromProblem' });
      case 'to':
        return msg('The last day must be after the first.', { id: 'money.toProblem' });
      default:
        return msg('Give a reason.', { id: 'money.reasonProblem' });
    }
  }

  private newAgreementCard() {
    const f = this.agreement;
    const set = (patch: Partial<AgreementForm>) => (this.agreement = { ...f, ...patch });
    return html`<section class="pv-card" aria-labelledby="new-agreement">
      <div class="pv-card__head"><h2 class="pv-card__title" id="new-agreement">${msg('New agreement', { id: 'money.newAgreement' })}</h2></div>
      <form class="pv-card__body" @submit=${(e: Event) => this.doAddAgreement(e)} novalidate>
        <p>${msg('While in force, a payout for a claim the clinic sent goes to the clinic (UTB-03).', { id: 'money.agreementHow' })}</p>
        <wa-input label=${msg('Clinic', { id: 'money.clinic' })} .value=${f.clinicId} @input=${(e: Event) => set({ clinicId: value(e) })}></wa-input>
        <wa-input label=${msg('Market', { id: 'money.market' })} .value=${f.market} @input=${(e: Event) => set({ market: value(e).toUpperCase() })}></wa-input>
        <wa-input type="date" label=${msg('From', { id: 'money.from' })} .value=${f.validFrom} @input=${(e: Event) => set({ validFrom: value(e) })}></wa-input>
        <wa-input type="date" label=${msg('Until (optional, not included)', { id: 'money.until' })} .value=${f.validTo} @input=${(e: Event) => set({ validTo: value(e) })}></wa-input>
        ${this.problems.length ? html`<wa-callout variant="danger" role="alert">${this.problems.map((p) => html`<div>${this.agreementProblemText(p)}</div>`)}</wa-callout>` : nothing}
        <wa-button type="submit" variant="brand" ?loading=${this.busy === 'agreement'}>${msg('Make the agreement', { id: 'money.makeAgreement' })}</wa-button>
      </form>
    </section>`;
  }

  private agreementCard(a: Agreement) {
    const lang = getLocale();
    const to = a.ended?.validTo ?? a.validTo;
    const open = !a.ended && (!a.validTo || a.validTo > today());
    return html`<section class="pv-card" aria-labelledby="sel">
        <div class="pv-card__head"><h2 class="pv-card__title" id="sel">${msg('Agreement', { id: 'money.agreement' })} ${a.clinicId}</h2><span class="pv-card__meta pv-mono">${a.id}</span></div>
        <div class="pv-card__body">
          <dl class="pv-dl">
            ${this.row(msg('Market', { id: 'money.market' }), a.market)}
            ${this.row(msg('From', { id: 'money.from' }), formatDate(a.validFrom, lang))}
            ${this.row(msg('To', { id: 'money.to' }), to ? formatDate(to, lang) : '–')}
            ${this.row(msg('Made by', { id: 'money.madeBy' }), `${a.createdBy}, ${formatDateTime(a.createdAt, lang)}`)}
            ${a.ended ? this.row(msg('Ended', { id: 'party.ended' }), `${a.ended.reason} (${a.ended.by})`) : nothing}
          </dl>
          ${open && this.me?.permissions.includes('payments:agreements')
            ? html`<form @submit=${(e: Event) => this.doEnd(e, a)} novalidate>
                <wa-input type="date" label=${msg('Ends on (not included)', { id: 'money.endsOn' })} .value=${this.ending.validTo} @input=${(e: Event) => (this.ending = { ...this.ending, validTo: value(e) })}></wa-input>
                <wa-textarea label=${msg('Reason', { id: 'money.reason' })} rows="2" .value=${this.ending.reason} @input=${(e: Event) => (this.ending = { ...this.ending, reason: value(e) })}></wa-textarea>
                ${this.problems.length ? html`<wa-callout variant="danger" role="alert">${this.problems.map((p) => html`<div>${this.agreementProblemText(p)}</div>`)}</wa-callout>` : nothing}
                <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'end'}>${msg('End the agreement', { id: 'money.endAgreement' })}</wa-button>
              </form>`
            : nothing}
        </div>
      </section>
      <pv-payee-accounts .api=${this.api} .me=${this.me} clinic-id=${a.clinicId} market=${a.market}></pv-payee-accounts>`;
  }

  private async doImport(e: Event) {
    e.preventDefault();
    if (!this.bankFile) {
      this.problems = ['file'];
      return;
    }
    this.problems = [];
    const form = new FormData();
    form.append('file', this.bankFile);
    const ok = await this.send(
      'import',
      this.bankFile.name,
      (key) => this.api.POST('/v1/payment-files', { params: { header: { 'Idempotency-Key': key } }, body: form as never, bodySerializer: (b: unknown) => b as FormData }),
      msg('The file is read in. New payments without a usable reference wait under Unmatched payments.', { id: 'money.imported' }),
    );
    if (ok) {
      this.bankFile = null;
      // Empty the field too: the same file chosen again must give a change.
      const input = this.renderRoot.querySelector<HTMLInputElement>('input[type=file]');
      if (input) input.value = '';
    }
  }

  private importCard() {
    return html`<section class="pv-card" aria-labelledby="import">
      <div class="pv-card__head"><h2 class="pv-card__title" id="import">${msg('Read in a bank file', { id: 'money.importTitle' })}</h2></div>
      <form class="pv-card__body" @submit=${(e: Event) => this.doImport(e)} novalidate>
        <p>${msg("The bank's notification of payments in, camt.054 (XML). The whole file is read or none of it, and a payment already read is not read again.", { id: 'money.importHow' })}</p>
        <label>
          ${msg('File', { id: 'money.file' })}
          <input type="file" accept=".xml,application/xml,text/xml" @change=${(e: Event) => (this.bankFile = (e.target as HTMLInputElement).files?.[0] ?? null)} />
        </label>
        ${this.problems.includes('file') ? html`<wa-callout variant="danger" role="alert">${msg('Choose the file.', { id: 'money.fileProblem' })}</wa-callout>` : nothing}
        <wa-button type="submit" variant="brand" ?loading=${this.busy === 'import'}>${msg('Read in', { id: 'money.import' })}</wa-button>
      </form>
    </section>`;
  }

  private async doMakePayoutFile(e: Event) {
    e.preventDefault();
    const { market, currency } = this.payoutFileFor;
    const ok = await this.send(
      'payout-file',
      `${market}-${currency}`,
      (key) => this.api.POST('/v1/payout-files', { params: { header: { 'Idempotency-Key': key } }, body: { market, currency } }),
      msg('The payout file is made. Fetch it and send it to the bank; its camt.054 then confirms the payouts.', { id: 'money.payoutFileMade' }),
    );
    if (ok) await this.loadPayoutFiles();
    // 409 here is no payout waiting, not a change by someone else.
    else if (this.notice?.reload) this.notice = { variant: 'warning', text: msg('No payouts wait for a file in the market and currency.', { id: 'money.noPayoutsWaiting' }) };
  }

  /** The file with its checksum, fetched with the token: a plain link cannot carry it. */
  private async download(f: PayoutFile) {
    this.busy = `download:${f.id}`;
    const { data, error } = await this.api.GET('/v1/payout-files/{fileId}/file', { params: { path: { fileId: f.id } }, parseAs: 'text' });
    this.busy = '';
    if (typeof data !== 'string') {
      this.notice = { variant: 'danger', text: (error as { title?: string } | undefined)?.title ?? msg('Something went wrong.', { id: 'common.error' }) };
      return;
    }
    const url = URL.createObjectURL(new Blob([data], { type: 'application/xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `petvold-payouts-${f.market}-${f.executionDate}-${f.id}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private payoutFilesCard() {
    const lang = getLocale();
    const may = this.me?.permissions.includes('payments:export');
    return html`<section class="pv-card" aria-labelledby="payout-files">
      <div class="pv-card__head"><h2 class="pv-card__title" id="payout-files">${msg('Payout files', { id: 'money.payoutFiles' })}</h2></div>
      <div class="pv-card__body">
        <p>${msg('Payouts by bank file wait for a pain.001 to the bank. The file takes every payout waiting in the market and currency.', { id: 'money.payoutFilesHow' })}</p>
        ${may
          ? html`<form @submit=${(e: Event) => this.doMakePayoutFile(e)} novalidate>
              <wa-input label=${msg('Market', { id: 'money.market' })} .value=${this.payoutFileFor.market} @input=${(e: Event) => (this.payoutFileFor = { ...this.payoutFileFor, market: value(e).toUpperCase() })}></wa-input>
              <wa-input label=${msg('Currency', { id: 'money.currency' })} .value=${this.payoutFileFor.currency} @input=${(e: Event) => (this.payoutFileFor = { ...this.payoutFileFor, currency: value(e).toUpperCase() })}></wa-input>
              <wa-button type="submit" variant="brand" ?loading=${this.busy === 'payout-file'}>${msg('Make a payout file', { id: 'money.makePayoutFile' })}</wa-button>
            </form>`
          : nothing}
        ${this.payoutFiles.length
          ? html`<dl class="pv-dl">
              ${this.payoutFiles.map(
                (f) => html`<div class="pv-dl__row">
                  <dt>${formatDate(f.executionDate, lang)} · ${f.payoutIds.length} · ${formatMoney(f.total, f.currency, lang)}</dt>
                  <dd>
                    ${f.erased
                      ? msg('Erased', { id: 'money.fileErased' })
                      : may
                        ? html`<wa-button size="small" appearance="outlined" ?loading=${this.busy === `download:${f.id}`} @click=${() => this.download(f)}>${msg('Fetch', { id: 'money.fetch' })}</wa-button>`
                        : nothing}
                  </dd>
                </div>`,
              )}
            </dl>`
          : html`<p>${msg('No payout files yet.', { id: 'money.noPayoutFiles' })}</p>`}
      </div>
    </section>`;
  }

  private fileCard(f: PaymentFile) {
    const lang = getLocale();
    return html`<section class="pv-card" aria-labelledby="sel">
      <div class="pv-card__head"><h2 class="pv-card__title" id="sel">${msg('Bank file', { id: 'money.bankFile' })}</h2><span class="pv-card__meta pv-mono">${f.id}</span></div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${this.row(msg('Read in', { id: 'money.importedAt' }), `${formatDateTime(f.importedAt, lang)} · ${f.importedBy}`)}
          ${this.row(msg('New payments', { id: 'money.received' }), f.received)}
          ${this.row(msg('Already read', { id: 'money.duplicates' }), f.duplicates)}
          ${this.row('SHA-256', `${f.sha256.slice(0, 16)}…`, true)}
          ${f.paymentIds.length ? this.row(msg('Payments', { id: 'money.payments' }), f.paymentIds.join(', '), true) : nothing}
        </dl>
      </div>
    </section>`;
  }

  private side() {
    const s = this.selected;
    const card = !s
      ? this.tab === 'clinics' && this.me?.permissions.includes('payments:agreements')
        ? this.newAgreementCard()
        : this.tab === 'files'
          ? html`${this.me?.permissions.includes('payments:import') ? this.importCard() : nothing}${this.payoutFilesCard()}`
          : nothing
      : 'paymentId' in s
        ? this.paymentCard(s)
        : 'purpose' in s
          ? s.status === 'awaiting-details'
            ? this.awaitingCard(s)
            : this.payoutCard(s)
          : 'validFrom' in s
            ? this.agreementCard(s)
            : 'sha256' in s
              ? this.fileCard(s)
              : this.proposalCard(s);
    if (!this.notice && card === nothing) return nothing;
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
