/**
 * <pv-explanation-dialog>: why a decision came out as it did, step by step (GET
 * .../decisions/{seq}/explanation), and the decision recalculated from its stored
 * evidence (POST .../replays, ADR 0018): the same result, what differs, or a
 * calculation model this engine no longer has.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { deviationLabel, outcomeLabel } from '../views/labels.ts';

type Explanation = components['schemas']['DecisionExplanation'];
type Replay = components['schemas']['ReplayResult'];

@customElement('pv-explanation-dialog')
export class ExplanationDialog extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private open = false;
  @state() private explanation: Explanation | null = null;
  @state() private problem: Problem | null = null;
  @state() private replay: Replay | null = null;
  @state() private replaying = false;
  @state() private replayProblem = '';
  private target: { claimId: string; seq: number } | null = null;

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
    .replay {
      margin-top: var(--wa-space-l);
      border-top: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      padding-top: var(--wa-space-m);
    }
    code {
      font-family: var(--wa-font-family-code);
    }
  `;

  /** Opens the dialog for a decision. */
  async show(claimId: string, seq: number) {
    this.open = true;
    this.explanation = null;
    this.problem = null;
    this.replay = null;
    this.replayProblem = '';
    this.target = { claimId, seq };
    try {
      this.explanation = await unwrap(this.api.GET('/v1/claims/{claimId}/decisions/{seq}/explanation', { params: { path: { claimId, seq } } }));
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  /** Recalculates the decision from its stored evidence. Nothing is stored or booked. */
  private async recalculate() {
    if (!this.target) return;
    this.replaying = true;
    this.replayProblem = '';
    const { data, error } = await this.api.POST('/v1/claims/{claimId}/decisions/{seq}/replays', { params: { path: this.target } });
    this.replaying = false;
    if (data) this.replay = data;
    else this.replayProblem = (error as { title?: string } | undefined)?.title ?? msg('Something went wrong.', { id: 'common.error' });
  }

  private replayView() {
    const r = this.replay;
    if (!r) return nothing;
    const show = (v: unknown) => (v === undefined ? '–' : JSON.stringify(v));
    switch (r.status) {
      case 'identical':
        return html`<wa-callout variant="success" role="status"
          >${msg('The same result. The stored evidence gives the decision again, with the engine', { id: 'replay.identical' })} <code>${r.replayedWith.engineVersion}</code>.</wa-callout
        >`;
      case 'model_unavailable':
        return html`<wa-callout variant="warning" role="status"
          >${msg('This engine no longer has the calculation model the decision was made with:', { id: 'replay.unavailable' })} <code>${r.calculationModel}</code>.</wa-callout
        >`;
      default:
        return html`<wa-callout variant="warning" role="status">
          <p>${msg('The result differs from the stored decision.', { id: 'replay.different' })}</p>
          <ul>
            ${r.differences.map((d) => html`<li><code>${d.path}</code>: ${show(d.stored)} → ${show(d.replayed)}</li>`)}
          </ul>
        </wa-callout>`;
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
            ${e.steps.length ? html`<h4>${msg('The calculation', { id: 'explain.steps' })}</h4><ol>${e.steps.map((s) => html`<li>${s.message ?? s.reason}</li>`)}</ol>` : nothing}
            <div class="replay">
              <p>${msg('Calculate the decision again from its stored evidence, to show it gives the same result. Nothing is stored.', { id: 'replay.how' })}</p>
              <wa-button size="small" appearance="outlined" ?loading=${this.replaying} @click=${() => this.recalculate()}>${msg('Recalculate from the evidence', { id: 'replay.button' })}</wa-button>
              ${this.replayProblem ? html`<wa-callout variant="danger" role="alert">${this.replayProblem}</wa-callout>` : nothing}
              ${this.replayView()}
            </div>`
        : nothing}
    </wa-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-explanation-dialog': ExplanationDialog;
  }
}
