/**
 * <pv-rule-simulation>: a rule set version, a draft or any other, run against
 * the stored evidence of the decisions in a period (ADR 0018), before it is
 * published: how many decisions would change, moves between automatic and
 * manual handling, the payouts per currency, and the decisions that change.
 * Nothing is stored or booked.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { changes, defaultDays, simulationRange } from '../simulation-logic.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { outcomeLabel } from '../views/labels.ts';
import './data-grid.ts';
import type { Column } from './data-grid.ts';

type Result = components['schemas']['SimulationResult'];
type Item = Result['items'][number];
type Version = components['schemas']['RuleSetVersion'];

const value = (e: Event) => (e.target as HTMLInputElement).value;

@customElement('pv-rule-simulation')
export class RuleSimulation extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property() series = '';
  @state() private versions: Version[] = [];
  @state() private version = '';
  @state() private days = defaultDays(new Date().toISOString().slice(0, 10));
  @state() private result: Result | null = null;
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
        margin-top: var(--space-6);
      }
      form {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
        align-items: flex-end;
      }
      form wa-input,
      form wa-select {
        width: 12rem;
      }
      .pv-card__body > * + * {
        margin-top: var(--space-4);
      }
      .pv-card__body p {
        margin: 0;
      }
    `,
  ];

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('series') && this.series) void this.loadVersions();
  }

  private async loadVersions() {
    const { data } = await this.api.GET('/v1/rule-sets/{series}/versions', { params: { path: { series: this.series }, query: { limit: 200 } } });
    // The newest first: usually the draft to try.
    this.versions = [...(data?.items ?? [])].reverse();
    this.version = this.versions[0] ? String(this.versions[0].version) : '';
  }

  private async run(e: Event) {
    e.preventDefault();
    const range = simulationRange(this.days.from, this.days.to);
    this.result = null;
    if (typeof range === 'string') return void (this.problem = msg('Give a first and a last day, the last not before the first.', { id: 'simulation.rangeProblem' }));
    if (!this.version) return void (this.problem = msg('Choose a version.', { id: 'simulation.versionProblem' }));
    this.busy = true;
    this.problem = '';
    try {
      this.result = await unwrap(this.api.POST('/v1/rule-sets/{series}/versions/{version}/simulations', { params: { path: { series: this.series, version: Number(this.version) } }, body: range }));
    } catch (err) {
      const p = err as { title?: string; detail?: string };
      this.problem = p.detail ?? p.title ?? msg('Something went wrong.', { id: 'common.error' });
    } finally {
      this.busy = false;
    }
  }

  private modeLabel(m: string) {
    return m === 'auto' ? msg('Automatic', { id: 'claim.automated' }) : msg('By a person', { id: 'simulation.manual' });
  }

  private columns(): Column<Item>[] {
    const lang = getLocale();
    return [
      {
        key: 'claim',
        header: msg('Claim', { id: 'money.claimPayout' }),
        value: (i) => html`<a href="/claims/${i.claimId}" @click=${(e: Event) => (e.preventDefault(), navigate(`/claims/${encodeURIComponent(i.claimId)}`))}>${i.claimId}</a>`,
      },
      { key: 'stored', header: msg('Stored', { id: 'simulation.stored' }), value: (i) => this.outcomeText(i.stored, i.currency) },
      { key: 'simulated', header: msg('With this version', { id: 'simulation.simulated' }), value: (i) => this.outcomeText(i.simulated, i.currency) },
      { key: 'delta', header: msg('Payout change', { id: 'simulation.delta' }), value: (i) => `${i.payoutDelta > 0 ? '+' : ''}${formatMoney(i.payoutDelta, i.currency, lang)}`, align: 'end' },
      { key: 'what', header: msg('What changes', { id: 'simulation.what' }), value: (i) => changes(i.stored, i.simulated).map((c) => this.changeLabel(c)).join(', ') },
    ];
  }

  private outcomeText(o: Item['stored'], currency: string) {
    return `${outcomeLabel(o.proposedOutcome)}, ${this.modeLabel(o.mode).toLowerCase()}, ${formatMoney(o.payout, currency, getLocale())}`;
  }

  private changeLabel(c: 'outcome' | 'mode' | 'payout') {
    switch (c) {
      case 'outcome':
        return msg('outcome', { id: 'simulation.changeOutcome' });
      case 'mode':
        return msg('handling', { id: 'simulation.changeMode' });
      case 'payout':
        return msg('payout', { id: 'simulation.changePayout' });
    }
  }

  private resultView(r: Result) {
    const lang = getLocale();
    const row = (label: string, v: unknown) => html`<div class="pv-dl__row"><dt>${label}</dt><dd>${v}</dd></div>`;
    return html`<dl class="pv-dl">
        ${row(msg('Decisions tried', { id: 'simulation.decisions' }), r.decisions)}
        ${row(msg('Would change', { id: 'simulation.changed' }), r.changed)}
        ${row(msg('From automatic to a person', { id: 'simulation.autoToManual' }), r.modeChanged.autoToManual)}
        ${row(msg('From a person to automatic', { id: 'simulation.manualToAuto' }), r.modeChanged.manualToAuto)}
        ${r.totals.map((t) =>
          row(
            `${msg('Payouts', { id: 'simulation.payouts' })} ${t.currency}`,
            `${formatMoney(t.storedPayout, t.currency, lang)} → ${formatMoney(t.simulatedPayout, t.currency, lang)} (${t.simulatedPayout - t.storedPayout >= 0 ? '+' : ''}${formatMoney(t.simulatedPayout - t.storedPayout, t.currency, lang)})`,
          ),
        )}
      </dl>
      ${r.items.length
        ? html`<pv-data-grid .columns=${this.columns()} .rows=${r.items} label=${msg('Decisions that change', { id: 'simulation.items' })}></pv-data-grid>`
        : html`<p>${msg('No decision would change.', { id: 'simulation.none' })}</p>`}`;
  }

  render() {
    return html`<section class="pv-card" aria-labelledby="simulation">
      <div class="pv-card__head">
        <h2 class="pv-card__title" id="simulation">${msg('Try a version against stored decisions', { id: 'simulation.title' })}</h2>
        ${this.result ? html`<span class="pv-card__meta pv-mono">${this.result.rulesVersion}</span>` : nothing}
      </div>
      <div class="pv-card__body">
        <p>
          ${msg('Each claim’s latest decision in the period is assessed again with the version, from its stored evidence. Nothing is stored. Each decision on its own: knock-on effects between claims, such as deductible periods, are not tried.', { id: 'simulation.how' })}
        </p>
        <form @submit=${(e: Event) => this.run(e)} novalidate>
          <wa-select label=${msg('Version', { id: 'accounting.version' })} value=${this.version} @change=${(e: Event) => (this.version = value(e))}>
            ${this.versions.map((v) => html`<wa-option value=${String(v.version)}>${v.version} · ${v.status}</wa-option>`)}
          </wa-select>
          <wa-input type="date" label=${msg('From', { id: 'money.from' })} .value=${this.days.from} @input=${(e: Event) => (this.days = { ...this.days, from: value(e) })}></wa-input>
          <wa-input type="date" label=${msg('Through', { id: 'simulation.through' })} .value=${this.days.to} @input=${(e: Event) => (this.days = { ...this.days, to: value(e) })}></wa-input>
          <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Try it', { id: 'simulation.run' })}</wa-button>
        </form>
        ${this.problem ? html`<wa-callout variant="danger" role="alert">${this.problem}</wa-callout>` : nothing}
        ${this.result ? this.resultView(this.result) : nothing}
      </div>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-rule-simulation': RuleSimulation;
  }
}
