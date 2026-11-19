/** <pv-litter-detail>: a litter (ADR 0027): breeder, parents and the animals born in it. */
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/callout/callout.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import { unwrap, type Api, type Problem } from '../api/client.ts';
import type { components } from '../api/schema';
import { formatDate, formatDateTime } from '../format.ts';
import { getLocale } from '../i18n.ts';
import { labelOf, loadReferences, type References } from '../reference.ts';
import { navigate } from '../router.ts';
import { pvComponents } from '../styles/pv-components.ts';

type Litter = components['schemas']['Litter'];

@customElement('pv-litter-detail')
export class LitterDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: 'litter-id' }) litterId = '';
  @state() private litter: Litter | null = null;
  @state() private refs: References | null = null;
  @state() private problem: Problem | null = null;

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
      dd a {
        color: var(--ink);
      }
      .title {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-3);
        margin: var(--space-2) 0 var(--space-8);
      }
      h1 {
        margin: 0;
        font: 700 36px/1.1 var(--font-display);
        letter-spacing: -0.02em;
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    void loadReferences(this.api).then((r) => (this.refs = r), () => undefined);
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('litterId') || changed.has('api')) void this.load();
  }

  private async load() {
    try {
      this.litter = await unwrap(this.api.GET('/v1/litters/{litterId}', { params: { path: { litterId: this.litterId } } }));
    } catch (e) {
      this.problem = e as Problem;
    }
  }

  render() {
    const crumbs = html`<nav class="crumbs" aria-label=${msg('Breadcrumb', { id: 'common.breadcrumb' })}>
      <a href="/animals" @click=${(e: Event) => (e.preventDefault(), navigate('/animals'))}>${msg('Animals', { id: 'nav.animals' })}</a>
      <span aria-hidden="true">/</span><span aria-current="page">${this.litterId}</span>
    </nav>`;
    if (this.problem) return html`${crumbs}<wa-callout variant="neutral">${msg('Does not exist, or lies outside what you may see.', { id: 'common.notFound' })}</wa-callout>`;
    const l = this.litter;
    if (!l) return html`${crumbs}<wa-spinner></wa-spinner>`;
    const lang = getLocale();
    const link = (path: string, id: string) => html`<a href=${path} class="pv-mono" @click=${(e: Event) => (e.preventDefault(), navigate(path))}>${id}</a>`;
    return html`
      ${crumbs}
      <div class="title">
        <h1>${msg('Litter', { id: 'litter.title' })} ${formatDate(l.birthDate, lang)}</h1>
        <span class="pv-badge pv-badge--id">${l.id}</span>
        <span class="pv-badge">${labelOf(this.refs?.species ?? [], l.species)} · ${l.market}</span>
      </div>
      <section class="pv-card" aria-labelledby="litter">
        <div class="pv-card__head">
          <h2 class="pv-card__title" id="litter">${msg('Details', { id: 'claim.facts' })}</h2>
          <span class="pv-card__meta">${l.registeredBy}, ${formatDateTime(l.registeredAt, lang)}</span>
        </div>
        <div class="pv-card__body">
          <dl class="pv-dl">
            <div class="pv-dl__row"><dt>${msg('Breeder (party id)', { id: 'litter.breeder' })}</dt><dd>${link(`/parties/${l.breederPartyId}`, l.breederPartyId)}</dd></div>
            ${l.damId ? html`<div class="pv-dl__row"><dt>${msg('Dam (animal id, optional)', { id: 'litter.dam' })}</dt><dd>${link(`/animals/${l.damId}`, l.damId)}</dd></div>` : nothing}
            ${l.sireId ? html`<div class="pv-dl__row"><dt>${msg('Sire (animal id, optional)', { id: 'litter.sire' })}</dt><dd>${link(`/animals/${l.sireId}`, l.sireId)}</dd></div>` : nothing}
            ${l.animalIds.map((id, i) => html`<div class="pv-dl__row"><dt>${msg('Animal', { id: 'claim.animal' })} ${i + 1}</dt><dd>${link(`/animals/${id}`, id)}</dd></div>`)}
          </dl>
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-litter-detail': LitterDetail;
  }
}
