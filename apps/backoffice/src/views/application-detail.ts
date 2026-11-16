/** <pv-application-detail>: an application with its answers and the rules' checks, and a person's decision (ADR 0031). */
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
import '@awesome.me/webawesome/dist/components/radio-group/radio-group.js';
import '@awesome.me/webawesome/dist/components/radio/radio.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { applicationDecisionProblems, mayUnderwrite, mayWithdraw } from '../policy-logic.ts';
import { navigate } from '../router.ts';
import { applicationStatusLabel, problemLabel } from './labels.ts';

type Application = components['schemas']['Application'];
type Check = Application['underwriting']['result']['checks'][number];
type Answer = components['schemas']['UnderwritingAnswer'];
const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-application-detail')
export class ApplicationDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'application-id' }) applicationId = '';
  @state() private application: Application | null = null;
  @state() private problem: Problem | null = null;
  @state() private notice: Notice | null = null;
  @state() private outcome: 'accept' | 'decline' = 'accept';
  @state() private note = '';
  @state() private reason = '';
  @state() private startDate = '';
  @state() private withdrawReason = '';
  @state() private shown: string[] = [];
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
      margin: 0;
    }
    dt {
      color: var(--wa-color-text-quiet);
    }
    dd {
      margin: 0;
    }
    form {
      display: grid;
      gap: var(--wa-space-m);
    }
  `;

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('applicationId') || changed.has('api')) void this.load();
  }

  private async load() {
    this.problem = null;
    try {
      this.application = await unwrap(this.api.GET('/v1/applications/{applicationId}', { params: { path: { applicationId: this.applicationId } } }));
      this.reason = this.application.underwriting.result.reasons[0] ?? '';
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  render() {
    const back = html`<wa-button appearance="plain" size="small" @click=${() => navigate('/applications')}
      ><wa-icon slot="start" name="arrow-left"></wa-icon>${msg('Back', { id: 'common.back' })}</wa-button
    >`;
    if (this.problem) {
      const text = this.problem.status === 404 ? msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' }) : this.problem.title;
      return html`${back}<wa-callout variant=${this.problem.status === 404 ? 'neutral' : 'danger'}>${text}</wa-callout>`;
    }
    const a = this.application;
    if (!a) return html`${back}<wa-spinner></wa-spinner>`;
    const lang = getLocale();
    const u = a.underwriting;
    return html`
      ${back}
      <div class="head">
        <h2>${msg('Application', { id: 'application.title' })} ${a.id}</h2>
        <wa-badge variant=${a.status === 'referred' ? 'warning' : a.status === 'accepted' ? 'success' : 'neutral'}>${applicationStatusLabel(a.status)}</wa-badge>
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
            <dd>${a.animalId}, ${u.input.species}${u.input.breed ? ` (${u.input.breed})` : ''}, ${msg('born', { id: 'application.born' })} ${formatDate(u.input.birthDate, lang)}</dd>
            <dt>${msg('Policyholder', { id: 'policy.holder' })}</dt>
            <dd>${a.policyholderPartyId}</dd>
            <dt>${msg('Product', { id: 'policy.product' })}</dt>
            <dd>${a.productVersion}</dd>
            <dt>${msg('Starts', { id: 'application.starts' })}</dt>
            <dd>${formatDate(a.startDate, lang)}</dd>
            <dt>${msg('Premium', { id: 'policy.premium' })}</dt>
            <dd>${formatMoney(a.premium.amount, a.premium.currency, lang)}</dd>
            <dt>${msg('Received', { id: 'claims.col.received' })}</dt>
            <dd>${formatDateTime(a.receivedAt, lang)}</dd>
            ${a.deadline ? html`<dt>${msg('Decide by', { id: 'application.deadline' })}</dt><dd>${formatDate(a.deadline, lang)}</dd>` : nothing}
            ${a.policyId
              ? html`<dt>${msg('Policy', { id: 'claims.col.policy' })}</dt>
                  <dd><a href="/policies/${a.policyId}" @click=${(e: Event) => (e.preventDefault(), navigate(`/policies/${a.policyId}`))}>${a.policyId}</a></dd>`
              : nothing}
            ${a.decision
              ? html`<dt>${msg('Decision', { id: 'decide.action' })}</dt>
                  <dd>${applicationStatusLabel(a.decision.outcome)}, ${a.decision.decidedBy}${a.decision.note ? `: ${a.decision.note}` : ''}</dd>`
              : nothing}
          </dl>
        </wa-card>
        ${mayUnderwrite(this.me, a) ? this.decisionForm(a) : nothing} ${mayWithdraw(this.me, a) ? this.withdrawForm() : nothing}
        <div class="wide">
          <h3>${msg('Answers', { id: 'application.answers' })}</h3>
          <pv-data-grid .columns=${this.answerColumns()} .rows=${u.input.answers} label=${msg('Answers', { id: 'application.answers' })}></pv-data-grid>
        </div>
        <div class="wide">
          <h3>${msg('The rules', { id: 'application.checks' })} (${u.result.rules ? `${u.result.rules.series}@${u.result.rules.version}` : '–'})</h3>
          <pv-data-grid .columns=${this.checkColumns()} .rows=${u.result.checks} label=${msg('The rules', { id: 'application.checks' })}></pv-data-grid>
        </div>
      </div>
    `;
  }

  private decisionForm(a: Application) {
    const proposed = a.underwriting.result.riders;
    return html`<wa-card>
      <h3 slot="header">${msg('Underwrite', { id: 'application.decide' })}</h3>
      <form @submit=${this.decide}>
        <wa-radio-group label=${msg('Decision', { id: 'decide.action' })} value=${this.outcome} @change=${(e: Event) => (this.outcome = (e.target as HTMLInputElement).value as 'accept' | 'decline')}>
          <wa-radio value="accept">${msg('Accept and issue the policy', { id: 'application.accept' })}</wa-radio>
          <wa-radio value="decline">${msg('Decline', { id: 'application.decline' })}</wa-radio>
        </wa-radio-group>
        ${this.outcome === 'accept' && proposed.length
          ? html`<p>${msg('With the riders the rules propose:', { id: 'application.ridersProposed' })} ${proposed.map((r) => r.description).join('; ')}</p>`
          : nothing}
        ${this.outcome === 'accept'
          ? html`<wa-input
              type="date"
              label=${msg('New start date (optional)', { id: 'application.startDate' })}
              hint=${msg('Needed if the applied start date has passed.', { id: 'application.startDateHint' })}
              .value=${this.startDate}
              @input=${(e: Event) => (this.startDate = (e.target as HTMLInputElement).value)}
            ></wa-input>`
          : html`<wa-input
              label=${msg('Reason code', { id: 'decide.code' })}
              hint=${msg('e.g. ongoing-symptoms', { id: 'application.reasonHint' })}
              .value=${this.reason}
              @input=${(e: Event) => (this.reason = (e.target as HTMLInputElement).value)}
            ></wa-input>`}
        <wa-textarea label=${msg('Grounds', { id: 'application.note' })} rows="3" .value=${this.note} @input=${(e: Event) => (this.note = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
        ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing}
        <wa-button type="submit" variant="brand" ?loading=${this.busy === 'decide'}>${msg('Decide', { id: 'decide.submit' })}</wa-button>
      </form>
    </wa-card>`;
  }

  private withdrawForm() {
    return html`<wa-card>
      <h3 slot="header">${msg('Withdraw', { id: 'application.withdraw' })}</h3>
      <form @submit=${this.withdraw}>
        <p>${msg('For the channel, e.g. when the customer no longer wants the policy.', { id: 'application.withdrawWhy' })}</p>
        <wa-textarea label=${msg('Reason (optional)', { id: 'application.withdrawReason' })} rows="2" .value=${this.withdrawReason} @input=${(e: Event) => (this.withdrawReason = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
        <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'withdraw'}>${msg('Withdraw', { id: 'application.withdraw' })}</wa-button>
      </form>
    </wa-card>`;
  }

  private async decide(e: Event) {
    e.preventDefault();
    this.shown = applicationDecisionProblems({ outcome: this.outcome, note: this.note, reason: this.reason, startDate: this.startDate }, today());
    if (this.shown.length) return;
    this.busy = 'decide';
    const r = await act(
      () =>
        this.api.POST('/v1/applications/{applicationId}/decisions', {
          params: { path: { applicationId: this.applicationId }, header: { 'Idempotency-Key': this.keys.for('decide') } },
          body:
            this.outcome === 'accept'
              ? { outcome: 'accept', note: this.note.trim(), ...(this.startDate ? { startDate: this.startDate } : {}) }
              : { outcome: 'decline', note: this.note.trim(), reason: this.reason.trim() },
        }),
      () =>
        this.outcome === 'accept'
          ? { variant: 'success', text: msg('Accepted. The policy is issued.', { id: 'application.accepted' }) }
          : { variant: 'success', text: msg('Declined. The applicant gets a notice with the reasons.', { id: 'application.declined' }) },
    );
    this.finish('decide', r);
  }

  private async withdraw(e: Event) {
    e.preventDefault();
    this.busy = 'withdraw';
    const r = await act(
      () =>
        this.api.POST('/v1/applications/{applicationId}/withdrawals', {
          params: { path: { applicationId: this.applicationId }, header: { 'Idempotency-Key': this.keys.for('withdraw') } },
          body: this.withdrawReason.trim() ? { reason: this.withdrawReason.trim() } : {},
        }),
      () => ({ variant: 'success', text: msg('Withdrawn.', { id: 'application.withdrawn' }) }),
    );
    this.finish('withdraw', r);
  }

  private finish(key: string, r: { ok: boolean; notice: Notice }) {
    this.busy = '';
    this.notice = r.notice;
    if (r.ok) {
      this.keys.done(key);
      void this.load();
    }
  }

  private answerColumns(): Column<Answer>[] {
    return [
      { key: 'question', header: msg('Question', { id: 'application.question' }), value: (x) => x.question },
      { key: 'value', header: msg('Answer', { id: 'application.answer' }), value: (x) => (x.value ? msg('Yes', { id: 'common.yes' }) : msg('No', { id: 'common.no' })) },
      { key: 'codes', header: msg('Diagnosis', { id: 'claims.col.diagnosis' }), value: (x) => x.diagnosisCodes?.join(', ') ?? '–' },
    ];
  }

  private checkColumns(): Column<Check>[] {
    const variant = (r: string) => (r === 'pass' ? 'success' : r === 'decline' ? 'danger' : r === 'refer' ? 'warning' : 'neutral');
    return [
      { key: 'code', header: msg('Rule', { id: 'claim.rule' }), value: (c) => c.code },
      { key: 'result', header: msg('Result', { id: 'claim.result' }), value: (c) => html`<wa-badge variant=${variant(c.result)}>${c.result}</wa-badge>` },
      { key: 'basis', header: msg('Basis', { id: 'application.basis' }), value: (c) => (c.basis === undefined ? '–' : String(c.basis)) },
      { key: 'reason', header: msg('Reason', { id: 'claim.reason' }), value: (c) => c.reason ?? '–' },
    ];
  }
}
