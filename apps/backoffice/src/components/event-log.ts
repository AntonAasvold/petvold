/**
 * <pv-event-log>: what happened, newest first, on the inverted panel. Each
 * entry has a badge (solid: done; dashed: waits for someone), a time, a line
 * and the event's name, so a handler and a developer see the same thing.
 * Styles: .pv-log__* in design/components.css, through pvComponents.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatLogTime } from '../format.ts';
import { pvComponents } from '../styles/pv-components.ts';

export interface LogEntry {
  key: string;
  at: string;
  badge: string;
  /** solid: done or real; pending: waits for someone; sim: simulated or external. */
  state: 'solid' | 'pending' | 'sim';
  line: string;
  /** Who or what, e.g. the event name and the person. Shown muted, in monospace. */
  status?: string;
  action?: TemplateResult;
}

@customElement('pv-event-log')
export class EventLog extends LitElement {
  @property() heading = '';
  @property() empty = '';
  @property({ attribute: false }) entries: LogEntry[] = [];

  static styles = [
    pvComponents,
    css`
      :host {
        display: block;
      }
      h2 {
        margin: 0;
      }
      .pv-log .pv-badge--pending {
        background: transparent;
        color: var(--on-inverse);
        border-color: var(--on-inverse);
      }
      .pv-log__action {
        align-self: flex-start;
      }
      .pv-log__action button {
        padding: 0;
        border: 0;
        background: none;
        color: var(--on-inverse);
        font: 500 13px/1.4 var(--font-sans);
        text-decoration: underline;
        text-underline-offset: 3px;
        cursor: pointer;
      }
      .pv-log__action button:focus-visible {
        outline: var(--border-strong) solid var(--on-inverse);
        outline-offset: 2px;
      }
      .none {
        padding: 14px var(--space-5);
        color: var(--on-inverse-muted);
        font-size: 13px;
      }
    `,
  ];

  render() {
    const sorted = [...this.entries].sort((a, b) => b.at.localeCompare(a.at));
    return html`<section class="pv-log" aria-labelledby="h">
      <div class="pv-log__head">
        <h2 class="pv-overline" id="h">${this.heading}</h2>
        <span class="pv-log__count">${sorted.length}</span>
      </div>
      ${sorted.length
        ? html`<ol class="pv-log__list" aria-labelledby="h">
            ${sorted.map(
              (e) => html`<li class="pv-log__item">
                <div class="pv-log__meta">
                  <span class="pv-badge pv-badge--${e.state}">${e.badge}</span>
                  <time class="pv-log__time" datetime=${e.at}>${formatLogTime(e.at)}</time>
                </div>
                <div class="pv-log__line">${e.line}</div>
                ${e.status ? html`<div class="pv-log__status">${e.status}</div>` : nothing}
                ${e.action ? html`<div class="pv-log__action">${e.action}</div>` : nothing}
              </li>`,
            )}
          </ol>`
        : html`<p class="none">${this.empty}</p>`}
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'pv-event-log': EventLog;
  }
}
