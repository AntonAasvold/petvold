/**
 * <pv-docs>: the system documentation, with business processes and rules,
 * functions and decisions, searchable in the browser. The pages are the
 * repository's docs/, built in.
 */
import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { msg, updateWhenLocaleChanges } from '@lit/localize';
import { Marked } from 'marked';
import '@awesome.me/webawesome/dist/components/input/input.js';
import { DOC_PAGES } from '../docs-content.ts';
import { DOC_SECTIONS, rewriteLinks, search, slugify, type DocPage, type DocSection } from '../docs-logic.ts';
import { navigate } from '../router.ts';

const known = new Set(DOC_PAGES.map((p) => `${p.section}/${p.slug}`));

/** Headings with the anchors the docs site gives them, so links to a section work. */
const markdown = new Marked({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      return `<h${depth} id="${slugify(text)}">${text}</h${depth}>\n`;
    },
  },
});

@customElement('pv-docs')
export class DocsView extends LitElement {
  /** The page shown: section and slug, or none for the start page. */
  @property() section = '';
  @property() slug = '';
  @state() private query = new URLSearchParams(location.search).get('q') ?? '';

  constructor() {
    super();
    updateWhenLocaleChanges(this);
  }

  static styles = css`
    :host {
      display: grid;
      grid-template-columns: minmax(12rem, 16rem) 1fr;
      gap: var(--wa-space-xl);
      align-items: start;
    }
    @media (max-width: 52rem) {
      :host {
        grid-template-columns: 1fr;
      }
    }
    nav h3 {
      font-size: var(--wa-font-size-s);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: var(--wa-space-l) 0 var(--wa-space-2xs);
    }
    nav a {
      display: block;
      padding: var(--wa-space-3xs) var(--wa-space-xs);
      color: inherit;
      text-decoration: none;
      border-inline-start: var(--wa-border-width-m) solid transparent;
    }
    nav a[aria-current='page'] {
      border-inline-start-color: currentColor;
      font-weight: var(--wa-font-weight-semibold);
    }
    .hits {
      list-style: none;
      padding: 0;
      margin: var(--wa-space-m) 0;
    }
    .hits li {
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      padding: var(--wa-space-s) var(--wa-space-m);
      margin-bottom: var(--wa-space-xs);
    }
    .hits a,
    article a {
      color: inherit;
      text-decoration-thickness: var(--wa-border-width-s);
      text-underline-offset: 0.2em;
    }
    .hits a {
      font-weight: var(--wa-font-weight-semibold);
    }
    .hits p {
      margin: var(--wa-space-3xs) 0 0;
      color: var(--wa-color-text-quiet);
    }
    article {
      max-width: 52rem;
      line-height: var(--wa-line-height-normal);
    }
    article table {
      border-collapse: collapse;
      width: 100%;
      margin: var(--wa-space-m) 0;
    }
    article th,
    article td {
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      padding: var(--wa-space-2xs) var(--wa-space-xs);
      text-align: start;
      vertical-align: top;
    }
    /* A rule id, like OBET-05, on one line. */
    article td:first-child {
      min-width: 9ch;
    }
    article pre {
      border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      padding: var(--wa-space-s);
      overflow-x: auto;
      font-family: var(--wa-font-family-code);
      font-size: var(--wa-font-size-s);
    }
    article code {
      font-family: var(--wa-font-family-code);
    }
  `;

  protected updated(changed: PropertyValues): void {
    // To the section a link names, once the page is drawn.
    if ((changed.has('slug') || changed.has('section')) && location.hash) {
      this.renderRoot.querySelector(`[id="${CSS.escape(decodeURIComponent(location.hash.slice(1)))}"]`)?.scrollIntoView();
    }
  }

  private page(): DocPage | undefined {
    const section = (this.section || 'processer') as DocSection;
    return DOC_PAGES.find((p) => p.section === section && p.slug === (this.slug || 'README')) ?? DOC_PAGES[0];
  }

  /** Links within the documentation open in the back office without a reload. */
  private follow(e: MouseEvent) {
    const a = (e.composedPath()[0] as HTMLElement).closest?.('a');
    const href = a?.getAttribute('href');
    if (!href?.startsWith('/docs')) return;
    e.preventDefault();
    this.query = '';
    navigate(href);
  }

  private search(e: Event) {
    this.query = (e.target as HTMLInputElement).value;
    const url = new URL(location.href);
    if (this.query) url.searchParams.set('q', this.query);
    else url.searchParams.delete('q');
    history.replaceState(history.state, '', url);
  }

  private sectionTitle(s: DocSection) {
    switch (s) {
      case 'processer':
        return msg('Processes and rules', { id: 'docs.processes' });
      case 'funktion':
        return msg('Functions', { id: 'docs.functions' });
      case 'adr':
        return msg('Decisions', { id: 'docs.decisions' });
    }
  }

  render() {
    const current = this.page();
    const hits = search(DOC_PAGES, this.query);
    return html`
      <nav aria-label=${msg('Documentation', { id: 'docs.title' })} @click=${this.follow}>
        <wa-input
          type="search"
          label=${msg('Search the documentation', { id: 'docs.search' })}
          placeholder=${msg('E.g. reminder or PREM-07', { id: 'docs.searchPlaceholder' })}
          .value=${this.query}
          @input=${this.search}
          with-clear
        ></wa-input>
        ${DOC_SECTIONS.map(
          (s) => html`<h3>${this.sectionTitle(s)}</h3>
            ${DOC_PAGES.filter((p) => p.section === s).map(
              (p) => html`<a href="/docs/${p.section}/${p.slug}" aria-current=${p === current && !this.query ? 'page' : nothing}>${p.title}</a>`,
            )}`,
        )}
      </nav>
      <div @click=${this.follow}>
        ${this.query.trim().length >= 2
          ? html`<h2>${msg('Search results', { id: 'docs.results' })}</h2>
              ${hits.length
                ? html`<ul class="hits">
                    ${hits.map(
                      (h) => html`<li>
                        <a href="/docs/${h.page.section}/${h.page.slug}${h.part.anchor ? `#${h.part.anchor}` : ''}">${h.page.title}${h.part.anchor ? html` · ${h.part.heading}` : nothing}</a>
                        <p>${h.snippet}</p>
                      </li>`,
                    )}
                  </ul>`
                : html`<p>${msg('Nothing matches every word.', { id: 'docs.noHits' })}</p>`}`
          : current
            ? html`<article>${unsafeHTML(markdown.parse(rewriteLinks(current.markdown, current, known), { async: false }) as string)}</article>`
            : nothing}
      </div>
    `;
  }
}
