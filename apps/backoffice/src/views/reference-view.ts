/**
 * <pv-reference-data>: species, breeds and sexes (ADR 0022), with their labels
 * in every language, whether they are offered for new data, and their history.
 * A change is a new revision with a reason; a code never changes, and an
 * inactive one stays readable for what is stored.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';
import '@awesome.me/webawesome/dist/components/tab/tab.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { act, type Notice } from '../actions.ts';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { tabFromUrl } from '../overview-logic.ts';
import type { Me } from '../permissions.ts';
import { REFERENCE_KINDS, referenceBody, referenceProblems, suggestCode, type ReferenceForm, type ReferenceKind, type ReferenceProblem } from '../reference-logic.ts';
import { pvComponents } from '../styles/pv-components.ts';

type Item = components['schemas']['ReferenceItem'];

/** The languages the form always offers; a code's other languages are kept and shown too. */
const LANGUAGES = ['sv', 'en'];
const value = (e: Event) => (e.target as HTMLInputElement).value;
const empty = (): ReferenceForm => ({ code: '', labels: { sv: '', en: '' }, parent: '', active: true, reason: '' });

@customElement('pv-reference-data')
export class ReferenceView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @state() private kind: ReferenceKind = 'species';
  @state() private items: Item[] = [];
  @state() private species: Item[] = [];
  @state() private selected: Item | null = null;
  @state() private revisions: Item[] = [];
  @state() private form: ReferenceForm = empty();
  @state() private shown: ReferenceProblem[] = [];
  @state() private notice: Notice | null = null;
  @state() private loading = false;
  @state() private busy = false;

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
      h2 {
        margin-top: 0;
      }
      wa-tab-group {
        margin-bottom: var(--space-4);
      }
      .cols {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-6);
      }
      .list {
        flex: 999 1 520px;
        min-width: 0;
      }
      .side {
        flex: 1 1 340px;
        max-width: 420px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      form {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .pv-card__body p {
        margin: 0;
      }
      @media (max-width: 52rem) {
        .side {
          max-width: none;
        }
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    this.kind = tabFromUrl(location.search, REFERENCE_KINDS) ?? this.kind;
    void this.load();
  }

  private async load() {
    this.loading = true;
    const [items, species] = await Promise.all([
      unwrap(this.api.GET('/v1/reference-data/{kind}', { params: { path: { kind: this.kind } } })),
      this.kind === 'breed' ? unwrap(this.api.GET('/v1/reference-data/{kind}', { params: { path: { kind: 'species' } } })) : Promise.resolve({ items: this.species }),
    ]).catch(() => [{ items: [] as Item[] }, { items: [] as Item[] }] as const);
    this.items = items.items;
    this.species = species.items;
    this.loading = false;
  }

  private show(kind: ReferenceKind) {
    this.kind = kind;
    this.select(null);
    this.notice = null;
    void this.load();
  }

  private async select(item: Item | null) {
    this.selected = item;
    this.shown = [];
    this.revisions = [];
    this.form = item
      ? { code: item.code, labels: { ...Object.fromEntries(LANGUAGES.map((l) => [l, ''])), ...item.labels }, parent: item.parent ?? '', active: item.active, reason: '' }
      : { ...empty(), parent: this.kind === 'breed' ? (this.species[0]?.code ?? '') : '' };
    if (item) {
      const { data } = await this.api.GET('/v1/reference-data/{kind}/{code}/revisions', { params: { path: { kind: this.kind, code: item.code } } });
      this.revisions = [...(data?.items ?? [])].reverse();
    }
  }

  private kindLabel(k: ReferenceKind) {
    switch (k) {
      case 'species':
        return msg('Species', { id: 'reference.species' });
      case 'breed':
        return msg('Breeds', { id: 'reference.breeds' });
      case 'sex':
        return msg('Sexes', { id: 'reference.sexes' });
    }
  }

  private columns(): Column<Item>[] {
    return [
      { key: 'code', header: msg('Code', { id: 'reference.code' }), value: (i) => html`<span class="pv-mono">${i.code}</span>`, sortable: true },
      { key: 'sv', header: msg('Swedish', { id: 'reference.sv' }), value: (i) => i.labels.sv ?? '–' },
      { key: 'en', header: msg('English', { id: 'reference.en' }), value: (i) => i.labels.en ?? '–' },
      ...(this.kind === 'breed' ? [{ key: 'parent', header: msg('Species', { id: 'reference.species' }), value: (i: Item) => i.parent ?? '–' }] : []),
      {
        key: 'active',
        header: msg('Offered', { id: 'reference.active' }),
        value: (i) => (i.active ? msg('Yes', { id: 'common.yes' }) : html`<span class="pv-badge pv-badge--pending">${msg('No', { id: 'common.no' })}</span>`),
      },
      { key: 'revision', header: msg('Revision', { id: 'reference.revision' }), value: (i) => i.revision, align: 'end' },
    ];
  }

  private async save(e: Event) {
    e.preventDefault();
    const isNew = !this.selected;
    this.shown = referenceProblems(this.kind, this.form, isNew);
    if (this.shown.length) return;
    const code = (isNew ? this.form.code : this.selected!.code).trim();
    this.busy = true;
    const { ok, notice } = await act(
      () =>
        this.api.PUT('/v1/reference-data/{kind}/{code}', {
          params: { path: { kind: this.kind, code } },
          body: referenceBody(this.kind, this.form, this.selected?.revision),
        }),
      () => ({ variant: 'success', text: isNew ? msg('The code is added.', { id: 'reference.added' }) : msg('Saved as a new revision.', { id: 'reference.saved' }) }),
    );
    this.busy = false;
    this.notice = notice;
    if (ok) {
      await this.load();
      await this.select(this.items.find((i) => i.code === code) ?? null);
    }
  }

  private problemText(p: ReferenceProblem) {
    switch (p) {
      case 'code':
        return msg('A code is small letters, digits and dashes, e.g. dog-labrador-retriever.', { id: 'reference.codeProblem' });
      case 'labels':
        return msg('Give at least one label.', { id: 'reference.labelsProblem' });
      case 'parent':
        return msg('Choose the species of the breed.', { id: 'reference.parentProblem' });
      case 'reason':
        return msg('Give a reason for the change.', { id: 'settings.needReason' });
    }
  }

  private formCard() {
    const f = this.form;
    const set = (patch: Partial<ReferenceForm>) => (this.form = { ...this.form, ...patch });
    const writable = !!this.me?.permissions.includes('catalog:write');
    const isNew = !this.selected;
    if (isNew && !writable) return nothing;
    const lang = getLocale();
    return html`<section class="pv-card" aria-labelledby="ref">
      <div class="pv-card__head">
        <h2 class="pv-card__title" id="ref">${isNew ? msg('New code', { id: 'reference.new' }) : this.selected!.code}</h2>
        ${!isNew ? html`<span class="pv-card__meta">${msg('Revision', { id: 'reference.revision' })} ${this.selected!.revision}</span>` : nothing}
      </div>
      <form class="pv-card__body" @submit=${(e: Event) => this.save(e)} novalidate>
        ${isNew
          ? html`${this.kind === 'breed'
                ? html`<wa-select label=${msg('Species', { id: 'reference.species' })} value=${f.parent} @change=${(e: Event) => set({ parent: value(e) })}>
                    ${this.species.filter((s) => s.active).map((s) => html`<wa-option value=${s.code}>${s.label}</wa-option>`)}
                  </wa-select>`
                : nothing}
              <wa-input
                label=${msg('Code', { id: 'reference.code' })}
                hint=${msg('Never changes. Suggested from the English label.', { id: 'reference.codeHint' })}
                .value=${f.code}
                @input=${(e: Event) => set({ code: value(e) })}
              ></wa-input>`
          : html`<p>${msg('A code never changes. A change is a new revision; data already stored keeps its code.', { id: 'reference.how' })}</p>`}
        ${Object.keys(f.labels).map(
          (l) => html`<wa-input
            label=${`${msg('Label', { id: 'reference.label' })} (${l})`}
            .value=${f.labels[l] ?? ''}
            ?disabled=${!writable}
            @input=${(e: Event) => {
              const labels = { ...this.form.labels, [l]: value(e) };
              set(isNew && l === 'en' && (!f.code || f.code === suggestCode(this.kind, f.labels.en ?? '', f.parent)) ? { labels, code: suggestCode(this.kind, value(e), f.parent) } : { labels });
            }}
          ></wa-input>`,
        )}
        <wa-checkbox .checked=${f.active} ?disabled=${!writable} @change=${(e: Event) => set({ active: (e.target as HTMLInputElement).checked })}
          >${msg('Offered for new data', { id: 'reference.offered' })}</wa-checkbox
        >
        ${!isNew && writable
          ? html`<wa-textarea label=${msg('Reason for the change', { id: 'settings.reason' })} rows="2" .value=${f.reason} @input=${(e: Event) => set({ reason: value(e) })}></wa-textarea>`
          : nothing}
        ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${this.problemText(p)}</div>`)}</wa-callout>` : nothing}
        ${writable
          ? html`<wa-button type="submit" variant="brand" ?loading=${this.busy}>${isNew ? msg('Add the code', { id: 'reference.add' }) : msg('Save a new version', { id: 'settings.save' })}</wa-button>`
          : nothing}
        ${!isNew && this.revisions.length
          ? html`<dl class="pv-dl">
              ${this.revisions.map(
                (r) =>
                  html`<div class="pv-dl__row">
                    <dt>${msg('Revision', { id: 'reference.revision' })} ${r.revision}</dt>
                    <dd>${r.reason ?? '–'} · ${r.changedBy}, ${formatDateTime(r.changedAt, lang)}</dd>
                  </div>`,
              )}
            </dl>`
          : nothing}
        ${!isNew ? html`<wa-button appearance="plain" @click=${() => this.select(null)}>${msg('New code', { id: 'reference.new' })}</wa-button>` : nothing}
      </form>
    </section>`;
  }

  render() {
    return html`
      <h2>${msg('Reference data', { id: 'nav.reference' })}</h2>
      <wa-tab-group @wa-tab-show=${(e: CustomEvent<{ name: string }>) => this.show(e.detail.name as ReferenceKind)}>
        ${REFERENCE_KINDS.map((k) => html`<wa-tab panel=${k} ?active=${k === this.kind}>${this.kindLabel(k)}</wa-tab>`)}
      </wa-tab-group>
      ${this.notice ? html`<wa-callout variant=${this.notice.variant} role=${this.notice.variant === 'success' ? 'status' : 'alert'}>${this.notice.text}</wa-callout>` : nothing}
      <div class="cols">
        <div class="list">
          <pv-data-grid
            .columns=${this.columns()}
            .rows=${this.items}
            ?loading=${this.loading}
            label=${this.kindLabel(this.kind)}
            empty-text=${msg('Nothing to show.', { id: 'common.empty' })}
            @pv-row-activate=${(e: CustomEvent<{ row: Item }>) => this.select(e.detail.row)}
          ></pv-data-grid>
        </div>
        <div class="side">${this.formCard()}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-reference-data': ReferenceView;
  }
}
