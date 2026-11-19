/**
 * <pv-parties>: find a party by personal or organization number, or by id,
 * and register a new one (ADR 0026). The number is sent in the body of a
 * search, never in an address.
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
import type { Me } from '../permissions.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';

@customElement('pv-parties')
export class PartiesView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @state() private type: 'personal-number' | 'organization-number' | 'id' = 'personal-number';
  @state() private country = 'SE';
  @state() private value = '';
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
        max-width: 60rem;
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-4);
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
        flex: 0 1 220px;
      }
    `,
  ];

  render() {
    const mayWrite = !!this.me?.permissions.includes('parties:write');
    return html`
      <div class="head">
        <h1>${msg('Parties', { id: 'nav.parties' })}</h1>
        ${mayWrite
          ? html`<wa-button appearance="outlined" @click=${() => navigate('/parties/new')}><wa-icon slot="start" name="plus"></wa-icon>${msg('Register a party', { id: 'party.register' })}</wa-button>`
          : nothing}
      </div>
      <section class="pv-card" aria-labelledby="find">
        <div class="pv-card__head"><h2 class="pv-card__title" id="find">${msg('Find a party', { id: 'party.find' })}</h2></div>
        <form class="pv-card__body" role="search" @submit=${this.search}>
          <div class="row">
            <wa-select label=${msg('By', { id: 'party.findBy' })} value=${this.type} @change=${(e: Event) => (this.type = (e.target as HTMLSelectElement).value as PartiesView['type'])}>
              <wa-option value="personal-number">${msg('Personal number', { id: 'party.personalNumber' })}</wa-option>
              <wa-option value="organization-number">${msg('Organization number', { id: 'party.orgNumber' })}</wa-option>
              <wa-option value="id">${msg('Party id', { id: 'party.id' })}</wa-option>
            </wa-select>
            <wa-input
              label=${this.type === 'id' ? msg('Party id', { id: 'party.id' }) : msg('Number', { id: 'party.number' })}
              autocomplete="off"
              .value=${this.value}
              @input=${(e: Event) => (this.value = (e.target as HTMLInputElement).value)}
            ></wa-input>
            <wa-button type="submit" variant="brand" ?loading=${this.busy}><wa-icon slot="start" name="magnifying-glass"></wa-icon>${msg('Search', { id: 'party.search' })}</wa-button>
          </div>
          <p class="pv-note">${msg('A number is sent in the body of the search and never ends up in an address or a log. Personal numbers are shown masked.', { id: 'party.searchNote' })}</p>
          ${this.message ? html`<wa-callout variant="neutral" role="status">${this.message}</wa-callout>` : nothing}
        </form>
      </section>
    `;
  }

  private async search(e: Event) {
    e.preventDefault();
    const value = this.value.trim();
    this.message = '';
    if (!value) return;
    if (this.type === 'id') return navigate(`/parties/${encodeURIComponent(value)}`);
    this.busy = true;
    try {
      const found = await unwrap(this.api.POST('/v1/parties/searches', { body: { type: this.type, country: this.country, value } }));
      const first = found.items[0];
      if (first) navigate(`/parties/${encodeURIComponent(first.id)}`);
      else this.message = msg('No party with that number within your markets.', { id: 'party.notFound' });
    } catch (err) {
      this.message = (err as Problem).title;
    } finally {
      this.busy = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-parties': PartiesView;
  }
}
