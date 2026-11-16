/** <pv-policies-search>: find policies by policy, animal, party, personal number or microchip. */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import '../components/data-grid.ts';
import type { Column } from '../components/data-grid.ts';
import { formatDate, formatMoney } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { parseSearch, versionOn } from '../policy-logic.ts';
import { navigate } from '../router.ts';
import { policyStatusLabel } from './labels.ts';

type Policy = components['schemas']['PolicyRecord'];
const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-policies-search')
export class PoliciesSearch extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private query = '';
  @state() private results: Policy[] | null = null;
  @state() private loading = false;
  @state() private message = '';

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    h2 {
      margin-top: 0;
    }
    form {
      display: flex;
      gap: var(--wa-space-s);
      align-items: end;
      margin-bottom: var(--wa-space-m);
      max-width: 40rem;
    }
    wa-input {
      flex: 1;
    }
  `;

  private async search(e: Event) {
    e.preventDefault();
    const s = parseSearch(this.query);
    this.message = '';
    this.results = null;
    if (s.kind === 'unknown') {
      this.message = msg('Give a policy, animal or party id, a personal number or a microchip.', { id: 'policies.searchHelp' });
      return;
    }
    if (s.kind === 'policy') return navigate(`/policies/${encodeURIComponent(s.id)}`);
    this.loading = true;
    try {
      let query: { animalId: string } | { policyholderPartyId: string } | null = null;
      if (s.kind === 'animal') query = { animalId: s.id };
      if (s.kind === 'party') query = { policyholderPartyId: s.id };
      if (s.kind === 'microchip') {
        const animals = await unwrap(this.api.GET('/v1/animals', { params: { query: { microchip: s.value } } }));
        if (animals.items[0]) query = { animalId: animals.items[0].id };
      }
      if (s.kind === 'personal-number') {
        // In the body, never in the address (ADR 0026).
        const parties = await unwrap(this.api.POST('/v1/parties/searches', { body: { type: 'personal-number', country: 'SE', value: s.value } }));
        if (parties.items[0]) query = { policyholderPartyId: parties.items[0].id };
      }
      this.results = query ? (await unwrap(this.api.GET('/v1/policies', { params: { query } }))).items : [];
    } catch (err) {
      this.message = (err as Problem).title;
    } finally {
      this.loading = false;
    }
  }

  private columns(): Column<Policy>[] {
    const lang = getLocale();
    return [
      { key: 'id', header: msg('Policy', { id: 'claims.col.policy' }), value: (p) => p.id },
      { key: 'animal', header: msg('Animal', { id: 'policy.animal' }), value: (p) => p.animalId },
      { key: 'holder', header: msg('Policyholder', { id: 'policy.holder' }), value: (p) => versionOn(p.versions, today())?.policyholderPartyId ?? '–' },
      { key: 'product', header: msg('Product', { id: 'policy.product' }), value: (p) => p.terms.at(-1)?.productVersion ?? '–' },
      { key: 'end', header: msg('Term ends', { id: 'policy.termEnds' }), value: (p) => (p.terms.at(-1) ? formatDate(p.terms.at(-1)!.endDate, lang) : '–') },
      {
        key: 'premium',
        header: msg('Premium', { id: 'policy.premium' }),
        align: 'end',
        value: (p) => (p.terms.at(-1) ? formatMoney(p.terms.at(-1)!.premium, p.terms.at(-1)!.currency, lang) : '–'),
      },
      {
        key: 'status',
        header: msg('Status', { id: 'claims.col.status' }),
        value: (p) => {
          const s = versionOn(p.versions, today())?.status ?? 'cancelled';
          return html`<wa-badge variant=${s === 'active' ? 'success' : 'neutral'}>${policyStatusLabel(s)}</wa-badge>`;
        },
      },
    ];
  }

  render() {
    return html`
      <h2>${msg('Policies', { id: 'policies.title' })}</h2>
      <form @submit=${this.search} role="search">
        <wa-input
          label=${msg('Search', { id: 'policies.search' })}
          hint=${msg('Policy, animal or party id, personal number or microchip', { id: 'policies.searchHint' })}
          .value=${this.query}
          @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
        ></wa-input>
        <wa-button type="submit" variant="brand" ?loading=${this.loading}><wa-icon slot="start" name="magnifying-glass"></wa-icon>${msg('Search', { id: 'policies.search' })}</wa-button>
      </form>
      ${this.message ? html`<wa-callout variant="neutral">${this.message}</wa-callout>` : nothing}
      ${this.results
        ? html`<pv-data-grid
            .columns=${this.columns()}
            .rows=${this.results}
            label=${msg('Policies', { id: 'policies.title' })}
            empty-text=${msg('No policies found.', { id: 'policies.none' })}
            @pv-row-activate=${(e: CustomEvent<{ row: Policy }>) => navigate(`/policies/${encodeURIComponent(e.detail.row.id)}`)}
          ></pv-data-grid>`
        : nothing}
    `;
  }
}
