/**
 * <pv-data-grid>: the table under every queue and list (ADR 0035). A plain
 * <table> with Web Awesome's styles, the WAI-ARIA grid pattern for the keyboard,
 * and "show more" with the API's cursor instead of page numbers.
 *
 * Events:
 * - pv-row-activate: Enter or a click on a row, detail { row }
 * - pv-load-more: the next page is wanted
 * - pv-sort: a sortable header was chosen, detail { key, direction }
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { move, type Cell } from '../grid-keys.ts';
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome/dist/components/callout/callout.js';

export interface Column<T> {
  key: string;
  header: string;
  /** The cell's content. */
  value: (row: T) => string | number | TemplateResult | typeof nothing;
  align?: 'start' | 'end';
  sortable?: boolean;
}

export type SortDirection = 'ascending' | 'descending';

@customElement('pv-data-grid')
export class DataGrid<T = unknown> extends LitElement {
  @property({ attribute: false }) columns: Column<T>[] = [];
  @property({ attribute: false }) rows: T[] = [];
  /** Accessible name of the grid. */
  @property() label = '';
  @property({ type: Boolean }) loading = false;
  @property({ type: Boolean, attribute: 'has-more' }) hasMore = false;
  @property() error = '';
  @property({ attribute: 'empty-text' }) emptyText = '';
  @property({ attribute: 'more-text' }) moreText = 'Show more';
  @property({ attribute: 'retry-text' }) retryText = 'Try again';
  @property({ attribute: false }) sort: { key: string; direction: SortDirection } | null = null;

  /** The cell that has the tab stop. */
  @state() private active: Cell = { row: 0, col: 0 };

  static styles = css`
    :host {
      display: block;
    }
    .wrap {
      overflow: auto;
      max-height: var(--pv-grid-max-height, none);
      border: var(--wa-border-width-s) var(--wa-border-style) var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-m);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--wa-font-size-s);
    }
    th,
    td {
      padding: var(--wa-space-xs) var(--wa-space-s);
      text-align: start;
      border-bottom: var(--wa-border-width-s) var(--wa-border-style) var(--wa-color-surface-border);
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--wa-color-surface-raised);
      font-weight: var(--wa-font-weight-semibold);
      z-index: 1;
    }
    th button {
      all: unset;
      cursor: pointer;
    }
    th button:focus-visible {
      outline: var(--wa-focus-ring);
    }
    .end {
      text-align: end;
      font-variant-numeric: tabular-nums;
    }
    tbody tr {
      cursor: pointer;
    }
    tbody tr:hover {
      background: var(--wa-color-neutral-fill-quiet);
    }
    td:focus {
      outline: var(--wa-focus-ring);
      outline-offset: calc(-1 * var(--wa-focus-ring-width));
    }
    .footer {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: var(--wa-space-s);
      padding: var(--wa-space-s);
      color: var(--wa-color-text-quiet);
    }
  `;

  render() {
    if (this.error) {
      return html`<wa-callout variant="danger" role="alert"
        >${this.error}
        <wa-button size="small" appearance="outlined" @click=${() => this.dispatchEvent(new CustomEvent('pv-load-more'))}>${this.retryText}</wa-button></wa-callout
      >`;
    }
    const empty = !this.loading && this.rows.length === 0;
    return html`
      <div class="wrap">
        <table role="grid" aria-label=${this.label} aria-rowcount=${this.hasMore ? -1 : this.rows.length + 1} aria-busy=${this.loading ? 'true' : 'false'}>
          <thead>
            <tr>
              ${this.columns.map(
                (c) =>
                  html`<th
                    scope="col"
                    class=${c.align === 'end' ? 'end' : ''}
                    aria-sort=${this.sort?.key === c.key ? this.sort.direction : c.sortable ? 'none' : nothing}
                  >
                    ${c.sortable ? html`<button @click=${() => this.sortBy(c.key)}>${c.header}${this.arrow(c.key)}</button>` : c.header}
                  </th>`,
              )}
            </tr>
          </thead>
          <tbody @keydown=${this.onKey}>
            ${this.rows.map(
              (row, r) =>
                html`<tr @click=${() => this.activate(r)}>
                  ${this.columns.map(
                    (c, ci) =>
                      html`<td
                        role="gridcell"
                        class=${c.align === 'end' ? 'end' : ''}
                        tabindex=${r === this.active.row && ci === this.active.col ? 0 : -1}
                        data-row=${r}
                        data-col=${ci}
                        @focus=${() => (this.active = { row: r, col: ci })}
                      >
                        ${c.value(row)}
                      </td>`,
                  )}
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <div class="footer" aria-live="polite">
        ${this.loading ? html`<wa-spinner></wa-spinner>` : nothing} ${empty ? this.emptyText : nothing}
        ${this.hasMore && !this.loading && this.rows.length ? html`<wa-button size="small" appearance="outlined" @click=${() => this.dispatchEvent(new CustomEvent('pv-load-more'))}>${this.moreText}</wa-button>` : nothing}
      </div>
    `;
  }

  /** Keeps the tab stop inside the rows when they change. */
  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('rows') || changed.has('columns')) {
      this.active = { row: Math.min(this.active.row, Math.max(this.rows.length - 1, 0)), col: Math.min(this.active.col, Math.max(this.columns.length - 1, 0)) };
    }
  }

  private arrow(key: string) {
    if (this.sort?.key !== key) return nothing;
    return this.sort.direction === 'ascending' ? ' ▲' : ' ▼';
  }

  private sortBy(key: string) {
    const direction: SortDirection = this.sort?.key === key && this.sort.direction === 'ascending' ? 'descending' : 'ascending';
    this.sort = { key, direction };
    this.dispatchEvent(new CustomEvent('pv-sort', { detail: { key, direction } }));
  }

  private activate(row: number) {
    const r = this.rows[row];
    if (r !== undefined) this.dispatchEvent(new CustomEvent('pv-row-activate', { detail: { row: r } }));
  }

  private onKey(e: KeyboardEvent) {
    const result = move(this.active, e.key, { rows: this.rows.length, cols: this.columns.length }, { ctrl: e.ctrlKey || e.metaKey });
    if (!result) return;
    e.preventDefault();
    if ('activate' in result) return this.activate(result.activate);
    this.active = result.to;
    this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>(`td[data-row="${result.to.row}"][data-col="${result.to.col}"]`)?.focus());
    // At the last row with more to load: fetch the next page.
    if (result.to.row === this.rows.length - 1 && this.hasMore && !this.loading) this.dispatchEvent(new CustomEvent('pv-load-more'));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-data-grid': DataGrid;
  }
}
