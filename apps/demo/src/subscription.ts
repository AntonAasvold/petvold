/**
 * The demo's subscription in Petvold, through the contract only
 * (docs/teknik/demotjanst.md, the subscription): find the subscription on
 * the demo's own address; make it if there is none; change its secret if the
 * demo does not have it, which is the usual case after the test data made
 * it; and turn it on again if Petvold turned it off.
 */
import { randomUUID } from 'node:crypto';
import type { components } from './api/schema.d.ts';
import type { Store } from './store.ts';

type Subscription = components['schemas']['WebhookSubscription'];
type WithSecret = components['schemas']['WebhookSubscriptionWithSecret'];

export interface PetvoldApi {
  baseUrl: string;
  /** A token with webhooks:read and webhooks:manage, e.g. dev-integration. */
  token: string;
  fetch?: typeof fetch;
}

export interface SavedSubscription {
  id: string;
  secret: string;
}

export type Outcome = 'kept' | 'created' | 'rotated';

export const SETTING = 'subscription';

export class PetvoldError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(api: PetvoldApi, method: string, path: string, body?: unknown, idempotent = false): Promise<T> {
  const res = await (api.fetch ?? fetch)(`${api.baseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${api.token}`,
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(idempotent ? { 'idempotency-key': `demo-${randomUUID()}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const p = data as { title?: string; detail?: string } | undefined;
    throw new PetvoldError(res.status, `${method} ${path}: ${res.status} ${p?.detail ?? p?.title ?? ''}`.trim());
  }
  return data as T;
}

async function findByUrl(api: PetvoldApi, url: string): Promise<Subscription | null> {
  let cursor: string | undefined;
  do {
    const page = await call<{ items: Subscription[]; nextCursor?: string }>(api, 'GET', `/v1/webhook-subscriptions?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    const found = page.items.find((s) => s.url === url);
    if (found) return found;
    cursor = page.nextCursor;
  } while (cursor);
  return null;
}

/** Makes sure Petvold sends every event to url, signed with a secret the store has. */
export async function ensureSubscription(api: PetvoldApi, store: Store, url: string, now: () => string): Promise<{ subscription: SavedSubscription; outcome: Outcome }> {
  const saved = await store.setting<SavedSubscription>(SETTING);
  const found = await findByUrl(api, url);
  let outcome: Outcome = 'kept';
  let current: Subscription;
  let secret: string;
  if (!found) {
    const made = await call<WithSecret>(api, 'POST', '/v1/webhook-subscriptions', { url, eventTypes: ['*'], markets: '*', description: 'Petvold Demo' }, true);
    [current, secret, outcome] = [made.subscription, made.secret, 'created'];
  } else if (!saved || saved.id !== found.id || !saved.secret) {
    const rotated = await call<WithSecret>(api, 'POST', `/v1/webhook-subscriptions/${encodeURIComponent(found.id)}/secret-rotations`, undefined, true);
    [current, secret, outcome] = [rotated.subscription, rotated.secret, 'rotated'];
  } else {
    [current, secret] = [found, saved.secret];
  }
  const subscription = { id: current.id, secret };
  if (outcome !== 'kept') await store.setSetting(SETTING, subscription, now());
  if (current.status === 'disabled') {
    await call<Subscription>(api, 'PUT', `/v1/webhook-subscriptions/${encodeURIComponent(current.id)}`, {
      basedOnRevision: current.revision,
      url: current.url,
      eventTypes: current.eventTypes,
      markets: current.markets,
      ...(current.description ? { description: current.description } : {}),
      status: 'active',
    });
  }
  return { subscription, outcome };
}
