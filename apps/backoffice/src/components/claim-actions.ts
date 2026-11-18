/**
 * <pv-claim-actions>: what a person may do with a claim (ADR 0018, 0019):
 * decide, approve or return a proposal, ask for a review, reassess. Each form
 * sends an Idempotency-Key and the assessment's inputHash; the API decides.
 * Emits pv-changed when the claim changed.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import type { Api } from '../api/client.ts';
import type { components } from '../api/schema';
import {
  DEVIATION_CODES,
  IdempotencyKeys,
  decisionProblems,
  deviates,
  mayApprove,
  mayDecide,
  mayRequestReview,
  needsReason,
  proposedAction,
  DISMISSAL_REASONS,
  closureProblems,
  mayClose,
  type ClosureForm,
  type DismissalReason,
  routingLines,
  type Action,
  type DeviationCode,
} from '../decide.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { navigate } from '../router.ts';
import type { Me } from '../permissions.ts';
import { claimStatusLabel, deviationLabel, dismissalLabel, outcomeLabel, problemLabel } from '../views/labels.ts';

type Assessment = components['schemas']['AssessmentWithRouting'];
type Decision = components['schemas']['Decision'];
type Proposal = components['schemas']['DecisionProposal'];
type ReviewRequest = components['schemas']['ReviewRequest'];
type ClaimClosure = components['schemas']['ClaimClosure'];

/** An outcome to show after an action, polite for success and assertive for errors. */
interface Notice {
  variant: 'success' | 'warning' | 'danger';
  text: string;
  reload?: boolean;
}

@customElement('pv-claim-actions')
export class ClaimActions extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property({ attribute: 'claim-id' }) claimId = '';
  @property() currency = 'SEK';
  @property() status = '';
  @property({ attribute: false }) assessment!: Assessment;
  @property({ attribute: false }) decisions: Decision[] = [];
  @property({ attribute: false }) proposals: Proposal[] = [];
  @property({ attribute: false }) reviews: ReviewRequest[] = [];
  /** Set when the claim was withdrawn or dismissed (ADR 0036). */
  @property({ attribute: false }) closure: ClaimClosure | null = null;

  @state() private action: Action = 'accept';
  @state() private reasonCode: DeviationCode | '' = '';
  @state() private reason = '';
  @state() private returnReason = '';
  @state() private statement = '';
  @state() private reassessReason = '';
  @state() private busy = '';
  @state() private notice: Notice | null = null;
  @state() private shown: string[] = [];
  @state() private closing: ClosureForm = { kind: 'withdrawn', reasonCode: '', reason: '', duplicateOf: '' };
  @state() private closeShown: string[] = [];
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
    :host {
      display: grid;
      gap: var(--wa-space-l);
    }
    fieldset {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
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
    .pv-choice__title .pv-badge {
      margin-left: var(--space-2);
      height: 20px;
      vertical-align: middle;
    }
    .pv-note ul {
      margin: var(--space-1) 0 0;
      padding-left: var(--space-5);
    }
    .pv-card__body p {
      margin: 0;
    }
    .submit {
      width: 100%;
    }
    .submit::part(base) {
      padding-inline: var(--space-4);
    }
    .submit::part(label) {
      white-space: normal;
    }
    form {
      display: grid;
      gap: var(--wa-space-m);
    }
    .row {
      display: flex;
      gap: var(--wa-space-s);
      flex-wrap: wrap;
    }
    dl:not(.pv-dl) {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--wa-space-2xs) var(--wa-space-m);
      margin: 0 0 var(--wa-space-m);
    }
    dl:not(.pv-dl) dt {
      color: var(--wa-color-text-quiet);
    }
    dl:not(.pv-dl) dd {
      margin: 0;
    }
  `,
  ];

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('assessment') && this.assessment) {
      this.action = proposedAction(this.assessment.proposedOutcome);
      this.reasonCode = '';
      this.reason = '';
      this.shown = [];
    }
  }

  render() {
    const open = this.proposals.filter((p) => p.status === 'open');
    const openReview = this.reviews.find((r) => !r.closedAt);
    const latest = this.decisions.at(-1);
    return html`
      ${this.notice
        ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>
            ${this.notice.text}
            ${this.notice.reload ? html`<wa-button size="small" appearance="outlined" @click=${() => this.changed()}>${msg('Reload', { id: 'common.reload' })}</wa-button>` : nothing}
          </wa-callout>`
        : nothing}
      ${this.closure ? this.closedCard(this.closure) : nothing}
      ${mayDecide(this.me, this.status) ? this.decideForm() : nothing}
      ${open.map((p) => this.proposalCard(p))}
      ${openReview ? this.reviewCard(openReview) : nothing}
      ${mayRequestReview(this.me, latest, !!openReview) ? this.requestReviewForm() : nothing}
      ${this.me?.permissions.includes('claims:reassess') && this.decisions.length ? this.reassessForm() : nothing}
      ${this.closeForm()}
    `;
  }

  private decideForm() {
    const a = this.assessment;
    const lang = getLocale();
    const money = (m: number) => formatMoney(m, this.currency, lang);
    const against = deviates(this.action, a.proposedOutcome);
    const reasonNeeded = needsReason(this.action, a.proposedOutcome);
    const problems = this.shown;
    const payout = a.calculation?.payout ?? 0;
    const why = routingLines(a.routing.reasons, a.rules);
    const proposed = proposedAction(a.proposedOutcome);
    const choice = (value: Action, title: string, desc: string) => html`<label class="pv-choice">
      <input type="radio" name="action" value=${value} .checked=${this.action === value} @change=${() => (this.action = value)} />
      <span>
        <span class="pv-choice__title">${title}${value === proposed ? html`<span class="pv-badge pv-badge--pending">${msg('Proposal', { id: 'claim.proposed' })}</span>` : nothing}</span>
        <span class="pv-choice__desc">${desc}</span>
      </span>
    </label>`;
    const submit =
      this.action === 'accept'
        ? `${msg('Approve payout', { id: 'decide.submitAccept' })} · ${money(payout)}`
        : msg('Reject the claim', { id: 'decide.submitReject' });
    return html`<section class="pv-card pv-card--strong" aria-labelledby="decide">
      <div class="pv-card__head">
        <h2 class="pv-card__title" id="decide">${this.status === 'review-requested' ? msg('Review the decision', { id: 'decide.reviewTitle' }) : msg('Decision', { id: 'decide.action' })}</h2>
      </div>
      <form class="pv-card__body" @submit=${this.decide}>
        ${why.length
          ? html`<div class="pv-note">
              <strong>${msg('Why a claims handler', { id: 'decide.why' })}</strong>
              <ul>
                ${why.map((w) => html`<li>${w}</li>`)}
              </ul>
            </div>`
          : nothing}
        <fieldset>
          <legend>${msg('Decision', { id: 'decide.action' })}</legend>
          ${choice(
            'accept',
            msg('Approve payout', { id: 'decide.accept' }),
            payout > 0
              ? `${money(payout)} ${msg('is paid out. The customer pays', { id: 'decide.acceptPays' })} ${money(a.calculation?.customerShare ?? 0)}.`
              : msg('Nothing is paid out: the amount falls within the deductible.', { id: 'decide.acceptNothing' }),
          )}
          ${choice('reject', msg('Reject', { id: 'decide.reject' }), msg('Nothing is paid out. The customer gets the decision with the reason.', { id: 'decide.rejectDesc' }))}
        </fieldset>
        ${against
          ? html`<wa-callout variant="warning">${msg('This goes against the proposal. Give a reason code and a reason; they are kept with the decision.', { id: 'decide.against' })}</wa-callout>
              <wa-select label=${msg('Reason code', { id: 'decide.code' })} value=${this.reasonCode} @change=${(e: Event) => (this.reasonCode = (e.target as HTMLSelectElement).value as DeviationCode)}>
                ${DEVIATION_CODES.map((c) => html`<wa-option value=${c}>${deviationLabel(c)}</wa-option>`)}
              </wa-select>`
          : nothing}
        ${reasonNeeded
          ? html`<wa-textarea label=${msg('Reason', { id: 'claim.reason' })} rows="3" .value=${this.reason} @input=${(e: Event) => (this.reason = (e.target as HTMLTextAreaElement).value)}></wa-textarea>`
          : nothing}
        ${problems.length ? html`<wa-callout variant="danger" role="alert">${problems.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing}
        <wa-button class="submit" type="submit" variant="brand" ?loading=${this.busy === 'decide'}>${submit}</wa-button>
      </form>
    </section>`;
  }

  /** A claim closed without a decision: what, why, by whom and when. */
  private closedCard(k: ClaimClosure) {
    return html`<section class="pv-card pv-card--strong" aria-labelledby="closed">
      <div class="pv-card__head"><h2 class="pv-card__title" id="closed">${claimStatusLabel(k.kind)}</h2></div>
      <div class="pv-card__body">
        <p>${msg('The claim is closed without a decision. Nothing is paid out, and nothing of the limit is used.', { id: 'close.closedNote' })}</p>
        <dl class="pv-dl">
          ${k.reasonCode ? html`<div class="pv-dl__row"><dt>${msg('Why', { id: 'close.why' })}</dt><dd>${dismissalLabel(k.reasonCode)}</dd></div>` : nothing}
          ${k.duplicateOf
            ? html`<div class="pv-dl__row">
                <dt>${msg('Duplicate of', { id: 'close.duplicateOf' })}</dt>
                <dd><a href=${`/claims/${k.duplicateOf}`} @click=${(e: Event) => (e.preventDefault(), navigate(`/claims/${encodeURIComponent(k.duplicateOf!)}`))} class="pv-mono">${k.duplicateOf}</a></dd>
              </div>`
            : nothing}
          <div class="pv-dl__row"><dt>${msg('Reason', { id: 'claim.reason' })}</dt><dd>${k.reason}</dd></div>
          <div class="pv-dl__row"><dt>${msg('Closed by', { id: 'close.by' })}</dt><dd>${k.closedBy}</dd></div>
          <div class="pv-dl__row"><dt>${msg('Closed', { id: 'close.at' })}</dt><dd>${formatDateTime(k.closedAt, getLocale())}</dd></div>
        </dl>
      </div>
    </section>`;
  }

  /**
   * Close the claim without a decision (ADR 0036): withdrawn by the customer,
   * or dismissed, e.g. as a duplicate. Only before any decision.
   */
  private closeForm() {
    const may = mayClose(this.me, this.status, this.decisions.length);
    if (!may.withdraw && !may.dismiss) return nothing;
    const f = this.closing;
    const kind = !may.withdraw ? 'dismissed' : !may.dismiss ? 'withdrawn' : f.kind;
    const set = (patch: Partial<ClosureForm>) => (this.closing = { ...this.closing, ...patch });
    const choice = (value: ClosureForm['kind'], title: string, desc: string) => html`<label class="pv-choice">
      <input type="radio" name="close-kind" value=${value} .checked=${kind === value} @change=${() => set({ kind: value })} />
      <span><span class="pv-choice__title">${title}</span><span class="pv-choice__desc">${desc}</span></span>
    </label>`;
    return html`<section class="pv-card" aria-labelledby="close">
      <div class="pv-card__head"><h2 class="pv-card__title" id="close">${msg('Close without a decision', { id: 'close.title' })}</h2></div>
      <form class="pv-card__body" @submit=${(e: Event) => this.close(e, kind)}>
        <fieldset>
          <legend>${msg('How', { id: 'close.how' })}</legend>
          ${may.withdraw ? choice('withdrawn', msg('Withdrawn by the customer', { id: 'close.withdraw' }), msg('The customer no longer wants the claim tried.', { id: 'close.withdrawDesc' })) : nothing}
          ${may.dismiss ? choice('dismissed', msg('Dismiss', { id: 'close.dismiss' }), msg('A duplicate, registered in error or not a claim. Not a rejection: the customer gets no decision.', { id: 'close.dismissDesc' })) : nothing}
        </fieldset>
        ${kind === 'dismissed'
          ? html`<wa-select label=${msg('Why', { id: 'close.why' })} value=${f.reasonCode ?? ''} @change=${(e: Event) => set({ reasonCode: (e.target as HTMLSelectElement).value as DismissalReason })}>
              ${DISMISSAL_REASONS.map((c) => html`<wa-option value=${c}>${dismissalLabel(c)}</wa-option>`)}
            </wa-select>
            ${f.reasonCode === 'duplicate'
              ? html`<wa-input
                  label=${msg('Duplicate of', { id: 'close.duplicateOf' })}
                  hint=${msg('The id of the other claim, e.g. clm_048213', { id: 'close.duplicateHint' })}
                  .value=${f.duplicateOf ?? ''}
                  @input=${(e: Event) => set({ duplicateOf: (e.target as HTMLInputElement).value })}
                ></wa-input>`
              : nothing}`
          : nothing}
        <wa-textarea label=${msg('Reason', { id: 'claim.reason' })} rows="2" .value=${f.reason} @input=${(e: Event) => set({ reason: (e.target as HTMLTextAreaElement).value })}></wa-textarea>
        ${this.closeShown.length ? html`<wa-callout variant="danger" role="alert">${this.closeShown.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing}
        <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'close'}
          >${kind === 'withdrawn' ? msg('Withdraw the claim', { id: 'close.submitWithdraw' }) : msg('Dismiss the claim', { id: 'close.submitDismiss' })}</wa-button
        >
      </form>
    </section>`;
  }

  private proposalCard(p: Proposal) {
    const lang = getLocale();
    const may = mayApprove(this.me, p);
    return html`<section class="pv-card">
      <div class="pv-card__head"><h2 class="pv-card__title">${msg('Awaiting approval', { id: 'claims.status.awaiting-approval' })}</h2></div>
      <div class="pv-card__body">
      <dl>
        <dt>${msg('Decision', { id: 'decide.action' })}</dt>
        <dd>${outcomeLabel(p.outcome)} · ${formatMoney(p.payout, p.currency, lang)}</dd>
        <dt>${msg('Proposed by', { id: 'approve.by' })}</dt>
        <dd>${p.proposedBy}, ${formatDateTime(p.proposedAt, lang)}</dd>
        <dt>${msg('Their limit', { id: 'approve.limit' })}</dt>
        <dd>${formatMoney(p.proposerLimit, p.currency, lang)}</dd>
        ${p.reason ? html`<dt>${msg('Reason', { id: 'claim.reason' })}</dt><dd>${p.reasonCode ? `${deviationLabel(p.reasonCode)}: ` : ''}${p.reason}</dd>` : nothing}
      </dl>
      ${may
        ? html`<form @submit=${(e: Event) => this.approve(e, p)}>
            <div class="row">
              <wa-button type="submit" variant="success" ?loading=${this.busy === 'approve'}>${msg('Approve', { id: 'approve.submit' })}</wa-button>
            </div>
          </form>
          <form @submit=${(e: Event) => this.returnProposal(e, p)}>
            <wa-textarea label=${msg('Why it goes back', { id: 'approve.returnReason' })} rows="2" required .value=${this.returnReason} @input=${(e: Event) => (this.returnReason = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
            <div class="row"><wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'return'}>${msg('Return to the handler', { id: 'approve.return' })}</wa-button></div>
          </form>`
        : p.proposedBy === this.me?.subject
          ? html`<p>${msg('Someone else must approve your proposal.', { id: 'approve.fourEyes' })}</p>`
          : nothing}
    </div>
    </section>`;
  }

  private reviewCard(r: ReviewRequest) {
    return html`<section class="pv-card">
      <div class="pv-card__head"><h2 class="pv-card__title">${msg('Review requested', { id: 'claims.status.review-requested' })}</h2></div>
      <div class="pv-card__body">
      <dl>
        <dt>${msg('Decision', { id: 'decide.action' })}</dt>
        <dd>#${r.decisionSeq}</dd>
        <dt>${msg('Requested', { id: 'review.requested' })}</dt>
        <dd>${formatDateTime(r.requestedAt, getLocale())}</dd>
        ${r.statement ? html`<dt>${msg("The customer's view", { id: 'review.statement' })}</dt><dd>${r.statement}</dd>` : nothing}
      </dl>
      <p>${msg('A new decision by a person answers the request.', { id: 'review.answer' })}</p>
    </div>
    </section>`;
  }

  private requestReviewForm() {
    return html`<section class="pv-card">
      <div class="pv-card__head"><h2 class="pv-card__title">${msg('Ask for a review', { id: 'review.title' })}</h2></div>
      <div class="pv-card__body">
      <form @submit=${this.requestReview}>
        <p>${msg('The latest decision was automated. The customer may ask for a person to review it.', { id: 'review.why' })}</p>
        <wa-textarea label=${msg("The customer's view (optional)", { id: 'review.statementInput' })} rows="3" .value=${this.statement} @input=${(e: Event) => (this.statement = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
        <div class="row"><wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'review'}>${msg('Ask for a review', { id: 'review.submit' })}</wa-button></div>
      </form>
    </div>
    </section>`;
  }

  private reassessForm() {
    return html`<section class="pv-card">
      <div class="pv-card__head"><h2 class="pv-card__title">${msg('Reassess', { id: 'reassess.title' })}</h2></div>
      <div class="pv-card__body">
      <form @submit=${this.reassess}>
        <p>${msg('Assess the claim again on what is known now, e.g. after a correction of the policy. A new decision is made only if the outcome changes.', { id: 'reassess.why' })}</p>
        <wa-textarea label=${msg('Reason', { id: 'claim.reason' })} rows="2" required .value=${this.reassessReason} @input=${(e: Event) => (this.reassessReason = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
        <div class="row"><wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'reassess'}>${msg('Reassess', { id: 'reassess.submit' })}</wa-button></div>
      </form>
    </div>
    </section>`;
  }

  private path() {
    return { claimId: this.claimId };
  }

  private headers(action: string) {
    return { 'Idempotency-Key': this.keys.for(`${action}:${this.claimId}`) };
  }

  /** Runs an action: the API's answer becomes a notice; a conflict offers to reload. */
  private async run(action: string, call: () => Promise<{ response: Response; error?: unknown }>, success: (status: number) => Notice) {
    this.busy = action;
    this.notice = null;
    try {
      const { response, error } = await call();
      if (response.ok) {
        this.keys.done(`${action}:${this.claimId}`);
        this.notice = success(response.status);
        this.changed();
        return;
      }
      const p = (error ?? {}) as { title?: string; detail?: string };
      this.notice =
        response.status === 409
          ? { variant: 'warning', text: `${msg('The claim has changed since you opened it.', { id: 'common.conflict' })} ${p.detail ?? p.title ?? ''}`, reload: true }
          : { variant: 'danger', text: p.detail ?? p.title ?? response.statusText };
    } catch {
      this.notice = { variant: 'danger', text: msg('Something went wrong.', { id: 'common.error' }) };
    } finally {
      this.busy = '';
    }
  }

  private async decide(e: Event) {
    e.preventDefault();
    const problems = decisionProblems({ action: this.action, reasonCode: this.reasonCode, reason: this.reason }, this.assessment.proposedOutcome, this.me);
    this.shown = problems;
    if (problems.length) return;
    const against = deviates(this.action, this.assessment.proposedOutcome);
    const withReason = needsReason(this.action, this.assessment.proposedOutcome);
    await this.run(
      'decide',
      () =>
        this.api.POST('/v1/claims/{claimId}/decisions', {
          params: { path: this.path(), header: this.headers('decide') },
          body: {
            action: this.action,
            expectedInputHash: this.assessment.inputHash,
            ...(against ? { reasonCode: this.reasonCode as DeviationCode } : {}),
            ...(withReason ? { reason: this.reason.trim() } : {}),
          },
        }),
      (status) =>
        status === 202
          ? { variant: 'warning', text: msg('The payout is above your limit. The decision is a proposal and waits for someone to approve it.', { id: 'decide.proposal' }) }
          : { variant: 'success', text: msg('The claim is decided.', { id: 'decide.done' }) },
    );
  }

  private async approve(e: Event, p: Proposal) {
    e.preventDefault();
    await this.run(
      'approve',
      () => this.api.POST('/v1/claims/{claimId}/proposals/{proposalId}/approvals', { params: { path: { ...this.path(), proposalId: p.id }, header: this.headers('approve') }, body: {} }),
      () => ({ variant: 'success', text: msg('Approved. The decision is made.', { id: 'approve.done' }) }),
    );
  }

  private async returnProposal(e: Event, p: Proposal) {
    e.preventDefault();
    if (!this.returnReason.trim()) return;
    await this.run(
      'return',
      () =>
        this.api.POST('/v1/claims/{claimId}/proposals/{proposalId}/returns', {
          params: { path: { ...this.path(), proposalId: p.id }, header: this.headers('return') },
          body: { reason: this.returnReason.trim() },
        }),
      () => ({ variant: 'success', text: msg('Returned to the handler.', { id: 'approve.returned' }) }),
    );
  }

  private async requestReview(e: Event) {
    e.preventDefault();
    const latest = this.decisions.at(-1)!;
    await this.run(
      'review',
      () =>
        this.api.POST('/v1/claims/{claimId}/decisions/{seq}/review-requests', {
          params: { path: { ...this.path(), seq: latest.seq }, header: this.headers('review') },
          body: this.statement.trim() ? { statement: this.statement.trim() } : {},
        }),
      () => ({ variant: 'success', text: msg('A person will review the decision.', { id: 'review.done' }) }),
    );
  }

  private async reassess(e: Event) {
    e.preventDefault();
    if (!this.reassessReason.trim()) return;
    await this.run(
      'reassess',
      () =>
        this.api.POST('/v1/claims/{claimId}/reassessments', {
          params: { path: this.path(), header: this.headers('reassess') },
          body: { reason: this.reassessReason.trim() },
        }),
      (status) =>
        status === 204
          ? { variant: 'success', text: msg('Reassessed: the outcome is the same, so no new decision.', { id: 'reassess.same' }) }
          : { variant: 'success', text: msg('Reassessed: a new decision is made.', { id: 'reassess.new' }) },
    );
  }

  private async close(e: Event, kind: ClosureForm['kind']) {
    e.preventDefault();
    const f = { ...this.closing, kind };
    this.closeShown = closureProblems(f, this.claimId);
    if (this.closeShown.length) return;
    await this.run(
      'close',
      () =>
        kind === 'withdrawn'
          ? this.api.POST('/v1/claims/{claimId}/withdrawals', { params: { path: this.path(), header: this.headers('close') }, body: { reason: f.reason.trim() } })
          : this.api.POST('/v1/claims/{claimId}/dismissals', {
              params: { path: this.path(), header: this.headers('close') },
              body: {
                reasonCode: f.reasonCode as DismissalReason,
                reason: f.reason.trim(),
                ...(f.reasonCode === 'duplicate' ? { duplicateOf: f.duplicateOf!.trim() } : {}),
              },
            }),
      () => ({ variant: 'success', text: kind === 'withdrawn' ? msg('The claim is withdrawn.', { id: 'close.withdrawn' }) : msg('The claim is dismissed.', { id: 'close.dismissed' }) }),
    );
  }

  private changed() {
    this.dispatchEvent(new CustomEvent('pv-changed', { bubbles: true, composed: true }));
  }
}
