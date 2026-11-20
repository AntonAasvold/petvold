/**
 * <pv-versions-panel>: the versions of a product or a rule set series, and their
 * lifecycle (ADR 0021, 0023): draft, review with four eyes, publication, and the
 * end. The kind's calls come from an adapter. A product and claims rules are
 * edited as a form, or as JSON; tariffs, price terms and underwriting rules as
 * JSON. The API validates everything.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { act, type Notice } from '../actions.ts';
import { lifecycleActions, parseJson, type Kind } from '../catalog-logic.ts';
import type { Api } from '../api/client.ts';
import { isClaimsRules, productFormFrom, rulesFormFrom } from '../product-form.ts';
import { problemLabel } from '../views/labels.ts';
import { pvComponents } from '../styles/pv-components.ts';
import './content-forms.ts';
import type { ContentResult } from './content-forms.ts';
import { formatDate, formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import './data-grid.ts';
import type { Column } from './data-grid.ts';

/** A version as the panel shows it, whatever its kind. */
export interface VersionRow {
  key: string;
  label: string;
  status: string;
  from: string;
  to?: string;
  content: unknown;
  /** Rule sets: the calculation model. */
  model?: string;
  submittedBy?: string;
  createdBy: string;
  createdAt: string;
  publishedBy?: string;
  note?: string;
}

export interface DraftForm {
  /** Products: the new version's name. Rule sets get a number from the API. */
  version: string;
  from: string;
  to: string;
  model: string;
  content: unknown;
}

type Call = () => Promise<{ response: Response; error?: unknown }>;

/** The kind's calls. Each sends its own idempotency key. */
export interface VersionsAdapter {
  kind: Kind;
  list(): Promise<VersionRow[]>;
  create(f: DraftForm): Call;
  update(v: VersionRow, f: DraftForm): Call;
  submit(v: VersionRow): Call;
  publish(v: VersionRow): Call;
  return(v: VersionRow, reason: string): Call;
  /** Products: end sales on a date; rule sets: retire. */
  end(v: VersionRow, reason: string, date: string): Call;
  /** A suggestion for a new draft's version name, or '' when the API numbers it. */
  nextVersion(rows: VersionRow[]): string;
}

@customElement('pv-versions-panel')
export class VersionsPanel extends LitElement {
  @property({ attribute: false }) adapter!: VersionsAdapter;
  @property({ attribute: false }) me: Me | null = null;
  /** For the product form's species. */
  @property({ attribute: false }) api: Api | null = null;
  @state() private rows: VersionRow[] = [];
  /** How the content is edited, and the content the form starts from. */
  @state() private mode: 'form' | 'json' = 'json';
  @state() private formContent: unknown = {};
  @state() private selected: VersionRow | null = null;
  @state() private editing: 'new' | 'edit' | null = null;
  @state() private form: { version: string; from: string; to: string; model: string; json: string } = { version: '', from: '', to: '', model: '', json: '' };
  @state() private reason = '';
  @state() private endDate = '';
  @state() private notice: Notice | null = null;
  @state() private busy = '';

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [pvComponents, css`
    wa-card {
      margin-top: var(--wa-space-l);
    }
    form {
      display: grid;
      gap: var(--wa-space-m);
    }
    .row {
      display: flex;
      gap: var(--wa-space-s);
      flex-wrap: wrap;
      align-items: end;
    }
    .row > wa-input {
      flex: 1;
      min-width: 10rem;
    }
    pre,
    wa-textarea::part(textarea) {
      font-family: var(--wa-font-family-code);
      font-size: var(--wa-font-size-s);
    }
    pre {
      max-height: 28rem;
      overflow: auto;
      margin: 0;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: var(--wa-space-2xs) var(--wa-space-m);
    }
    dt {
      color: var(--wa-color-text-quiet);
    }
    dd {
      margin: 0;
    }
    .modes {
      display: flex;
      gap: var(--space-2);
    }
    details summary {
      cursor: pointer;
      font: 500 13px/1.4 var(--font-sans);
      color: var(--text-secondary);
    }
  `];

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(keep?: string) {
    try {
      this.rows = await this.adapter.list();
      this.selected = this.rows.find((r) => r.key === (keep ?? this.selected?.key)) ?? this.rows.at(-1) ?? null;
    } catch (e) {
      this.notice = { variant: 'danger', text: (e as { title?: string }).title ?? msg('Something went wrong.', { id: 'common.error' }) };
    }
  }

  private statusLabel(s: string) {
    switch (s) {
      case 'draft':
        return msg('Draft', { id: 'catalog.status.draft' });
      case 'in_review':
        return msg('In review', { id: 'catalog.status.in_review' });
      case 'published':
        return msg('Published', { id: 'catalog.status.published' });
      case 'retired':
        return msg('Retired', { id: 'catalog.status.retired' });
      default:
        return s;
    }
  }

  private columns(): Column<VersionRow>[] {
    const lang = getLocale();
    const variant = (s: string) => (s === 'published' ? 'success' : s === 'in_review' ? 'warning' : 'neutral');
    return [
      { key: 'label', header: msg('Version', { id: 'settings.version' }), value: (v) => v.label },
      { key: 'status', header: msg('Status', { id: 'claims.col.status' }), value: (v) => html`<wa-badge variant=${variant(v.status)}>${this.statusLabel(v.status)}</wa-badge>` },
      { key: 'from', header: msg('From', { id: 'proposal.from' }), value: (v) => `${formatDate(v.from, lang)}${v.to ? ` – ${formatDate(v.to, lang)}` : ''}` },
      { key: 'by', header: msg('Created by', { id: 'catalog.createdBy' }), value: (v) => v.createdBy },
      { key: 'published', header: msg('Published by', { id: 'catalog.publishedBy' }), value: (v) => v.publishedBy ?? '–' },
    ];
  }

  render() {
    const v = this.selected;
    const actions = v ? lifecycleActions(this.adapter.kind, v, this.me) : [];
    const lang = getLocale();
    return html`
      ${this.notice
        ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}
            >${this.notice.text}
            ${this.notice.reload ? html`<wa-button size="small" appearance="outlined" @click=${() => this.load()}>${msg('Reload', { id: 'common.reload' })}</wa-button>` : nothing}</wa-callout
          >`
        : nothing}
      <pv-data-grid
        .columns=${this.columns()}
        .rows=${this.rows}
        label=${msg('Versions', { id: 'settings.versions' })}
        @pv-row-activate=${(e: CustomEvent<{ row: VersionRow }>) => ((this.selected = e.detail.row), (this.editing = null))}
      ></pv-data-grid>
      ${v && !this.editing
        ? html`<wa-card>
            <h3 slot="header">${msg('Version', { id: 'settings.version' })} ${v.label} · ${this.statusLabel(v.status)}</h3>
            <dl>
              ${v.model ? html`<dt>${msg('Calculation model', { id: 'catalog.model' })}</dt><dd>${v.model}</dd>` : nothing}
              <dt>${msg('Created', { id: 'catalog.created' })}</dt>
              <dd>${v.createdBy}, ${formatDateTime(v.createdAt, lang)}</dd>
              ${v.submittedBy ? html`<dt>${msg('Submitted by', { id: 'catalog.submittedBy' })}</dt><dd>${v.submittedBy}</dd>` : nothing}
              ${v.note ? html`<dt>${msg('Note', { id: 'policy.note' })}</dt><dd>${v.note}</dd>` : nothing}
            </dl>
            <div class="row">
              ${actions.includes('edit') ? html`<wa-button appearance="outlined" @click=${() => this.startEdit('edit')}><wa-icon slot="start" name="pen"></wa-icon>${msg('Edit', { id: 'catalog.edit' })}</wa-button>` : nothing}
              ${actions.includes('submit') ? this.button('submit', msg('Submit for review', { id: 'catalog.submit' }), 'brand', () => this.adapter.submit(v)) : nothing}
              ${actions.includes('publish') ? this.button('publish', msg('Publish', { id: 'catalog.publish' }), 'success', () => this.adapter.publish(v)) : nothing}
              ${v.status === 'in_review' && v.submittedBy === this.me?.subject ? html`<span>${msg('Someone else must publish what you submitted.', { id: 'catalog.fourEyes' })}</span>` : nothing}
              ${actions.includes('copy') ? html`<wa-button appearance="outlined" @click=${() => this.startEdit('new')}><wa-icon slot="start" name="plus"></wa-icon>${msg('New draft from this', { id: 'catalog.copy' })}</wa-button>` : nothing}
            </div>
            ${actions.includes('return') || actions.includes('end')
              ? html`<form @submit=${(e: Event) => e.preventDefault()}>
                  <wa-input label=${msg('Reason', { id: 'claim.reason' })} .value=${this.reason} @input=${(e: Event) => (this.reason = (e.target as HTMLInputElement).value)}></wa-input>
                  ${actions.includes('end') && this.adapter.kind === 'product'
                    ? html`<wa-input type="date" label=${msg('Last day of sales is the day before', { id: 'catalog.salesTo' })} .value=${this.endDate} @input=${(e: Event) => (this.endDate = (e.target as HTMLInputElement).value)}></wa-input>`
                    : nothing}
                  <div class="row">
                    ${actions.includes('return') ? this.button('return', msg('Return to draft', { id: 'catalog.return' }), 'neutral', () => this.adapter.return(v, this.reason.trim()), true) : nothing}
                    ${actions.includes('end')
                      ? this.button('end', this.adapter.kind === 'product' ? msg('End sales', { id: 'catalog.endSales' }) : msg('Retire', { id: 'catalog.retire' }), 'danger', () => this.adapter.end(v, this.reason.trim(), this.endDate), true)
                      : nothing}
                  </div>
                </form>`
              : nothing}
            <h4>${msg('Content', { id: 'notice.content' })}</h4>
            ${this.summary(v.content)}
            <details ?open=${!this.hasForm(v.content)}>
              <summary>${msg('The content as JSON', { id: 'catalog.asJson' })}</summary>
              <pre>${JSON.stringify(v.content, null, 2)}</pre>
            </details>
          </wa-card>`
        : nothing}
      ${this.editing ? this.editor() : nothing}
    `;
  }

  private button(key: string, label: string, variant: string, call: () => ReturnType<VersionsAdapter['submit']>, needsReason = false) {
    return html`<wa-button
      variant=${variant}
      appearance=${variant === 'neutral' ? 'outlined' : 'accent'}
      ?loading=${this.busy === key}
      @click=${() => this.run(key, needsReason, call())}
      >${label}</wa-button
    >`;
  }

  /** A product and claims rules have a form; other content is JSON only. */
  private hasForm(content: unknown): boolean {
    return this.adapter.kind === 'product' || isClaimsRules(content);
  }

  /** The main facts of a product or claims rules, to read without the JSON. */
  private summary(content: unknown) {
    if (!this.hasForm(content)) return nothing;
    const c = (content ?? {}) as Record<string, unknown>;
    const row = (dt: string, dd: unknown) => html`<div class="pv-dl__row"><dt>${dt}</dt><dd>${dd || '–'}</dd></div>`;
    if (this.adapter.kind === 'product') {
      const f = productFormFrom(c);
      return html`<dl class="pv-dl">
        ${row(msg('Market', { id: 'claim.market' }), `${f.market}, ${f.currency}`)}
        ${row(msg('Species', { id: 'product.species' }), f.species.join(', '))}
        ${row(msg('Claims rules series', { id: 'product.ruleSeries' }), f.ruleSeries)}
        ${row(msg('Tariff series (optional)', { id: 'product.tariffSeries' }), f.tariffSeries)}
        ${row(msg('Annual limits', { id: 'product.annualLimits' }), f.annualLimits)}
        ${row(msg('Deductible', { id: 'product.deductible' }), f.deductibles.map((d) => d.code).join(', '))}
        ${row(msg('Waiting period, days', { id: 'product.waiting' }), f.waitingPeriodDays)}
      </dl>`;
    }
    const r = rulesFormFrom(c);
    return html`<dl class="pv-dl">
      ${row(msg('Market', { id: 'claim.market' }), r.market)}
      ${row(msg('Settled automatically up to', { id: 'rules.autoSettle' }), r.autoSettleMax)}
      ${row(msg('Categories never reimbursed', { id: 'rules.nonReimbursable' }), r.nonReimbursable)}
      ${row(msg('Diagnosis groups', { id: 'rules.groups' }), String(Object.keys((c.diagnosisGroups as object) ?? {}).length))}
    </dl>`;
  }

  /** The form's result, or null with its problems shown. */
  private formResult(): ContentResult | null {
    const el = this.renderRoot.querySelector<HTMLElement & { result(): ContentResult }>('pv-product-content, pv-rules-content');
    if (!el) return null;
    const r = el.result();
    if (r.problems.length) {
      this.notice = { variant: 'danger', text: r.problems.map((p) => problemLabel(p)).join(' ') };
      return null;
    }
    return r;
  }

  private switchMode(mode: 'form' | 'json') {
    if (mode === this.mode) return;
    if (mode === 'json') {
      const r = this.formResult();
      if (!r) return;
      this.form = { ...this.form, json: JSON.stringify(r.content, null, 2) };
    } else {
      const parsed = parseJson(this.form.json);
      if (!parsed.ok) {
        this.notice = { variant: 'danger', text: `${msg('The content is not valid JSON:', { id: 'catalog.badJson' })} ${parsed.error}` };
        return;
      }
      this.formContent = parsed.value;
    }
    this.notice = null;
    this.mode = mode;
  }

  private startEdit(mode: 'new' | 'edit') {
    const v = this.selected!;
    this.editing = mode;
    this.formContent = v.content;
    this.mode = this.hasForm(v.content) ? 'form' : 'json';
    this.form = {
      version: mode === 'new' ? this.adapter.nextVersion(this.rows) : v.label,
      from: v.from,
      to: v.to ?? '',
      model: v.model ?? '',
      json: JSON.stringify(v.content, null, 2),
    };
  }

  private editor() {
    const isNew = this.editing === 'new';
    const set = (k: keyof VersionsPanel['form']) => (e: Event) => (this.form = { ...this.form, [k]: (e.target as HTMLInputElement).value });
    return html`<wa-card>
      <h3 slot="header">${isNew ? msg('New draft', { id: 'catalog.newDraft' }) : msg('Edit the draft', { id: 'catalog.editDraft' })}</h3>
      <form @submit=${this.save}>
        <div class="row">
          ${this.adapter.kind === 'product'
            ? html`<wa-input label=${msg('Version', { id: 'settings.version' })} ?disabled=${!isNew} .value=${this.form.version} @input=${set('version')}></wa-input>`
            : html`<wa-input label=${msg('Calculation model', { id: 'catalog.model' })} .value=${this.form.model} @input=${set('model')}></wa-input>`}
          <wa-input type="date" label=${this.adapter.kind === 'product' ? msg('Sales from', { id: 'catalog.salesFrom' }) : msg('In force from', { id: 'catalog.effectiveFrom' })} .value=${this.form.from} @input=${set('from')}></wa-input>
          ${this.adapter.kind === 'product' ? html`<wa-input type="date" label=${msg('Sales until (optional)', { id: 'catalog.salesUntil' })} .value=${this.form.to} @input=${set('to')}></wa-input>` : nothing}
        </div>
        ${this.hasForm(this.formContent)
          ? html`<div class="modes" role="group" aria-label=${msg('Edit as', { id: 'catalog.editAs' })}>
              <wa-button size="small" appearance=${this.mode === 'form' ? 'accent' : 'outlined'} aria-pressed=${this.mode === 'form'} @click=${() => this.switchMode('form')}
                >${msg('Form', { id: 'catalog.form' })}</wa-button
              >
              <wa-button size="small" appearance=${this.mode === 'json' ? 'accent' : 'outlined'} aria-pressed=${this.mode === 'json'} @click=${() => this.switchMode('json')}>JSON</wa-button>
            </div>`
          : nothing}
        ${this.mode === 'form'
          ? this.adapter.kind === 'product'
            ? html`<pv-product-content .api=${this.api} .content=${this.formContent}></pv-product-content>`
            : html`<pv-rules-content .content=${this.formContent}></pv-rules-content>`
          : html`<wa-textarea label=${msg('Content (JSON)', { id: 'catalog.json' })} rows="24" .value=${this.form.json} @input=${set('json')}></wa-textarea>`}
        <div class="row">
          <wa-button type="submit" variant="brand" ?loading=${this.busy === 'save'}>${msg('Save the draft', { id: 'catalog.save' })}</wa-button>
          <wa-button appearance="outlined" @click=${() => (this.editing = null)}>${msg('Cancel', { id: 'catalog.cancel' })}</wa-button>
        </div>
      </form>
    </wa-card>`;
  }

  private async save(e: Event) {
    e.preventDefault();
    let content: unknown;
    if (this.mode === 'form') {
      const r = this.formResult();
      if (!r) return;
      content = r.content;
    } else {
      const parsed = parseJson(this.form.json);
      if (!parsed.ok) {
        this.notice = { variant: 'danger', text: `${msg('The content is not valid JSON:', { id: 'catalog.badJson' })} ${parsed.error}` };
        return;
      }
      content = parsed.value;
    }
    const f = { version: this.form.version.trim(), from: this.form.from, to: this.form.to, model: this.form.model.trim(), content };
    const ok = await this.run('save', false, this.editing === 'new' ? this.adapter.create(f) : this.adapter.update(this.selected!, f));
    if (ok) this.editing = null;
  }

  private async run(key: string, needsReason: boolean, call: Call): Promise<boolean> {
    if (needsReason && !this.reason.trim()) {
      this.notice = { variant: 'danger', text: msg('Give a reason for the change.', { id: 'settings.needReason' }) };
      return false;
    }
    this.busy = key;
    const r = await act(call, () => ({ variant: 'success', text: msg('Done.', { id: 'catalog.done' }) }));
    this.busy = '';
    this.notice = r.notice;
    if (r.ok) {
      this.reason = '';
      await this.load(key === 'save' && this.editing === 'new' ? undefined : this.selected?.key);
      if (key === 'save' && this.editing === 'new') this.selected = this.rows.at(-1) ?? null;
    }
    return r.ok;
  }
}
