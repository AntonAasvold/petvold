/**
 * <pv-app>: signs in, reads GET /v1/me, shows the sections the caller may use,
 * and routes to the views (ADR 0035).
 */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import { apiClient, unwrap, type Api } from '../api/client.ts';
import type { Session } from '../auth.ts';
import { getLocale, useLocale, type Locale } from '../i18n.ts';
import { countLabel, sectionsFor, type Me } from '../permissions.ts';
import { searchTarget } from '../policy-logic.ts';
import { pvComponents } from '../styles/pv-components.ts';
import { match, navigate, type Route } from '../router.ts';
import '../views/login-view.ts';
import '../views/claims-queue.ts';
import '../views/claim-detail.ts';
import '../views/claim-register.ts';
import '../views/jobs-view.ts';
import '../views/parties-view.ts';
import '../views/policy-issue.ts';
import '../views/animals-view.ts';
import '../views/animal-register.ts';
import '../views/animal-detail.ts';
import '../views/litter-register.ts';
import '../views/litter-detail.ts';
import '../views/party-register.ts';
import '../views/party-detail.ts';
import '../views/job-detail.ts';
import '../views/policies-search.ts';
import '../views/policy-detail.ts';
import '../views/applications-queue.ts';
import '../views/application-detail.ts';
import '../views/proposals-queue.ts';
import '../views/notices-queue.ts';
import '../views/notice-detail.ts';
import '../views/webhooks-view.ts';
import '../views/webhook-detail.ts';
import '../views/settings-view.ts';
import '../views/catalog-views.ts';

@customElement('pv-app')
export class AppShell extends LitElement {
  @property({ attribute: false }) session!: Session;
  @property({ attribute: 'api-url' }) apiUrl = 'http://localhost:8787';
  @state() private me: Me | null = null;
  @state() private path = location.pathname;
  @state() private failed = '';
  /** Waiting items per section path, e.g. { '/claims': '3' }. */
  @state() private counts: Record<string, string> = {};
  @state() private query = '';
  private api!: Api;

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
        min-height: 100vh;
        font-family: var(--font-sans);
        color: var(--ink);
        background: var(--paper);
      }
      .body {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      .side {
        flex: 0 0 clamp(220px, 18vw, 300px);
        padding: var(--space-5);
        border-right: var(--border-hairline) solid var(--line);
      }
      main {
        flex: 999 1 560px;
        min-width: 0;
        padding: var(--space-8);
      }
      .pv-topbar wa-select {
        width: 9rem;
        --wa-form-control-background-color: var(--panel-inverse);
        --wa-form-control-value-color: var(--on-inverse);
        --wa-form-control-border-color: var(--panel-inverse-line);
        --wa-form-control-height: var(--size-control);
      }
      /* The label is for screen readers; on the top bar the value says enough. */
      .pv-topbar wa-select::part(form-control-label) {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .pv-topbar__search {
        margin: 0;
      }
      .pv-topbar__search wa-icon {
        color: var(--on-inverse-muted);
      }
      .pv-topbar__search:focus-within {
        outline: var(--border-strong) solid var(--on-inverse);
        outline-offset: 2px;
      }
      .who {
        font-size: 13px;
        color: var(--on-inverse-muted);
      }
      .signout {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        height: var(--size-control);
        padding: 0 var(--space-4);
        border: var(--border-hairline) solid var(--on-inverse-muted);
        border-radius: var(--radius-md);
        background: var(--panel-inverse);
        color: var(--on-inverse);
        font: 600 14px/1 var(--font-sans);
        cursor: pointer;
      }
      .signout:hover {
        border-color: var(--on-inverse);
      }
      .signout:focus-visible {
        outline: var(--border-strong) solid var(--on-inverse);
        outline-offset: 2px;
      }
      .pv-nav__item {
        font-size: 15px;
      }
      .pv-nav__item:focus-visible {
        outline: var(--border-strong) solid var(--focus);
        outline-offset: 2px;
      }
      .pv-nav__item wa-icon {
        font-size: 18px;
      }
      .center {
        flex: 1;
        display: grid;
        place-items: center;
      }
      @media (max-width: 900px) {
        .body {
          flex-direction: column;
        }
        .side {
          flex: none;
          border-right: 0;
          border-bottom: var(--border-hairline) solid var(--line);
        }
        main {
          padding: var(--space-5);
        }
      }
    `,
  ];

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
    // A queue may have changed: count again, but not more than once a second.
    clearTimeout(this.countTimer);
    this.countTimer = setTimeout(() => void this.loadCounts(), 1000);
  };

  private countTimer: ReturnType<typeof setTimeout> | undefined;

  /** One page of each waiting queue the caller may see, for the menu's counts. */
  private async loadCounts() {
    if (!this.me) return;
    const sections = sectionsFor(this.me).filter((s) => s.count);
    const pages = await Promise.all(
      sections.map(async (s) => {
        const { data } = await (this.api.GET as (p: string, o: unknown) => Promise<{ data?: { items: unknown[]; nextCursor?: string } }>)(s.count!.path, {
          params: { query: { ...s.count!.query, limit: 100 } },
        }).catch(() => ({ data: undefined }));
        return [s.path, data ? countLabel(data) : ''] as const;
      }),
    );
    this.counts = Object.fromEntries(pages.filter(([, c]) => c && c !== '0'));
  }

  private search(e: Event) {
    e.preventDefault();
    if (!this.query.trim()) return;
    const target = searchTarget(this.query);
    navigate(target.path, target.query ? { query: target.query } : null);
    this.query = '';
  }

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
      void this.loadCounts();
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
    this.counts = {};
    navigate('/login');
  }

  private routes(): Route[] {
    return [
      { pattern: /^\/claims$/, render: () => html`<pv-claims-queue .api=${this.api} .me=${this.me}></pv-claims-queue>` },
      { pattern: /^\/claims\/new$/, render: () => html`<pv-claim-register .api=${this.api}></pv-claim-register>` },
      { pattern: /^\/claims\/(?<id>[^/]+)$/, render: (p) => html`<pv-claim-detail .api=${this.api} .me=${this.me} claim-id=${p.id!}></pv-claim-detail>` },
      { pattern: /^\/policies$/, render: () => html`<pv-policies-search .api=${this.api}></pv-policies-search>` },
      { pattern: /^\/policies\/new$/, render: () => html`<pv-policy-issue .api=${this.api}></pv-policy-issue>` },
      { pattern: /^\/policies\/(?<id>[^/]+)$/, render: (p) => html`<pv-policy-detail .api=${this.api} .me=${this.me} policy-id=${p.id!}></pv-policy-detail>` },
      { pattern: /^\/applications$/, render: () => html`<pv-applications-queue .api=${this.api}></pv-applications-queue>` },
      { pattern: /^\/applications\/(?<id>[^/]+)$/, render: (p) => html`<pv-application-detail .api=${this.api} .me=${this.me} application-id=${p.id!}></pv-application-detail>` },
      { pattern: /^\/proposals$/, render: () => html`<pv-proposals-queue .api=${this.api}></pv-proposals-queue>` },
      { pattern: /^\/notices$/, render: () => html`<pv-notices-queue .api=${this.api}></pv-notices-queue>` },
      { pattern: /^\/notices\/(?<id>[^/]+)$/, render: (p) => html`<pv-notice-detail .api=${this.api} .me=${this.me} notice-id=${p.id!}></pv-notice-detail>` },
      { pattern: /^\/webhooks$/, render: () => html`<pv-webhooks .api=${this.api} .me=${this.me}></pv-webhooks>` },
      { pattern: /^\/products$/, render: () => html`<pv-products .api=${this.api}></pv-products>` },
      { pattern: /^\/products\/(?<id>[^/]+)$/, render: (p) => html`<pv-product-detail .api=${this.api} .me=${this.me} product=${p.id!}></pv-product-detail>` },
      { pattern: /^\/rule-sets$/, render: () => html`<pv-rule-sets .api=${this.api}></pv-rule-sets>` },
      { pattern: /^\/rule-sets\/(?<id>[^/]+)$/, render: (p) => html`<pv-rule-set-detail .api=${this.api} .me=${this.me} series=${p.id!}></pv-rule-set-detail>` },
      { pattern: /^\/animals$/, render: () => html`<pv-animals .api=${this.api} .me=${this.me}></pv-animals>` },
      { pattern: /^\/animals\/new$/, render: () => html`<pv-animal-register .api=${this.api}></pv-animal-register>` },
      { pattern: /^\/animals\/(?<id>[^/]+)$/, render: (p) => html`<pv-animal-detail .api=${this.api} .me=${this.me} animal-id=${p.id!}></pv-animal-detail>` },
      { pattern: /^\/litters\/new$/, render: () => html`<pv-litter-register .api=${this.api}></pv-litter-register>` },
      { pattern: /^\/litters\/(?<id>[^/]+)$/, render: (p) => html`<pv-litter-detail .api=${this.api} litter-id=${p.id!}></pv-litter-detail>` },
      { pattern: /^\/parties$/, render: () => html`<pv-parties .api=${this.api} .me=${this.me}></pv-parties>` },
      { pattern: /^\/parties\/new$/, render: () => html`<pv-party-register .api=${this.api}></pv-party-register>` },
      { pattern: /^\/parties\/(?<id>[^/]+)$/, render: (p) => html`<pv-party-detail .api=${this.api} .me=${this.me} party-id=${p.id!}></pv-party-detail>` },
      { pattern: /^\/jobs$/, render: () => html`<pv-jobs .api=${this.api} .me=${this.me}></pv-jobs>` },
      { pattern: /^\/jobs\/(?<id>[^/]+)$/, render: (p) => html`<pv-job-detail .api=${this.api} .me=${this.me} job=${p.id!}></pv-job-detail>` },
      { pattern: /^\/settings$/, render: () => html`<pv-settings .api=${this.api} .me=${this.me}></pv-settings>` },
      { pattern: /^\/webhooks\/(?<id>[^/]+)$/, render: (p) => html`<pv-webhook-detail .api=${this.api} .me=${this.me} subscription-id=${p.id!}></pv-webhook-detail>` },
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
      <header class="pv-topbar">
        <div class="pv-topbar__brand">
          <span class="pv-topbar__name">Petvold</span>
          <span class="pv-topbar__divider" aria-hidden="true"></span>
          <span class="pv-topbar__context">Back office</span>
        </div>
        <span class="pv-topbar__spacer"></span>
        <form class="pv-topbar__search" role="search" @submit=${this.search}>
          <wa-icon name="magnifying-glass" aria-hidden="true"></wa-icon>
          <input
            type="search"
            aria-label=${msg('Search for a claim, policy, animal or customer', { id: 'nav.search' })}
            placeholder=${msg('Claim, policy, animal or customer', { id: 'nav.searchPlaceholder' })}
            .value=${this.query}
            @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
          />
        </form>
        <wa-select label=${msg('Language', { id: 'nav.language' })} value=${getLocale()} @change=${(e: Event) => useLocale((e.target as HTMLSelectElement).value as Locale)}>
          <wa-option value="sv">Svenska</wa-option>
          <wa-option value="en">English</wa-option>
        </wa-select>
        <span class="who">${this.me.subject}</span>
        <button class="signout" type="button" @click=${() => this.signOut()}>
          <wa-icon name="arrow-right-from-bracket" aria-hidden="true"></wa-icon>${msg('Sign out', { id: 'nav.signOut' })}
        </button>
      </header>
      <div class="body">
        <nav class="side" aria-label=${msg('Sections', { id: 'nav.sections' })}>
          <div class="pv-nav">
            ${sections.map(
              (s) =>
                html`<a class="pv-nav__item" href=${s.path} aria-current=${this.path.startsWith(s.path) ? 'page' : nothing} @click=${(e: Event) => (e.preventDefault(), navigate(s.path))}>
                  <wa-icon name=${s.icon} aria-hidden="true"></wa-icon><span>${this.label(s.label)}</span>
                  ${this.counts[s.path] ? html`<span class="pv-nav__count" aria-label=${`${this.counts[s.path]} ${msg('waiting', { id: 'nav.waiting' })}`}>${this.counts[s.path]}</span>` : nothing}
                </a>`,
            )}
          </div>
        </nav>
        <main>
          ${found
            ? found.route.render(found.params)
            : html`<wa-callout variant="neutral">${msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' })}</wa-callout>`}
        </main>
      </div>
    `;
  }

  private label(id: string) {
    switch (id) {
      case 'nav.claims':
        return msg('Claims', { id: 'nav.claims' });
      case 'nav.policies':
        return msg('Policies', { id: 'nav.policies' });
      case 'nav.applications':
        return msg('Applications', { id: 'nav.applications' });
      case 'nav.proposals':
        return msg('Proposals', { id: 'nav.proposals' });
      case 'nav.notices':
        return msg('Notices', { id: 'nav.notices' });
      case 'nav.webhooks':
        return msg('Webhooks', { id: 'nav.webhooks' });
      case 'nav.animals':
        return msg('Animals', { id: 'nav.animals' });
      case 'nav.parties':
        return msg('Parties', { id: 'nav.parties' });
      case 'nav.jobs':
        return msg('Runs', { id: 'nav.jobs' });
      case 'nav.products':
        return msg('Products', { id: 'nav.products' });
      case 'nav.ruleSets':
        return msg('Rule sets', { id: 'nav.ruleSets' });
      case 'nav.settings':
        return msg('Settings', { id: 'nav.settings' });
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
