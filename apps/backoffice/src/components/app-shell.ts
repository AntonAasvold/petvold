/**
 * <pv-app>: signs in, reads GET /v1/me, shows the sections the caller may use,
 * and routes to the views (ADR 0035).
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { apiClient, unwrap, type Api } from '../api/client.ts';
import type { Session } from '../auth.ts';
import { getLocale, useLocale, type Locale } from '../i18n.ts';
import { sectionsFor, type Me } from '../permissions.ts';
import { match, navigate, type Route } from '../router.ts';
import '../views/login-view.ts';
import '../views/claims-queue.ts';
import '../views/claim-detail.ts';

@customElement('pv-app')
export class AppShell extends LitElement {
  @property({ attribute: false }) session!: Session;
  @property({ attribute: 'api-url' }) apiUrl = 'http://localhost:8787';
  @state() private me: Me | null = null;
  @state() private path = location.pathname;
  @state() private failed = '';
  private api!: Api;

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    :host {
      display: grid;
      grid-template-columns: 14rem 1fr;
      grid-template-rows: auto 1fr;
      min-height: 100vh;
    }
    header {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: var(--wa-space-m);
      padding: var(--wa-space-s) var(--wa-space-l);
      border-bottom: var(--wa-border-width-s) var(--wa-border-style) var(--wa-color-surface-border);
      background: var(--wa-color-surface-raised);
    }
    header h1 {
      font-size: var(--wa-font-size-l);
      margin: 0;
      flex: 1;
    }
    nav {
      padding: var(--wa-space-m);
      border-right: var(--wa-border-width-s) var(--wa-border-style) var(--wa-color-surface-border);
    }
    nav a {
      display: flex;
      gap: var(--wa-space-xs);
      align-items: center;
      padding: var(--wa-space-xs) var(--wa-space-s);
      border-radius: var(--wa-border-radius-m);
      color: inherit;
      text-decoration: none;
    }
    nav a[aria-current='page'] {
      background: var(--wa-color-brand-fill-quiet);
      color: var(--wa-color-brand-on-quiet);
    }
    main {
      padding: var(--wa-space-l);
      min-width: 0;
    }
    .who {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
    .center {
      grid-column: 1 / -1;
      display: grid;
      place-items: center;
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    this.api = apiClient(this.apiUrl, this.session);
    window.addEventListener('popstate', this.onNavigate);
    window.addEventListener('pv-navigate', this.onNavigate);
    void this.start();
  }

  disconnectedCallback(): void {
    window.removeEventListener('popstate', this.onNavigate);
    window.removeEventListener('pv-navigate', this.onNavigate);
    super.disconnectedCallback();
  }

  private onNavigate = () => {
    this.path = location.pathname;
  };

  private async start() {
    if (this.path === '/callback' && this.session.completeSignIn) {
      await this.session.completeSignIn();
      this.path = location.pathname;
    }
    if (await this.session.token()) await this.loadMe();
  }

  private async loadMe() {
    try {
      this.failed = '';
      this.me = (await unwrap(this.api.GET('/v1/me'))) as Me;
      if (this.path === '/' || this.path === '/login' || this.path === '/callback') navigate(sectionsFor(this.me)[0]?.path ?? '/');
    } catch (e) {
      this.me = null;
      this.failed = (e as { title?: string }).title ?? msg('Something went wrong.', { id: 'common.error' });
    }
  }

  private async signIn(choice?: string) {
    await this.session.signIn(choice);
    if (this.session.kind === 'dev') await this.loadMe();
  }

  private async signOut() {
    await this.session.signOut();
    this.me = null;
    navigate('/login');
  }

  private routes(): Route[] {
    return [
      { pattern: /^\/claims$/, render: () => html`<pv-claims-queue .api=${this.api}></pv-claims-queue>` },
      { pattern: /^\/claims\/(?<id>[^/]+)$/, render: (p) => html`<pv-claim-detail .api=${this.api} .me=${this.me} claim-id=${p.id!}></pv-claim-detail>` },
    ];
  }

  render() {
    if (!this.me) {
      return html`<div class="center">
        <pv-login-view .kind=${this.session?.kind ?? 'dev'} .error=${this.failed} @pv-sign-in=${(e: CustomEvent<{ token?: string }>) => this.signIn(e.detail.token)}></pv-login-view>
      </div>`;
    }
    const sections = sectionsFor(this.me);
    const found = match(this.routes(), this.path);
    return html`
      <header>
        <h1>${msg('Petvold back office', { id: 'app.title' })}</h1>
        <span class="who">${this.me.subject}</span>
        <wa-select size="small" label=${msg('Language', { id: 'nav.language' })} value=${getLocale()} @change=${(e: Event) => useLocale((e.target as HTMLSelectElement).value as Locale)}>
          <wa-option value="sv">Svenska</wa-option>
          <wa-option value="en">English</wa-option>
        </wa-select>
        <wa-button size="small" appearance="outlined" @click=${() => this.signOut()}>
          <wa-icon slot="start" name="arrow-right-from-bracket"></wa-icon>${msg('Sign out', { id: 'nav.signOut' })}
        </wa-button>
      </header>
      <nav aria-label=${msg('Sections', { id: 'nav.sections' })}>
        ${sections.map(
          (s) =>
            html`<a href=${s.path} aria-current=${this.path.startsWith(s.path) ? 'page' : nothing} @click=${(e: Event) => (e.preventDefault(), navigate(s.path))}>
              <wa-icon name=${s.icon}></wa-icon>${this.label(s.label)}</a
            >`,
        )}
      </nav>
      <main>
        ${found
          ? found.route.render(found.params)
          : html`<wa-callout variant="neutral">${msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' })}</wa-callout>`}
      </main>
    `;
  }

  private label(id: string) {
    switch (id) {
      case 'nav.claims':
        return msg('Claims', { id: 'nav.claims' });
      default:
        return id;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-app': AppShell;
  }
}
