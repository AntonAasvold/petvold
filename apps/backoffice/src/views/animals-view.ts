/**
 * <pv-animals>: find an animal in the register (ADR 0024) by microchip,
 * registration number, passport, owner or id, and register an animal or a
 * litter. Searching by owner lists every animal the party owns today.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { normalizeChip } from '../animal-logic.ts';
import { formatDate } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { labelOf, loadReferences, type References } from '../reference.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';

type Animal = components['schemas']['AnimalRecord'];
type By = 'microchip' | 'registration' | 'passport' | 'ownerPartyId' | 'id';

@customElement('pv-animals')
export class AnimalsView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @state() private by: By = 'microchip';
  @state() private value = '';
  @state() private results: Animal[] | null = null;
  @state() private refs: References | null = null;
  @state() private message = '';
  @state() private busy = false;

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
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-4);
      }
      .actions {
        display: flex;
        gap: var(--space-3);
      }
      h1 {
        margin: 0;
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--space-4);
      }
      .row > wa-input {
        flex: 1 1 220px;
      }
      .row > wa-select {
        flex: 0 1 240px;
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    void loadReferences(this.api).then((r) => (this.refs = r), () => undefined);
  }

  render() {
    const mayWrite = !!this.me?.permissions.includes('animals:write');
    return html`
      <div class="head">
        <h1>${msg('Animals', { id: 'nav.animals' })}</h1>
        ${mayWrite
          ? html`<div class="actions">
              <wa-button appearance="outlined" @click=${() => navigate('/litters/new')}><wa-icon slot="start" name="plus"></wa-icon>${msg('Register a litter', { id: 'litter.register' })}</wa-button>
              <wa-button appearance="outlined" @click=${() => navigate('/animals/new')}><wa-icon slot="start" name="plus"></wa-icon>${msg('Register an animal', { id: 'animal.register' })}</wa-button>
            </div>`
          : nothing}
      </div>
      <section class="pv-card" aria-labelledby="find">
        <div class="pv-card__head"><h2 class="pv-card__title" id="find">${msg('Find an animal', { id: 'animal.find' })}</h2></div>
        <form class="pv-card__body" role="search" @submit=${this.search}>
          <div class="row">
            <wa-select label=${msg('By', { id: 'party.findBy' })} value=${this.by} @change=${(e: Event) => (this.by = (e.target as HTMLSelectElement).value as By)}>
              <wa-option value="microchip">${msg('Microchip', { id: 'animal.microchip' })}</wa-option>
              <wa-option value="registration">${msg('Registration number', { id: 'animal.registration' })}</wa-option>
              <wa-option value="passport">${msg('Passport', { id: 'animal.passport' })}</wa-option>
              <wa-option value="ownerPartyId">${msg('Owner (party id)', { id: 'animal.byOwner' })}</wa-option>
              <wa-option value="id">${msg('Animal id', { id: 'animal.id' })}</wa-option>
            </wa-select>
            <wa-input label=${msg('Value', { id: 'party.value' })} autocomplete="off" .value=${this.value} @input=${(e: Event) => (this.value = (e.target as HTMLInputElement).value)}></wa-input>
            <wa-button type="submit" variant="brand" ?loading=${this.busy}><wa-icon slot="start" name="magnifying-glass"></wa-icon>${msg('Search', { id: 'party.search' })}</wa-button>
          </div>
          ${this.message ? html`<wa-callout variant="neutral" role="status">${this.message}</wa-callout>` : nothing}
        </form>
        ${this.results
          ? html`<pv-data-grid
              .columns=${this.columns()}
              .rows=${this.results}
              label=${msg('Animals', { id: 'nav.animals' })}
              empty-text=${msg('No animal found within your markets.', { id: 'animal.notFound' })}
              @pv-row-activate=${(e: CustomEvent<{ row: Animal }>) => navigate(`/animals/${encodeURIComponent(e.detail.row.id)}`)}
            ></pv-data-grid>`
          : nothing}
      </section>
    `;
  }

  private columns(): Column<Animal>[] {
    const lang = getLocale();
    const r = this.refs;
    return [
      { key: 'name', header: msg('Name', { id: 'party.name' }), value: (a) => a.name },
      { key: 'species', header: msg('Species', { id: 'animal.species' }), value: (a) => `${labelOf(r?.species ?? [], a.species)}${a.breed ? `, ${labelOf(r?.breeds ?? [], a.breed)}` : ''}` },
      { key: 'born', header: msg('Date of birth', { id: 'party.birthDate' }), value: (a) => formatDate(a.birthDate, lang) },
      { key: 'id', header: msg('Animal id', { id: 'animal.id' }), value: (a) => a.id },
    ];
  }

  private async search(e: Event) {
    e.preventDefault();
    const v = this.value.trim();
    this.message = '';
    this.results = null;
    if (!v) return;
    if (this.by === 'id') return navigate(`/animals/${encodeURIComponent(v)}`);
    this.busy = true;
    try {
      const query = this.by === 'microchip' ? { microchip: normalizeChip(v) } : { [this.by]: v };
      this.results = (await unwrap(this.api.GET('/v1/animals', { params: { query } }))).items;
    } catch (err) {
      this.message = (err as Problem).title;
    } finally {
      this.busy = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-animals': AnimalsView;
  }
}
