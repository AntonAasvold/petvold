/** <pv-claim-detail>: a claim with its assessment, calculation and decisions. Read only in step 1. */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { navigate } from '../router.ts';
import { channelLabel, claimStatusLabel, outcomeLabel, ruleStatusLabel, statusVariant } from './labels.ts';
import '../components/claim-actions.ts';
import '../components/explanation-dialog.ts';
import { claimStatus } from '../decide.ts';
import type { Me } from '../permissions.ts';

type Claim = components['schemas']['Claim'];
type Assessment = components['schemas']['Assessment'];
type Decision = components['schemas']['Decision'];
type RuleResult = components['schemas']['RuleResult'];
type Proposal = components['schemas']['DecisionProposal'];
type ReviewRequest = components['schemas']['ReviewRequest'];

@customElement('pv-claim-detail')
export class ClaimDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'claim-id' }) claimId = '';
  @state() private proposals: Proposal[] = [];
  @state() private reviews: ReviewRequest[] = [];
  @state() private claim: Claim | null = null;
  @state() private assessment: Assessment | null = null;
  @state() private decisions: Decision[] = [];
  @state() private problem: Problem | null = null;

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    .head {
      display: flex;
      align-items: center;
      gap: var(--wa-space-m);
    }
    .head h2 {
      margin: 0;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
      gap: var(--wa-space-l);
      margin-top: var(--wa-space-l);
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--wa-space-2xs) var(--wa-space-m);
      margin: 0;
    }
    dt {
      color: var(--wa-color-text-quiet);
    }
    dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
    .wide {
      grid-column: 1 / -1;
    }
    pv-claim-actions {
      margin-top: var(--wa-space-l);
    }
  `;

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('claimId') || changed.has('api')) void this.load();
  }

  private async load() {
    this.problem = null;
    const path = { params: { path: { claimId: this.claimId } } };
    try {
      const [claim, assessment, decisions, proposals, reviews] = await Promise.all([
        unwrap(this.api.GET('/v1/claims/{claimId}', path)),
        unwrap(this.api.GET('/v1/claims/{claimId}/assessment', path)),
        unwrap(this.api.GET('/v1/claims/{claimId}/decisions', path)),
        unwrap(this.api.GET('/v1/claims/{claimId}/proposals', path)),
        unwrap(this.api.GET('/v1/claims/{claimId}/review-requests', path)),
      ]);
      this.claim = claim;
      this.assessment = assessment;
      this.decisions = decisions.items;
      this.proposals = proposals.items;
      this.reviews = reviews.items;
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  render() {
    const back = html`<wa-button appearance="plain" size="small" @click=${() => navigate('/claims')}
      ><wa-icon slot="start" name="arrow-left"></wa-icon>${msg('Back', { id: 'common.back' })}</wa-button
    >`;
    if (this.problem) {
      const text =
        this.problem.status === 404
          ? msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' })
          : this.problem.status === 403
            ? msg('You are not permitted to do this.', { id: 'common.forbidden' })
            : this.problem.title;
      return html`${back}<wa-callout variant=${this.problem.status === 404 || this.problem.status === 403 ? 'neutral' : 'danger'}>${text}</wa-callout>`;
    }
    if (!this.claim || !this.assessment) return html`${back}<wa-spinner></wa-spinner>`;
    const c = this.claim;
    const a = this.assessment;
    const lang = getLocale();
    const money = (m: number) => formatMoney(m, c.currency, lang);
    const status = claimStatus({
      openProposals: this.proposals.filter((p) => p.status === 'open').length,
      openReviews: this.reviews.filter((r) => !r.closedAt).length,
      decisions: this.decisions.length,
    });
    return html`
      ${back}
      <div class="head">
        <h2>${msg('Claim', { id: 'claim.title' })} ${c.claimNo}</h2>
        <wa-badge variant="neutral">${c.id}</wa-badge>
        <wa-badge variant=${statusVariant(status)}>${claimStatusLabel(status)}</wa-badge>
      </div>
      <pv-claim-actions
        .api=${this.api}
        .me=${this.me}
        claim-id=${c.id}
        currency=${c.currency}
        status=${status}
        .assessment=${a}
        .decisions=${this.decisions}
        .proposals=${this.proposals}
        .reviews=${this.reviews}
        @pv-changed=${() => this.load()}
      ></pv-claim-actions>
      <pv-explanation-dialog .api=${this.api}></pv-explanation-dialog>
      <div class="cards">
        <wa-card>
          <h3 slot="header">${msg('Details', { id: 'claim.facts' })}</h3>
          <dl>
            <dt>${msg('Policy', { id: 'claims.col.policy' })}</dt>
            <dd>${c.policyId}</dd>
            <dt>${msg('Channel', { id: 'claims.col.channel' })}</dt>
            <dd>${channelLabel(c.channel)}</dd>
            <dt>${msg('Treatment from', { id: 'claims.col.treatment' })}</dt>
            <dd>${formatDate(c.treatmentFrom, lang)} – ${formatDate(c.treatmentTo, lang)}</dd>
            <dt>${msg('Diagnosis', { id: 'claims.col.diagnosis' })}</dt>
            <dd>${c.diagnosisCode}${a.diagnosisGroup ? ` (${a.diagnosisGroup})` : ''}</dd>
            <dt>${msg('Received', { id: 'claims.col.received' })}</dt>
            <dd>${formatDateTime(c.receivedAt, lang)}</dd>
          </dl>
        </wa-card>
        <wa-card>
          <h3 slot="header">${msg('Calculation', { id: 'claim.calculation' })}</h3>
          ${a.calculation
            ? html`<dl>
                <dt>${msg('Billed', { id: 'calc.billed' })}</dt>
                <dd>${money(a.calculation.billed)}</dd>
                <dt>${msg('Not reimbursed', { id: 'calc.nonReimbursable' })}</dt>
                <dd>${money(a.calculation.nonReimbursable)}</dd>
                <dt>${msg('Fixed deductible', { id: 'calc.deductibleFixed' })}</dt>
                <dd>${money(a.calculation.deductibleFixed)}</dd>
                <dt>${msg('Variable deductible', { id: 'calc.deductibleVariable' })}</dt>
                <dd>${money(a.calculation.deductibleVariable)}</dd>
                <dt>${msg('Left of the annual limit', { id: 'calc.remainingBefore' })}</dt>
                <dd>${money(a.calculation.remainingBefore)}</dd>
                <dt><strong>${msg('Payout', { id: 'calc.payout' })}</strong></dt>
                <dd><strong>${money(a.calculation.payout)}</strong></dd>
                <dt>${msg('The customer pays', { id: 'calc.customerShare' })}</dt>
                <dd>${money(a.calculation.customerShare)}</dd>
              </dl>`
            : nothing}
          <p>
            ${msg('Proposal', { id: 'claim.proposed' })}: <strong>${outcomeLabel(a.proposedOutcome)}</strong> ·
            ${a.mode === 'auto' ? msg('May be settled automatically', { id: 'claim.mode.auto' }) : msg('Needs a claims handler', { id: 'claim.mode.manual' })}
          </p>
        </wa-card>
        <div class="wide">
          <h3>${msg('Assessment', { id: 'claim.assessment' })}</h3>
          <pv-data-grid .columns=${this.ruleColumns()} .rows=${a.rules} label=${msg('Assessment', { id: 'claim.assessment' })}></pv-data-grid>
        </div>
        <div class="wide">
          <h3>${msg('Decisions', { id: 'claim.decisions' })}</h3>
          <pv-data-grid
            .columns=${this.decisionColumns()}
            .rows=${this.decisions}
            label=${msg('Decisions', { id: 'claim.decisions' })}
            empty-text=${msg('No decisions yet.', { id: 'claim.noDecisions' })}
          ></pv-data-grid>
        </div>
      </div>
    `;
  }

  private ruleColumns(): Column<RuleResult>[] {
    const variant = (s: string) => (s === 'pass' ? 'success' : s === 'fail' ? 'danger' : s === 'review' ? 'warning' : 'neutral');
    return [
      { key: 'code', header: msg('Rule', { id: 'claim.rule' }), value: (r) => r.code },
      { key: 'status', header: msg('Result', { id: 'claim.result' }), value: (r) => html`<wa-badge variant=${variant(r.status)}>${ruleStatusLabel(r.status)}</wa-badge>` },
      { key: 'message', header: msg('Reason', { id: 'claim.reason' }), value: (r) => r.message ?? r.reason },
    ];
  }

  private decisionColumns(): Column<Decision>[] {
    const lang = getLocale();
    return [
      { key: 'seq', header: '#', value: (d) => d.seq },
      { key: 'outcome', header: msg('Result', { id: 'claim.result' }), value: (d) => outcomeLabel(d.outcome) },
      { key: 'payout', header: msg('Payout', { id: 'calc.payout' }), align: 'end', value: (d) => formatMoney(d.payout, this.claim!.currency, lang) },
      { key: 'decidedBy', header: msg('Decided by', { id: 'claim.decidedBy' }), value: (d) => (d.automated ? msg('Automatic', { id: 'claim.automated' }) : d.decidedBy) },
      { key: 'decidedAt', header: msg('Decided', { id: 'claim.decidedAt' }), value: (d) => formatDateTime(d.decidedAt, lang) },
      {
        key: 'why',
        header: msg('Explanation', { id: 'claim.explanation' }),
        value: (d) =>
          html`<wa-button size="small" appearance="plain" @click=${(e: Event) => (e.stopPropagation(), this.explain(d.seq))}>${msg('Why?', { id: 'claim.why' })}</wa-button>`,
      },
    ];
  }

  private explain(seq: number) {
    void this.renderRoot.querySelector('pv-explanation-dialog')?.show(this.claimId, seq);
  }
}
