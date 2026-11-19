/**
 * <pv-policy-issue>: issue a policy (ADR 0029, 0031): the animal and the
 * policyholder, a product version on sale for the animal's species, its
 * choices, a price indication from the tariff, and how the customer accepted
 * with the documents they were shown. From an animal's page both are filled in.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import type { Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { displayName } from '../party-logic.ts';
import { CHANNELS, emptyIssue, issueBody, issueProblems, needsApplication, quoteBody, withProductDefaults, type IssueForm, type ProductLike } from '../policy-form.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { channelLabelFor, documentLabel, problemLabel } from './labels.ts';

type Product = components['schemas']['ProductVersion'];
type Quote = components['schemas']['Quote'];

const today = () => new Date().toISOString().slice(0, 10);
/** Now as datetime-local wants it, in the browser's time zone. */
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

@customElement('pv-policy-issue')
export class PolicyIssue extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private form: IssueForm = (() => {
    const q = new URLSearchParams(location.search);
    return emptyIssue(today(), nowLocal(), { animalId: q.get('animal') ?? '', holder: q.get('holder') ?? '' });
  })();
  @state() private products: Product[] = [];
  @state() private animal: { name: string; species: string; market: string } | null = null;
  @state() private holderName = '';
  @state() private quote: Quote | null = null;
  @state() private shown: string[] = [];
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
      .docs {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      .pv-card__body p {
        margin: 0;
      }
      .who {
        font-size: 14px;
        color: var(--text-secondary);
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
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    void this.loadWho().then(() => this.loadProducts());
  }

  private product(): ProductLike | null {
    return (this.products.find((p) => p.id === this.form.productVersion) as unknown as ProductLike | undefined) ?? null;
  }

  /** The animal's name and species, and the policyholder's name, so the person sees who it is for. */
  private async loadWho() {
    const f = this.form;
    const animal = /^ani_/.test(f.animalId) ? await this.api.GET('/v1/animals/{animalId}', { params: { path: { animalId: f.animalId.trim() } } }).then((r) => r.data ?? null, () => null) : null;
    this.animal = animal ? { name: animal.name, species: animal.species, market: animal.market } : null;
    const holder = /^pty_/.test(f.policyholderPartyId) ? await this.api.GET('/v1/parties/{partyId}', { params: { path: { partyId: f.policyholderPartyId.trim() } } }).then((r) => r.data ?? null, () => null) : null;
    this.holderName = displayName(holder);
    if (animal) this.form = { ...this.form, market: animal.market };
  }

  /** Product versions on sale on the start date, for the animal's species when it is known. */
  private async loadProducts() {
    const { data } = await this.api.GET('/v1/product-versions', {
      params: { query: { onSale: this.form.startDate, market: this.form.market, ...(this.animal ? { species: this.animal.species } : {}) } },
    });
    this.products = data?.items ?? [];
    if (!this.product() && this.products[0]) this.form = withProductDefaults(this.form, this.products[0] as unknown as ProductLike);
  }

  private set(patch: Partial<IssueForm>) {
    this.form = { ...this.form, ...patch };
    this.quote = null;
    this.keys.done('issue');
  }

  render() {
    const f = this.form;
    const p = this.product();
    const lang = getLocale();
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    const money = (m: number) => formatMoney(m, p?.content.currency ?? 'SEK', lang);
    return html`
      <nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
        <a href="/policies" @click=${(e: Event) => (e.preventDefault(), navigate('/policies'))}>${msg('Policies', { id: 'nav.policies' })}</a>
        <span aria-hidden="true">/</span><span aria-current="page">${msg('Issue a policy', { id: 'policy.issue' })}</span>
      </nav>
      <h1>${msg('Issue a policy', { id: 'policy.issue' })}</h1>
      <form class="cols" @submit=${this.submit} novalidate>
        <div class="basis">
          <section class="pv-card" aria-labelledby="who">
            <div class="pv-card__head"><h2 class="pv-card__title" id="who">${msg('Animal and policyholder', { id: 'policy.who' })}</h2></div>
            <div class="pv-card__body">
              <div class="row">
                <wa-input
                  label=${msg('Animal id', { id: 'animal.id' })}
                  .value=${f.animalId}
                  @change=${(e: Event) => (this.set({ animalId: value(e) }), void this.loadWho().then(() => this.loadProducts()))}
                ></wa-input>
                <wa-input
                  label=${msg('Policyholder (party id)', { id: 'policy.holderId' })}
                  .value=${f.policyholderPartyId}
                  @change=${(e: Event) => (this.set({ policyholderPartyId: value(e) }), void this.loadWho())}
                ></wa-input>
              </div>
              <p class="who">${this.animal ? `${this.animal.name}` : '–'} · ${this.holderName || '–'}</p>
            </div>
          </section>

          <section class="pv-card" aria-labelledby="product">
            <div class="pv-card__head"><h2 class="pv-card__title" id="product">${msg('Product', { id: 'policy.product' })}</h2></div>
            <div class="pv-card__body">
              <div class="row">
                <wa-select
                  label=${msg('Product version on sale', { id: 'policy.productVersion' })}
                  value=${f.productVersion}
                  @change=${(e: Event) => {
                    const chosen = this.products.find((x) => x.id === value(e));
                    if (chosen) this.set(withProductDefaults(this.form, chosen as unknown as ProductLike));
                  }}
                >
                  ${this.products.map((x) => html`<wa-option value=${x.id}>${x.name} (${x.id})</wa-option>`)}
                </wa-select>
                <wa-input type="date" label=${msg('Start date', { id: 'policy.start' })} .value=${f.startDate} @change=${(e: Event) => (this.set({ startDate: value(e) }), void this.loadProducts())}></wa-input>
              </div>
              ${p && needsApplication(p)
                ? html`<p class="pv-note">${msg('This product has health questions: register an application instead, which may be referred to an underwriter.', { id: 'policy.needsApplicationNote' })}</p>`
                : nothing}
              ${p
                ? html`<div class="row">
                    <wa-select label=${msg('Annual limit', { id: 'policy.annualLimit' })} value=${String(f.annualLimit ?? '')} @change=${(e: Event) => this.set({ annualLimit: Number(value(e)) })}>
                      ${p.content.vetCare.annualLimits.map((l) => html`<wa-option value=${String(l)}>${money(l)}</wa-option>`)}
                    </wa-select>
                    <wa-select label=${msg('Deductible', { id: 'policy.deductible' })} value=${f.deductible} @change=${(e: Event) => this.set({ deductible: value(e) })}>
                      ${p.content.vetCare.deductibles.map((d) => html`<wa-option value=${d.code}>${d.labels?.[lang] ?? d.labels?.en ?? d.code}</wa-option>`)}
                    </wa-select>
                    <wa-input label=${msg('Campaign code (optional)', { id: 'policy.campaign' })} .value=${f.campaignCode} @input=${(e: Event) => this.set({ campaignCode: value(e) })}></wa-input>
                  </div>`
                : html`<p>${msg('No product version is on sale for this animal on the start date.', { id: 'policy.noProduct' })}</p>`}
            </div>
          </section>

          <section class="pv-card" aria-labelledby="acceptance">
            <div class="pv-card__head"><h2 class="pv-card__title" id="acceptance">${msg("The customer's acceptance", { id: 'policy.acceptance' })}</h2></div>
            <div class="pv-card__body">
              <div class="row">
                <wa-select label=${msg('Channel', { id: 'claims.col.channel' })} value=${f.channel} @change=${(e: Event) => this.set({ channel: value(e) })}>
                  ${CHANNELS.map((c) => html`<wa-option value=${c}>${channelLabelFor(c)}</wa-option>`)}
                </wa-select>
                <wa-input type="datetime-local" label=${msg('Accepted', { id: 'policy.acceptedAt' })} .value=${f.acceptedAt} @input=${(e: Event) => this.set({ acceptedAt: value(e) })}></wa-input>
                <wa-input label=${msg('Reference (optional)', { id: 'policy.reference' })} hint=${msg('e.g. a call or a signing reference', { id: 'policy.referenceHint' })} .value=${f.reference} @input=${(e: Event) => this.set({ reference: value(e) })}></wa-input>
              </div>
              ${p?.content.documents?.length
                ? html`<fieldset class="docs">
                    <legend>${msg('Documents the customer was shown', { id: 'policy.documents' })}</legend>
                    ${p.content.documents.map((d) => {
                      const key = `${d.type}:${d.language}`;
                      return html`<wa-checkbox
                        ?checked=${f.documents.includes(key)}
                        @change=${(e: Event) => this.set({ documents: (e.target as HTMLInputElement).checked ? [...f.documents, key] : f.documents.filter((x) => x !== key) })}
                        >${documentLabel(d.type)} (${d.language})</wa-checkbox
                      >`;
                    })}
                  </fieldset>`
                : nothing}
            </div>
          </section>
        </div>

        <div class="side">
          <section class="pv-card pv-card--strong" aria-labelledby="price">
            <div class="pv-card__head"><h2 class="pv-card__title" id="price">${msg('Price', { id: 'policy.price' })}</h2></div>
            <div class="pv-card__body">
              ${p && !p.content.tariffSeries
                ? html`<p>${msg('This product has no tariff: give the premium for a term.', { id: 'policy.manualPremium' })}</p>
                    <wa-input label=${msg('Premium per term', { id: 'policy.premiumPerTerm' })} inputmode="decimal" .value=${f.premium} @input=${(e: Event) => this.set({ premium: value(e) })}></wa-input>`
                : html`<wa-button class="wide" appearance="outlined" ?loading=${this.busy === 'quote'} ?disabled=${!p} @click=${() => this.runQuote()}>${msg('Price indication', { id: 'policy.quote' })}</wa-button>
                    ${this.quote
                      ? html`<dl class="pv-dl" role="status" aria-label=${msg('Price', { id: 'policy.price' })}>
                          <div class="pv-dl__row"><dt>${msg('Base price per year', { id: 'policy.basePremium' })}</dt><dd>${money(this.quote.price.basePremium)}</dd></div>
                          <div class="pv-dl__row pv-dl__row--total"><dt>${msg('Premium per year', { id: 'policy.annualPremium' })}</dt><dd>${money(this.quote.price.annualPremium)}</dd></div>
                          <div class="pv-dl__row"><dt>${msg('For this term', { id: 'policy.termPremium' })} (${this.quote.startDate} – ${this.quote.endDate})</dt><dd>${money(this.quote.price.termPremium)}</dd></div>
                        </dl>`
                      : nothing}`}
              ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((x) => html`<div>${problemLabel(x)}</div>`)}</wa-callout>` : nothing}
              ${this.notice ? html`<wa-callout variant=${this.notice.variant} role="alert">${this.notice.text}</wa-callout>` : nothing}
              <wa-button class="wide" type="submit" variant="brand" ?loading=${this.busy === 'issue'} ?disabled=${!!p && needsApplication(p)}
                >${msg('Issue the policy', { id: 'policy.submitIssue' })}${this.quote ? ` · ${money(this.quote.price.annualPremium)} ${msg('per year', { id: 'policy.perYear' })}` : ''}</wa-button
              >
            </div>
          </section>
        </div>
      </form>
    `;
  }

  private async runQuote() {
    const p = this.product();
    if (!p) return;
    this.busy = 'quote';
    const { data, error } = await this.api.POST('/v1/quotes', { body: quoteBody(this.form, p) as never });
    this.busy = '';
    if (data) {
      this.quote = data;
      this.notice = null;
    } else {
      const e = (error ?? {}) as { title?: string; detail?: string };
      this.notice = { variant: 'danger', text: e.detail ?? e.title ?? msg('Something went wrong.', { id: 'common.error' }) };
    }
  }

  private async submit(e: Event) {
    e.preventDefault();
    const p = this.product();
    this.shown = issueProblems(this.form, p, today(), nowLocal());
    if (this.shown.length || !p) return;
    this.busy = 'issue';
    let created: { id: string } | undefined;
    const { ok, notice } = await act(
      async () => {
        const r = await this.api.POST('/v1/policies', { params: { header: { 'Idempotency-Key': this.keys.for('issue') } }, body: issueBody(this.form, p) as never });
        created = r.data;
        return r;
      },
      () => ({ variant: 'success', text: msg('The policy is issued.', { id: 'policy.issued' }) }),
    );
    this.busy = '';
    if (ok && created) {
      this.keys.done('issue');
      navigate(`/policies/${encodeURIComponent(created.id)}`);
      return;
    }
    this.notice = notice;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-policy-issue': PolicyIssue;
  }
}
