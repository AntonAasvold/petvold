/** <pv-explanation-dialog>: why a decision came out as it did, step by step (GET .../decisions/{seq}/explanation). */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { deviationLabel, outcomeLabel } from '../views/labels.ts';

type Explanation = components['schemas']['DecisionExplanation'];

@customElement('pv-explanation-dialog')
export class ExplanationDialog extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private open = false;
  @state() private explanation: Explanation | null = null;
  @state() private problem: Problem | null = null;

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    ol {
      padding-inline-start: var(--wa-space-l);
    }
    li {
      margin-bottom: var(--wa-space-2xs);
    }
  `;

  /** Opens the dialog for a decision. */
  async show(claimId: string, seq: number) {
    this.open = true;
    this.explanation = null;
    this.problem = null;
    try {
      this.explanation = await unwrap(this.api.GET('/v1/claims/{claimId}/decisions/{seq}/explanation', { params: { path: { claimId, seq } } }));
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  render() {
    const e = this.explanation;
    return html`<wa-dialog label=${msg('Why this decision', { id: 'explain.title' })} ?open=${this.open} @wa-after-hide=${() => (this.open = false)}>
      ${this.problem ? html`<wa-callout variant="danger">${this.problem.title}</wa-callout>` : nothing}
      ${!e && !this.problem ? html`<wa-spinner></wa-spinner>` : nothing}
      ${e
        ? html`<p>
              <strong>${outcomeLabel(e.outcome)}</strong> · ${formatMoney(e.payout, e.currency, getLocale())}${e.automated ? html` · ${msg('Automatic', { id: 'claim.automated' })}` : nothing}
            </p>
            <p>${e.mainReason.message ?? e.mainReason.reason}</p>
            ${e.deviation
              ? html`<wa-callout variant="warning">${msg('Against the proposal', { id: 'explain.deviation' })}: ${e.deviation.message ?? deviationLabel(e.deviation.reasonCode)}. ${e.deviation.reason}</wa-callout>`
              : nothing}
            ${e.steps.length ? html`<h4>${msg('The calculation', { id: 'explain.steps' })}</h4><ol>${e.steps.map((s) => html`<li>${s.message ?? s.reason}</li>`)}</ol>` : nothing}`
        : nothing}
    </wa-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-explanation-dialog': ExplanationDialog;
  }
}
