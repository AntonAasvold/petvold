/**
 * <pv-jobs>: Petvold's daily runs (ADR 0037): per job and market the latest
 * and next run, and the relay's dead letters with "Send again".
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { isLate, jobRows, mayOperateJobs } from '../jobs-logic.ts';
import type { Me } from '../permissions.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { jobLabel, runStatusLabel, runStatusVariant, scheduleLabel } from './labels.ts';

type Job = components['schemas']['Job'];
type DeadLetter = components['schemas']['RelayDeadLetter'];
type Row = ReturnType<typeof jobRows<Job>>[number];

@customElement('pv-jobs')
export class JobsView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @state() private jobs: Job[] = [];
  @state() private dead: DeadLetter[] = [];
  @state() private loading = false;
  @state() private error = '';
  @state() private notice: Notice | null = null;
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }
      h1 {
        margin: 0;
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
      }
      .lead {
        margin: 0;
        color: var(--text-secondary);
        max-width: 60ch;
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    this.loading = true;
    this.error = '';
    try {
      const [jobs, dead] = await Promise.all([unwrap(this.api.GET('/v1/jobs', {})), unwrap(this.api.GET('/v1/relay-dead-letters', {}))]);
      this.jobs = jobs.items;
      this.dead = dead.items;
    } catch (e) {
      this.error = (e as { title?: string }).title ?? msg('Something went wrong.', { id: 'common.error' });
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html`
      <h1>${msg('Runs', { id: 'nav.jobs' })}</h1>
      <p class="lead">${msg('Petvold runs these every day in each market, one server at a time. Open a run to see its history, run it now or pause it.', { id: 'jobs.lead' })}</p>
      ${this.error ? html`<wa-callout variant="danger" role="alert">${this.error}</wa-callout>` : nothing}
      <section class="pv-card" aria-labelledby="jobs">
        <div class="pv-card__head"><h2 class="pv-card__title" id="jobs">${msg('Daily runs', { id: 'jobs.daily' })}</h2></div>
        <pv-data-grid
          .columns=${this.columns()}
          .rows=${jobRows(this.jobs)}
          ?loading=${this.loading}
          label=${msg('Runs', { id: 'nav.jobs' })}
          @pv-row-activate=${(e: CustomEvent<{ row: Row }>) => navigate(`/jobs/${encodeURIComponent(e.detail.row.job.id)}`)}
        ></pv-data-grid>
      </section>
      <section class="pv-card" aria-labelledby="dead">
        <div class="pv-card__head">
          <h2 class="pv-card__title" id="dead">${msg('Dead letters in the relay', { id: 'jobs.dead' })}</h2>
          <span class="pv-card__meta">${msg('Events that could not be delivered within Petvold after ten attempts', { id: 'jobs.deadMeta' })}</span>
        </div>
        ${this.notice ? html`<div class="pv-card__body"><wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}>${this.notice.text}</wa-callout></div>` : nothing}
        <pv-data-grid
          .columns=${this.deadColumns()}
          .rows=${this.dead}
          ?loading=${this.loading}
          label=${msg('Dead letters in the relay', { id: 'jobs.dead' })}
          empty-text=${msg('No dead letters.', { id: 'jobs.noDead' })}
        ></pv-data-grid>
      </section>
    `;
  }

  private columns(): Column<Row>[] {
    const lang = getLocale();
    return [
      { key: 'job', header: msg('Run', { id: 'jobs.col.job' }), value: (r) => jobLabel(r.job.id) },
      { key: 'market', header: msg('Market', { id: 'claim.market' }), value: (r) => r.market },
      { key: 'schedule', header: msg('Schedule', { id: 'run.schedule' }), value: (r) => scheduleLabel(r.job.schedule) },
      {
        key: 'last',
        header: msg('Latest run', { id: 'jobs.col.last' }),
        value: (r) =>
          r.lastRun
            ? html`<wa-badge variant=${runStatusVariant(r.lastRun.status)}>${runStatusLabel(r.lastRun.status)}</wa-badge> ${formatDateTime(r.lastRun.startedAt, lang)}`
            : '–',
      },
      {
        key: 'next',
        header: msg('Next run', { id: 'jobs.col.next' }),
        value: (r) =>
          r.job.schedule.enabled === false
            ? html`<wa-badge variant="neutral">${msg('Turned off', { id: 'jobs.off' })}</wa-badge>`
            : r.job.paused
            ? html`<wa-badge variant="warning">${msg('Paused', { id: 'job.paused' })}</wa-badge>`
            : r.nextRunAt
              ? html`${isLate(r.nextRunAt, new Date().toISOString()) ? html`<wa-badge variant="danger">${msg('Late', { id: 'jobs.late' })}</wa-badge> ` : nothing}${formatDateTime(r.nextRunAt, lang)}`
              : '–',
      },
    ];
  }

  private deadColumns(): Column<DeadLetter>[] {
    const lang = getLocale();
    const may = mayOperateJobs(this.me);
    return [
      { key: 'source', header: msg('Source', { id: 'jobs.col.source' }), value: (d) => d.source },
      { key: 'event', header: msg('Event', { id: 'jobs.col.event' }), value: (d) => d.eventId },
      { key: 'attempts', header: msg('Attempts', { id: 'jobs.col.attempts' }), align: 'end', value: (d) => d.attempts },
      { key: 'error', header: msg('Latest error', { id: 'jobs.col.error' }), value: (d) => d.lastError },
      { key: 'at', header: msg('Set aside', { id: 'jobs.col.deadAt' }), value: (d) => formatDateTime(d.deadAt, lang) },
      ...(may
        ? [
            {
              key: 'retry',
              header: msg('Action', { id: 'jobs.col.action' }),
              value: (d: DeadLetter) =>
                html`<wa-button size="small" appearance="outlined" @click=${(e: Event) => (e.stopPropagation(), this.retry(d))}>${msg('Send again', { id: 'jobs.retry' })}</wa-button>`,
            },
          ]
        : []),
    ];
  }

  private async retry(d: DeadLetter) {
    const key = `retry:${d.id}`;
    const { ok, notice } = await act(
      () => this.api.POST('/v1/relay-dead-letters/{deadLetter}/retries', { params: { path: { deadLetter: d.id }, header: { 'Idempotency-Key': this.keys.for(key) } } }),
      () => ({ variant: 'success', text: msg('Sent again. The relay tries it at its next round.', { id: 'jobs.retried' }) }),
    );
    this.notice = notice;
    if (ok) {
      this.keys.done(key);
      await this.load();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-jobs': JobsView;
  }
}
