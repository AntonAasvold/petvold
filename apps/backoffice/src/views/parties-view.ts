/**
 * <pv-parties>: find a party by a part of the name or email, by personal or
 * organization number, or by id, and register a new one (ADR 0026, 0039). The
 * text or number is sent in the body of a search, never in an address.
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
import { displayName, partyStatus } from '../party-logic.ts';

type PartyRecord = components['schemas']['PartyRecord'];
import type { Me } from '../permissions.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';

@customElement('pv-parties')
export class PartiesView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @state() private type: 'text' | 'personal-number' | 'organization-number' | 'id' = 'text';
  /** The parties a search by name or email found. */
  @state() private found: PartyRecord[] | null = null;
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
              <wa-option value="text">${msg('Name or email', { id: 'party.byText' })}</wa-option>
              <wa-option value="personal-number">${msg('Personal number', { id: 'party.personalNumber' })}</wa-option>
              <wa-option value="organization-number">${msg('Organization number', { id: 'party.orgNumber' })}</wa-option>
              <wa-option value="id">${msg('Party id', { id: 'party.id' })}</wa-option>
            </wa-select>
            <wa-input
              label=${this.type === 'id' ? msg('Party id', { id: 'party.id' }) : this.type === 'text' ? msg('Name or email', { id: 'party.byText' }) : msg('Number', { id: 'party.number' })}
              autocomplete="off"
              .value=${this.value}
              @input=${(e: Event) => (this.value = (e.target as HTMLInputElement).value)}
            ></wa-input>
            <wa-button type="submit" variant="brand" ?loading=${this.busy}><wa-icon slot="start" name="magnifying-glass"></wa-icon>${msg('Search', { id: 'party.search' })}</wa-button>
          </div>
          <p class="pv-note">${msg('A number or name is sent in the body of the search and never ends up in an address or a log. Personal numbers are shown masked. A name finds at most 50 parties.', { id: 'party.searchNote2' })}</p>
          ${this.message ? html`<wa-callout variant="neutral" role="status">${this.message}</wa-callout>` : nothing}
        </form>
      </section>
      ${this.found
        ? html`<pv-data-grid
            .columns=${this.columns()}
            .rows=${this.found}
            label=${msg('Parties found', { id: 'party.found' })}
            empty-text=${msg('No party with that name or email within your markets.', { id: 'party.noneByText' })}
            @pv-row-activate=${(e: CustomEvent<{ row: PartyRecord }>) => navigate(`/parties/${encodeURIComponent(e.detail.row.id)}`)}
          ></pv-data-grid>`
        : nothing}
    `;
  }

  private columns(): Column<PartyRecord>[] {
    return [
      { key: 'name', header: msg('Name', { id: 'party.name' }), value: (p) => displayName(p) },
      { key: 'kind', header: msg('Kind', { id: 'party.kind' }), value: (p) => (p.kind === 'person' ? msg('Person', { id: 'party.person' }) : msg('Organization', { id: 'party.organization' })) },
      { key: 'market', header: msg('Market', { id: 'policy.market' }), value: (p) => p.market },
      { key: 'email', header: msg('Email', { id: 'party.email' }), value: (p) => p.email ?? '–' },
      { key: 'city', header: msg('City', { id: 'party.city' }), value: (p) => p.address?.city ?? '–' },
      {
        key: 'status',
        header: msg('Status', { id: 'party.status' }),
        value: (p) => {
          const s = partyStatus(p, new Date().toISOString().slice(0, 10));
          return s === 'ended' ? msg('Ended', { id: 'party.ended' }) : s === 'restricted' ? msg('Restricted', { id: 'party.restrictedShort' }) : msg('Active', { id: 'party.active' });
        },
      },
    ];
  }

  private async search(e: Event) {
    e.preventDefault();
    const value = this.value.trim();
    this.message = '';
    if (!value) return;
    if (this.type === 'id') return navigate(`/parties/${encodeURIComponent(value)}`);
    this.busy = true;
    if (this.type === 'text') {
      try {
        if (value.length < 2) {
          this.message = msg('Write at least 2 characters.', { id: 'party.tooShort' });
          return;
        }
        this.found = (await unwrap(this.api.POST('/v1/parties/searches', { body: { text: value } }))).items;
      } catch (err) {
        this.message = (err as Problem).title;
      } finally {
        this.busy = false;
      }
      return;
    }
    this.found = null;
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
