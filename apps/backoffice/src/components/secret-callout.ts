/** <pv-secret-callout>: a webhook secret, shown once, with a copy button. */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/copy-button/copy-button.js';

@customElement('pv-secret-callout')
export class SecretCallout extends LitElement {
  @property() secret = '';

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    code {
      overflow-wrap: anywhere;
    }
  `;

  render() {
    return html`<wa-callout variant="warning" role="status">
      <strong>${msg('The secret is shown only now. Store it in the receiving system.', { id: 'webhooks.secretOnce' })}</strong>
      <div><code>${this.secret}</code> <wa-copy-button value=${this.secret}></wa-copy-button></div>
    </wa-callout>`;
  }
}
