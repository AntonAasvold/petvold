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
import { isPriceTerms, isTariff, priceTermsFormFrom, tariffFormFrom } from '../pricing-form.ts';
import { isUnderwriting, underwritingFormFrom } from '../underwriting-form.ts';
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

  static styles = [
    pvComponents,
    css`
      :host {
        display: block;
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
      wa-callout {
        margin-bottom: var(--space-6);
      }
      form {
        display: grid;
        gap: var(--space-4);
      }
      .row {
        display: flex;
        gap: var(--space-3);
        flex-wrap: wrap;
        align-items: end;
      }
      .row > wa-input {
        flex: 1;
        min-width: 10rem;
      }
      .buttons {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--space-3);
      }
      .pv-card__body p {
        margin: 0;
      }
      pre,
      wa-textarea::part(textarea) {
        font-family: var(--font-mono);
        font-size: 12px;
      }
      pre {
        max-height: 28rem;
        overflow: auto;
        margin: var(--space-3) 0 0;
      }
      .modes {
        display: flex;
        gap: var(--space-2);
      }
      details {
        margin-top: var(--space-4);
      }
      details summary {
        cursor: pointer;
        font: 500 13px/1.4 var(--font-sans);
        color: var(--text-secondary);
      }
      @media (max-width: 900px) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

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
    const inForce = [...this.rows].reverse().find((r) => r.status === 'published');
    const drafts = this.rows.filter((r) => r.status === 'draft' || r.status === 'in_review').length;
    const row = (dt: string, dd: unknown) => html`<div class="pv-dl__row"><dt>${dt}</dt><dd>${dd}</dd></div>`;
    return html`
      <ul class="facts">
        <li>${msg('Published', { id: 'catalog.status.published' })}: <strong class="pv-mono">${inForce ? `${inForce.label}, ${formatDate(inForce.from, lang)}` : '–'}</strong></li>
        <li>${msg('Drafts and in review', { id: 'catalog.openVersions' })}: <strong>${drafts}</strong></li>
        <li>${msg('Versions', { id: 'settings.versions' })}: <strong>${this.rows.length}</strong></li>
      </ul>
      ${this.notice
        ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'danger' ? 'alert' : 'status'}
            >${this.notice.text}
            ${this.notice.reload ? html`<wa-button size="small" appearance="outlined" @click=${() => this.load()}>${msg('Reload', { id: 'common.reload' })}</wa-button>` : nothing}</wa-callout
          >`
        : nothing}
      <div class="cols">
        <div class="basis">
          <section class="pv-card" aria-labelledby="versions">
            <div class="pv-card__head"><h2 class="pv-card__title" id="versions">${msg('Versions', { id: 'settings.versions' })}</h2></div>
            <pv-data-grid
              .columns=${this.columns()}
              .rows=${this.rows}
              label=${msg('Versions', { id: 'settings.versions' })}
              @pv-row-activate=${(e: CustomEvent<{ row: VersionRow }>) => ((this.selected = e.detail.row), (this.editing = null))}
            ></pv-data-grid>
          </section>
          ${this.editing
            ? this.editor()
            : v
              ? html`<section class="pv-card" aria-labelledby="content">
                  <div class="pv-card__head">
                    <h2 class="pv-card__title" id="content">${msg('Content', { id: 'notice.content' })}</h2>
                    <span class="pv-card__meta pv-mono">${v.label}</span>
                  </div>
                  <div class="pv-card__body">
                    ${this.summary(v.content)}
                    <details ?open=${!this.hasForm(v.content)}>
                      <summary>${msg('The content as JSON', { id: 'catalog.asJson' })}</summary>
                      <pre>${JSON.stringify(v.content, null, 2)}</pre>
                    </details>
                  </div>
                </section>`
              : nothing}
        </div>
        <div class="side">
          ${v && !this.editing
            ? html`<section class="pv-card ${actions.length ? 'pv-card--strong' : ''}" aria-labelledby="version">
                <div class="pv-card__head">
                  <h2 class="pv-card__title" id="version">${msg('Version', { id: 'settings.version' })} ${v.label}</h2>
                  <span class="pv-badge ${v.status === 'published' || v.status === 'retired' ? 'pv-badge--solid' : 'pv-badge--pending'}">${this.statusLabel(v.status)}</span>
                </div>
                <div class="pv-card__body">
                  <dl>
                    ${v.model ? row(msg('Calculation model', { id: 'catalog.model' }), v.model) : nothing}
                    ${row(msg('Created', { id: 'catalog.created' }), `${v.createdBy}, ${formatDateTime(v.createdAt, lang)}`)}
                    ${v.submittedBy ? row(msg('Submitted by', { id: 'catalog.submittedBy' }), v.submittedBy) : nothing}
                    ${v.publishedBy ? row(msg('Published by', { id: 'catalog.publishedBy' }), v.publishedBy) : nothing}
                    ${v.note ? row(msg('Note', { id: 'policy.note' }), v.note) : nothing}
                  </dl>
                  <div class="buttons">
                    ${actions.includes('submit') ? this.button('submit', msg('Submit for review', { id: 'catalog.submit' }), 'brand', () => this.adapter.submit(v)) : nothing}
                    ${actions.includes('publish') ? this.button('publish', msg('Publish', { id: 'catalog.publish' }), 'brand', () => this.adapter.publish(v)) : nothing}
                    ${v.status === 'in_review' && v.submittedBy === this.me?.subject ? html`<p class="pv-note">${msg('Someone else must publish what you submitted.', { id: 'catalog.fourEyes' })}</p>` : nothing}
                    ${actions.includes('edit') ? html`<wa-button appearance="outlined" @click=${() => this.startEdit('edit')}><wa-icon slot="start" name="pen"></wa-icon>${msg('Edit', { id: 'catalog.edit' })}</wa-button>` : nothing}
                    ${actions.includes('copy') ? html`<wa-button appearance="outlined" @click=${() => this.startEdit('new')}><wa-icon slot="start" name="plus"></wa-icon>${msg('New draft from this', { id: 'catalog.copy' })}</wa-button>` : nothing}
                  </div>
                  ${actions.includes('return') || actions.includes('end')
                    ? html`<form @submit=${(e: Event) => e.preventDefault()}>
                        <wa-input label=${msg('Reason', { id: 'claim.reason' })} .value=${this.reason} @input=${(e: Event) => (this.reason = (e.target as HTMLInputElement).value)}></wa-input>
                        ${actions.includes('end') && this.adapter.kind === 'product'
                          ? html`<wa-input type="date" label=${msg('Last day of sales is the day before', { id: 'catalog.salesTo' })} .value=${this.endDate} @input=${(e: Event) => (this.endDate = (e.target as HTMLInputElement).value)}></wa-input>`
                          : nothing}
                        <div class="buttons">
                          ${actions.includes('return') ? this.button('return', msg('Return to draft', { id: 'catalog.return' }), 'neutral', () => this.adapter.return(v, this.reason.trim()), true) : nothing}
                          ${actions.includes('end')
                            ? this.button('end', this.adapter.kind === 'product' ? msg('End sales', { id: 'catalog.endSales' }) : msg('Retire', { id: 'catalog.retire' }), 'neutral', () => this.adapter.end(v, this.reason.trim(), this.endDate), true)
                            : nothing}
                        </div>
                      </form>`
                    : nothing}
                </div>
              </section>`
            : nothing}
        </div>
      </div>
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

  /** The form for the content: a product, claims rules, a tariff, price terms or underwriting rules. Other content is JSON only. */
  private formKind(content: unknown): 'product' | 'rules' | 'tariff' | 'terms' | 'underwriting' | null {
    if (this.adapter.kind === 'product') return 'product';
    if (isClaimsRules(content)) return 'rules';
    if (isTariff(content)) return 'tariff';
    if (isPriceTerms(content)) return 'terms';
    if (isUnderwriting(content)) return 'underwriting';
    return null;
  }

  private hasForm(content: unknown): boolean {
    return this.formKind(content) !== null;
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
    if (this.formKind(c) === 'tariff') {
      const t = tariffFormFrom(c);
      return html`<dl class="pv-dl">
        ${row(msg('Market', { id: 'claim.market' }), `${t.market}, ${t.currency}`)}
        ${row(msg('Base premiums a year', { id: 'tariff.base' }), t.basePremiums.split('\n').length)}
        ${row(msg('Breed groups', { id: 'tariff.breedLegend' }), t.breedGroupFactors.split('\n').join(', '))}
        ${row(msg('Zones', { id: 'tariff.zones' }), t.zoneFactors.split('\n').join(', '))}
        ${row(msg('Lowest premium a year', { id: 'tariff.minimum' }), t.minimumAnnual)}
      </dl>`;
    }
    if (this.formKind(c) === 'terms') {
      const t = priceTermsFormFrom(c);
      return html`<dl class="pv-dl">
        ${row(msg('Market', { id: 'claim.market' }), `${t.market}, ${t.currency}`)}
        ${row(msg('Group discounts', { id: 'terms.groups' }), t.groupDiscounts.split('\n').join(', '))}
        ${row(msg('Campaign codes', { id: 'terms.campaigns' }), ((c.campaigns as { code: string }[]) ?? []).map((k) => k.code).join(', '))}
        ${row(msg('Largest discount in all, per cent', { id: 'terms.max' }), t.maxTotalDiscount)}
      </dl>`;
    }
    if (this.formKind(c) === 'underwriting') {
      const u = underwritingFormFrom(c);
      return html`<dl class="pv-dl">
        ${row(msg('Market', { id: 'claim.market' }), u.market)}
        ${row(msg('Age limits', { id: 'uwform.ageLimits' }), u.ageLimits.split('\n').join(' · '))}
        ${row(msg('Health questions', { id: 'uwform.questions' }), u.questions.map((q) => q.id).join(', '))}
        ${row(msg('What a yes leads to', { id: 'uwform.rules' }), u.answerRules.length)}
        ${row(msg('Breeds', { id: 'reference.breeds' }), u.breedRules.split('\n').filter(Boolean).length)}
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
    const el = this.renderRoot.querySelector<HTMLElement & { result(): ContentResult }>('pv-product-content, pv-rules-content, pv-tariff-content, pv-price-terms-content, pv-underwriting-content');
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

  private contentForm() {
    switch (this.formKind(this.formContent)) {
      case 'product':
        return html`<pv-product-content .api=${this.api} .content=${this.formContent}></pv-product-content>`;
      case 'tariff':
        return html`<pv-tariff-content .content=${this.formContent}></pv-tariff-content>`;
      case 'terms':
        return html`<pv-price-terms-content .content=${this.formContent}></pv-price-terms-content>`;
      case 'underwriting':
        return html`<pv-underwriting-content .content=${this.formContent}></pv-underwriting-content>`;
      default:
        return html`<pv-rules-content .content=${this.formContent}></pv-rules-content>`;
    }
  }

  private editor() {
    const isNew = this.editing === 'new';
    const set = (k: keyof VersionsPanel['form']) => (e: Event) => (this.form = { ...this.form, [k]: (e.target as HTMLInputElement).value });
    return html`<section class="pv-card pv-card--strong" aria-labelledby="editor">
      <div class="pv-card__head">
        <h2 class="pv-card__title" id="editor">${isNew ? msg('New draft', { id: 'catalog.newDraft' }) : msg('Edit the draft', { id: 'catalog.editDraft' })}</h2>
      </div>
      <form class="pv-card__body" @submit=${this.save}>
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
          ? this.contentForm()
          : html`<wa-textarea label=${msg('Content (JSON)', { id: 'catalog.json' })} rows="24" .value=${this.form.json} @input=${set('json')}></wa-textarea>`}
        <div class="row">
          <wa-button type="submit" variant="brand" ?loading=${this.busy === 'save'}>${msg('Save the draft', { id: 'catalog.save' })}</wa-button>
          <wa-button appearance="outlined" @click=${() => (this.editing = null)}>${msg('Cancel', { id: 'catalog.cancel' })}</wa-button>
        </div>
      </form>
    </section>`;
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
