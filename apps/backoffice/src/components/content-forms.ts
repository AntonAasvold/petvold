/**
 * <pv-product-content>, <pv-rules-content>, <pv-tariff-content>,
 * <pv-price-terms-content> and <pv-underwriting-content>: a product's content,
 * claims rules, a tariff, price terms and underwriting rules as forms (ADR
 * 0021, 0023, 0030, 0031). Each starts from the content it is given and
 * hands back new content with result(); what the form does not show is kept.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import type { Api } from '../api/client.ts';
import {
  POLICY_DEFAULTS,
  POLICY_SETTINGS,
  emptyDeductible,
  labelLanguages,
  productContentFrom,
  productFormFrom,
  productFormProblems,
  rulesContentFrom,
  rulesFormFrom,
  rulesFormProblems,
  type ClaimsRulesForm,
  type DeductibleForm,
  type PolicySetting,
  type ProductForm,
} from '../product-form.ts';
import {
  priceTermsContentFrom,
  priceTermsFormFrom,
  priceTermsFormProblems,
  tariffContentFrom,
  tariffFormFrom,
  tariffFormProblems,
  type PriceTermsForm,
  type TariffForm,
} from '../pricing-form.ts';
import { loadReferences, type RefItem } from '../reference.ts';
import {
  emptyAnswerRule,
  emptyQuestion,
  underwritingContentFrom,
  underwritingFormFrom,
  underwritingFormProblems,
  type AnswerRuleForm,
  type QuestionForm,
  type UnderwritingForm,
} from '../underwriting-form.ts';
import { pvComponents } from '../styles/pv-components.ts';

export interface ContentResult {
  problems: string[];
  content: unknown;
}

const styles = [
  pvComponents,
  css`
    :host {
      display: grid;
      gap: var(--space-5);
    }
    fieldset {
      display: grid;
      gap: var(--space-3);
      margin: 0;
      padding: var(--space-4);
      border: var(--border-hairline) solid var(--line);
    }
    legend {
      padding: 0 var(--space-2);
      font: 600 14px/1.4 var(--font-sans);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      align-items: start;
    }
    .row > * {
      flex: 1 1 10rem;
      min-width: 0;
    }
    .row > wa-select {
      flex: 2 1 16rem;
    }
    .row.end {
      align-items: end;
    }
    .settings {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      gap: var(--space-3);
      align-items: end;
    }
    fieldset.inner {
      padding: 0;
      border: 0;
    }
    fieldset.inner legend {
      padding: 0 0 var(--space-2);
      font: 500 13px/1.4 var(--font-sans);
      color: var(--text-secondary);
    }
    .checks {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-5);
    }
    .deductible {
      display: grid;
      gap: var(--space-3);
      padding-top: var(--space-3);
      border-top: var(--border-hairline) solid var(--line);
    }
    .deductible:first-of-type {
      border-top: 0;
      padding-top: 0;
    }
    .mono::part(input),
    .mono::part(textarea) {
      font-family: var(--font-mono);
    }
  `,
];

const value = (e: Event) => (e.target as HTMLInputElement).value;

@customElement('pv-product-content')
export class ProductContentForm extends LitElement {
  @property({ attribute: false }) api: Api | null = null;
  /** The content to start from. A new value starts the form again. */
  @property({ attribute: false }) content: unknown = {};
  @state() private form: ProductForm = productFormFrom({});
  @state() private species: RefItem[] = [];

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = styles;

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('content')) this.form = productFormFrom((this.content ?? {}) as Record<string, unknown>);
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.api) void loadReferences(this.api).then((r) => (this.species = r.species), () => undefined);
  }

  /** The content the form gives, and what is wrong with it as message ids. */
  result(): ContentResult {
    const problems = productFormProblems(this.form);
    return { problems, content: problems.length ? null : productContentFrom(this.form, (this.content ?? {}) as Record<string, unknown>) };
  }

  private set(patch: Partial<ProductForm>) {
    this.form = { ...this.form, ...patch };
  }

  private setDeductible(i: number, patch: Partial<DeductibleForm>) {
    this.set({ deductibles: this.form.deductibles.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  }

  render() {
    const f = this.form;
    const species = [...new Set([...this.species.map((s) => s.code), ...f.species])];
    const label = (code: string) => this.species.find((s) => s.code === code)?.label ?? code;
    return html`
      <fieldset>
        <legend>${msg('The product', { id: 'product.legend' })}</legend>
        <div class="row">
          <wa-input label=${msg('Market', { id: 'claim.market' })} .value=${f.market} @input=${(e: Event) => this.set({ market: value(e).toUpperCase() })}></wa-input>
          <wa-input label=${msg('Currency', { id: 'product.currency' })} .value=${f.currency} @input=${(e: Event) => this.set({ currency: value(e).toUpperCase() })}></wa-input>
          <wa-input
            type="number"
            label=${msg('Waiting period, days', { id: 'product.waiting' })}
            .value=${f.waitingPeriodDays}
            @input=${(e: Event) => this.set({ waitingPeriodDays: value(e) })}
          ></wa-input>
        </div>
        ${labelLanguages(f.names).map(
          (lang) => html`<wa-input
            label=${`${msg('Name', { id: 'catalog.name' })} (${lang})`}
            .value=${f.names[lang] ?? ''}
            @input=${(e: Event) => this.set({ names: { ...f.names, [lang]: value(e) } })}
          ></wa-input>`,
        )}
        <fieldset class="inner">
          <legend>${msg('Species', { id: 'product.species' })}</legend>
          <div class="checks">
            ${species.map(
              (code) => html`<wa-checkbox
                .checked=${f.species.includes(code)}
                @change=${(e: Event) => this.set({ species: (e.target as HTMLInputElement).checked ? [...f.species, code] : f.species.filter((s) => s !== code) })}
                >${label(code)}</wa-checkbox
              >`,
            )}
          </div>
        </fieldset>
      </fieldset>

      <fieldset>
        <legend>${msg('Rules and price', { id: 'product.series' })}</legend>
        <div class="row">
          <wa-input class="mono" label=${msg('Claims rules series', { id: 'product.ruleSeries' })} .value=${f.ruleSeries} @input=${(e: Event) => this.set({ ruleSeries: value(e).toUpperCase() })}></wa-input>
          <wa-input
            class="mono"
            label=${msg('Underwriting rules series (optional)', { id: 'product.underwritingSeries' })}
            .value=${f.underwritingSeries}
            @input=${(e: Event) => this.set({ underwritingSeries: value(e).toUpperCase() })}
          ></wa-input>
        </div>
        <div class="row">
          <wa-input
            class="mono"
            label=${msg('Tariff series (optional)', { id: 'product.tariffSeries' })}
            hint=${msg('Empty: the premium is given by hand.', { id: 'product.tariffHint' })}
            .value=${f.tariffSeries}
            @input=${(e: Event) => this.set({ tariffSeries: value(e).toUpperCase() })}
          ></wa-input>
          <wa-input
            class="mono"
            label=${msg('Price terms series (optional)', { id: 'product.priceTermsSeries' })}
            .value=${f.priceTermsSeries}
            @input=${(e: Event) => this.set({ priceTermsSeries: value(e).toUpperCase() })}
          ></wa-input>
        </div>
      </fieldset>

      <fieldset>
        <legend>${msg('Vet care', { id: 'product.vetCare' })}</legend>
        <div class="row">
          <wa-input
            label=${msg('Annual limits', { id: 'product.annualLimits' })}
            hint=${msg('In the currency, separated by semicolons, e.g. 30 000; 60 000', { id: 'product.annualLimitsHint' })}
            .value=${f.annualLimits}
            @input=${(e: Event) => this.set({ annualLimits: value(e) })}
          ></wa-input>
          <wa-input label=${msg('Default annual limit', { id: 'product.defaultLimit' })} .value=${f.defaultAnnualLimit} @input=${(e: Event) => this.set({ defaultAnnualLimit: value(e) })}></wa-input>
        </div>
        ${f.deductibles.map((d, i) => this.deductible(d, i))}
        <div class="row end">
          <wa-button appearance="outlined" @click=${() => this.set({ deductibles: [...f.deductibles, emptyDeductible()] })}
            ><wa-icon slot="start" name="plus"></wa-icon>${msg('Add a deductible', { id: 'product.addDeductible' })}</wa-button
          >
          <wa-select label=${msg('Default deductible', { id: 'product.defaultDeductible' })} value=${f.defaultDeductible} @change=${(e: Event) => this.set({ defaultDeductible: value(e) })}>
            ${f.deductibles.filter((d) => d.code).map((d) => html`<wa-option value=${d.code}>${d.code}</wa-option>`)}
          </wa-select>
        </div>
      </fieldset>

      <fieldset>
        <legend>${msg('Policies', { id: 'nav.policies' })}</legend>
        <p class="pv-note">${msg('Empty fields get the default, shown in grey.', { id: 'product.defaults' })}</p>
        <div class="settings">
          <wa-select
            label=${msg('Cancellation during a term', { id: 'product.midTerm' })}
            value=${f.policy.midTermCancellation || 'default'}
            @change=${(e: Event) => this.set({ policy: { ...f.policy, midTermCancellation: value(e) === 'default' ? '' : (value(e) as 'term-end' | 'immediate') } })}
          >
            <wa-option value="default">${msg('Default: at the end of the term', { id: 'product.midTermDefault' })}</wa-option>
            <wa-option value="term-end">${msg('At the end of the term', { id: 'product.termEnd' })}</wa-option>
            <wa-option value="immediate">${msg('The day after notice, with a refund', { id: 'product.immediate' })}</wa-option>
          </wa-select>
          ${POLICY_SETTINGS.map(
            (k) => html`<wa-input
              type="number"
              label=${this.settingLabel(k)}
              placeholder=${String(POLICY_DEFAULTS[k])}
              .value=${f.policy[k]}
              @input=${(e: Event) => this.set({ policy: { ...f.policy, [k]: value(e) } })}
            ></wa-input>`,
          )}
        </div>
      </fieldset>
    `;
  }

  private deductible(d: DeductibleForm, i: number) {
    const n = i + 1;
    return html`<div class="deductible" role="group" aria-label=${`${msg('Deductible', { id: 'product.deductible' })} ${n}`}>
      <div class="row">
        <wa-input class="mono" label=${msg('Code', { id: 'product.code' })} .value=${d.code} @input=${(e: Event) => this.setDeductible(i, { code: value(e) })}></wa-input>
        ${labelLanguages(d.labels).map(
          (lang) => html`<wa-input
            label=${`${msg('Name', { id: 'catalog.name' })} (${lang})`}
            .value=${d.labels[lang] ?? ''}
            @input=${(e: Event) => this.setDeductible(i, { labels: { ...d.labels, [lang]: value(e) } })}
          ></wa-input>`,
        )}
        <wa-button
          appearance="plain"
          label=${`${msg('Remove the deductible', { id: 'product.removeDeductible' })} ${n}`}
          ?disabled=${this.form.deductibles.length === 1}
          @click=${() => this.set({ deductibles: this.form.deductibles.filter((_, j) => j !== i) })}
          ><wa-icon name="trash" label=${`${msg('Remove the deductible', { id: 'product.removeDeductible' })} ${n}`}></wa-icon
        ></wa-button>
      </div>
      <div class="row">
        <wa-input label=${msg('Fixed', { id: 'product.fixed' })} inputmode="decimal" .value=${d.fixed} @input=${(e: Event) => this.setDeductible(i, { fixed: value(e) })}></wa-input>
        <wa-select label=${msg('Charged', { id: 'product.fixedPer' })} value=${d.fixedPer} @change=${(e: Event) => this.setDeductible(i, { fixedPer: value(e) as DeductibleForm['fixedPer'] })}>
          <wa-option value="period">${msg('Once per period and diagnosis group', { id: 'product.perPeriod' })}</wa-option>
          <wa-option value="claim">${msg('On every claim', { id: 'product.perClaim' })}</wa-option>
          <wa-option value="policy_year">${msg('Once per policy year', { id: 'product.perYear' })}</wa-option>
        </wa-select>
        ${d.fixedPer === 'period'
          ? html`<wa-input type="number" label=${msg('Period, days', { id: 'product.periodDays' })} .value=${d.periodDays} @input=${(e: Event) => this.setDeductible(i, { periodDays: value(e) })}></wa-input>`
          : nothing}
        <wa-input label=${msg('Variable, %', { id: 'product.variable' })} inputmode="decimal" .value=${d.variable} @input=${(e: Event) => this.setDeductible(i, { variable: value(e) })}></wa-input>
      </div>
      <div class="row">
        <wa-input
          label=${msg('Higher variable by age (optional)', { id: 'product.byAge' })}
          hint=${msg('Age in years: per cent, separated by semicolons, e.g. 8: 35; 10: 45', { id: 'product.byAgeHint' })}
          .value=${d.byAge}
          @input=${(e: Event) => this.setDeductible(i, { byAge: value(e) })}
        ></wa-input>
        ${d.fixedPer === 'period'
          ? html`<wa-checkbox .checked=${d.periodEndsAtRenewal} @change=${(e: Event) => this.setDeductible(i, { periodEndsAtRenewal: (e.target as HTMLInputElement).checked })}
              >${msg('The period ends at renewal', { id: 'product.endsAtRenewal' })}</wa-checkbox
            >`
          : nothing}
      </div>
    </div>`;
  }

  private settingLabel(k: PolicySetting): string {
    switch (k) {
      case 'termMonths':
        return msg('Term, months', { id: 'product.termMonths' });
      case 'renewalLeadDays':
        return msg('Renewed, days before the end', { id: 'product.renewalLead' });
      case 'transferAcceptanceDays':
        return msg('Days to accept a transfer', { id: 'product.transferDays' });
      case 'applicationExpiryDays':
        return msg('Days an application may wait', { id: 'product.applicationDays' });
      case 'maxStartAheadDays':
        return msg('Start at most, days ahead', { id: 'product.startAhead' });
    }
  }
}

@customElement('pv-rules-content')
export class RulesContentForm extends LitElement {
  @property({ attribute: false }) content: unknown = {};
  @state() private form: ClaimsRulesForm = rulesFormFrom({});

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = styles;

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('content')) this.form = rulesFormFrom((this.content ?? {}) as Record<string, unknown>);
  }

  result(): ContentResult {
    const problems = rulesFormProblems(this.form);
    return { problems, content: problems.length ? null : rulesContentFrom(this.form, (this.content ?? {}) as Record<string, unknown>) };
  }

  private set(patch: Partial<ClaimsRulesForm>) {
    this.form = { ...this.form, ...patch };
  }

  render() {
    const f = this.form;
    return html`
      <fieldset>
        <legend>${msg('Claims rules', { id: 'rules.legend' })}</legend>
        <div class="row">
          <wa-input label=${msg('Market', { id: 'claim.market' })} .value=${f.market} @input=${(e: Event) => this.set({ market: value(e).toUpperCase() })}></wa-input>
          <wa-input
            label=${msg('Settled automatically up to', { id: 'rules.autoSettle' })}
            hint=${msg("In the market's currency", { id: 'rules.autoSettleHint' })}
            inputmode="decimal"
            .value=${f.autoSettleMax}
            @input=${(e: Event) => this.set({ autoSettleMax: value(e) })}
          ></wa-input>
        </div>
        <wa-checkbox .checked=${f.vatReimbursable} @change=${(e: Event) => this.set({ vatReimbursable: (e.target as HTMLInputElement).checked })}
          >${msg('VAT on vet invoices is reimbursed', { id: 'rules.vat' })}</wa-checkbox
        >
        <wa-input
          label=${msg('Categories never reimbursed', { id: 'rules.nonReimbursable' })}
          hint=${msg('Separated by commas, e.g. food', { id: 'rules.nonReimbursableHint' })}
          .value=${f.nonReimbursable}
          @input=${(e: Event) => this.set({ nonReimbursable: value(e) })}
        ></wa-input>
        <wa-textarea
          class="mono"
          label=${msg('Diagnosis groups', { id: 'rules.groups' })}
          hint=${msg('One per line: code = group. Two diagnoses in a group share a deductible period.', { id: 'rules.groupsHint' })}
          rows="8"
          .value=${f.diagnosisGroups}
          @input=${(e: Event) => this.set({ diagnosisGroups: value(e) })}
        ></wa-textarea>
      </fieldset>
      <fieldset>
        <legend>${msg('Requests for information', { id: 'rules.information' })}</legend>
        <p class="pv-note">${msg('Empty: a reminder after 14 days and a due date after 30.', { id: 'rules.informationDefault' })}</p>
        <div class="row">
          <wa-input type="number" label=${msg('Reminder after, days', { id: 'rules.reminderDays' })} placeholder="14" .value=${f.reminderAfterDays} @input=${(e: Event) => this.set({ reminderAfterDays: value(e) })}></wa-input>
          <wa-input type="number" label=${msg('Due after, days', { id: 'rules.expiresDays' })} placeholder="30" .value=${f.expiresAfterDays} @input=${(e: Event) => this.set({ expiresAfterDays: value(e) })}></wa-input>
        </div>
      </fieldset>
    `;
  }
}

/** A textarea for a table, one row per line, in a monospace font. */
const table = (label: string, hint: string, text: string, rows: number, on: (v: string) => void) =>
  html`<wa-textarea class="mono" label=${label} hint=${hint} rows=${rows} .value=${text} @input=${(e: Event) => on(value(e))}></wa-textarea>`;

@customElement('pv-tariff-content')
export class TariffContentForm extends LitElement {
  @property({ attribute: false }) content: unknown = {};
  @state() private form: TariffForm = tariffFormFrom({});

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = styles;

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('content')) this.form = tariffFormFrom((this.content ?? {}) as Record<string, unknown>);
  }

  result(): ContentResult {
    const problems = tariffFormProblems(this.form);
    return { problems, content: problems.length ? null : tariffContentFrom(this.form, (this.content ?? {}) as Record<string, unknown>) };
  }

  private set(patch: Partial<TariffForm>) {
    this.form = { ...this.form, ...patch };
  }

  render() {
    const f = this.form;
    const factorHint = msg('A factor of 1 is no change, 1.15 is 15 % more and 0.9 is 10 % less.', { id: 'tariff.factorHint' });
    return html`
      <fieldset>
        <legend>${msg('Tariff', { id: 'tariff.legend' })}</legend>
        <p class="pv-note">
          ${msg('The price is the base premium times the factors for age, breed group, deductible and zone, at least the minimum, rounded to the nearest step.', { id: 'tariff.how' })}
        </p>
        <div class="row">
          <wa-input label=${msg('Market', { id: 'claim.market' })} .value=${f.market} @input=${(e: Event) => this.set({ market: value(e).toUpperCase() })}></wa-input>
          <wa-input label=${msg('Currency', { id: 'product.currency' })} .value=${f.currency} @input=${(e: Event) => this.set({ currency: value(e).toUpperCase() })}></wa-input>
          <wa-input label=${msg('Lowest premium a year', { id: 'tariff.minimum' })} inputmode="decimal" .value=${f.minimumAnnual} @input=${(e: Event) => this.set({ minimumAnnual: value(e) })}></wa-input>
          <wa-input
            label=${msg('Round to', { id: 'tariff.roundTo' })}
            hint=${msg('e.g. 1: whole kronor', { id: 'tariff.roundToHint' })}
            inputmode="decimal"
            .value=${f.roundTo}
            @input=${(e: Event) => this.set({ roundTo: value(e) })}
          ></wa-input>
        </div>
        ${table(
          msg('Base premiums a year', { id: 'tariff.base' }),
          msg('One per line: species; annual limit; premium. e.g. dog; 60000; 3000', { id: 'tariff.baseHint' }),
          f.basePremiums,
          4,
          (v) => this.set({ basePremiums: v }),
        )}
        ${table(
          msg('Age', { id: 'tariff.ageBands' }),
          msg('One per line: species; from age in years; factor. The highest age not above the animal’s applies.', { id: 'tariff.ageBandsHint' }),
          f.ageBands,
          5,
          (v) => this.set({ ageBands: v }),
        )}
      </fieldset>
      <fieldset>
        <legend>${msg('Breed groups', { id: 'tariff.breedLegend' })}</legend>
        ${table(msg('Breeds', { id: 'reference.breeds' }), msg('One per line: breed = group, e.g. dog-bulldog = C', { id: 'tariff.breedGroupsHint' }), f.breedGroups, 5, (v) => this.set({ breedGroups: v }))}
        <div class="row">
          <wa-input
            label=${msg('Group of other breeds', { id: 'tariff.defaultGroup' })}
            .value=${f.defaultBreedGroup}
            @input=${(e: Event) => this.set({ defaultBreedGroup: value(e) })}
          ></wa-input>
        </div>
        ${table(msg('Factor per group', { id: 'tariff.groupFactors' }), `${msg('One per line: group = factor.', { id: 'tariff.groupFactorsHint' })} ${factorHint}`, f.breedGroupFactors, 3, (v) =>
          this.set({ breedGroupFactors: v }),
        )}
      </fieldset>
      <fieldset>
        <legend>${msg('Deductible and zone', { id: 'tariff.otherLegend' })}</legend>
        ${table(
          msg('Factor per deductible', { id: 'tariff.deductibleFactors' }),
          msg('One per line: the product’s deductible code = factor, e.g. high = 0.85', { id: 'tariff.deductibleFactorsHint' }),
          f.deductibleFactors,
          3,
          (v) => this.set({ deductibleFactors: v }),
        )}
        ${table(
          msg('Zones', { id: 'tariff.zones' }),
          msg('One per line: postal code prefix = zone, e.g. 411 = centre. The longest match applies.', { id: 'tariff.zonesHint' }),
          f.zones,
          4,
          (v) => this.set({ zones: v }),
        )}
        <div class="row">
          <wa-input label=${msg('Zone of other postal codes', { id: 'tariff.defaultZone' })} .value=${f.defaultZone} @input=${(e: Event) => this.set({ defaultZone: value(e) })}></wa-input>
        </div>
        ${table(msg('Factor per zone', { id: 'tariff.zoneFactors' }), msg('One per line: zone = factor.', { id: 'tariff.zoneFactorsHint' }), f.zoneFactors, 3, (v) => this.set({ zoneFactors: v }))}
      </fieldset>
    `;
  }
}

@customElement('pv-price-terms-content')
export class PriceTermsContentForm extends LitElement {
  @property({ attribute: false }) content: unknown = {};
  @state() private form: PriceTermsForm = priceTermsFormFrom({});

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = styles;

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('content')) this.form = priceTermsFormFrom((this.content ?? {}) as Record<string, unknown>);
  }

  result(): ContentResult {
    const problems = priceTermsFormProblems(this.form);
    return { problems, content: problems.length ? null : priceTermsContentFrom(this.form, (this.content ?? {}) as Record<string, unknown>) };
  }

  private set(patch: Partial<PriceTermsForm>) {
    this.form = { ...this.form, ...patch };
  }

  render() {
    const f = this.form;
    return html`
      <fieldset>
        <legend>${msg('Price terms', { id: 'terms.legend' })}</legend>
        <p class="pv-note">
          ${msg('Discounts on the tariff’s price. The best group discount applies, and a campaign code adds its own. Together never more than the cap, and never below the lowest premium.', { id: 'terms.how' })}
        </p>
        <div class="row">
          <wa-input label=${msg('Market', { id: 'claim.market' })} .value=${f.market} @input=${(e: Event) => this.set({ market: value(e).toUpperCase() })}></wa-input>
          <wa-input label=${msg('Currency', { id: 'product.currency' })} .value=${f.currency} @input=${(e: Event) => this.set({ currency: value(e).toUpperCase() })}></wa-input>
          <wa-input
            label=${msg('Largest discount in all, per cent', { id: 'terms.max' })}
            inputmode="decimal"
            .value=${f.maxTotalDiscount}
            @input=${(e: Event) => this.set({ maxTotalDiscount: value(e) })}
          ></wa-input>
        </div>
        ${table(
          msg('Group discounts', { id: 'terms.groups' }),
          msg('One per line: litter, household or any; from the nth animal; per cent. e.g. litter; 2; 15', { id: 'terms.groupsHint' }),
          f.groupDiscounts,
          3,
          (v) => this.set({ groupDiscounts: v }),
        )}
        ${table(
          msg('Campaign codes', { id: 'terms.campaigns' }),
          msg('One per line: CODE; from; to (empty: no end); per cent; new or all. e.g. PUPPY2026; 2026-01-01; 2027-01-01; 20; new', { id: 'terms.campaignsHint' }),
          f.campaigns,
          4,
          (v) => this.set({ campaigns: v }),
        )}
      </fieldset>
    `;
  }
}

@customElement('pv-underwriting-content')
export class UnderwritingContentForm extends LitElement {
  @property({ attribute: false }) content: unknown = {};
  @state() private form: UnderwritingForm = underwritingFormFrom({});

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = styles;

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('content')) this.form = underwritingFormFrom((this.content ?? {}) as Record<string, unknown>);
  }

  result(): ContentResult {
    const problems = underwritingFormProblems(this.form);
    return { problems, content: problems.length ? null : underwritingContentFrom(this.form, (this.content ?? {}) as Record<string, unknown>) };
  }

  private set(patch: Partial<UnderwritingForm>) {
    this.form = { ...this.form, ...patch };
  }

  private setQuestion(i: number, patch: Partial<QuestionForm>) {
    this.set({ questions: this.form.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  }

  private setRule(i: number, patch: Partial<AnswerRuleForm>) {
    this.set({ answerRules: this.form.answerRules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  }

  private question(q: QuestionForm, i: number) {
    const n = i + 1;
    const remove = `${msg('Remove the question', { id: 'uwform.removeQuestion' })} ${n}`;
    return html`<div class="deductible" role="group" aria-label=${`${msg('Question', { id: 'uwform.question' })} ${n}`}>
      <div class="row">
        <wa-input class="mono" label=${msg('Id', { id: 'uwform.questionId' })} .value=${q.id} @input=${(e: Event) => this.setQuestion(i, { id: value(e) })}></wa-input>
        <wa-select label=${msg('Answer', { id: 'uwform.type' })} value=${q.type} @change=${(e: Event) => this.setQuestion(i, { type: value(e) as QuestionForm['type'] })}>
          <wa-option value="boolean">${msg('Yes or no', { id: 'uwform.boolean' })}</wa-option>
          <wa-option value="diagnoses">${msg('Yes with diagnoses', { id: 'uwform.diagnoses' })}</wa-option>
        </wa-select>
        <wa-input
          label=${msg('Only for species', { id: 'uwform.species' })}
          hint=${msg('Separated by commas. Empty: every species.', { id: 'uwform.speciesHint' })}
          .value=${q.species}
          @input=${(e: Event) => this.setQuestion(i, { species: value(e) })}
        ></wa-input>
        <wa-button appearance="plain" label=${remove} @click=${() => this.set({ questions: this.form.questions.filter((_, j) => j !== i) })}
          ><wa-icon name="trash" label=${remove}></wa-icon
        ></wa-button>
      </div>
      ${labelLanguages(q.labels).map(
        (lang) => html`<wa-input
          label=${`${msg('The question', { id: 'uwform.label' })} (${lang})`}
          .value=${q.labels[lang] ?? ''}
          @input=${(e: Event) => this.setQuestion(i, { labels: { ...q.labels, [lang]: value(e) } })}
        ></wa-input>`,
      )}
    </div>`;
  }

  private rule(r: AnswerRuleForm, i: number) {
    const n = i + 1;
    const remove = `${msg('Remove the rule', { id: 'uwform.removeRule' })} ${n}`;
    const q = this.form.questions.find((x) => x.id === r.question);
    return html`<div class="deductible" role="group" aria-label=${`${msg('Rule', { id: 'uwform.rule' })} ${n}`}>
      <div class="row">
        <wa-select label=${msg('When the answer is yes to', { id: 'uwform.ruleQuestion' })} value=${r.question} @change=${(e: Event) => this.setRule(i, { question: value(e) })}>
          ${this.form.questions.filter((x) => x.id).map((x) => html`<wa-option value=${x.id}>${x.id}</wa-option>`)}
        </wa-select>
        <wa-select label=${msg('Then', { id: 'uwform.outcome' })} value=${r.outcome} @change=${(e: Event) => this.setRule(i, { outcome: value(e) as AnswerRuleForm['outcome'] })}>
          <wa-option value="rider">${msg('Accept with a rider', { id: 'uwform.rider' })}</wa-option>
          <wa-option value="refer">${msg('Refer to a person', { id: 'uwform.refer' })}</wa-option>
          <wa-option value="decline">${msg('Decline', { id: 'uwform.decline' })}</wa-option>
        </wa-select>
        <wa-input
          class="mono"
          label=${msg('Reason code', { id: 'uwform.reason' })}
          hint=${msg('The channel explains it, e.g. heart-disease', { id: 'uwform.reasonHint' })}
          .value=${r.reason}
          @input=${(e: Event) => this.setRule(i, { reason: value(e) })}
        ></wa-input>
        <wa-button appearance="plain" label=${remove} @click=${() => this.set({ answerRules: this.form.answerRules.filter((_, j) => j !== i) })}
          ><wa-icon name="trash" label=${remove}></wa-icon
        ></wa-button>
      </div>
      ${q?.type === 'diagnoses'
        ? html`<wa-input
            class="mono"
            label=${msg('Only for these diagnoses (optional)', { id: 'uwform.onlyFor' })}
            hint=${msg('Codes separated by commas. Empty: any declared diagnosis.', { id: 'uwform.onlyForHint' })}
            .value=${r.onlyFor}
            @input=${(e: Event) => this.setRule(i, { onlyFor: value(e) })}
          ></wa-input>`
        : nothing}
      ${r.outcome === 'rider'
        ? html`<div class="row">
            <wa-input label=${msg('The rider', { id: 'uwform.riderDescription' })} .value=${r.riderDescription} @input=${(e: Event) => this.setRule(i, { riderDescription: value(e) })}></wa-input>
            <wa-input
              class="mono"
              label=${q?.type === 'boolean' ? msg('Excluded diagnoses', { id: 'uwform.codes' }) : msg('Also excluded (optional)', { id: 'uwform.moreCodes' })}
              hint=${msg('Codes separated by commas', { id: 'uwform.codesHint' })}
              .value=${r.diagnosisCodes}
              @input=${(e: Event) => this.setRule(i, { diagnosisCodes: value(e) })}
            ></wa-input>
          </div>`
        : nothing}
    </div>`;
  }

  render() {
    const f = this.form;
    return html`
      <fieldset>
        <legend>${msg('Underwriting rules', { id: 'uwform.legend' })}</legend>
        <p class="pv-note">${msg('The strictest outcome wins: decline before refer, refer before a rider. Every refer and decline has a reason code.', { id: 'uwform.how' })}</p>
        <div class="row">
          <wa-input label=${msg('Market', { id: 'claim.market' })} .value=${f.market} @input=${(e: Event) => this.set({ market: value(e).toUpperCase() })}></wa-input>
        </div>
        ${table(
          msg('Age limits', { id: 'uwform.ageLimits' }),
          msg('One per line: species; youngest in days; oldest in whole years (empty: no limit). e.g. dog; 42; 9. A species not listed is declined.', { id: 'uwform.ageLimitsHint' }),
          f.ageLimits,
          3,
          (v) => this.set({ ageLimits: v }),
        )}
        ${table(
          msg('Breeds', { id: 'reference.breeds' }),
          msg('One per line: breed; refer or decline; reason code. e.g. dog-wolfhybrid; decline; breed-not-covered', { id: 'uwform.breedRulesHint' }),
          f.breedRules,
          3,
          (v) => this.set({ breedRules: v }),
        )}
      </fieldset>
      <fieldset>
        <legend>${msg('Health questions', { id: 'uwform.questions' })}</legend>
        ${f.questions.map((q, i) => this.question(q, i))}
        <div class="row">
          <wa-button appearance="outlined" @click=${() => this.set({ questions: [...f.questions, emptyQuestion()] })}
            ><wa-icon slot="start" name="plus"></wa-icon>${msg('Add a question', { id: 'uwform.addQuestion' })}</wa-button
          >
        </div>
      </fieldset>
      <fieldset>
        <legend>${msg('What a yes leads to', { id: 'uwform.rules' })}</legend>
        ${f.answerRules.map((r, i) => this.rule(r, i))}
        <div class="row">
          <wa-button appearance="outlined" @click=${() => this.set({ answerRules: [...f.answerRules, emptyAnswerRule(f.questions[0]?.id ?? '')] })}
            ><wa-icon slot="start" name="plus"></wa-icon>${msg('Add a rule', { id: 'uwform.addRule' })}</wa-button
          >
        </div>
      </fieldset>
    `;
  }
}
