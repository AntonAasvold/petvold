/**
 * The demo's pages, rendered on the server with Petvold's design system
 * (design/components.css and the tokens): black and white, borders instead of
 * shadows, and a duplicate shown with a dashed border and a text, never by
 * colour alone. Values are escaped by hono/html.
 */
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { shortType, summary } from './cloud-event.ts';
import type { Counts, Delivery, Rejected, StoredEvent } from './store.ts';
import { T } from './texts-sv.ts';

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export interface SubscriptionStatus {
  state: 'waiting' | 'ready';
  id?: string;
  outcome?: 'kept' | 'created' | 'rotated';
  error?: string;
}

/** The filter as the page shows it: days rather than times. */
export interface UiFilter {
  type?: string;
  market?: string;
  subject?: string;
  fromDay?: string;
  toDay?: string;
}

export interface Ctx {
  /** Where the demo is served, ending in '/': '/' locally, '/demo/' behind Caddy. */
  base: string;
  backofficeUrl: string;
}

const TIME = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Stockholm' });
export const formatTime = (iso: string) => TIME.format(new Date(iso));

/** The object's page in Petvold's back office, by the id's prefix; null when it has none. */
export function backofficePath(id: string): string | null {
  const prefix: Record<string, string> = { pol: 'policies', clm: 'claims', app: 'applications', ani: 'animals', pty: 'parties', ntc: 'notices', lit: 'litters', bac: 'payer-accounts' };
  const p = prefix[id.split('_')[0] ?? ''];
  return p ? `/${p}/${encodeURIComponent(id)}` : null;
}

/** The filter as a query string, without empty values. */
export function query(f: UiFilter & { offset?: number }): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '' && !(k === 'offset' && !v)) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function layout(ctx: Ctx, current: 'events' | 'rejected', title: string, body: Html): Html {
  const nav = (key: 'events' | 'rejected', href: string, label: string) => html`<a class="pv-nav__item" href="${ctx.base}${href}" ${current === key ? raw('aria-current="page"') : ''}>${label}</a>`;
  return html`<!doctype html>
    <html lang="sv" class="wa-light">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · ${T.title}</title>
        <link rel="stylesheet" href="${ctx.base}assets/demo.css" />
        <script>
          if (matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.className = 'wa-dark';
        </script>
      </head>
      <body class="pv">
        <a class="skip" href="#main">${T.skip}</a>
        <header class="top">
          <div>
            <a class="brand" href="${ctx.base}">${T.title}</a>
            <span class="tagline">${T.tagline}</span>
          </div>
          <nav class="pv-nav pv-nav--row" aria-label="${T.title}">
            ${nav('events', '', T.navEvents)} ${nav('rejected', 'rejected', T.navRejected)}
            <a class="pv-nav__item" href="${ctx.backofficeUrl}">${T.backoffice}</a>
          </nav>
        </header>
        <main id="main">${body}</main>
      </body>
    </html>`;
}

export function subscriptionLine(s: SubscriptionStatus): Html {
  if (s.state === 'ready') {
    const outcome = s.outcome === 'created' ? T.outcomeCreated : s.outcome === 'rotated' ? T.outcomeRotated : T.outcomeKept;
    return html`<p class="status"><span class="pv-badge pv-badge--solid">${T.subscriptionReady}</span> <span class="pv-mono">${s.id}</span>, ${outcome}</p>`;
  }
  return html`<p class="status"><span class="pv-badge pv-badge--pending">${T.subscriptionWaiting}</span> ${T.subscriptionWaitingHint}${s.error ? html` <span class="pv-mono">${s.error}</span>` : ''}</p>`;
}

export function figures(c: Counts): Html {
  const fig = (label: string, v: number) => html`<div class="pv-figure"><span class="pv-figure__label">${label}</span><span class="pv-figure__value">${v.toLocaleString('sv-SE')}</span></div>`;
  return html`<div class="pv-card"><div class="pv-figures">${fig(T.countEvents, c.events)}${fig(T.countDeliveries, c.deliveries)}${fig(T.countDuplicates, c.deliveries - c.events)}${fig(T.countRejected, c.rejected)}</div></div>`;
}

function idLink(ctx: Ctx, id: string): Html {
  return html`<a class="pv-mono" href="${ctx.base}${query({ subject: id })}">${id}</a>`;
}

export function eventRows(ctx: Ctx, items: StoredEvent[]): Html {
  return html`${items.map(
    (s) => html`<tr class="${s.deliveries > 1 ? 'dup' : ''}">
      <td class="pv-mono nowrap"><a href="${ctx.base}events/${encodeURIComponent(s.id)}">${formatTime(s.event.time)}</a></td>
      <td class="pv-mono">${shortType(s.event.type)}</td>
      <td>${idLink(ctx, s.event.subject)}</td>
      <td>${s.event.market}</td>
      <td>${summary(s.event.data).map((f) => html`<span class="field"><span class="key">${f.key}</span> ${f.value}</span>`)}</td>
      <td>${s.deliveries > 1 ? html`<span class="pv-badge pv-badge--pending">${T.duplicate(s.deliveries)}</span>` : '1'}</td>
    </tr>`,
  )}`;
}

/** The part of the list page that is replaced when an event comes. */
export function live(ctx: Ctx, status: SubscriptionStatus, counts: Counts, filter: UiFilter, items: StoredEvent[], offset: number, limit: number, dropping = 0): Html {
  const filtered = Object.values(filter).some(Boolean);
  return html`<div id="live">
    ${subscriptionLine(status)} ${figures(counts)}
    <form class="drop" method="post" action="${ctx.base}drop-answer">
      <button class="pv-btn pv-btn--secondary pv-btn--sm" type="submit">${T.dropAnswer}</button>
      <span class="hint">${dropping ? html`<span class="pv-badge pv-badge--pending">${T.dropping(dropping)}</span>` : T.dropHow}</span>
    </form>
    ${items.length
      ? html`<div class="table-wrap">
          <table class="events">
            <thead>
              <tr>
                <th scope="col">${T.colTime}</th>
                <th scope="col">${T.colType}</th>
                <th scope="col">${T.colSubject}</th>
                <th scope="col">${T.colMarket}</th>
                <th scope="col">${T.colDetails}</th>
                <th scope="col">${T.colDeliveries}</th>
              </tr>
            </thead>
            <tbody>
              ${eventRows(ctx, items)}
            </tbody>
          </table>
        </div>
        ${items.length === limit ? html`<p><a class="pv-btn pv-btn--secondary pv-btn--sm" href="${ctx.base}${query({ ...filter, offset: offset + limit })}">${T.more}</a></p>` : ''}`
      : html`<p class="empty">${filtered ? T.noMatch : T.noEvents}</p>`}
  </div>`;
}

export function eventsPage(ctx: Ctx, status: SubscriptionStatus, counts: Counts, filter: UiFilter, items: StoredEvent[], offset: number, limit: number, dropping = 0): Html {
  const input = (name: string, label: string, value: string | undefined, extra: Html | string = '', type = 'text') =>
    html`<label class="pv-field">${label}<input class="pv-input" type="${type}" name="${name}" value="${value ?? ''}" ${extra} /></label>`;
  const liveQuery = query({ ...filter, offset });
  return layout(
    ctx,
    'events',
    T.navEvents,
    html`<h1>${T.navEvents}</h1>
      <form class="filters" method="get" action="${ctx.base}">
        ${input('type', T.filterType, filter.type, raw(`placeholder="${T.filterTypeHint}"`))} ${input('market', T.filterMarket, filter.market, raw('maxlength="2" size="2"'))}
        ${input('subject', T.filterSubject, filter.subject)} ${input('fromDay', T.filterFrom, filter.fromDay, '', 'date')} ${input('toDay', T.filterTo, filter.toDay, '', 'date')}
        <div class="actions">
          <button class="pv-btn pv-btn--sm" type="submit">${T.filterApply}</button>
          <a class="pv-btn pv-btn--link pv-btn--sm" href="${ctx.base}">${T.filterClear}</a>
        </div>
      </form>
      ${live(ctx, status, counts, filter, items, offset, limit, dropping)}
      <p class="hint">${T.live}</p>
      <script>
        (() => {
          const base = ${raw(JSON.stringify(ctx.base))};
          const q = ${raw(JSON.stringify(liveQuery))};
          let timer = null;
          const refresh = async () => {
            timer = null;
            const res = await fetch(base + 'live' + q);
            if (res.ok) document.getElementById('live').outerHTML = await res.text();
          };
          const source = new EventSource(base + 'stream');
          source.addEventListener('changed', () => {
            if (!timer) timer = setTimeout(refresh, 400);
          });
        })();
      </script>`,
  );
}

function headersBlock(h: Record<string, string>): Html {
  return html`<pre class="code">${Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}</pre>`;
}

export function eventPage(ctx: Ctx, found: { stored: StoredEvent; deliveries: Delivery[] } | null): Html {
  if (!found) return layout(ctx, 'events', T.eventTitle, html`<h1>${T.eventTitle}</h1><p>${T.notFound}</p>`);
  const e = found.stored.event;
  const row = (label: string, v: Html | string) => html`<div class="pv-dl__row"><dt>${label}</dt><dd>${v}</dd></div>`;
  const bo = backofficePath(e.subject);
  return layout(
    ctx,
    'events',
    `${shortType(e.type)} ${e.subject}`,
    html`<h1>${shortType(e.type)}</h1>
      <section class="pv-card">
        <div class="pv-card__body">
          <dl class="pv-dl">
            ${row(T.fieldId, html`<span class="pv-mono">${e.id}</span>`)} ${row(T.fieldType, html`<span class="pv-mono">${e.type}</span>`)} ${row(T.fieldSource, html`<span class="pv-mono">${e.source}</span>`)}
            ${row(T.fieldSubject, html`<a class="pv-mono" href="${ctx.base}${query({ subject: e.subject })}">${e.subject}</a>${bo ? html` · <a href="${ctx.backofficeUrl}${bo}">${T.openInBackoffice}</a>` : ''}`)}
            ${row(T.fieldMarket, e.market)} ${row(T.fieldTime, formatTime(e.time))} ${e.sequence ? row(T.fieldSequence, html`<span class="pv-mono">${e.sequence}</span>`) : ''}
            ${row(T.fieldReceived, formatTime(found.stored.receivedAt))}
          </dl>
        </div>
      </section>
      <h2>${T.cloudEvent}</h2>
      <pre class="code">${JSON.stringify(e, null, 2)}</pre>
      <h2>${T.deliveries} (${found.deliveries.length})</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">${T.colReceived}</th>
              <th scope="col">${T.colWebhookId}</th>
              <th scope="col">${T.colHeaders}</th>
            </tr>
          </thead>
          <tbody>
            ${found.deliveries.map((d) => html`<tr><td class="pv-mono nowrap">${formatTime(d.receivedAt)}</td><td class="pv-mono">${d.webhookId}</td><td>${headersBlock(d.headers)}</td></tr>`)}
          </tbody>
        </table>
      </div>`,
  );
}

export function reasonText(reason: string): string {
  const [code, ...rest] = reason.split(': ');
  const label = T.reasons[code ?? ''] ?? code ?? reason;
  return rest.length ? `${label}: ${rest.join(': ')}` : label;
}

export function rejectedPage(ctx: Ctx, items: Rejected[]): Html {
  return layout(
    ctx,
    'rejected',
    T.rejectedTitle,
    html`<h1>${T.rejectedTitle}</h1>
      <p>${T.rejectedHow}</p>
      ${items.length
        ? html`<div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">${T.colReceived}</th>
                  <th scope="col">${T.colReason}</th>
                  <th scope="col">${T.colWebhookId}</th>
                  <th scope="col">${T.colBody}</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(
                  (r) => html`<tr class="dup">
                    <td class="pv-mono nowrap">${formatTime(r.receivedAt)}</td>
                    <td>${reasonText(r.reason)}</td>
                    <td class="pv-mono">${r.webhookId ?? '–'}</td>
                    <td>
                      <details>
                        <summary>${T.colHeaders} · ${T.colBody}</summary>
                        ${headersBlock(r.headers)}
                        <pre class="code">${r.body}</pre>
                      </details>
                    </td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>`
        : html`<p class="empty">${T.noRejected}</p>`}`,
  );
}
