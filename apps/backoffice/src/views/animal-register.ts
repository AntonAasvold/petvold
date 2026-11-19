/**
 * <pv-animal-register>: register an animal with its owner (ADR 0024). From a
 * party's page the owner is filled in (?owner=pty_…). The owner must exist as
 * a party in the animal's market.
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import type { Api } from '../api/client.ts';
import { act, type Notice } from '../actions.ts';
import { animalProblems, emptyAnimal, registerAnimalBody, type AnimalForm } from '../animal-logic.ts';
import { animalFields } from '../components/animal-fields.ts';
import { IdempotencyKeys } from '../decide.ts';
import { loadReferences, type References } from '../reference.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { problemLabel } from './labels.ts';

const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-animal-register')
export class AnimalRegister extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private form: AnimalForm = emptyAnimal(today(), new URLSearchParams(location.search).get('owner') ?? '');
  @state() private refs: References | null = null;
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
      .row.checks > * {
        flex: 0 0 auto;
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    void loadReferences(this.api).then((r) => (this.refs = r), () => undefined);
  }

  render() {
    const set = (patch: Partial<AnimalForm>) => {
      this.form = { ...this.form, ...patch };
      this.keys.done('register');
    };
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    return html`
      <nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
        <a href="/animals" @click=${(e: Event) => (e.preventDefault(), navigate('/animals'))}>${msg('Animals', { id: 'nav.animals' })}</a>
        <span aria-hidden="true">/</span><span aria-current="page">${msg('Register an animal', { id: 'animal.register' })}</span>
      </nav>
      <h1>${msg('Register an animal', { id: 'animal.register' })}</h1>
      <form class="pv-card pv-card--strong" @submit=${this.submit} novalidate>
        <div class="pv-card__body">
          <div class="row">
            <wa-input label=${msg('Market', { id: 'claim.market' })} .value=${this.form.market} @input=${(e: Event) => set({ market: value(e) })}></wa-input>
            <wa-input label=${msg('Microchip (optional)', { id: 'animal.chipOptional' })} hint=${msg('15 digits', { id: 'animal.chipHint' })} .value=${this.form.microchip} @input=${(e: Event) => set({ microchip: value(e) })}></wa-input>
          </div>
          ${animalFields(this.form, this.refs, set, { correcting: false })}
          <div class="row">
            <wa-input label=${msg('Owner (party id)', { id: 'animal.byOwner' })} hint=${msg('For example pty_owner001. Find it under Parties.', { id: 'animal.ownerHint' })} .value=${this.form.ownerPartyId} @input=${(e: Event) => set({ ownerPartyId: value(e) })}></wa-input>
            <wa-input type="date" label=${msg('Owner from', { id: 'animal.ownerFrom' })} .value=${this.form.ownerFrom} @input=${(e: Event) => set({ ownerFrom: value(e) })}></wa-input>
          </div>
          ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing}
          ${this.notice ? html`<wa-callout variant=${this.notice.variant} role="alert">${this.notice.text}</wa-callout>` : nothing}
          <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Register the animal', { id: 'animal.submitRegister' })}</wa-button>
        </div>
      </form>
    `;
  }

  private async submit(e: Event) {
    e.preventDefault();
    this.shown = animalProblems(this.form, today());
    if (this.shown.length) return;
    this.busy = true;
    let created: { id: string } | undefined;
    const { ok, notice } = await act(
      async () => {
        const r = await this.api.POST('/v1/animals', { params: { header: { 'Idempotency-Key': this.keys.for('register') } }, body: registerAnimalBody(this.form) as never });
        created = r.data;
        return r;
      },
      () => ({ variant: 'success', text: msg('The animal is registered.', { id: 'animal.registered' }) }),
    );
    this.busy = false;
    if (ok && created) {
      this.keys.done('register');
      navigate(`/animals/${encodeURIComponent(created.id)}`);
      return;
    }
    this.notice = notice;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-animal-register': AnimalRegister;
  }
}
