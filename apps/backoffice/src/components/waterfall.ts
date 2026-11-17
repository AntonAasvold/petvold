/**
 * <pv-waterfall>: a calculation as one row per step. What was billed, each
 * deduction with its rule, and the payout. The bar shows the step in percent of
 * the billed amount; deductions are hatched. Styles: .pv-wf__* in
 * design/components.css, through pvComponents (https://lit.dev/docs/components/styles/).
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import { formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { waterfallSteps, type CalculationLike, type Step } from '../waterfall.ts';

@customElement('pv-waterfall')
export class Waterfall extends LitElement {
  @property({ attribute: false }) calculation: CalculationLike | null = null;
  @property() currency = 'SEK';
  @property() label = '';

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
      :host {
        display: block;
        container: waterfall / inline-size;
      }
      ol {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .pv-wf__amount {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .pv-wf__row--result {
        border-bottom: 0;
        border-top: var(--border-strong) solid var(--ink);
      }
      .pv-wf__row--result .pv-wf__amount {
        font: 700 20px/1.3 var(--font-display);
      }
      /* Follows its own width, not the screen's: it also sits in a narrow side column. */
      @container waterfall (max-width: 520px) {
        .pv-wf__row {
          grid-template-columns: minmax(0, 1fr) auto;
          row-gap: var(--space-2);
        }
        .pv-wf__track {
          grid-column: 1 / -1;
          grid-row: 2;
        }
      }
    `,
  ];

  render() {
    if (!this.calculation) return nothing;
    const steps = waterfallSteps(this.calculation);
    return html`<ol aria-label=${this.label || nothing}>
      ${steps.map((s) => this.row(s))}
    </ol>`;
  }

  private row(s: Step) {
    const money = (m: number) => formatMoney(m, this.currency, getLocale());
    const kind = s.kind === 'minus' ? 'pv-wf__row--minus' : s.kind === 'result' ? 'pv-wf__row--result' : '';
    const note = this.note(s, money);
    return html`<li class="pv-wf__row ${kind}">
      <span>
        <span class="pv-wf__label">${this.stepTitle(s)}</span>
        ${note ? html`<span class="pv-wf__note">${note}</span>` : nothing}
      </span>
      <span class="pv-wf__track" aria-hidden="true"><span class="pv-wf__bar" style="left: ${s.from}%; width: ${s.to - s.from}%"></span></span>
      <span class="pv-wf__amount">${s.kind === 'minus' ? '− ' : ''}${money(s.amount)}</span>
    </li>`;
  }

  private stepTitle(s: Step): string {
    switch (s.key) {
      case 'billed':
        return msg('Billed', { id: 'calc.billed' });
      case 'nonReimbursable':
        return msg('Not reimbursed', { id: 'calc.nonReimbursable' });
      case 'vatExcluded':
        return msg('VAT', { id: 'calc.vat' });
      case 'deductibleFixed':
        return msg('Fixed deductible', { id: 'calc.deductibleFixed' });
      case 'deductibleVariable':
        return msg('Variable deductible', { id: 'calc.deductibleVariable' });
      case 'limit':
        return msg('Annual limit', { id: 'calc.limit' });
      case 'payout':
        return msg('Payout', { id: 'calc.payout' });
    }
  }

  /** The rule behind the step, in a line. */
  private note(s: Step, money: (m: number) => string): string {
    switch (s.key) {
      case 'billed':
        return msg("The clinic's invoice", { id: 'wf.billed' });
      case 'nonReimbursable':
        return msg('Costs the cover does not pay, for example food', { id: 'wf.nonReimbursable' });
      case 'vatExcluded':
        return msg('VAT is not reimbursed in this market', { id: 'wf.vat' });
      case 'deductibleFixed':
        return s.params.opensPeriod
          ? msg('Once per period: opens a deductible period for the diagnosis group', { id: 'wf.fixedOpens' })
          : msg('Once per claim', { id: 'wf.fixed' });
      case 'deductibleVariable':
        return `${new Intl.NumberFormat(getLocale()).format(Number(s.params.percent))} % ${msg('of what is left after the fixed deductible', { id: 'wf.variable' })}`;
      case 'limit':
        return `${msg('Only this much is left of the annual limit:', { id: 'wf.limit' })} ${money(Number(s.params.remaining))}`;
      case 'payout':
        return msg('Paid to the customer', { id: 'wf.payout' });
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-waterfall': Waterfall;
  }
}
