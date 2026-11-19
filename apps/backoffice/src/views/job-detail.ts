/**
 * <pv-job-detail>: one run (ADR 0037). Its history beside what may be done:
 * run now in a market, with or without dryRun, and pause or resume with a
 * reason. Pause takes effect at once; the trail shows who did what and why.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import '../components/data-grid.ts';
import '../components/event-log.ts';
import type { Column } from '../components/data-grid.ts';
import type { LogEntry } from '../components/event-log.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { controlProblems, mayOperateJobs, resultLine } from '../jobs-logic.ts';
import type { Me } from '../permissions.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { jobLabel, problemLabel, runStatusLabel, runStatusVariant, runTriggerLabel, scheduleLabel } from './labels.ts';

type JobDetail = components['schemas']['JobDetail'];
type JobRun = components['schemas']['JobRun'];

@customElement('pv-job-detail')
export class JobDetailView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property() job = '';
  @state() private detail: JobDetail | null = null;
  @state() private runs: JobRun[] = [];
  @state() private problem: Problem | null = null;
  @state() private market = '';
  @state() private dryRun = true;
  @state() private reason = '';
  @state() private shown: string[] = [];
  @state() private notice: Notice | null = null;
  @state() private busy = '';
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
      .crumbs {
        display: flex;
        gap: var(--space-2);
        font-size: 13px;
        color: var(--text-muted);
      }
      .crumbs a {
        color: var(--text-secondary);
      }
      .title {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-3);
        margin: var(--space-2) 0 var(--space-2);
      }
      h1 {
        margin: 0;
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
      }
      .facts {
        margin: 0 0 var(--space-8);
        color: var(--text-secondary);
        font-size: 14px;
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
      }
      .side {
        flex: 1 1 340px;
        max-width: 420px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      .pv-card__body p {
        margin: 0;
      }
      wa-button.wide {
        width: 100%;
      }
      @media (max-width: 900px) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('job') || changed.has('api')) void this.load();
  }

  private async load() {
    this.problem = null;
    const path = { params: { path: { job: this.job } } };
    try {
      const [detail, runs] = await Promise.all([unwrap(this.api.GET('/v1/jobs/{job}', path)), unwrap(this.api.GET('/v1/jobs/{job}/runs', path))]);
      this.detail = detail;
      this.runs = runs.items;
      if (!this.market) this.market = detail.markets[0]?.market ?? '';
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  render() {
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/jobs" @click=${(e: Event) => (e.preventDefault(), navigate('/jobs'))}>${msg('Runs', { id: 'nav.jobs' })}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${jobLabel(this.job)}</span>
    </nav>`;
    if (this.problem) {
      return html`${crumbs}<wa-callout variant="neutral">${msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' })}</wa-callout>`;
    }
    const d = this.detail;
    if (!d) return html`${crumbs}<wa-spinner></wa-spinner>`;
    return html`
      ${crumbs}
      <div class="title">
        <h1>${jobLabel(d.id)}</h1>
        <span class="pv-badge pv-badge--id">${d.id}</span>
        ${d.paused ? html`<span class="pv-badge pv-badge--pending">${msg('Paused', { id: 'job.paused' })}</span>` : nothing}
      </div>
      <p class="facts">${scheduleLabel(d.schedule)} · ${msg("in each market's own time", { id: 'job.marketTime' })}</p>
      <div class="cols">
        <section class="pv-card basis" aria-labelledby="history">
          <div class="pv-card__head"><h2 class="pv-card__title" id="history">${msg('History', { id: 'claim.history' })}</h2></div>
          <pv-data-grid
            .columns=${this.columns()}
            .rows=${this.runs}
            label=${msg('History', { id: 'claim.history' })}
            empty-text=${msg('Not run yet.', { id: 'jobs.noRuns' })}
          ></pv-data-grid>
        </section>
        <div class="side">
          ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>${this.notice.text}</wa-callout>` : nothing}
          ${mayOperateJobs(this.me) ? this.runCard(d) : nothing} ${mayOperateJobs(this.me) ? this.pauseCard(d) : nothing}
          <pv-event-log heading=${msg('Paused and resumed', { id: 'jobs.trail' })} empty=${msg('Never paused.', { id: 'jobs.noTrail' })} .entries=${this.trail(d)}></pv-event-log>
        </div>
      </div>
    `;
  }

  private runCard(d: JobDetail) {
    return html`<section class="pv-card pv-card--strong" aria-labelledby="run">
      <div class="pv-card__head"><h2 class="pv-card__title" id="run">${msg('Run now', { id: 'run.manual' })}</h2></div>
      <form class="pv-card__body" @submit=${this.run}>
        <p>${msg('Runs at once in one market, also while the run is paused. A dry run stores nothing, for the runs that can.', { id: 'jobs.runHow' })}</p>
        <wa-select label=${msg('Market', { id: 'claim.market' })} value=${this.market} @change=${(e: Event) => (this.market = (e.target as HTMLSelectElement).value)}>
          ${d.markets.map((m) => html`<wa-option value=${m.market}>${m.market}</wa-option>`)}
        </wa-select>
        <wa-checkbox ?checked=${this.dryRun} @change=${(e: Event) => (this.dryRun = (e.target as HTMLInputElement).checked)}>${msg('Dry run: store nothing', { id: 'jobs.dryRun' })}</wa-checkbox>
        <wa-button class="wide" type="submit" variant="brand" ?loading=${this.busy === 'run'}
          >${this.dryRun ? msg('Try the run', { id: 'jobs.submitDry' }) : msg('Run now', { id: 'run.manual' })} · ${this.market}</wa-button
        >
      </form>
    </section>`;
  }

  private pauseCard(d: JobDetail) {
    return html`<section class="pv-card" aria-labelledby="pause">
      <div class="pv-card__head"><h2 class="pv-card__title" id="pause">${d.paused ? msg('Resume', { id: 'jobs.resume' }) : msg('Pause', { id: 'jobs.pause' })}</h2></div>
      <form class="pv-card__body" @submit=${this.control}>
        <p>
          ${d.paused
            ? `${msg('Paused by', { id: 'jobs.pausedBy' })} ${d.paused.pausedBy}, ${formatDateTime(d.paused.pausedAt, getLocale())}: ${d.paused.reason}`
            : msg('Takes effect at once in every market. "Run now" still works.', { id: 'jobs.pauseHow' })}
        </p>
        <wa-textarea label=${msg('Reason', { id: 'claim.reason' })} rows="2" .value=${this.reason} @input=${(e: Event) => (this.reason = (e.target as HTMLTextAreaElement).value)}></wa-textarea>
        ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing}
        <wa-button type="submit" appearance="outlined" ?loading=${this.busy === 'control'}
          >${d.paused ? msg('Resume the run', { id: 'jobs.submitResume' }) : msg('Pause the run', { id: 'jobs.submitPause' })}</wa-button
        >
      </form>
    </section>`;
  }

  private trail(d: JobDetail): LogEntry[] {
    return d.controls.map((c) => ({
      key: c.id,
      at: c.at,
      state: 'solid' as const,
      badge: c.action === 'pause' ? msg('Paused', { id: 'job.paused' }) : msg('Resumed', { id: 'jobs.resumed' }),
      line: c.reason,
      status: `job.${c.action} · ${c.by}`,
    }));
  }

  private columns(): Column<JobRun>[] {
    const lang = getLocale();
    return [
      { key: 'started', header: msg('Started', { id: 'jobs.col.started' }), value: (r) => formatDateTime(r.startedAt, lang) },
      { key: 'market', header: msg('Market', { id: 'claim.market' }), value: (r) => r.market },
      { key: 'trigger', header: msg('How', { id: 'close.how' }), value: (r) => `${runTriggerLabel(r.trigger)}${r.dryRun ? ` (${msg('dry run', { id: 'jobs.dry' })})` : ''}` },
      { key: 'by', header: msg('By', { id: 'jobs.col.by' }), value: (r) => r.startedBy },
      { key: 'status', header: msg('Result', { id: 'claim.result' }), value: (r) => html`<wa-badge variant=${runStatusVariant(r.status)}>${runStatusLabel(r.status)}</wa-badge>` },
      {
        key: 'what',
        header: msg('What it did', { id: 'jobs.col.what' }),
        // A summary reads better wrapped than scrolled.
        value: (r) => html`<span style="white-space: normal">${r.error ?? resultLine(r.result as Record<string, unknown> | undefined)}</span>`,
      },
    ];
  }

  private async run(e: Event) {
    e.preventDefault();
    this.busy = 'run';
    const body = { market: this.market, dryRun: this.dryRun };
    const key = `run:${this.job}:${this.market}:${this.dryRun}`;
    let status = '';
    const { ok, notice } = await act(
      async () => {
        const r = await this.api.POST('/v1/jobs/{job}/runs', { params: { path: { job: this.job }, header: { 'Idempotency-Key': this.keys.for(key) } }, body });
        status = r.data?.status ?? '';
        return r;
      },
      () =>
        status === 'failed'
          ? { variant: 'danger', text: msg('The run failed. See the error in the history.', { id: 'jobs.runFailed' }) }
          : { variant: 'success', text: msg('The run is done. See what it did in the history.', { id: 'jobs.runDone' }) },
    );
    this.busy = '';
    this.notice = notice;
    if (ok) {
      this.keys.done(key);
      await this.load();
    }
  }

  private async control(e: Event) {
    e.preventDefault();
    this.shown = controlProblems(this.reason);
    if (this.shown.length) return;
    const resume = !!this.detail?.paused;
    const key = `${resume ? 'resume' : 'pause'}:${this.job}`;
    this.busy = 'control';
    const params = { params: { path: { job: this.job }, header: { 'Idempotency-Key': this.keys.for(key) } }, body: { reason: this.reason.trim() } };
    const { ok, notice } = await act(
      () => (resume ? this.api.POST('/v1/jobs/{job}/resumptions', params) : this.api.POST('/v1/jobs/{job}/pauses', params)),
      () => ({ variant: 'success', text: resume ? msg('The run is resumed.', { id: 'jobs.resumedNotice' }) : msg('The run is paused.', { id: 'jobs.pausedNotice' }) }),
    );
    this.busy = '';
    this.notice = notice;
    if (ok) {
      this.keys.done(key);
      this.reason = '';
      await this.load();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-job-detail': JobDetailView;
  }
}
