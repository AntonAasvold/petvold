/**
 * <pv-policy-detail>: a policy as the design system lays out a detail page
 * (docs/teknik/designsystem.md, "Detaljsidan"). A head with the policy, its
 * status and who and what it concerns; then two columns: what one reads (the
 * term in force with the annual limit used, the claims, riders, terms and
 * versions over time) and, beside it, what one does (proposals, changes,
 * cancellation, renewal) and the history.
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
import '../components/policy-actions.ts';
import type { Column } from '../components/data-grid.ts';
import type { LogEntry } from '../components/event-log.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate, formatDateTime, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { mayAnswerProposal, partyName, versionOn } from '../policy-logic.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { claimStatusLabel, outcomeLabel, policyStatusLabel, proposalKindLabel, statusVariant, transactionLabel } from './labels.ts';

type Policy = components['schemas']['PolicyRecord'];
type Term = components['schemas']['PolicyTerm'];
type Version = components['schemas']['PolicyVersion'];
type Transaction = components['schemas']['PolicyTransaction'];
type Rider = components['schemas']['Rider'];
type Proposal = components['schemas']['PolicyProposal'];
type Limits = components['schemas']['Limits'];
type ClaimSummary = components['schemas']['ClaimSummary'];
type Party = components['schemas']['Party'];
type Animal = components['schemas']['Animal'];

const today = () => new Date().toISOString().slice(0, 10);

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
  /** Who and what the policy concerns, the annual limit used and the claims. Each is left out if the caller may not read it. */
  @state() private animal: Animal | null = null;
  @state() private holder: Party | null = null;
  @state() private limits: Limits | null = null;
  @state() private claims: ClaimSummary[] | null = null;
  @state() private channel = 'phone';
  @state() private rejectReason = '';
  @state() private busy = '';
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
      .limit {
        display: grid;
        gap: var(--space-2);
        margin-top: var(--space-4);
      }
      .limit .pv-wf__track {
        display: block;
      }
      .limit .pv-wf__bar {
        display: block;
        height: 100%;
        background: var(--ink);
      }
      .limit p {
        margin: 0;
        font-size: 13px;
        color: var(--text-secondary);
      }
      .pv-card__body p {
        margin: 0;
      }
      form {
        display: grid;
        gap: var(--space-3);
      }
      @media (max-width: 900px) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('policyId') || changed.has('api')) void this.load();
  }

  private may(p: string): boolean {
    return !!this.me?.permissions.includes(p);
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
      return;
    }
    void this.loadAround();
  }

  /** The animal, the policyholder, the annual limit used and the claims. Not needed to act, so a missing permission only leaves them out. */
  private async loadAround() {
    const p = this.policy!;
    const holderId = versionOn(p.versions, today())?.policyholderPartyId;
    const [animal, holder, limits, claims] = await Promise.all([
      this.api.GET('/v1/animals/{animalId}', { params: { path: { animalId: p.animalId } } }).then((r) => r.data ?? null, () => null),
      holderId ? this.api.GET('/v1/parties/{partyId}', { params: { path: { partyId: holderId } } }).then((r) => r.data ?? null, () => null) : Promise.resolve(null),
      this.may('limits:read')
        ? this.api.GET('/v1/policies/{policyId}/limits', { params: { path: { policyId: p.id }, query: { onDate: today() } } }).then((r) => r.data ?? null, () => null)
        : Promise.resolve(null),
      this.may('claims:read')
        ? this.api.GET('/v1/claims', { params: { query: { policyId: p.id, limit: 200 } } }).then((r) => r.data?.items ?? [], () => [])
        : Promise.resolve(null),
    ]);
    this.animal = animal;
    this.holder = holder;
    this.limits = limits;
    this.claims = claims;
  }

  render() {
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/policies" @click=${(e: Event) => (e.preventDefault(), navigate('/policies'))}>${msg('Policies', { id: 'nav.policies' })}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${this.policyId}</span>
    </nav>`;
    if (this.problem) {
      const text = this.problem.status === 404 ? msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' }) : this.problem.title;
      return html`${crumbs}<wa-callout variant=${this.problem.status === 404 ? 'neutral' : 'danger'}>${text}</wa-callout>`;
    }
    const p = this.policy;
    if (!p || !this.history) return html`${crumbs}<wa-spinner></wa-spinner>`;
    const lang = getLocale();
    const current = versionOn(p.versions, today());
    const term = p.terms.find((t) => t.startDate <= today() && today() < t.endDate) ?? p.terms.at(-1)!;
    const riders = p.terms.flatMap((t) => t.riders);
    const holder = partyName(this.holder);
    const link = (href: string, text: string, mono = false) =>
      html`<a href=${href} @click=${(e: Event) => (e.preventDefault(), navigate(href))}><strong class=${mono ? 'pv-mono' : ''}>${text}</strong></a>`;
    return html`
      ${crumbs}
      <div class="title">
        <h1>${msg('Policy', { id: 'claims.col.policy' })} ${this.animal ? `${msg('for', { id: 'policy.for' })} ${this.animal.name}` : p.id}</h1>
        <span class="pv-badge pv-badge--id">${p.id}</span>
        ${current ? html`<span class="pv-badge ${current.status === 'active' ? 'pv-badge--solid' : 'pv-badge--pending'}">${policyStatusLabel(current.status)}</span>` : nothing}
        ${this.may('claims:register')
          ? html`<wa-button size="small" appearance="outlined" @click=${() => navigate(`/claims/new?policy=${encodeURIComponent(p.id)}`)}
              ><wa-icon slot="start" name="plus"></wa-icon>${msg('Register a claim', { id: 'register.title' })}</wa-button
            >`
          : nothing}
      </div>
      <ul class="facts">
        <li>${msg('Animal', { id: 'claim.animal' })}: ${link(`/animals/${p.animalId}`, this.animal?.name ?? p.animalId)}</li>
        ${current
          ? html`<li>${msg('Policyholder', { id: 'policy.holder' })}: ${link(`/parties/${current.policyholderPartyId}`, holder || current.policyholderPartyId)}</li>`
          : nothing}
        <li>${msg('Market', { id: 'policy.market' })}: <strong>${p.market}</strong></li>
        <li>${msg('Since', { id: 'policy.since' })}: <strong>${formatDate(p.inceptionDate, lang)}</strong></li>
        <li>${msg('Term', { id: 'policy.term' })}: <strong>${formatDate(term.startDate, lang)} – ${formatDate(term.endDate, lang)}</strong></li>
      </ul>
      ${this.notice
        ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}
            >${this.notice.text}
            ${this.notice.reload ? html`<wa-button size="small" appearance="outlined" @click=${() => this.load()}>${msg('Reload', { id: 'common.reload' })}</wa-button>` : nothing}</wa-callout
          >`
        : nothing}
      <div class="cols">
        <div class="basis">
          ${this.termCard(term)} ${this.claims ? this.claimsCard(this.claims) : nothing}
          <section class="pv-card" aria-labelledby="riders">
            <div class="pv-card__head"><h2 class="pv-card__title" id="riders">${msg('Riders', { id: 'policy.riders' })}</h2></div>
            <pv-data-grid .columns=${this.riderColumns()} .rows=${riders} label=${msg('Riders', { id: 'policy.riders' })} empty-text=${msg('No riders.', { id: 'policy.noRiders' })}></pv-data-grid>
          </section>
          <section class="pv-card" aria-labelledby="terms">
            <div class="pv-card__head"><h2 class="pv-card__title" id="terms">${msg('Terms', { id: 'policy.terms' })}</h2></div>
            <pv-data-grid .columns=${this.termColumns()} .rows=${p.terms} label=${msg('Terms', { id: 'policy.terms' })}></pv-data-grid>
          </section>
          <section class="pv-card" aria-labelledby="versions">
            <div class="pv-card__head"><h2 class="pv-card__title" id="versions">${msg('Versions over time', { id: 'policy.versions' })}</h2></div>
            <pv-data-grid .columns=${this.versionColumns()} .rows=${this.history.versions} label=${msg('Versions over time', { id: 'policy.versions' })}></pv-data-grid>
          </section>
        </div>
        <div class="side">
          ${this.proposals.map((pr) => this.proposalCard(pr))}
          ${this.may('policies:write')
            ? html`<pv-policy-actions .api=${this.api} .policy=${p} .transactions=${this.history.transactions} @pv-changed=${() => this.load()}></pv-policy-actions>`
            : nothing}
          <pv-event-log heading=${msg('History', { id: 'policy.history' })} .entries=${this.historyEntries()}></pv-event-log>
        </div>
      </div>
    `;
  }

  /** The term in force: its product and choices, and how much of the annual limit is used (ADR 0007). */
  private termCard(t: Term) {
    const lang = getLocale();
    const money = (m: number) => formatMoney(m, t.currency, lang);
    const row = (label: string, value: unknown, mono = false) => html`<div class="pv-dl__row"><dt>${label}</dt><dd class=${mono ? 'pv-mono' : ''}>${value}</dd></div>`;
    const l = this.limits;
    const used = l && l.annualLimit > 0 ? Math.min(100, Math.round((l.consumed / l.annualLimit) * 100)) : 0;
    return html`<section class="pv-card" aria-labelledby="term">
      <div class="pv-card__head">
        <h2 class="pv-card__title" id="term">${msg('The term in force', { id: 'policy.termInForce' })}</h2>
        <span class="pv-card__meta">${msg('Term', { id: 'policy.term' })} ${t.termNo}</span>
      </div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${row(msg('Product', { id: 'policy.product' }), t.productVersion, true)}
          ${row(msg('Period', { id: 'policy.period' }), `${formatDate(t.startDate, lang)} – ${formatDate(t.endDate, lang)}`)}
          ${row(msg('Premium', { id: 'policy.premium' }), money(t.premium))} ${row(msg('Deductible', { id: 'policy.deductible' }), t.deductibleOption)}
          ${row(msg('Annual limit', { id: 'policy.annualLimit' }), money(t.vetCare.annualLimit))}
        </dl>
        ${l
          ? html`<div class="limit">
              <dl class="pv-dl">
                ${row(msg('Paid out this policy year', { id: 'policy.consumed' }), formatMoney(l.consumed, l.currency, lang))}
                ${row(msg('Left of the annual limit', { id: 'calc.remainingBefore' }), html`<strong>${formatMoney(l.remaining, l.currency, lang)}</strong>`)}
              </dl>
              <span class="pv-wf__track" role="img" aria-label=${`${used} % ${msg('of the annual limit is used', { id: 'policy.usedShare' })}`}
                ><span class="pv-wf__bar" style="width: ${used}%"></span
              ></span>
              <p>${msg('Policy year', { id: 'policy.year' })} ${formatDate(l.policyYearStart, lang)} – ${formatDate(l.policyYearEnd, lang)}</p>
            </div>`
          : nothing}
      </div>
    </section>`;
  }

  private claimsCard(claims: ClaimSummary[]) {
    const lang = getLocale();
    const columns: Column<ClaimSummary>[] = [
      { key: 'no', header: msg('Claim', { id: 'claim.title' }), value: (c) => html`<span class="pv-mono">${c.claimNo}</span>` },
      { key: 'treatment', header: msg('Treatment from', { id: 'claims.col.treatment' }), value: (c) => formatDate(c.treatmentFrom, lang) },
      { key: 'diagnosis', header: msg('Diagnosis', { id: 'claims.col.diagnosis' }), value: (c) => html`<span class="pv-mono">${c.diagnosisCode}</span>` },
      { key: 'status', header: msg('Status', { id: 'claims.col.status' }), value: (c) => html`<wa-badge variant=${statusVariant(c.status)}>${claimStatusLabel(c.status)}</wa-badge>` },
      {
        key: 'payout',
        header: msg('Payout', { id: 'policy.payout' }),
        align: 'end',
        value: (c) => (c.latestDecision ? `${outcomeLabel(c.latestDecision.outcome)} · ${formatMoney(c.latestDecision.payout, c.currency, lang)}` : '–'),
      },
    ];
    return html`<section class="pv-card" aria-labelledby="claims">
      <div class="pv-card__head"><h2 class="pv-card__title" id="claims">${msg('Claims on the policy', { id: 'policy.claims' })}</h2></div>
      <pv-data-grid
        .columns=${columns}
        .rows=${claims}
        label=${msg('Claims on the policy', { id: 'policy.claims' })}
        empty-text=${msg('No claims.', { id: 'policy.noClaims' })}
        @pv-row-activate=${(e: CustomEvent<{ row: ClaimSummary }>) => navigate(`/claims/${encodeURIComponent(e.detail.row.id)}`)}
      ></pv-data-grid>
    </section>`;
  }

  /** The policy's changes, newest first, as the design system's log. */
  private historyEntries(): LogEntry[] {
    return [...this.history!.transactions]
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : a.requestedAt > b.requestedAt ? -1 : 0))
      .map((t) => ({
        key: t.id,
        at: t.requestedAt,
        state: 'solid' as const,
        badge: transactionLabel(t.type),
        line: t.steps.at(-1)?.note ?? t.cancellation?.reason ?? '',
        status: `policy.${t.type} · ${t.requestedBy}`,
      }));
  }

  private proposalCard(pr: Proposal) {
    const lang = getLocale();
    const d = pr.details;
    const row = (label: string, value: unknown) => html`<div class="pv-dl__row"><dt>${label}</dt><dd>${value}</dd></div>`;
    return html`<section class="pv-card ${mayAnswerProposal(this.me, pr) ? 'pv-card--strong' : ''}" aria-labelledby=${`pr-${pr.id}`}>
      <div class="pv-card__head"><h2 class="pv-card__title" id=${`pr-${pr.id}`}>${proposalKindLabel(pr.kind)}</h2></div>
      <div class="pv-card__body">
        <dl class="pv-dl">
          ${d.fromPartyId ? row(msg('From', { id: 'proposal.from' }), d.fromPartyId) : nothing}
          ${d.toPartyId ? row(msg('To', { id: 'proposal.to' }), d.toPartyId) : nothing}
          ${d.from ? row(msg('From the day', { id: 'proposal.fromDay' }), formatDate(d.from, lang)) : nothing}
          ${d.deceasedOn ? row(msg('Died', { id: 'proposal.died' }), formatDate(d.deceasedOn, lang)) : nothing}
          ${pr.deadline ? row(msg('Answer by', { id: 'proposal.deadline' }), formatDate(pr.deadline, lang)) : nothing}
          ${pr.decision ? row(msg('Decision', { id: 'decide.action' }), `${pr.decision.outcome}, ${pr.decision.decidedBy}, ${formatDateTime(pr.decision.decidedAt, lang)}`) : nothing}
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
      </div>
    </section>`;
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
}
