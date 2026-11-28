/**
 * The demo service's HTTP app: the receiver for Petvold's webhooks, and the
 * pages. The receiver checks the signature, stores the event as received and
 * answers at once, so that Petvold's retries never depend on how the demo
 * reads the event afterwards.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { parseCloudEvent } from './cloud-event.ts';
import { verify } from './signature.ts';
import type { EventFilter, Store } from './store.ts';
import { eventPage, eventsPage, live, rejectedPage, type Ctx, type SubscriptionStatus, type UiFilter } from './views.ts';

export interface AppDeps {
  store: Store;
  /** The subscription's secret, or null before the demo has it. */
  secret: () => string | null;
  status: () => SubscriptionStatus;
  now: () => Date;
  /** Where the pages are served, e.g. '/' or '/demo/'. The receiver is always at /webhooks/petvold. */
  basePath: string;
  backofficeUrl: string;
  css: string;
}

export const RECEIVER_PATH = '/webhooks/petvold';
const PAGE = 100;
/** Headers kept with each call: the ones Petvold sets, never anything else. */
const KEPT = ['webhook-id', 'webhook-timestamp', 'webhook-signature', 'content-type', 'user-agent'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight in Stockholm at the start of a day, as a UTC time. */
export function stockholmMidnight(day: string): string {
  const utc = Date.parse(`${day}T00:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hour: '2-digit', hourCycle: 'h23' }).format(new Date(utc)));
  return new Date(utc - hour * 3_600_000).toISOString();
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** The page's filter from the query, and the store's filter from it. */
export function filtersOf(q: (k: string) => string | undefined): { ui: UiFilter; store: EventFilter; offset: number } {
  const v = (k: string) => q(k)?.trim() || undefined;
  const ui: UiFilter = { type: v('type'), market: v('market')?.toUpperCase(), subject: v('subject'), fromDay: v('fromDay'), toDay: v('toDay') };
  const store: EventFilter = { type: ui.type, market: ui.market, subject: ui.subject };
  if (ui.fromDay && DAY.test(ui.fromDay)) store.from = stockholmMidnight(ui.fromDay);
  if (ui.toDay && DAY.test(ui.toDay)) store.to = stockholmMidnight(nextDay(ui.toDay));
  const offset = Math.max(0, Math.floor(Number(q('offset') ?? 0)) || 0);
  return { ui, store, offset };
}

export function createApp(d: AppDeps) {
  const app = new Hono();
  const base = d.basePath.endsWith('/') ? d.basePath : `${d.basePath}/`;
  const ctx: Ctx = { base, backofficeUrl: d.backofficeUrl.replace(/\/$/, '') };
  const listeners = new Set<() => void>();
  // Answers to drop on purpose: the event is stored but Petvold gets 500, so it sends it again (a duplicate).
  let drop = 0;
  const changed = () => listeners.forEach((l) => l());

  app.get('/health', (c) => c.json({ status: 'ok', subscription: d.status().state }));

  app.post(RECEIVER_PATH, bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ title: 'The body is too large' }, 413) }), async (c) => {
    const body = await c.req.text();
    const headers: Record<string, string> = {};
    for (const k of KEPT) {
      const v = c.req.header(k);
      if (v !== undefined) headers[k] = v;
    }
    const webhookId = headers['webhook-id'] ?? null;
    const receivedAt = d.now().toISOString();
    const secret = d.secret();
    // Before the demo has the secret it cannot tell; Petvold tries again later.
    if (!secret) return c.json({ title: 'The demo has no subscription yet' }, 503);
    const problem = verify(secret, { id: headers['webhook-id'], timestamp: headers['webhook-timestamp'], signature: headers['webhook-signature'] }, body, Math.floor(d.now().getTime() / 1000));
    if (problem) {
      await d.store.reject({ webhookId, receivedAt, reason: problem, headers, body: body.slice(0, 65_536) });
      changed();
      return c.json({ title: 'The signature does not hold', detail: problem }, 401);
    }
    const event = parseCloudEvent(body);
    if (typeof event === 'string') {
      await d.store.reject({ webhookId, receivedAt, reason: `not-a-cloud-event: ${event}`, headers, body: body.slice(0, 65_536) });
      changed();
      return c.json({ title: 'Not a CloudEvent', detail: event }, 400);
    }
    await d.store.receive(event, { webhookId: webhookId!, receivedAt, headers });
    if (drop > 0) {
      drop--;
      changed();
      return c.json({ title: 'The demo dropped this answer on purpose', detail: 'The event is stored; send it again' }, 500);
    }
    changed();
    return c.body(null, 204);
  });

  app.post('/drop-answer', (c) => {
    drop++;
    changed();
    return c.redirect(base, 303);
  });

  app.get('/assets/demo.css', (c) => c.body(d.css, 200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache' }));

  app.get('/', async (c) => {
    const f = filtersOf((k) => c.req.query(k));
    const [counts, items] = await Promise.all([d.store.counts(), d.store.events(f.store, PAGE, f.offset)]);
    return c.html(eventsPage(ctx, d.status(), counts, f.ui, items, f.offset, PAGE, drop));
  });

  app.get('/live', async (c) => {
    const f = filtersOf((k) => c.req.query(k));
    const [counts, items] = await Promise.all([d.store.counts(), d.store.events(f.store, PAGE, f.offset)]);
    return c.html(live(ctx, d.status(), counts, f.ui, items, f.offset, PAGE, drop));
  });

  app.get('/events/:id', async (c) => {
    const found = await d.store.event(c.req.param('id'));
    return c.html(eventPage(ctx, found), found ? 200 : 404);
  });

  app.get('/rejected', async (c) => c.html(rejectedPage(ctx, await d.store.rejected(200))));

  // Server-sent events: 'changed' when something was received, so an open page reloads its list.
  app.get('/stream', (c) =>
    streamSSE(c, async (stream) => {
      let wake: (() => void) | null = null;
      let pending = false;
      const listener = () => {
        pending = true;
        wake?.();
      };
      listeners.add(listener);
      stream.onAbort(() => {
        listeners.delete(listener);
        wake?.();
      });
      while (!stream.aborted) {
        if (pending) {
          pending = false;
          await stream.writeSSE({ event: 'changed', data: '' });
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 25_000);
        });
        wake = null;
        // A comment keeps proxies from closing a quiet connection.
        if (!pending && !stream.aborted) await stream.write(': ping\n\n');
      }
    }),
  );

  return app;
}
