/**
 * <pv-claim-register>: a claims handler registers a claim (POST /v1/claims),
 * for example one the customer sent on paper. The policy gives market,
 * currency and animal. A preview (POST /v1/claim-previews) shows the
 * assessment before anything is stored; it sits beside the form, as the
 * decision does on a claim ("Underlaget bredvid beslutet").
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import type { Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import { LINE_CATEGORIES, claimFormProblems, emptyLine, linesTotal, newClaimId, suggestClaimNo, toClaimInput, type ClaimForm, type LineForm, type PolicyFacts } from '../claim-form.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { versionOn } from '../policy-logic.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import '../components/waterfall.ts';
import { channelLabel, lineCategoryLabel, outcomeLabel, policyStatusLabel, problemLabel, ruleStatusLabel } from './labels.ts';

type Assessment = components['schemas']['Assessment'];

const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-claim-register')
export class ClaimRegister extends LitElement {
  @property({ attribute: false }) api!: Api;

  @state() private policyId = '';
  @state() private policy: (PolicyFacts & { status?: string; animalName?: string; product?: string }) | null = null;
  @state() private policyError = '';
  @state() private form: ClaimForm = {
    claimNo: suggestClaimNo(today()),
    channel: 'customer',
    treatmentFrom: '',
    treatmentTo: '',
    diagnosisCode: '',
    lines: [emptyLine()],
  };
  @state() private preview: Assessment | null = null;
  @state() private shown: string[] = [];
  @state() private notice: Notice | null = null;
  @state() private busy = '';
  /** One id per claim being registered: a retry after a network error is the same claim. */
  private claimId = newClaimId();
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
      h1 {
        margin: var(--space-2) 0 var(--space-8);
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
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
        position: sticky;
        top: var(--space-6);
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      /* Fields line up at the top, so a hint under one field does not push the others down. */
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-4);
      }
      .policy wa-button::part(base) {
        height: auto;
      }
      .row > * {
        flex: 1 1 180px;
      }
      .row > wa-button {
        flex: none;
      }
      .line {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr) auto;
        align-items: end;
        gap: var(--space-3);
        padding-bottom: var(--space-4);
        border-bottom: var(--border-hairline) solid var(--line);
      }
      .total {
        display: flex;
        justify-content: space-between;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .pv-card__body p {
        margin: 0;
      }
      .rules {
        margin: 0;
        padding-left: var(--space-5);
        font-size: 14px;
      }
      wa-input.mono::part(input) {
        font-family: var(--font-mono);
      }
      wa-button.wide {
        width: 100%;
      }
      wa-button.wide::part(label) {
        white-space: normal;
      }
      @media (max-width: 900px) {
        .side {
          position: static;
          max-width: none;
        }
        .line {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    // From a policy's page: /claims/new?policy=pol_…
    const id = new URLSearchParams(location.search).get('policy');
    if (id) {
      this.policyId = id;
      void this.loadPolicy();
    }
  }

  private async loadPolicy() {
    const id = this.policyId.trim();
    this.policy = null;
    this.preview = null;
    this.policyError = '';
    if (!id) return;
    const { data } = await this.api.GET('/v1/policies/{policyId}', { params: { path: { policyId: id } } }).catch(() => ({ data: undefined }));
    if (!data) {
      this.policyError = msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' });
      return;
    }
    const term = data.terms.find((t) => t.startDate <= today() && today() < t.endDate) ?? data.terms.at(-1);
    const animal = await this.api.GET('/v1/animals/{animalId}', { params: { path: { animalId: data.animalId } } }).then((r) => r.data ?? null, () => null);
    this.policy = {
      id: data.id,
      market: data.market,
      animalId: data.animalId,
      currency: term?.currency ?? 'SEK',
      status: versionOn(data.versions, today())?.status,
      animalName: animal?.name,
      product: term?.productVersion,
    };
  }

  private set<K extends keyof ClaimForm>(key: K, value: ClaimForm[K]) {
    this.form = { ...this.form, [key]: value };
    this.preview = null;
    // A changed claim is a new request: a retry with the same key must send the same body.
    this.keys.done(`register:${this.claimId}`);
  }

  private setLine(i: number, patch: Partial<LineForm>) {
    this.set(
      'lines',
      this.form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    );
  }

  private check(): boolean {
    this.shown = claimFormProblems(this.form, this.policy, today());
    return !this.shown.length;
  }

  private async runPreview() {
    if (!this.check()) return;
    this.busy = 'preview';
    this.notice = null;
    const { data, error, response } = await this.api.POST('/v1/claim-previews', { body: toClaimInput(this.form, this.policy!, this.claimId) as never }).catch(() => ({ data: undefined, error: undefined, response: undefined }));
    this.busy = '';
    if (data) this.preview = data;
    else {
      const p = (error ?? {}) as { title?: string; detail?: string };
      this.notice = { variant: 'danger', text: p.detail ?? p.title ?? response?.statusText ?? msg('Something went wrong.', { id: 'common.error' }) };
    }
  }

  private async register(e: Event) {
    e.preventDefault();
    if (!this.check()) return;
    this.busy = 'register';
    const id = this.claimId;
    const { ok, notice } = await act(
      () =>
        this.api.POST('/v1/claims', {
          params: { header: { 'Idempotency-Key': this.keys.for(`register:${id}`) } },
          body: toClaimInput(this.form, this.policy!, id) as never,
        }),
      () => ({ variant: 'success', text: msg('The claim is registered.', { id: 'register.done' }) }),
    );
    this.busy = '';
    if (ok) {
      this.keys.done(`register:${id}`);
      navigate(`/claims/${encodeURIComponent(id)}`);
      return;
    }
    this.notice = { ...notice, reload: false };
  }

  render() {
    const lang = getLocale();
    const currency = this.policy?.currency ?? 'SEK';
    const money = (m: number) => formatMoney(m, currency, lang);
    const total = linesTotal(this.form.lines, currency);
    return html`
      <nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
        <a href="/claims" @click=${(e: Event) => (e.preventDefault(), navigate('/claims'))}>${msg('Claims', { id: 'nav.claims' })}</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">${msg('Register a claim', { id: 'register.title' })}</span>
      </nav>
      <h1>${msg('Register a claim', { id: 'register.title' })}</h1>
      <form class="cols" @submit=${this.register} novalidate>
        <div class="basis">
          <section class="pv-card" aria-labelledby="policy">
            <div class="pv-card__head"><h2 class="pv-card__title" id="policy">${msg('Policy', { id: 'claims.col.policy' })}</h2></div>
            <div class="pv-card__body">
              <wa-input
                class="policy"
                label=${msg('Policy id', { id: 'register.policyId' })}
                hint=${msg('For example pol_bella. Search in Policies if you do not know it.', { id: 'register.policyHint' })}
                .value=${this.policyId}
                @input=${(e: Event) => (this.policyId = (e.target as HTMLInputElement).value)}
                @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && (e.preventDefault(), void this.loadPolicy())}
              >
                <wa-button slot="end" size="small" appearance="plain" @click=${() => this.loadPolicy()}>${msg('Fetch the policy', { id: 'register.fetchPolicy' })}</wa-button>
              </wa-input>
              ${this.policyError ? html`<wa-callout variant="neutral" role="alert">${this.policyError}</wa-callout>` : nothing}
              ${this.policy
                ? html`<dl class="pv-dl">
                    <div class="pv-dl__row"><dt>${msg('Animal', { id: 'claim.animal' })}</dt><dd>${this.policy.animalName ?? this.policy.animalId}</dd></div>
                    <div class="pv-dl__row"><dt>${msg('Product', { id: 'claim.product' })}</dt><dd class="pv-mono">${this.policy.product ?? '–'}</dd></div>
                    <div class="pv-dl__row"><dt>${msg('Market', { id: 'claim.market' })}</dt><dd>${this.policy.market}, ${this.policy.currency}</dd></div>
                    <div class="pv-dl__row"><dt>${msg('Status', { id: 'claims.col.status' })}</dt><dd>${this.policy.status ? policyStatusLabel(this.policy.status) : '–'}</dd></div>
                  </dl>`
                : nothing}
            </div>
          </section>

          <section class="pv-card" aria-labelledby="treatment">
            <div class="pv-card__head"><h2 class="pv-card__title" id="treatment">${msg('Treatment', { id: 'register.treatment' })}</h2></div>
            <div class="pv-card__body">
              <div class="row">
                <wa-input label=${msg('Claim number', { id: 'claims.col.claimNo' })} class="mono" .value=${this.form.claimNo} @input=${(e: Event) => this.set('claimNo', (e.target as HTMLInputElement).value)}></wa-input>
                <wa-select label=${msg('Channel', { id: 'claims.col.channel' })} value=${this.form.channel} @change=${(e: Event) => this.set('channel', (e.target as HTMLSelectElement).value as ClaimForm['channel'])}>
                  <wa-option value="customer">${channelLabel('customer')}</wa-option>
                  <wa-option value="clinic_direct">${channelLabel('clinic_direct')}</wa-option>
                </wa-select>
              </div>
              <div class="row">
                <wa-input type="date" label=${msg('First day of treatment', { id: 'register.from' })} .value=${this.form.treatmentFrom} @input=${(e: Event) => this.set('treatmentFrom', (e.target as HTMLInputElement).value)}></wa-input>
                <wa-input type="date" label=${msg('Last day of treatment', { id: 'register.to' })} .value=${this.form.treatmentTo} @input=${(e: Event) => this.set('treatmentTo', (e.target as HTMLInputElement).value)}></wa-input>
                <wa-input
                  label=${msg('Diagnosis', { id: 'claims.col.diagnosis' })}
                  hint=${msg('Code, e.g. ORT-KORSBAND-V', { id: 'register.diagnosisHint' })}
                  .value=${this.form.diagnosisCode}
                  @input=${(e: Event) => this.set('diagnosisCode', (e.target as HTMLInputElement).value)}
                ></wa-input>
              </div>
            </div>
          </section>

          <section class="pv-card" aria-labelledby="lines">
            <div class="pv-card__head">
              <h2 class="pv-card__title" id="lines">${msg('Invoice', { id: 'register.invoice' })}</h2>
              <span class="pv-card__meta">${msg('Amounts including VAT', { id: 'register.inclVat' })}</span>
            </div>
            <div class="pv-card__body">
              ${this.form.lines.map(
                (l, i) => html`<div class="line" role="group" aria-label=${`${msg('Line', { id: 'register.line' })} ${i + 1}`}>
                  <wa-input label=${msg('Description', { id: 'register.description' })} .value=${l.description} @input=${(e: Event) => this.setLine(i, { description: (e.target as HTMLInputElement).value })}></wa-input>
                  <wa-select label=${msg('Category', { id: 'register.category' })} value=${l.category} @change=${(e: Event) => this.setLine(i, { category: (e.target as HTMLSelectElement).value })}>
                    ${LINE_CATEGORIES.map((c) => html`<wa-option value=${c}>${lineCategoryLabel(c)}</wa-option>`)}
                  </wa-select>
                  <wa-input label=${msg('Amount', { id: 'register.amount' })} inputmode="decimal" .value=${l.amount} @input=${(e: Event) => this.setLine(i, { amount: (e.target as HTMLInputElement).value })}></wa-input>
                  <wa-input label=${msg('Of which VAT', { id: 'register.vat' })} inputmode="decimal" .value=${l.vat} @input=${(e: Event) => this.setLine(i, { vat: (e.target as HTMLInputElement).value })}></wa-input>
                  <wa-button
                    appearance="plain"
                    label=${`${msg('Remove line', { id: 'register.removeLine' })} ${i + 1}`}
                    ?disabled=${this.form.lines.length === 1}
                    @click=${() => this.set('lines', this.form.lines.filter((_, j) => j !== i))}
                    ><wa-icon name="trash" label=${`${msg('Remove line', { id: 'register.removeLine' })} ${i + 1}`}></wa-icon
                  ></wa-button>
                </div>`,
              )}
              <div class="row">
                <wa-button appearance="outlined" @click=${() => this.set('lines', [...this.form.lines, emptyLine()])}
                  ><wa-icon slot="start" name="plus"></wa-icon>${msg('Add a line', { id: 'register.addLine' })}</wa-button
                >
              </div>
              <div class="total"><span>${msg('Billed', { id: 'calc.billed' })}</span><span>${money(total)}</span></div>
            </div>
          </section>
        </div>

        <div class="side">
          <section class="pv-card pv-card--strong" aria-labelledby="register">
            <div class="pv-card__head"><h2 class="pv-card__title" id="register">${msg('Preview and register', { id: 'register.side' })}</h2></div>
            <div class="pv-card__body">
              <p class="pv-note">${msg('The preview assesses the claim without storing it. On registering, it is assessed again and may be decided at once.', { id: 'register.how' })}</p>
              <wa-button class="wide" appearance="outlined" ?loading=${this.busy === 'preview'} @click=${() => this.runPreview()}>${msg('Preview the assessment', { id: 'register.preview' })}</wa-button>
              ${this.preview ? this.previewView(this.preview, money) : nothing}
              ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing}
              ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>${this.notice.text}</wa-callout>` : nothing}
              <wa-button class="wide" type="submit" variant="brand" ?loading=${this.busy === 'register'}>${msg('Register the claim', { id: 'register.submit' })} · ${money(total)}</wa-button>
            </div>
          </section>
        </div>
      </form>
    `;
  }

  private previewView(a: Assessment, money: (m: number) => string) {
    const attention = a.rules.filter((r) => r.status === 'review' || r.status === 'fail');
    return html`<div role="status" aria-label=${msg('Preview', { id: 'register.previewResult' })}>
      <p>
        ${msg('Proposal', { id: 'claim.proposed' })}: <strong>${outcomeLabel(a.proposedOutcome)}</strong>${a.calculation ? html` · ${money(a.calculation.payout)}` : nothing} ·
        ${a.mode === 'auto' ? msg('May be settled automatically', { id: 'claim.mode.auto' }) : msg('Needs a claims handler', { id: 'claim.mode.manual' })}
      </p>
      ${attention.length
        ? html`<ul class="rules">
            ${attention.map((r) => html`<li><span class="pv-mono">${r.code}</span> ${ruleStatusLabel(r.status)}: ${r.message ?? r.reason}</li>`)}
          </ul>`
        : nothing}
      ${a.calculation ? html`<pv-waterfall .calculation=${a.calculation} currency=${a.currency} label=${msg('Calculation', { id: 'claim.calculation' })}></pv-waterfall>` : nothing}
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-claim-register': ClaimRegister;
  }
}
