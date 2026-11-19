/**
 * <pv-litter-register>: register a litter (ADR 0027): the breeder owns every
 * animal from the birth date, and each animal is registered with its name, sex
 * and an optional microchip in the same call.
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
import type { Api } from '../api/client.ts';
import { act, type Notice } from '../actions.ts';
import { emptyLitterAnimal, litterBody, litterProblems, type LitterAnimalForm, type LitterForm } from '../animal-logic.ts';
import { IdempotencyKeys } from '../decide.ts';
import { loadReferences, type References } from '../reference.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { problemLabel } from './labels.ts';

const today = () => new Date().toISOString().slice(0, 10);

@customElement('pv-litter-register')
export class LitterRegister extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private form: LitterForm = { market: 'SE', species: '', birthDate: '', damId: '', sireId: '', breederPartyId: '', animals: [emptyLitterAnimal()] };
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
        max-width: 64rem;
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
        flex: 1 1 180px;
      }
      .puppy {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.4fr) auto;
        align-items: end;
        gap: var(--space-3);
        padding-bottom: var(--space-4);
        border-bottom: var(--border-hairline) solid var(--line);
      }
      @media (max-width: 900px) {
        .puppy {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    void loadReferences(this.api).then((r) => (this.refs = r), () => undefined);
  }

  private set(patch: Partial<LitterForm>) {
    this.form = { ...this.form, ...patch };
    this.keys.done('litter');
  }

  private setAnimal(i: number, patch: Partial<LitterAnimalForm>) {
    this.set({ animals: this.form.animals.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  }

  render() {
    const f = this.form;
    const r = this.refs;
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    const breeds = (r?.breeds ?? []).filter((b) => !f.species || b.parent === f.species);
    return html`
      <nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
        <a href="/animals" @click=${(e: Event) => (e.preventDefault(), navigate('/animals'))}>${msg('Animals', { id: 'nav.animals' })}</a>
        <span aria-hidden="true">/</span><span aria-current="page">${msg('Register a litter', { id: 'litter.register' })}</span>
      </nav>
      <h1>${msg('Register a litter', { id: 'litter.register' })}</h1>
      <form class="pv-card pv-card--strong" @submit=${this.submit} novalidate>
        <div class="pv-card__body">
          <div class="row">
            <wa-input label=${msg('Market', { id: 'claim.market' })} .value=${f.market} @input=${(e: Event) => this.set({ market: value(e) })}></wa-input>
            <wa-select label=${msg('Species', { id: 'animal.species' })} value=${f.species} @change=${(e: Event) => this.set({ species: value(e) })}>
              ${(r?.species ?? []).map((s) => html`<wa-option value=${s.code}>${s.label}</wa-option>`)}
            </wa-select>
            <wa-input type="date" label=${msg('Date of birth', { id: 'party.birthDate' })} .value=${f.birthDate} @input=${(e: Event) => this.set({ birthDate: value(e) })}></wa-input>
          </div>
          <div class="row">
            <wa-input label=${msg('Breeder (party id)', { id: 'litter.breeder' })} hint=${msg('Owns every animal from the birth date', { id: 'litter.breederHint' })} .value=${f.breederPartyId} @input=${(e: Event) => this.set({ breederPartyId: value(e) })}></wa-input>
            <wa-input label=${msg('Dam (animal id, optional)', { id: 'litter.dam' })} .value=${f.damId} @input=${(e: Event) => this.set({ damId: value(e) })}></wa-input>
            <wa-input label=${msg('Sire (animal id, optional)', { id: 'litter.sire' })} .value=${f.sireId} @input=${(e: Event) => this.set({ sireId: value(e) })}></wa-input>
          </div>
          ${f.animals.map(
            (a, i) => html`<div class="puppy" role="group" aria-label=${`${msg('Animal', { id: 'claim.animal' })} ${i + 1}`}>
              <wa-input label=${msg('Name', { id: 'party.name' })} .value=${a.name} @input=${(e: Event) => this.setAnimal(i, { name: value(e) })}></wa-input>
              <wa-select label=${msg('Sex', { id: 'animal.sex' })} value=${a.sex} @change=${(e: Event) => this.setAnimal(i, { sex: value(e) })}>
                ${(r?.sexes ?? []).map((s) => html`<wa-option value=${s.code}>${s.label}</wa-option>`)}
              </wa-select>
              <wa-select label=${msg('Breed (optional)', { id: 'animal.breed' })} value=${a.breed} with-clear @change=${(e: Event) => this.setAnimal(i, { breed: value(e) })}>
                ${breeds.map((b) => html`<wa-option value=${b.code}>${b.label}</wa-option>`)}
              </wa-select>
              <wa-input label=${msg('Microchip (optional)', { id: 'animal.chipOptional' })} .value=${a.microchip} @input=${(e: Event) => this.setAnimal(i, { microchip: value(e) })}></wa-input>
              <wa-button appearance="plain" ?disabled=${f.animals.length === 1} @click=${() => this.set({ animals: f.animals.filter((_, j) => j !== i) })}
                ><wa-icon name="trash" label=${`${msg('Remove', { id: 'litter.remove' })} ${i + 1}`}></wa-icon
              ></wa-button>
            </div>`,
          )}
          <div class="row">
            <wa-button appearance="outlined" ?disabled=${f.animals.length >= 24} @click=${() => this.set({ animals: [...f.animals, emptyLitterAnimal()] })}
              ><wa-icon slot="start" name="plus"></wa-icon>${msg('Add an animal', { id: 'litter.addAnimal' })}</wa-button
            >
          </div>
          ${this.shown.length ? html`<wa-callout variant="danger" role="alert">${this.shown.map((p) => html`<div>${problemLabel(p)}</div>`)}</wa-callout>` : nothing}
          ${this.notice ? html`<wa-callout variant=${this.notice.variant} role="alert">${this.notice.text}</wa-callout>` : nothing}
          <wa-button type="submit" variant="brand" ?loading=${this.busy}>${msg('Register the litter', { id: 'litter.submit' })} · ${f.animals.length}</wa-button>
        </div>
      </form>
    `;
  }

  private async submit(e: Event) {
    e.preventDefault();
    this.shown = litterProblems(this.form, today());
    if (this.shown.length) return;
    this.busy = true;
    let created: { id: string } | undefined;
    const { ok, notice } = await act(
      async () => {
        const res = await this.api.POST('/v1/litters', { params: { header: { 'Idempotency-Key': this.keys.for('litter') } }, body: litterBody(this.form) as never });
        created = res.data;
        return res;
      },
      () => ({ variant: 'success', text: msg('The litter is registered.', { id: 'litter.registered' }) }),
    );
    this.busy = false;
    if (ok && created) {
      this.keys.done('litter');
      navigate(`/litters/${encodeURIComponent(created.id)}`);
      return;
    }
    this.notice = notice;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-litter-register': LitterRegister;
  }
}
