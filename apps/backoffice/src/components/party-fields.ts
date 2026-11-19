/**
 * The fields of a party, shared by registering and changing one. A function
 * that renders into the calling view's shadow root, so the view's styles apply.
 */
import { html, nothing } from 'lit';
import { msg } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import type { PartyForm } from '../party-logic.ts';

export function partyFields(f: PartyForm, set: (patch: Partial<PartyForm>) => void, o: { fixed: boolean }) {
  const input = (key: keyof PartyForm, label: string, extra: { type?: string; hint?: string; autocomplete?: string } = {}) =>
    html`<wa-input
      label=${label}
      type=${extra.type ?? 'text'}
      hint=${extra.hint ?? nothing}
      autocomplete=${extra.autocomplete ?? 'off'}
      .value=${f[key]}
      @input=${(e: Event) => set({ [key]: (e.target as HTMLInputElement).value } as Partial<PartyForm>)}
    ></wa-input>`;
  return html`
    <div class="row">
      ${o.fixed
        ? nothing
        : html`<wa-select label=${msg('Kind', { id: 'party.kind' })} value=${f.kind} @change=${(e: Event) => set({ kind: (e.target as HTMLSelectElement).value as PartyForm['kind'] })}>
              <wa-option value="person">${msg('Person', { id: 'party.person' })}</wa-option>
              <wa-option value="organization">${msg('Organization', { id: 'party.organization' })}</wa-option>
            </wa-select>
            ${input('market', msg('Market', { id: 'claim.market' }), { hint: msg('Two capital letters, e.g. SE', { id: 'party.marketHint' }) })}`}
    </div>
    ${f.kind === 'person'
      ? html`<div class="row">
          ${input('givenName', msg('Given name', { id: 'party.givenName' }))} ${input('familyName', msg('Family name', { id: 'party.familyName' }))}
          ${input('birthDate', msg('Date of birth', { id: 'party.birthDate' }), { type: 'date' })}
        </div>`
      : html`<div class="row">${input('name', msg('Name', { id: 'party.name' }))}</div>`}
    <div class="row">
      ${input('email', msg('Email', { id: 'party.email' }), { type: 'email' })}
      ${input('phone', msg('Phone', { id: 'party.phone' }), { type: 'tel', hint: msg('International format, e.g. +46701234567', { id: 'party.phoneHint' }) })}
      ${input('language', msg('Language', { id: 'nav.language' }), { hint: msg('Two letters, e.g. sv', { id: 'party.languageHint' }) })}
    </div>
    <div class="row">
      ${input('street', msg('Street', { id: 'party.street' }))} ${input('postalCode', msg('Postal code', { id: 'party.postalCode' }))}
      ${input('city', msg('City', { id: 'party.city' }))}
    </div>
  `;
}
