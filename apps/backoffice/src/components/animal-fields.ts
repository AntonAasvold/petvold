/**
 * The fields of an animal, shared by registering and correcting. A function
 * that renders into the calling view's shadow root. Species never changes once
 * registered, so correcting shows it but does not offer it.
 */
import { html, nothing } from 'lit';
import { msg } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';
import type { AnimalForm } from '../animal-logic.ts';
import type { References } from '../reference.ts';

export function animalFields(f: AnimalForm, refs: References | null, set: (patch: Partial<AnimalForm>) => void, o: { correcting: boolean }) {
  const breeds = (refs?.breeds ?? []).filter((b) => !f.species || b.parent === f.species);
  const value = (e: Event) => (e.target as HTMLInputElement).value;
  return html`
    <div class="row">
      ${o.correcting
        ? nothing
        : html`<wa-select label=${msg('Species', { id: 'animal.species' })} value=${f.species} @change=${(e: Event) => set({ species: value(e), breed: '' })}>
            ${(refs?.species ?? []).map((s) => html`<wa-option value=${s.code}>${s.label}</wa-option>`)}
          </wa-select>`}
      <wa-select label=${msg('Breed (optional)', { id: 'animal.breed' })} value=${f.breed} with-clear @change=${(e: Event) => set({ breed: value(e) })}>
        ${breeds.map((b) => html`<wa-option value=${b.code}>${b.label}</wa-option>`)}
      </wa-select>
      <wa-select label=${msg('Sex', { id: 'animal.sex' })} value=${f.sex} @change=${(e: Event) => set({ sex: value(e) })}>
        ${(refs?.sexes ?? []).map((s) => html`<wa-option value=${s.code}>${s.label}</wa-option>`)}
      </wa-select>
    </div>
    <div class="row">
      <wa-input label=${msg('Name', { id: 'party.name' })} .value=${f.name} @input=${(e: Event) => set({ name: value(e) })}></wa-input>
      <wa-input type="date" label=${msg('Date of birth', { id: 'party.birthDate' })} .value=${f.birthDate} @input=${(e: Event) => set({ birthDate: value(e) })}></wa-input>
      ${o.correcting
        ? html`<wa-input type="date" label=${msg('Date of death', { id: 'animal.deceasedOn' })} .value=${f.deceasedOn} @input=${(e: Event) => set({ deceasedOn: value(e) })}></wa-input>`
        : nothing}
    </div>
    <div class="row checks">
      <wa-checkbox ?checked=${f.neutered} @change=${(e: Event) => set({ neutered: (e.target as HTMLInputElement).checked })}>${msg('Neutered', { id: 'animal.neutered' })}</wa-checkbox>
      <wa-checkbox ?checked=${f.allowLookup} @change=${(e: Event) => set({ allowLookup: (e.target as HTMLInputElement).checked })}
        >${msg('Clinics may find it by its microchip', { id: 'animal.allowLookup' })}</wa-checkbox
      >
    </div>
  `;
}
