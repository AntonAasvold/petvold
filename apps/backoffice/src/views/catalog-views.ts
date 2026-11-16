/**
 * Products and rule sets (ADR 0021, 0023): the lists, and a product or a rule
 * set series with its versions in <pv-versions-panel>.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/icon/icon.js';
import '@awesome.me/webawesome/dist/components/badge/badge.js';
import { unwrap, type Api } from '../api/client.ts';
import type { components } from '../api/schema';
import { nextProductVersion } from '../catalog-logic.ts';
import '../components/data-grid.ts';
import '../components/versions-panel.ts';
import type { Column } from '../components/data-grid.ts';
import type { DraftForm, VersionRow, VersionsAdapter } from '../components/versions-panel.ts';
import { IdempotencyKeys } from '../decide.ts';
import { formatDate } from '../format.ts';
import { getLocale } from '../i18n.ts';
import type { Me } from '../permissions.ts';
import { navigate } from '../router.ts';

type ProductVersion = components['schemas']['ProductVersion'];
type RuleSetVersion = components['schemas']['RuleSetVersion'];
type ProductItem = { product: string; versions: ProductVersion[] };
type SeriesItem = { series: string; kind: string; versions: { version: number; status: string; effectiveFrom: string }[] };

const styles = css`
  h2 {
    margin-top: 0;
  }
`;
const latest = <T,>(xs: T[]) => xs.at(-1);

@customElement('pv-products')
export class ProductsView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private items: ProductItem[] = [];
  @state() private loading = true;

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = styles;

  async connectedCallback() {
    super.connectedCallback();
    this.items = (await unwrap(this.api.GET('/v1/products', { params: { query: { limit: 200 } } }))).items;
    this.loading = false;
  }

  render() {
    const lang = getLocale();
    const columns: Column<ProductItem>[] = [
      { key: 'product', header: msg('Product', { id: 'policy.product' }), value: (p) => p.product },
      { key: 'name', header: msg('Name', { id: 'catalog.name' }), value: (p) => latest(p.versions)?.name ?? '–' },
      { key: 'latest', header: msg('Latest version', { id: 'catalog.latest' }), value: (p) => latest(p.versions)?.version ?? '–' },
      { key: 'status', header: msg('Status', { id: 'claims.col.status' }), value: (p) => latest(p.versions)?.status ?? '–' },
      { key: 'from', header: msg('Sales from', { id: 'catalog.salesFrom' }), value: (p) => (latest(p.versions) ? formatDate(latest(p.versions)!.salesFrom, lang) : '–') },
    ];
    return html`<h2>${msg('Products', { id: 'catalog.products' })}</h2>
      <pv-data-grid
        .columns=${columns}
        .rows=${this.items}
        ?loading=${this.loading}
        label=${msg('Products', { id: 'catalog.products' })}
        @pv-row-activate=${(e: CustomEvent<{ row: ProductItem }>) => navigate(`/products/${encodeURIComponent(e.detail.row.product)}`)}
      ></pv-data-grid>`;
  }
}

@customElement('pv-product-detail')
export class ProductDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property() product = '';
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = styles;

  private adapter(): VersionsAdapter {
    const api = this.api;
    const product = this.product;
    const keys = this.keys;
    const path = (v: VersionRow) => ({ product, version: v.key });
    const header = (k: string) => ({ 'Idempotency-Key': keys.for(k) });
    const body = (f: DraftForm) => ({ content: f.content as never, salesFrom: f.from, ...(f.to ? { salesTo: f.to } : {}) });
    const done = <T extends { response: Response }>(k: string) => (r: T) => (r.response.ok && keys.done(k), r);
    return {
      kind: 'product',
      async list() {
        const items = (await unwrap(api.GET('/v1/products/{product}/versions', { params: { path: { product }, query: { limit: 200 } } }))).items;
        return items.map((v) => ({
          key: v.version,
          label: v.version,
          status: v.status,
          from: v.salesFrom,
          ...(v.salesTo ? { to: v.salesTo } : {}),
          content: v.content,
          ...(v.submittedBy ? { submittedBy: v.submittedBy } : {}),
          createdBy: v.createdBy,
          createdAt: v.createdAt,
          ...(v.publishedBy ? { publishedBy: v.publishedBy } : {}),
          ...(v.note ? { note: v.note } : {}),
        }));
      },
      create: (f) => () => api.POST('/v1/products/{product}/versions', { params: { path: { product }, header: header(`create:${f.version}`) }, body: { version: f.version, ...body(f) } }).then(done(`create:${f.version}`)),
      update: (v, f) => () => api.PUT('/v1/products/{product}/versions/{version}', { params: { path: path(v) }, body: body(f) }),
      submit: (v) => () => api.POST('/v1/products/{product}/versions/{version}/submissions', { params: { path: path(v), header: header(`submit:${v.key}`) }, body: {} }).then(done(`submit:${v.key}`)),
      publish: (v) => () => api.POST('/v1/products/{product}/versions/{version}/publications', { params: { path: path(v), header: header(`publish:${v.key}`) }, body: {} }).then(done(`publish:${v.key}`)),
      return: (v, reason) => () => api.POST('/v1/products/{product}/versions/{version}/returns', { params: { path: path(v), header: header(`return:${v.key}`) }, body: { reason } }).then(done(`return:${v.key}`)),
      end: (v, reason, date) => () =>
        api.POST('/v1/products/{product}/versions/{version}/sales-endings', { params: { path: path(v), header: header(`end:${v.key}`) }, body: { salesTo: date, reason } }).then(done(`end:${v.key}`)),
      nextVersion: (rows) => nextProductVersion(rows.map((r) => r.label), new Date().getFullYear()),
    };
  }

  render() {
    return html`<wa-button appearance="plain" size="small" @click=${() => navigate('/products')}
        ><wa-icon slot="start" name="arrow-left"></wa-icon>${msg('Back', { id: 'common.back' })}</wa-button
      >
      <h2>${msg('Product', { id: 'policy.product' })} ${this.product}</h2>
      <pv-versions-panel .adapter=${this.adapter()} .me=${this.me}></pv-versions-panel>`;
  }
}

@customElement('pv-rule-sets')
export class RuleSetsView extends LitElement {
  @property({ attribute: false }) api!: Api;
  @state() private items: SeriesItem[] = [];
  @state() private loading = true;

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = styles;

  async connectedCallback() {
    super.connectedCallback();
    this.items = (await unwrap(this.api.GET('/v1/rule-sets', { params: { query: { limit: 200 } } }))).items;
    this.loading = false;
  }

  render() {
    const lang = getLocale();
    const columns: Column<SeriesItem>[] = [
      { key: 'series', header: msg('Series', { id: 'catalog.series' }), value: (s) => s.series },
      { key: 'kind', header: msg('Kind', { id: 'catalog.kind' }), value: (s) => s.kind },
      { key: 'latest', header: msg('Latest version', { id: 'catalog.latest' }), value: (s) => latest(s.versions)?.version ?? '–' },
      { key: 'status', header: msg('Status', { id: 'claims.col.status' }), value: (s) => latest(s.versions)?.status ?? '–' },
      { key: 'from', header: msg('In force from', { id: 'catalog.effectiveFrom' }), value: (s) => (latest(s.versions) ? formatDate(latest(s.versions)!.effectiveFrom, lang) : '–') },
    ];
    return html`<h2>${msg('Rule sets', { id: 'catalog.ruleSets' })}</h2>
      <pv-data-grid
        .columns=${columns}
        .rows=${this.items}
        ?loading=${this.loading}
        label=${msg('Rule sets', { id: 'catalog.ruleSets' })}
        @pv-row-activate=${(e: CustomEvent<{ row: SeriesItem }>) => navigate(`/rule-sets/${encodeURIComponent(e.detail.row.series)}`)}
      ></pv-data-grid>`;
  }
}

@customElement('pv-rule-set-detail')
export class RuleSetDetail extends LitElement {
  @property({ attribute: false }) api!: Api;
  @property({ attribute: false }) me: Me | null = null;
  @property() series = '';
  private keys = new IdempotencyKeys();

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = styles;

  private adapter(): VersionsAdapter {
    const api = this.api;
    const series = this.series;
    const keys = this.keys;
    const path = (v: VersionRow) => ({ series, version: Number(v.key) });
    const header = (k: string) => ({ 'Idempotency-Key': keys.for(k) });
    const body = (f: DraftForm) => ({ content: f.content as never, calculationModel: f.model, effectiveFrom: f.from });
    const done = <T extends { response: Response }>(k: string) => (r: T) => (r.response.ok && keys.done(k), r);
    const row = (v: RuleSetVersion): VersionRow => ({
      key: String(v.version),
      label: String(v.version),
      status: v.status,
      from: v.effectiveFrom,
      content: v.content,
      model: v.calculationModel,
      ...(v.submittedBy ? { submittedBy: v.submittedBy } : {}),
      createdBy: v.createdBy,
      createdAt: v.createdAt,
      ...(v.publishedBy ? { publishedBy: v.publishedBy } : {}),
      ...(v.note ? { note: v.note } : {}),
    });
    return {
      kind: 'rules',
      list: async () => (await unwrap(api.GET('/v1/rule-sets/{series}/versions', { params: { path: { series }, query: { limit: 200 } } }))).items.map(row),
      create: (f) => () => api.POST('/v1/rule-sets/{series}/versions', { params: { path: { series }, header: header('create') }, body: body(f) }).then(done('create')),
      update: (v, f) => () => api.PUT('/v1/rule-sets/{series}/versions/{version}', { params: { path: path(v) }, body: body(f) }),
      submit: (v) => () => api.POST('/v1/rule-sets/{series}/versions/{version}/submissions', { params: { path: path(v), header: header(`submit:${v.key}`) }, body: {} }).then(done(`submit:${v.key}`)),
      publish: (v) => () => api.POST('/v1/rule-sets/{series}/versions/{version}/publications', { params: { path: path(v), header: header(`publish:${v.key}`) }, body: {} }).then(done(`publish:${v.key}`)),
      return: (v, reason) => () => api.POST('/v1/rule-sets/{series}/versions/{version}/returns', { params: { path: path(v), header: header(`return:${v.key}`) }, body: { reason } }).then(done(`return:${v.key}`)),
      end: (v, reason) => () => api.POST('/v1/rule-sets/{series}/versions/{version}/retirements', { params: { path: path(v), header: header(`end:${v.key}`) }, body: { reason } }).then(done(`end:${v.key}`)),
      nextVersion: () => '',
    };
  }

  render() {
    return html`<wa-button appearance="plain" size="small" @click=${() => navigate('/rule-sets')}
        ><wa-icon slot="start" name="arrow-left"></wa-icon>${msg('Back', { id: 'common.back' })}</wa-button
      >
      <h2>${msg('Rule set', { id: 'catalog.ruleSet' })} ${this.series}</h2>
      <pv-versions-panel .adapter=${this.adapter()} .me=${this.me}></pv-versions-panel>`;
  }
}
