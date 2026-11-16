/**
 * Events to the insurer's systems with webhooks (ADR 0033).
 *
 * The relay hands each module's events to `enqueue`, which puts a delivery in
 * a queue per matching subscription. A worker sends them as CloudEvents 1.0,
 * signed as Standard Webhooks, and retries with a growing pause for three
 * days. Events are thin: ids and fields that are not personal data, from the
 * catalog below. The receiver fetches the rest with the API and its own token.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

export type Timestamp = string;

/**
 * The public events and the fields of `data` each may carry (ADR 0033 point 5
 * and 6). Anything else in a module's event stays inside Petvold: names, notes,
 * who did it. Types are versioned: a breaking change is a new `.vN`.
 */
export const PUBLIC_EVENTS: Record<string, { source: string; subject: 'policyId' | 'applicationId'; fields: string[] }> = {
  'policy.issued': { source: 'policies', subject: 'policyId', fields: ['transactionId', 'animalId', 'policyholderPartyId', 'productVersion', 'startDate', 'endDate', 'premium', 'applicationId'] },
  'policy.changed': { source: 'policies', subject: 'policyId', fields: ['transactionId', 'termNo', 'changeNo', 'from', 'premiumAdjustment', 'currency'] },
  'policy.renewed': { source: 'policies', subject: 'policyId', fields: ['transactionId', 'termNo', 'startDate', 'endDate', 'productVersion', 'premium'] },
  'policy.transferred': { source: 'policies', subject: 'policyId', fields: ['transactionId', 'fromPartyId', 'toPartyId', 'from', 'premium'] },
  'policy.cancelled': { source: 'policies', subject: 'policyId', fields: ['transactionId', 'reason', 'effectiveDate', 'refund'] },
  'policy.reinstated': { source: 'policies', subject: 'policyId', fields: ['transactionId', 'reverses', 'refundReversed'] },
  'application.received': { source: 'policies', subject: 'applicationId', fields: ['animalId', 'productVersion'] },
  'application.accepted': { source: 'policies', subject: 'applicationId', fields: ['policyId', 'outcome', 'riders'] },
  'application.referred': { source: 'policies', subject: 'applicationId', fields: ['outcome', 'reasons'] },
  'application.declined': { source: 'policies', subject: 'applicationId', fields: ['outcome', 'reasons', 'reason'] },
  'application.withdrawn': { source: 'policies', subject: 'applicationId', fields: [] },
  'application.expired': { source: 'policies', subject: 'applicationId', fields: ['deadline'] },
  'proposal.created': { source: 'policies', subject: 'policyId', fields: ['proposalId', 'kind', 'fromPartyId', 'toPartyId', 'from', 'deadline', 'deceasedOn'] },
};

/** An event from a module's outbox, with its market, as the relay hands it over. */
export interface SourceEvent {
  id: string;
  type: string;
  policyId?: string;
  applicationId?: string;
  market: string;
  occurredAt: Timestamp;
  data: Record<string, unknown>;
}

/** CloudEvents 1.0 in structured JSON mode, with the extension `market`. */
export interface CloudEvent {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  subject: string;
  time: Timestamp;
  datacontenttype: 'application/json';
  market: string;
  data: Record<string, unknown>;
}

/** The public form of an event, or null if it is not public. Pure. */
export function toCloudEvent(e: SourceEvent): CloudEvent | null {
  const spec = PUBLIC_EVENTS[e.type];
  if (!spec) return null;
  const subject = spec.subject === 'policyId' ? e.policyId : e.applicationId;
  if (!subject) return null;
  const data: Record<string, unknown> = { [spec.subject]: subject };
  for (const f of spec.fields) if (e.data[f] !== undefined) data[f] = structuredClone(e.data[f]);
  if (spec.subject === 'applicationId' && e.policyId) data.policyId = e.policyId;
  return { specversion: '1.0', id: e.id, source: `/petvold/${spec.source}`, type: `petvold.${e.type}.v1`, subject, time: e.occurredAt, datacontenttype: 'application/json', market: e.market, data };
}

/** Whether a subscription pattern ('*', 'policy.*' or an exact type) covers an event type. Pure. */
export function matches(pattern: string, type: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

export type SubscriptionStatus = 'active' | 'disabled';

export interface Subscription {
  id: string;
  url: string;
  /** e.g. ['policy.*', 'application.declined'] or ['*']. */
  eventTypes: string[];
  /** Market codes, or '*' for every market. */
  markets: string[] | '*';
  description?: string;
  status: SubscriptionStatus;
  /** Why it was disabled, e.g. the receiver answered 410 Gone. */
  disabledReason?: string;
  revision: number;
  createdBy: string;
  createdAt: Timestamp;
  changedBy: string;
  changedAt: Timestamp;
  /** Until when the previous secret also signs, after a rotation. */
  previousSecretUntil?: Timestamp;
}

/** As stored: with the secrets sealed. */
export interface StoredSubscription extends Subscription {
  secret: string;
  previousSecret?: string;
}

export type DeliveryStatus = 'pending' | 'delivered' | 'dead';

export interface Delivery {
  id: string;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  event: CloudEvent;
  status: DeliveryStatus;
  attempts: number;
  /** pending: not before this. */
  nextAttemptAt: Timestamp;
  lastAttemptAt?: Timestamp;
  /** The receiver's HTTP status, if it answered. */
  lastStatus?: number;
  lastError?: string;
  deliveredAt?: Timestamp;
  createdAt: Timestamp;
}

export interface WebhookStore {
  createSubscription(s: StoredSubscription): Promise<void>;
  getSubscription(id: string): Promise<StoredSubscription | null>;
  listSubscriptions(): Promise<StoredSubscription[]>;
  /** Throws WebhookConflictError unless the stored revision is s.revision - 1. */
  updateSubscription(s: StoredSubscription): Promise<void>;
  /** Adds deliveries; one per subscription and event. Returns how many were new. */
  enqueue(ds: Delivery[]): Promise<number>;
  /**
   * Pending deliveries of active subscriptions due at `now`, oldest first. Each
   * is leased until `leaseUntil`, so another worker does not take it meanwhile.
   */
  claimDue(now: Timestamp, limit: number, leaseUntil: Timestamp): Promise<Delivery[]>;
  /** Stores the outcome of an attempt. */
  recordAttempt(d: Delivery): Promise<void>;
  listDeliveries(filter: { subscriptionId: string; status?: DeliveryStatus }): Promise<Delivery[]>;
}

export class WebhookConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookConflictError';
  }
}

export type WebhookErrorCode = 'validation' | 'not_found' | 'conflict' | 'forbidden';

export class WebhookError extends Error {
  constructor(
    public readonly code: WebhookErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}

/** Seals secrets with AES-256-GCM and the installation's key (PETVOLD_WEBHOOK_KEY), so the database never holds them in clear. */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('The webhook key must be 32 bytes, base64-encoded');
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `v1:${Buffer.concat([iv, c.getAuthTag(), data]).toString('base64')}`;
  }

  open(sealed: string): string {
    if (!sealed.startsWith('v1:')) throw new Error('Unknown sealed secret');
    const raw = Buffer.from(sealed.slice(3), 'base64');
    const d = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  }
}

/** A new secret as Standard Webhooks writes it: whsec_ and 32 random bytes in base64. */
export function newSecret(): string {
  return `whsec_${randomBytes(32).toString('base64')}`;
}

/** The webhook-signature value: 'v1,' and the HMAC-SHA256 of 'id.timestamp.body', per secret. Pure. */
export function sign(secrets: string[], id: string, timestamp: number, body: string): string {
  return secrets
    .map((s) => `v1,${createHmac('sha256', Buffer.from(s.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')}`)
    .join(' ');
}

/** Pauses before attempt 2, 3 … (ADR 0033): 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, then every 24 h. */
export const RETRY_DELAYS_MS = [5_000, 300_000, 1_800_000, 7_200_000, 18_000_000, 36_000_000, 86_400_000];
/** After this long since the event was queued, a delivery is dead. */
export const GIVE_UP_AFTER_MS = 3 * 86_400_000;
export const REQUEST_TIMEOUT_MS = 15_000;
/** How long a worker holds a delivery it is sending. */
export const LEASE_MS = 60_000;

/** When to try again after a failed attempt, or null to give up. Jitter is ±10 %. */
export function nextAttemptAt(createdAt: Timestamp, attempts: number, now: Timestamp, random: () => number = Math.random): Timestamp | null {
  const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]!;
  const at = Date.parse(now) + Math.round(delay * (0.9 + 0.2 * random()));
  return at - Date.parse(createdAt) > GIVE_UP_AFTER_MS ? null : new Date(at).toISOString();
}

/** Addresses a subscription must not reach: loopback, private, link-local and similar nets. */
const PRIVATE = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const) PRIVATE.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::1', 128], ['::', 128], ['fc00::', 7], ['fe80::', 10]] as const) PRIVATE.addSubnet(net, bits, 'ipv6');

export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) return PRIVATE.check(address, 'ipv4');
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    return mapped ? PRIVATE.check(mapped, 'ipv4') : PRIVATE.check(address, 'ipv6');
  }
  return false;
}

/** How the worker reaches a receiver. */
export interface Transport {
  post(url: string, headers: Record<string, string>, body: string): Promise<{ status: number }>;
}

/**
 * HTTP with fetch: no redirects, a timeout, and no private addresses unless the
 * host is allowed (ADR 0033 point 9). `resolve` gives a host's addresses.
 */
export function fetchTransport(o: { allowHosts?: readonly string[]; resolve: (host: string) => Promise<string[]>; timeoutMs?: number }): Transport {
  return {
    async post(url, headers, body) {
      const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
      if (!o.allowHosts?.includes(host)) {
        const addresses = isIP(host) ? [host] : await o.resolve(host);
        if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error(`${host} resolves to a private address`);
      }
      const res = await fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs ?? REQUEST_TIMEOUT_MS) });
      await res.body?.cancel();
      return { status: res.status };
    },
  };
}

export interface WebhookDeps {
  store: WebhookStore;
  box: SecretBox;
  clock: { now(): Timestamp };
  ids: { next(prefix: string): string };
  /** Hosts a subscription may name although they are local or use http, e.g. a receiver in development. */
  allowHosts?: readonly string[];
}

export interface SubscriptionInput {
  url: string;
  eventTypes: string[];
  markets: string[] | '*';
  description?: string;
}

export interface SubscriptionChange extends SubscriptionInput {
  basedOnRevision: number;
  status: SubscriptionStatus;
}

/** A subscription without its secrets. */
export function publicSubscription(s: StoredSubscription): Subscription {
  const { secret: _s, previousSecret: _p, ...rest } = s;
  return structuredClone(rest);
}

export class WebhookService {
  constructor(private readonly d: WebhookDeps) {}

  /** Creates a subscription. The secret is shown only here and at a rotation. */
  async create(input: SubscriptionInput, by: string): Promise<{ subscription: Subscription; secret: string }> {
    const clean = this.validate(input);
    const now = this.d.clock.now();
    const secret = newSecret();
    const s: StoredSubscription = { id: this.d.ids.next('whs'), ...clean, status: 'active', revision: 1, createdBy: by, createdAt: now, changedBy: by, changedAt: now, secret: this.d.box.seal(secret) };
    await this.d.store.createSubscription(s);
    return { subscription: publicSubscription(s), secret };
  }

  async get(id: string): Promise<Subscription> {
    return publicSubscription(await this.stored(id));
  }

  async list(): Promise<Subscription[]> {
    return (await this.d.store.listSubscriptions()).map(publicSubscription);
  }

  /** Changes the address, types, markets or status. Activating clears why it was disabled. */
  async change(id: string, input: SubscriptionChange, by: string): Promise<Subscription> {
    const cur = await this.stored(id);
    if (cur.revision !== input.basedOnRevision) throw new WebhookError('conflict', `The subscription is at revision ${cur.revision}, not ${input.basedOnRevision}`);
    if (input.status !== 'active' && input.status !== 'disabled') throw new WebhookError('validation', 'status is active or disabled');
    const clean = this.validate(input);
    const { description: _d, disabledReason: _r, ...rest } = cur;
    const next: StoredSubscription = {
      ...rest,
      ...clean,
      status: input.status,
      ...(input.status === 'disabled' ? { disabledReason: 'Disabled by a person' } : {}),
      revision: cur.revision + 1,
      changedBy: by,
      changedAt: this.d.clock.now(),
    };
    await this.save(next);
    return publicSubscription(next);
  }

  /** A new secret. The previous one also signs for 24 hours, so the receiver can switch without losing events. */
  async rotateSecret(id: string, by: string): Promise<{ subscription: Subscription; secret: string }> {
    const cur = await this.stored(id);
    const now = this.d.clock.now();
    const secret = newSecret();
    const next: StoredSubscription = {
      ...cur,
      secret: this.d.box.seal(secret),
      previousSecret: cur.secret,
      previousSecretUntil: new Date(Date.parse(now) + 86_400_000).toISOString(),
      revision: cur.revision + 1,
      changedBy: by,
      changedAt: now,
    };
    await this.save(next);
    return { subscription: publicSubscription(next), secret };
  }

  async deliveries(id: string, status?: DeliveryStatus): Promise<Delivery[]> {
    await this.stored(id);
    return this.d.store.listDeliveries({ subscriptionId: id, ...(status ? { status } : {}) });
  }

  /**
   * Queues an event for every active subscription that wants it. Events that
   * are not public give nothing. Repeats give nothing new (ADR 0008).
   */
  async enqueue(e: SourceEvent): Promise<number> {
    const event = toCloudEvent(e);
    if (!event) return 0;
    const now = this.d.clock.now();
    const subs = (await this.d.store.listSubscriptions()).filter(
      (s) => s.status === 'active' && s.eventTypes.some((p) => matches(p, e.type)) && (s.markets === '*' || s.markets.includes(e.market)),
    );
    if (!subs.length) return 0;
    return this.d.store.enqueue(
      subs.map((s) => ({ id: this.d.ids.next('whd'), subscriptionId: s.id, eventId: e.id, eventType: e.type, event, status: 'pending', attempts: 0, nextAttemptAt: now, createdAt: now })),
    );
  }

  /** The secrets that sign now: the current one, and the previous one during its overlap. */
  secretsOf(s: StoredSubscription, now: Timestamp): string[] {
    return [this.d.box.open(s.secret), ...(s.previousSecret && s.previousSecretUntil && now < s.previousSecretUntil ? [this.d.box.open(s.previousSecret)] : [])];
  }

  /** Marks a subscription disabled, e.g. when the receiver answers 410 Gone. */
  async disable(id: string, reason: string): Promise<void> {
    const cur = await this.stored(id);
    if (cur.status === 'disabled') return;
    await this.save({ ...cur, status: 'disabled', disabledReason: reason, revision: cur.revision + 1, changedBy: 'petvold-webhooks', changedAt: this.d.clock.now() });
  }

  async stored(id: string): Promise<StoredSubscription> {
    const s = await this.d.store.getSubscription(id);
    if (!s) throw new WebhookError('not_found', `Webhook subscription ${id} does not exist`);
    return s;
  }

  private async save(s: StoredSubscription): Promise<void> {
    await this.d.store.updateSubscription(s).catch((e: unknown) => {
      if (e instanceof WebhookConflictError) throw new WebhookError('conflict', e.message);
      throw e;
    });
  }

  private validate(input: SubscriptionInput): SubscriptionInput {
    const fail = (m: string): never => {
      throw new WebhookError('validation', m);
    };
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      return fail('url must be an absolute address');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const allowed = this.d.allowHosts?.includes(host) ?? false;
    if (url.protocol !== 'https:' && !(allowed && url.protocol === 'http:')) fail('url must use https');
    if (url.username || url.password) fail('url must not contain credentials');
    if (!allowed && (host === 'localhost' || isPrivateAddress(host))) fail('url must not point at a local or private address');
    if (input.url.length > 2000) fail('url is too long');
    if (!Array.isArray(input.eventTypes) || !input.eventTypes.length) fail('eventTypes needs at least one type, e.g. policy.*');
    for (const p of input.eventTypes) {
      if (!Object.keys(PUBLIC_EVENTS).some((t) => matches(p, t))) fail(`'${p}' matches no public event type`);
    }
    if (input.markets !== '*') {
      if (!Array.isArray(input.markets) || !input.markets.length) fail("markets needs at least one market, or '*'");
      for (const m of input.markets) if (!/^[A-Z]{2}$/.test(m)) fail(`Invalid market '${m}'`);
    }
    const description = input.description?.trim();
    if (description && description.length > 200) fail('description is at most 200 characters');
    return {
      url: url.toString(),
      eventTypes: [...new Set(input.eventTypes)].sort(),
      markets: input.markets === '*' ? '*' : [...new Set(input.markets)].sort(),
      ...(description ? { description } : {}),
    };
  }
}

export interface WorkerResult {
  delivered: number;
  failed: number;
  dead: number;
}

/**
 * Sends due deliveries. Several workers may run: each claims its deliveries
 * with a lease. A receiver that answers 2xx has the event; 410 Gone disables
 * the subscription; anything else, or no answer, is tried again later.
 */
export class WebhookWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly d: {
      service: WebhookService;
      store: WebhookStore;
      transport: Transport;
      clock: { now(): Timestamp };
      random?: () => number;
      log?: (line: string) => void;
      batchSize?: number;
    },
  ) {}

  async tick(): Promise<WorkerResult> {
    const out: WorkerResult = { delivered: 0, failed: 0, dead: 0 };
    if (this.running) return out;
    this.running = true;
    try {
      const now = this.d.clock.now();
      const due = await this.d.store.claimDue(now, this.d.batchSize ?? 50, new Date(Date.parse(now) + LEASE_MS).toISOString());
      for (const delivery of due) {
        const r = await this.send(delivery);
        if (r) out[r]++;
      }
    } finally {
      this.running = false;
    }
    return out;
  }

  private async send(delivery: Delivery): Promise<keyof WorkerResult | null> {
    const now = this.d.clock.now();
    const sub = await this.d.service.stored(delivery.subscriptionId);
    // Disabled since it was claimed, e.g. by a 410 earlier in this round: it waits, untried.
    if (sub.status !== 'active') {
      await this.d.store.recordAttempt({ ...delivery, nextAttemptAt: now });
      return null;
    }
    const body = JSON.stringify(delivery.event);
    const timestamp = Math.floor(Date.parse(now) / 1000);
    const headers = {
      'content-type': 'application/cloudevents+json',
      'webhook-id': delivery.eventId,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': sign(this.d.service.secretsOf(sub, now), delivery.eventId, timestamp, body),
    };
    const attempt = { ...delivery, attempts: delivery.attempts + 1, lastAttemptAt: now };
    let status: number | undefined;
    let error: string | undefined;
    try {
      status = (await this.d.transport.post(sub.url, headers, body)).status;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (status !== undefined && status >= 200 && status < 300) {
      const { lastError: _e, ...rest } = attempt;
      await this.d.store.recordAttempt({ ...rest, status: 'delivered', lastStatus: status, deliveredAt: now });
      return 'delivered';
    }
    const lastError = error ?? `HTTP ${status}`;
    if (status === 410) {
      await this.d.service.disable(sub.id, 'The receiver answered 410 Gone');
      this.d.log?.(`[webhooks] ${sub.id} disabled: 410 Gone`);
    }
    const next = status === 410 ? null : nextAttemptAt(delivery.createdAt, attempt.attempts, now, this.d.random);
    await this.d.store.recordAttempt({
      ...attempt,
      ...(status !== undefined ? { lastStatus: status } : {}),
      lastError,
      ...(next ? { status: 'pending', nextAttemptAt: next } : { status: 'dead' }),
    });
    this.d.log?.(`[webhooks] ${delivery.eventType} ${delivery.eventId} to ${sub.id} failed (attempt ${attempt.attempts}): ${lastError}`);
    return next ? 'failed' : 'dead';
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((err) => this.d.log?.(`[webhooks] ${String(err)}`)), intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((r) => setTimeout(r, 10));
  }
}

/** In-memory store, for tests and the dev server without a database. */
export class InMemoryWebhookStore implements WebhookStore {
  private subs: StoredSubscription[] = [];
  private queue: Delivery[] = [];

  async createSubscription(s: StoredSubscription) {
    if (this.subs.some((x) => x.id === s.id)) throw new WebhookConflictError(`Webhook subscription ${s.id} exists`);
    this.subs.push(structuredClone(s));
  }

  async getSubscription(id: string) {
    const s = this.subs.find((x) => x.id === id);
    return s ? structuredClone(s) : null;
  }

  async listSubscriptions() {
    return structuredClone(this.subs);
  }

  async updateSubscription(s: StoredSubscription) {
    const i = this.subs.findIndex((x) => x.id === s.id);
    if (i < 0 || this.subs[i]!.revision !== s.revision - 1) throw new WebhookConflictError(`Webhook subscription ${s.id} has changed`);
    this.subs[i] = structuredClone(s);
  }

  async enqueue(ds: Delivery[]) {
    let n = 0;
    for (const d of ds) {
      if (this.queue.some((x) => x.subscriptionId === d.subscriptionId && x.eventId === d.eventId)) continue;
      this.queue.push(structuredClone(d));
      n++;
    }
    return n;
  }

  async claimDue(now: Timestamp, limit: number, leaseUntil: Timestamp) {
    const active = new Set(this.subs.filter((s) => s.status === 'active').map((s) => s.id));
    const due = this.queue
      .filter((d) => d.status === 'pending' && d.nextAttemptAt <= now && active.has(d.subscriptionId))
      .sort((a, b) => (a.nextAttemptAt < b.nextAttemptAt ? -1 : a.nextAttemptAt > b.nextAttemptAt ? 1 : 0))
      .slice(0, limit);
    for (const d of due) d.nextAttemptAt = leaseUntil;
    return structuredClone(due);
  }

  async recordAttempt(d: Delivery) {
    const i = this.queue.findIndex((x) => x.id === d.id);
    if (i >= 0) this.queue[i] = structuredClone(d);
  }

  async listDeliveries(f: { subscriptionId: string; status?: DeliveryStatus }) {
    return structuredClone(this.queue.filter((d) => d.subscriptionId === f.subscriptionId && (!f.status || d.status === f.status)));
  }
}
