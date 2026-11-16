/** <pv-login-view>: a dev token in development, else the insurer's identity service. */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/card/card.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import { DEV_TOKENS } from '../auth.ts';

@customElement('pv-login-view')
export class LoginView extends LitElement {
  @property() kind: 'dev' | 'oidc' = 'dev';
  @property() error = '';
  @state() private token: string = DEV_TOKENS[0];

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    wa-card {
      width: min(26rem, 90vw);
    }
    form {
      display: grid;
      gap: var(--wa-space-m);
    }
  `;

  render() {
    return html`<wa-card>
      <h2 slot="header">${msg('Sign in', { id: 'login.title' })}</h2>
      ${this.error ? html`<wa-callout variant="danger">${this.error}</wa-callout>` : nothing}
      ${this.kind === 'dev'
        ? html`<form @submit=${this.submit}>
            <p>${msg("Development: pick one of the dev server's tokens.", { id: 'login.dev' })}</p>
            <wa-select name="token" label="Token" value=${this.token} @change=${(e: Event) => (this.token = (e.target as HTMLSelectElement).value)}>
              ${DEV_TOKENS.map((t) => html`<wa-option value=${t}>${t}</wa-option>`)}
            </wa-select>
            <wa-button type="submit" variant="brand">${msg('Sign in', { id: 'login.signIn' })}</wa-button>
          </form>`
        : html`<wa-button variant="brand" @click=${() => this.dispatchEvent(new CustomEvent('pv-sign-in', { detail: {} }))}
            >${msg("Sign in with the insurer's account", { id: 'login.oidc' })}</wa-button
          >`}
    </wa-card>`;
  }

  private submit(e: Event) {
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('pv-sign-in', { detail: { token: this.token } }));
  }
}
