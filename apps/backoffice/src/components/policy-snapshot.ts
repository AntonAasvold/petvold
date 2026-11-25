/**
 * <pv-policy-snapshot>: the policy as the claims engine sees it on a day, as it
 * was known at a time (ADR 0006): the version, its status, the product and
 * terms, and the riders. For a question like "what did we know when the claim
 * was decided?".
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import type { Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { formatDate, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { deductibleParts, snapshotQuery } from '../snapshot-logic.ts';
import { pvComponents } from '../styles/pv-components.ts';

type Snapshot = components['schemas']['PolicySnapshot'];

const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-policy-snapshot')
export class PolicySnapshot extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: 'policy-id' }) policyId = '';
  @state() private date = today();
  @state() private knownAt = '';
  @state() private snapshot: Snapshot | null = null;
  @state() private problem = '';
  @state() private busy = false;

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
      form {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .pv-card__body p {
        margin: 0;
      }
      ul {
        margin: 0;
        padding-inline-start: var(--space-5);
      }
    `,
  ];

  private async look(e: Event) {
    e.preventDefault();
    const q = snapshotQuery(this.date, this.knownAt);
    this.snapshot = null;
    if (q === 'date') return void (this.problem = msg('Give a day.', { id: 'snapshot.dateProblem' }));
    if (q === 'knownAt') return void (this.problem = msg('Give a time, or leave it empty for now.', { id: 'snapshot.knownAtProblem' }));
    this.busy = true;
    const { data, response } = await this.api.GET('/v1/policies/{policyId}/snapshot', { params: { path: { policyId: this.policyId }, query: q } });
    this.busy = false;
    this.problem = data
      ? ''
      : response.status === 404
        ? msg('The policy was not in force that day, as it was known then.', { id: 'snapshot.none' })
        : msg('Something went wrong.', { id: 'common.error' });
    this.snapshot = data ?? null;
  }

  private perText(per: string, days?: number) {
    switch (per) {
      case 'period':
        return `${msg('per period of', { id: 'snapshot.perPeriod' })} ${days} ${msg('days', { id: 'snapshot.days' })}`;
      case 'claim':
        return msg('per claim', { id: 'snapshot.perClaim' });
      default:
        return msg('per policy year', { id: 'snapshot.perYear' });
    }
  }

  private view(s: Snapshot) {
    const lang = getLocale();
    const row = (label: string, v: unknown, mono = false) => html`<div class="pv-dl__row"><dt>${label}</dt><dd class=${mono ? 'pv-mono' : ''}>${v}</dd></div>`;
    const d = s.vetCare ? deductibleParts(s.vetCare.deductible) : null;
    return html`<dl class="pv-dl">
        ${row(msg('Status', { id: 'claims.col.status' }), s.status === 'active' ? msg('Active', { id: 'snapshot.active' }) : msg('Cancelled', { id: 'snapshot.cancelled' }))}
        ${row(msg('Version', { id: 'accounting.version' }), s.policyVersionId, true)}
        ${row(msg('In force', { id: 'snapshot.validity' }), `${formatDate(s.validFrom, lang)} – ${s.validTo ? formatDate(s.validTo, lang) : '…'}`)}
        ${row(msg('Product version', { id: 'snapshot.product' }), s.productVersion, true)}
        ${row(msg('Policy year', { id: 'snapshot.policyYear' }), `${formatDate(s.policyYearStart, lang)} – ${formatDate(s.policyYearEnd, lang)}`)}
        ${row(msg('First day, the waiting period counts from', { id: 'snapshot.inception' }), formatDate(s.inceptionDate, lang))}
        ${s.vetCare
          ? html`${row(msg('Annual limit', { id: 'snapshot.annualLimit' }), formatMoney(s.vetCare.annualLimit, s.currency, lang))}
            ${row(msg('Deductible', { id: 'snapshot.deductible' }), `${formatMoney(d!.fixed, s.currency, lang)} ${this.perText(d!.per, d!.periodDays)}, ${d!.variablePercent} %`)}
            ${row(msg('Waiting period', { id: 'snapshot.waiting' }), `${s.vetCare.waitingPeriodDays} ${msg('days', { id: 'snapshot.days' })}`)}`
          : nothing}
      </dl>
      ${s.riders.length
        ? html`<p>${msg('Riders', { id: 'policy.riders' })}:</p>
            <ul>
              ${s.riders.map((r) => html`<li>${r.description} <span class="pv-mono">${r.diagnosisCodes.join(', ')}</span></li>`)}
            </ul>`
        : html`<p>${msg('No riders.', { id: 'policy.noRiders' })}</p>`}`;
  }

  render() {
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    return html`<section class="pv-card" aria-labelledby="snapshot">
      <div class="pv-card__head"><h2 class="pv-card__title" id="snapshot">${msg('The policy on a day', { id: 'snapshot.title' })}</h2></div>
      <div class="pv-card__body">
        <form @submit=${(e: Event) => this.look(e)} novalidate>
          <p>${msg('What the claims engine sees on the day, as it was known at the time. Empty: as known now.', { id: 'snapshot.how' })}</p>
          <wa-input type="date" label=${msg('Day', { id: 'accounting.day' })} .value=${this.date} @input=${(e: Event) => (this.date = value(e))}></wa-input>
          <wa-input type="datetime-local" label=${msg('Known at (optional)', { id: 'snapshot.knownAt' })} .value=${this.knownAt} @input=${(e: Event) => (this.knownAt = value(e))}></wa-input>
          <wa-button type="submit" appearance="outlined" ?loading=${this.busy}>${msg('Show', { id: 'snapshot.show' })}</wa-button>
        </form>
        ${this.problem ? html`<wa-callout variant="neutral" role="status">${this.problem}</wa-callout>` : nothing}
        ${this.snapshot ? this.view(this.snapshot) : nothing}
      </div>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-policy-snapshot': PolicySnapshot;
  }
}
