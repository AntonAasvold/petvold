/** <pv-policy-detail>: a policy with its terms, riders, versions over time, history and proposals. */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { mayAnswerProposal, versionOn } from '../policy-logic.ts';
import { navigate } from '../router.ts';
import { policyStatusLabel, proposalKindLabel, transactionLabel } from './labels.ts';

type Policy = components['schemas']['PolicyRecord'];
type Term = components['schemas']['PolicyTerm'];
type Version = components['schemas']['PolicyVersion'];
type Transaction = components['schemas']['PolicyTransaction'];
type Rider = components['schemas']['Rider'];
type Proposal = components['schemas']['PolicyProposal'];

@customElement('pv-policy-detail')
export class PolicyDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'policy-id' }) policyId = '';
  @state() private policy: Policy | null = null;
  @state() private history: { versions: Version[]; transactions: Transaction[] } | null = null;
  @state() private proposals: Proposal[] = [];
  @state() private problem: Problem | null = null;
  @state() private notice: Notice | null = null;
  @state() private channel = 'phone';
  @state() private rejectReason = '';
  @state() private busy = '';
  private keys = new IdempotencyKeys();

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
    .wide {
      grid-column: 1 / -1;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--wa-space-2xs) var(--wa-space-m);
      margin: 0 0 var(--wa-space-m);
    }
    dt {
      color: var(--wa-color-text-quiet);
    }
    dd {
      margin: 0;
    }
    form {
      display: grid;
      gap: var(--wa-space-s);
      margin-top: var(--wa-space-s);
    }
  `;

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('policyId') || changed.has('api')) void this.load();
  }

  private async load() {
    this.problem = null;
    const path = { params: { path: { policyId: this.policyId } } };
    try {
      const [policy, history, proposals] = await Promise.all([
        unwrap(this.api.GET('/v1/policies/{policyId}', path)),
        unwrap(this.api.GET('/v1/policies/{policyId}/history', path)),
        unwrap(this.api.GET('/v1/policy-proposals', { params: { query: { policyId: this.policyId } } })),
      ]);
      this.policy = policy;
      this.history = history;
      this.proposals = proposals.items;
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  render() {
    const back = html`<wa-button appearance="plain" size="small" @click=${() => navigate('/policies')}
      ><wa-icon slot="start" name="arrow-left"></wa-icon>${msg('Back', { id: 'common.back' })}</wa-button
    >`;
    if (this.problem) {
      const text = this.problem.status === 404 ? msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' }) : this.problem.title;
      return html`${back}<wa-callout variant=${this.problem.status === 404 ? 'neutral' : 'danger'}>${text}</wa-callout>`;
    }
    const p = this.policy;
    if (!p || !this.history) return html`${back}<wa-spinner></wa-spinner>`;
    const lang = getLocale();
    const current = versionOn(p.versions, new Date().toISOString().slice(0, 10));
    const riders = p.terms.flatMap((t) => t.riders);
    return html`
      ${back}
      <div class="head">
        <h2>${msg('Policy', { id: 'claims.col.policy' })} ${p.id}</h2>
        ${current ? html`<wa-badge variant=${current.status === 'active' ? 'success' : 'neutral'}>${policyStatusLabel(current.status)}</wa-badge>` : nothing}
        ${this.me?.permissions.includes('claims:register')
          ? html`<wa-button size="small" appearance="outlined" @click=${() => navigate(`/claims/new?policy=${encodeURIComponent(p.id)}`)}
              ><wa-icon slot="start" name="plus"></wa-icon>${msg('Register a claim', { id: 'register.title' })}</wa-button
            >`
          : nothing}
      </div>
      ${this.notice
        ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}
            >${this.notice.text}
            ${this.notice.reload ? html`<wa-button size="small" appearance="outlined" @click=${() => this.load()}>${msg('Reload', { id: 'common.reload' })}</wa-button>` : nothing}</wa-callout
          >`
        : nothing}
      <div class="cards">
        <wa-card>
          <h3 slot="header">${msg('Details', { id: 'claim.facts' })}</h3>
          <dl>
            <dt>${msg('Animal', { id: 'policy.animal' })}</dt>
            <dd>${p.animalId}</dd>
            <dt>${msg('Policyholder', { id: 'policy.holder' })}</dt>
            <dd>${current?.policyholderPartyId ?? '–'}</dd>
            <dt>${msg('Market', { id: 'policy.market' })}</dt>
            <dd>${p.market}</dd>
            <dt>${msg('Since', { id: 'policy.since' })}</dt>
            <dd>${formatDate(p.inceptionDate, lang)}</dd>
          </dl>
        </wa-card>
        ${this.proposals.map((pr) => this.proposalCard(pr))}
        <div class="wide">
          <h3>${msg('Terms', { id: 'policy.terms' })}</h3>
          <pv-data-grid .columns=${this.termColumns()} .rows=${p.terms} label=${msg('Terms', { id: 'policy.terms' })}></pv-data-grid>
        </div>
        <div class="wide">
          <h3>${msg('Riders', { id: 'policy.riders' })}</h3>
          <pv-data-grid
            .columns=${this.riderColumns()}
            .rows=${riders}
            label=${msg('Riders', { id: 'policy.riders' })}
            empty-text=${msg('No riders.', { id: 'policy.noRiders' })}
          ></pv-data-grid>
        </div>
        <div class="wide">
          <h3>${msg('Versions over time', { id: 'policy.versions' })}</h3>
          <pv-data-grid .columns=${this.versionColumns()} .rows=${this.history.versions} label=${msg('Versions over time', { id: 'policy.versions' })}></pv-data-grid>
        </div>
        <div class="wide">
          <h3>${msg('History', { id: 'policy.history' })}</h3>
          <pv-data-grid .columns=${this.transactionColumns()} .rows=${this.history.transactions} label=${msg('History', { id: 'policy.history' })}></pv-data-grid>
        </div>
      </div>
    `;
  }

  private proposalCard(pr: Proposal) {
    const lang = getLocale();
    const d = pr.details;
    return html`<wa-card>
      <h3 slot="header">${proposalKindLabel(pr.kind)}</h3>
      <dl>
        ${d.fromPartyId ? html`<dt>${msg('From', { id: 'proposal.from' })}</dt><dd>${d.fromPartyId}</dd>` : nothing}
        ${d.toPartyId ? html`<dt>${msg('To', { id: 'proposal.to' })}</dt><dd>${d.toPartyId}</dd>` : nothing}
        ${d.from ? html`<dt>${msg('From the day', { id: 'proposal.fromDay' })}</dt><dd>${formatDate(d.from, lang)}</dd>` : nothing}
        ${d.deceasedOn ? html`<dt>${msg('Died', { id: 'proposal.died' })}</dt><dd>${formatDate(d.deceasedOn, lang)}</dd>` : nothing}
        ${pr.deadline ? html`<dt>${msg('Answer by', { id: 'proposal.deadline' })}</dt><dd>${formatDate(pr.deadline, lang)}</dd>` : nothing}
        ${pr.decision
          ? html`<dt>${msg('Decision', { id: 'decide.action' })}</dt><dd>${pr.decision.outcome}, ${pr.decision.decidedBy}, ${formatDateTime(pr.decision.decidedAt, lang)}</dd>`
          : nothing}
      </dl>
      ${mayAnswerProposal(this.me, pr)
        ? html`<form @submit=${(e: Event) => this.accept(e, pr)}>
              ${pr.kind === 'transfer'
                ? html`<wa-input
                    label=${msg('Where the new owner accepted', { id: 'proposal.channel' })}
                    hint=${msg('e.g. phone, web or paper', { id: 'proposal.channelHint' })}
                    .value=${this.channel}
                    @input=${(e: Event) => (this.channel = (e.target as HTMLInputElement).value)}
                  ></wa-input>`
                : nothing}
              <wa-button type="submit" variant="brand" ?loading=${this.busy === `accept:${pr.id}`}>${msg('Accept', { id: 'proposal.accept' })}</wa-button>
            </form>
            <form @submit=${(e: Event) => this.reject(e, pr)}>
              <wa-textarea label=${msg('Why it is rejected', { id: 'proposal.rejectReason' })} rows="2" .value=${this.rejectReason} @input=${(e: Event) => (this.rejectReason = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
              <wa-button type="submit" appearance="outlined" ?loading=${this.busy === `reject:${pr.id}`}>${msg('Reject', { id: 'proposal.reject' })}</wa-button>
            </form>`
        : nothing}
    </wa-card>`;
  }

  private async accept(e: Event, pr: Proposal) {
    e.preventDefault();
    const key = `accept:${pr.id}`;
    this.busy = key;
    const r = await act(
      () =>
        this.api.POST('/v1/policy-proposals/{proposalId}/acceptances', {
          params: { path: { proposalId: pr.id }, header: { 'Idempotency-Key': this.keys.for(key) } },
          body: { channel: this.channel.trim() || 'phone' },
        }),
      () => ({ variant: 'success', text: msg('Accepted.', { id: 'proposal.accepted' }) }),
    );
    this.finish(key, r);
  }

  private async reject(e: Event, pr: Proposal) {
    e.preventDefault();
    if (!this.rejectReason.trim()) {
      this.notice = { variant: 'danger', text: msg('Write a reason.', { id: 'decide.needReason' }) };
      return;
    }
    const key = `reject:${pr.id}`;
    this.busy = key;
    const r = await act(
      () =>
        this.api.POST('/v1/policy-proposals/{proposalId}/rejections', {
          params: { path: { proposalId: pr.id }, header: { 'Idempotency-Key': this.keys.for(key) } },
          body: { reason: this.rejectReason.trim() },
        }),
      () => ({ variant: 'success', text: msg('Rejected.', { id: 'proposal.rejected' }) }),
    );
    this.finish(key, r);
  }

  private finish(key: string, r: { ok: boolean; notice: Notice }) {
    this.busy = '';
    this.notice = r.notice;
    if (r.ok) {
      this.keys.done(key);
      void this.load();
    }
  }

  private termColumns(): Column<Term>[] {
    const lang = getLocale();
    return [
      { key: 'termNo', header: '#', value: (t) => t.termNo },
      { key: 'period', header: msg('Period', { id: 'policy.period' }), value: (t) => `${formatDate(t.startDate, lang)} – ${formatDate(t.endDate, lang)}` },
      { key: 'product', header: msg('Product', { id: 'policy.product' }), value: (t) => t.productVersion },
      { key: 'limit', header: msg('Annual limit', { id: 'policy.annualLimit' }), align: 'end', value: (t) => formatMoney(t.vetCare.annualLimit, t.currency, lang) },
      { key: 'deductible', header: msg('Deductible', { id: 'policy.deductible' }), value: (t) => t.deductibleOption },
      { key: 'premium', header: msg('Premium', { id: 'policy.premium' }), align: 'end', value: (t) => formatMoney(t.premium, t.currency, lang) },
    ];
  }

  private riderColumns(): Column<Rider>[] {
    const lang = getLocale();
    return [
      { key: 'description', header: msg('Rider', { id: 'policy.rider' }), value: (r) => r.description },
      { key: 'codes', header: msg('Diagnosis', { id: 'claims.col.diagnosis' }), value: (r) => r.diagnosisCodes.join(', ') },
      { key: 'from', header: msg('From the day', { id: 'proposal.fromDay' }), value: (r) => formatDate(r.validFrom, lang) },
      { key: 'source', header: msg('Source', { id: 'policy.source' }), value: (r) => r.applicationId ?? r.source ?? '–' },
    ];
  }

  private versionColumns(): Column<Version>[] {
    const lang = getLocale();
    return [
      { key: 'valid', header: msg('Valid', { id: 'policy.valid' }), value: (v) => `${formatDate(v.validFrom, lang)} – ${formatDate(v.validTo, lang)}` },
      { key: 'holder', header: msg('Policyholder', { id: 'policy.holder' }), value: (v) => v.policyholderPartyId },
      { key: 'status', header: msg('Status', { id: 'claims.col.status' }), value: (v) => policyStatusLabel(v.status) },
      { key: 'known', header: msg('Known from', { id: 'policy.knownFrom' }), value: (v) => formatDateTime(v.sysFrom, lang) },
      { key: 'superseded', header: msg('Superseded', { id: 'policy.superseded' }), value: (v) => (v.sysTo ? formatDateTime(v.sysTo, lang) : '–') },
    ];
  }

  private transactionColumns(): Column<Transaction>[] {
    const lang = getLocale();
    return [
      { key: 'type', header: msg('Change', { id: 'policy.change' }), value: (t) => transactionLabel(t.type) },
      { key: 'by', header: msg('By', { id: 'policy.by' }), value: (t) => t.requestedBy },
      { key: 'at', header: msg('When', { id: 'policy.when' }), value: (t) => formatDateTime(t.requestedAt, lang) },
      { key: 'note', header: msg('Note', { id: 'policy.note' }), value: (t) => t.steps.at(-1)?.note ?? t.cancellation?.reason ?? '–' },
    ];
  }
}
