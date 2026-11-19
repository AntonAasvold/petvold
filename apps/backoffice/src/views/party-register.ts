/** <pv-party-register>: register a person or an organization (ADR 0026), with a personal or organization number. */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import type { Api } from '../api/client.ts';
import { act, type Notice } from '../actions.ts';
import { partyFields } from '../components/party-fields.ts';
import { IdempotencyKeys } from '../decide.ts';
import { emptyParty, partyProblems, registerBody, type IdentifierForm, type PartyForm } from '../party-logic.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { problemLabel } from './labels.ts';

@customElement('pv-party-register')
export class PartyRegister extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private form: PartyForm = emptyParty();
  @state() private identifier: IdentifierForm = { type: 'personal-number', country: 'SE', value: '' };
  @state() private shown: string[] = [];
  @state() private notice: Notice | null = null;
  @state() private busy = false;
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = [
    pvComponents,
    css`
      :host {
        display: block;
        max-width: 60rem;
      }
      .crumbs {
        display: flex;
        gap: var(--space-2);
        font-size: 13px;
        color: var(--text-muted);
      }
      .crumbs a {
        color: var(--text-secondary);
      }
      h1 {
        margin: var(--space-2) 0 var(--space-8);
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--space-4);
      }
      .row > * {
        flex: 1 1 200px;
      }
    `,
  ];

  render() {
    const set = (patch: Partial<PartyForm>) => {
      this.form = { ...this.form, ...patch };
      this.keys.done('register');
    };
    return html`
      <nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
        <a href="/parties" @click=${(e: Event) => (e.preventDefault(), navigate('/parties'))}>${msg('Parties', { id: 'nav.parties' })}</a>
        <span aria-hidden="true">/</span><span aria-current="page">${msg('Register a party', { id: 'party.register' })}</span>
      </nav>
      <h1>${msg('Register a party', { id: 'party.register' })}</h1>
      <form class="pv-card pv-card--strong" @submit=${this.submit} novalidate>
        <div class="pv-card__body">
          ${partyFields(this.form, set, { fixed: false })}
          <div class="row">
            <wa-select
              label=${msg('Number', { id: 'party.number' })}
              value=${this.identifier.type}
              @change=${(e: Event) => (this.identifier = { ...this.identifier, type: (e.target as HTMLSelectElement).value as IdentifierForm['type'] })}
            >
              <wa-option value="personal-number">${msg('Personal number', { id: 'party.personalNumber' })}</wa-option>
              <wa-option value="organization-number">${msg('Organization number', { id: 'party.orgNumber' })}</wa-option>
            </wa-select>
            <wa-input
              label=${msg('Number (optional)', { id: 'party.numberOptional' })}
              autocomplete="off"
              .value=${this.identifier.value}
              @input=${(e: Event) => (this.identifier = { ...this.identifier, value: (e.target as HTMLInputElement).value, country: this.form.market })}
            ></wa-input>
          </div>
          ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing}
          ${this.notice ? html`<wa-callout variant=${this.notice.variant} role="alert">${this.notice.text}</wa-callout>` : nothing}
          <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Register the party', { id: 'party.submitRegister' })}</wa-button>
        </div>
      </form>
    `;
  }

  private async submit(e: Event) {
    e.preventDefault();
    this.shown = partyProblems(this.form);
    if (this.shown.length) return;
    this.busy = true;
    let created: { id: string } | undefined;
    const { ok, notice } = await act(
      async () => {
        const r = await this.api.POST('/v1/parties', {
          params: { header: { 'Idempotency-Key': this.keys.for('register') } },
          body: registerBody(this.form, { ...this.identifier, country: this.form.market }) as never,
        });
        created = r.data;
        return r;
      },
      () => ({ variant: 'success', text: msg('The party is registered.', { id: 'party.registered' }) }),
    );
    this.busy = false;
    if (ok && created) {
      this.keys.done('register');
      navigate(`/parties/${encodeURIComponent(created.id)}`);
      return;
    }
    this.notice = notice;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-party-register': PartyRegister;
  }
}
