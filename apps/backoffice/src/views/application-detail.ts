/**
 * <pv-application-detail>: an application as the design system lays out a
 * detail page (docs/teknik/designsystem.md, "Detaljsidan"): the rules' checks
 * and the answers beside a person's decision and the history (ADR 0031).
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
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
import '../components/event-log.ts';
import type { LogEntry } from '../components/event-log.ts';
import { pvComponents } from '../styles/pv-components.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { applicationDecisionProblems, mayUnderwrite, mayWithdraw, partyName } from '../policy-logic.ts';
import { navigate } from '../router.ts';
import { applicationStatusLabel, problemLabel } from './labels.ts';

type Application = components['schemas']['Application'];
type Check = Application['underwriting']['result']['checks'][number];
type Answer = components['schemas']['UnderwritingAnswer'];
type Animal = components['schemas']['Animal'];
type Party = components['schemas']['Party'];
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
  @state() private animal: Animal | null = null;
  @state() private holder: Party | null = null;
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
      a {
        color: var(--ink);
      }
      .title {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-3);
        margin: var(--space-2) 0 var(--space-3);
      }
      h1 {
        margin: 0;
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
      }
      .facts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-6);
        margin: 0 0 var(--space-8);
        padding: 0;
        list-style: none;
        font-size: 14px;
        color: var(--text-secondary);
      }
      .facts strong {
        color: var(--ink);
        font-weight: 600;
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
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      .pv-dl__row dd {
        font-variant-numeric: tabular-nums;
      }
      .pv-card__body p {
        margin: 0;
      }
      form {
        display: grid;
        gap: var(--space-4);
      }
      fieldset {
        display: grid;
        gap: var(--space-3);
        margin: 0;
        padding: 0;
        border: 0;
      }
      legend {
        padding: 0 0 var(--space-2);
        font: 500 13px/1.4 var(--font-sans);
        color: var(--text-secondary);
      }
      .pv-choice:focus-within {
        outline: var(--border-strong) solid var(--focus);
        outline-offset: 2px;
      }
      @media (max-width: 900px) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

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
      return;
    }
    void this.loadWho();
  }

  /** The animal and the applicant by name, for the head. A missing permission only leaves the ids. */
  private async loadWho() {
    const a = this.application!;
    const [animal, holder] = await Promise.all([
      this.api.GET('/v1/animals/{animalId}', { params: { path: { animalId: a.animalId } } }).then((r) => r.data ?? null, () => null),
      this.api.GET('/v1/parties/{partyId}', { params: { path: { partyId: a.policyholderPartyId } } }).then((r) => r.data ?? null, () => null),
    ]);
    this.animal = animal;
    this.holder = holder;
  }

  render() {
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/applications" @click=${(e: Event) => (e.preventDefault(), navigate('/applications'))}>${msg('Applications', { id: 'nav.applications' })}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${this.applicationId}</span>
    </nav>`;
    if (this.problem) {
      const text = this.problem.status === 404 ? msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' }) : this.problem.title;
      return html`${crumbs}<wa-callout variant=${this.problem.status === 404 ? 'neutral' : 'danger'}>${text}</wa-callout>`;
    }
    const a = this.application;
    if (!a) return html`${crumbs}<wa-spinner></wa-spinner>`;
    const lang = getLocale();
    const u = a.underwriting;
    const link = (href: string, text: string) => html`<a href=${href} @click=${(e: Event) => (e.preventDefault(), navigate(href))}><strong>${text}</strong></a>`;
    const row = (label: string, value: unknown, mono = false) => html`<div class="pv-dl__row"><dt>${label}</dt><dd class=${mono ? 'pv-mono' : ''}>${value}</dd></div>`;
    const decided = a.status !== 'referred';
    return html`
      ${crumbs}
      <div class="title">
        <h1>${msg('Application', { id: 'application.title' })} ${this.animal ? `${msg('for', { id: 'policy.for' })} ${this.animal.name}` : a.id}</h1>
        <span class="pv-badge pv-badge--id">${a.id}</span>
        <span class="pv-badge ${decided ? 'pv-badge--solid' : 'pv-badge--pending'}">${applicationStatusLabel(a.status)}</span>
      </div>
      <ul class="facts">
        <li>${msg('Animal', { id: 'claim.animal' })}: ${link(`/animals/${a.animalId}`, this.animal?.name ?? a.animalId)}</li>
        <li>${msg('Policyholder', { id: 'policy.holder' })}: ${link(`/parties/${a.policyholderPartyId}`, partyName(this.holder) || a.policyholderPartyId)}</li>
        <li>${msg('Starts', { id: 'application.starts' })}: <strong>${formatDate(a.startDate, lang)}</strong></li>
        <li>${msg('Received', { id: 'claims.col.received' })}: <strong>${formatDateTime(a.receivedAt, lang)}</strong></li>
        ${a.deadline && !decided ? html`<li>${msg('Decide by', { id: 'application.deadline' })}: <span class="pv-badge pv-badge--pending">${formatDate(a.deadline, lang)}</span></li>` : nothing}
        ${a.decision?.policyId ?? a.policyId ? html`<li>${msg('Policy', { id: 'claims.col.policy' })}: ${link(`/policies/${a.decision?.policyId ?? a.policyId}`, (a.decision?.policyId ?? a.policyId)!)}</li>` : nothing}
      </ul>
      ${this.notice
        ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}
            >${this.notice.text}
            ${this.notice.reload ? html`<wa-button size="small" appearance="outlined" @click=${() => this.load()}>${msg('Reload', { id: 'common.reload' })}</wa-button>` : nothing}</wa-callout
          >`
        : nothing}
      <div class="cols">
        <div class="basis">
          <section class="pv-card" aria-labelledby="rules">
            <div class="pv-card__head">
              <h2 class="pv-card__title" id="rules">${msg('The rules', { id: 'application.checks' })}</h2>
              <span class="pv-card__meta pv-mono">${u.result.rules ? `${u.result.rules.series}@${u.result.rules.version}` : '–'}</span>
            </div>
            <pv-data-grid .columns=${this.checkColumns()} .rows=${u.result.checks} label=${msg('The rules', { id: 'application.checks' })}></pv-data-grid>
          </section>
          <section class="pv-card" aria-labelledby="answers">
            <div class="pv-card__head"><h2 class="pv-card__title" id="answers">${msg('Answers', { id: 'application.answers' })}</h2></div>
            <pv-data-grid .columns=${this.answerColumns()} .rows=${u.input.answers} label=${msg('Answers', { id: 'application.answers' })}></pv-data-grid>
          </section>
          <section class="pv-card" aria-labelledby="details">
            <div class="pv-card__head"><h2 class="pv-card__title" id="details">${msg('Details', { id: 'claim.facts' })}</h2></div>
            <div class="pv-card__body">
              <dl class="pv-dl">
                ${row(msg('Animal', { id: 'policy.animal' }), `${u.input.species}${u.input.breed ? ` (${u.input.breed})` : ''}, ${msg('born', { id: 'application.born' })} ${formatDate(u.input.birthDate, lang)}`)}
                ${row(msg('Product', { id: 'policy.product' }), a.productVersion, true)}
                ${row(msg('Premium', { id: 'policy.premium' }), formatMoney(a.premium.amount, a.premium.currency, lang))}
                ${a.campaignCode ? row(msg('Campaign code', { id: 'application.campaign' }), a.campaignCode, true) : nothing}
                ${row(msg('Market', { id: 'policy.market' }), a.market)}
              </dl>
            </div>
          </section>
        </div>
        <div class="side">
          ${a.decision ? this.decisionCard(a) : nothing} ${mayUnderwrite(this.me, a) ? this.decisionForm(a) : nothing}
          ${mayWithdraw(this.me, a) ? this.withdrawForm() : nothing}
          <pv-event-log heading=${msg('History', { id: 'claim.history' })} .entries=${this.historyEntries(a)}></pv-event-log>
        </div>
      </div>
    `;
  }

  /** What became of the application, with who and why. */
  private decisionCard(a: Application) {
    const d = a.decision!;
    const lang = getLocale();
    const row = (label: string, value: unknown) => html`<div class="pv-dl__row"><dt>${label}</dt><dd>${value}</dd></div>`;
    return html`<section class="pv-card" aria-labelledby="decision">
      <div class="pv-card__head"><h2 class="pv-card__title" id="decision">${msg('Decision', { id: 'decide.action' })}</h2></div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${row(msg('Outcome', { id: 'application.outcome' }), applicationStatusLabel(d.outcome))}
          ${d.reason ? row(msg('Reason code', { id: 'decide.code' }), d.reason) : nothing}
          ${d.riders?.length ? row(msg('Riders', { id: 'policy.riders' }), d.riders.map((r) => r.description).join('; ')) : nothing}
          ${d.note ? row(msg('Grounds', { id: 'application.note' }), d.note) : nothing}
          ${row(msg('By', { id: 'party.by' }), `${d.decidedBy}, ${formatDateTime(d.decidedAt, lang)}`)}
        </dl>
      </div>
    </section>`;
  }

  /** Received with what the rules gave, and the decision: newest first. */
  private historyEntries(a: Application): LogEntry[] {
    const out: LogEntry[] = [
      {
        key: 'received',
        at: a.receivedAt,
        state: 'solid',
        badge: msg('Received', { id: 'claims.col.received' }),
        line: `${msg('The rules gave', { id: 'application.rulesGave' })}: ${applicationStatusLabel(a.decision ? 'referred' : a.status)}`,
        status: `application.received · ${a.receivedBy}`,
      },
    ];
    if (a.decision) {
      out.unshift({
        key: 'decided',
        at: a.decision.decidedAt,
        state: 'solid',
        badge: applicationStatusLabel(a.decision.outcome),
        line: a.decision.note ?? '',
        status: `application.${a.decision.outcome} · ${a.decision.decidedBy}`,
      });
    }
    return out;
  }

  private decisionForm(a: Application) {
    const proposed = a.underwriting.result.riders;
    const choice = (value: 'accept' | 'decline', title: string, desc: string) => html`<label class="pv-choice">
      <input type="radio" name="outcome" value=${value} .checked=${this.outcome === value} @change=${() => (this.outcome = value)} />
      <span>
        <span class="pv-choice__title">${title}</span>
        <span class="pv-choice__desc">${desc}</span>
      </span>
    </label>`;
    return html`<section class="pv-card pv-card--strong" aria-labelledby="underwrite">
      <div class="pv-card__head"><h2 class="pv-card__title" id="underwrite">${msg('Underwrite', { id: 'application.decide' })}</h2></div>
      <form class="pv-card__body" @submit=${this.decide}>
        <fieldset>
          <legend>${msg('Decision', { id: 'decide.action' })}</legend>
          ${choice(
            'accept',
            msg('Accept and issue the policy', { id: 'application.accept' }),
            proposed.length
              ? `${msg('With the riders the rules propose:', { id: 'application.ridersProposed' })} ${proposed.map((r) => r.description).join('; ')}`
              : msg('The policy is issued from the start date.', { id: 'application.acceptDesc' }),
          )}
          ${choice('decline', msg('Decline', { id: 'application.decline' }), msg('The applicant gets a notice with the reasons and how to have the decision reviewed.', { id: 'application.declineDesc' }))}
        </fieldset>
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
    </section>`;
  }

  private withdrawForm() {
    return html`<section class="pv-card" aria-labelledby="withdraw">
      <div class="pv-card__head"><h2 class="pv-card__title" id="withdraw">${msg('Withdraw', { id: 'application.withdraw' })}</h2></div>
      <form class="pv-card__body" @submit=${this.withdraw}>
        <p>${msg('For the channel, e.g. when the customer no longer wants the policy.', { id: 'application.withdrawWhy' })}</p>
        <wa-textarea label=${msg('Reason (optional)', { id: 'application.withdrawReason' })} rows="2" .value=${this.withdrawReason} @input=${(e: Event) => (this.withdrawReason = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
        <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'withdraw'}>${msg('Withdraw', { id: 'application.withdraw' })}</wa-button>
      </form>
    </section>`;
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
