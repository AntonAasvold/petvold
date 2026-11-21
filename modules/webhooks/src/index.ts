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
export type SubjectField = 'policyId' | 'applicationId' | 'claimId' | 'animalId' | 'noticeId' | 'runId' | 'invoiceId';

/** A request for information (ADR 0036): what was asked for and when it is due, never the note. */
const INFORMATION_FIELDS = ['requestId', 'recipient', 'items', 'dueDate', 'status'];

export const PUBLIC_EVENTS: Record<string, { source: string; subject: SubjectField; fields: string[] }> = {
  'claim.registered': { source: 'claims', subject: 'claimId', fields: ['claimNo', 'policyId', 'animalId', 'channel', 'clinicId', 'treatmentFrom', 'treatmentTo', 'diagnosisCode', 'currency'] },
  'claim.decision_proposed': { source: 'claims', subject: 'claimId', fields: ['proposalId', 'action', 'outcome', 'payout', 'currency', 'deviatesFromProposal', 'reasonCode'] },
  'claim.proposal_returned': { source: 'claims', subject: 'claimId', fields: ['proposalId'] },
  'claim.decided': { source: 'claims', subject: 'claimId', fields: ['decisionId', 'seq', 'outcome', 'payout', 'currency', 'automated', 'deviatesFromProposal', 'reasonCode', 'reviewRequestId'] },
  'claim.payout_ordered': { source: 'claims', subject: 'claimId', fields: ['payoutOrderId', 'decisionId', 'policyId', 'amount', 'currency', 'channel', 'clinicId'] },
  'claim.review_requested': { source: 'claims', subject: 'claimId', fields: ['reviewRequestId', 'decisionId', 'decisionSeq'] },
  'claim.withdrawn': { source: 'claims', subject: 'claimId', fields: ['closureId'] },
  'claim.dismissed': { source: 'claims', subject: 'claimId', fields: ['closureId', 'reasonCode', 'duplicateOf'] },
  'claim.attachment_added': { source: 'claims', subject: 'claimId', fields: ['attachmentId', 'kind', 'mediaType', 'size', 'sha256', 'url', 'replaces'] },
  'claim.corrected': { source: 'claims', subject: 'claimId', fields: ['correctionId', 'revision', 'fields', 'reopens'] },
  'claim.information_requested': { source: 'claims', subject: 'claimId', fields: INFORMATION_FIELDS },
  'claim.information_reminded': { source: 'claims', subject: 'claimId', fields: INFORMATION_FIELDS },
  'claim.information_received': { source: 'claims', subject: 'claimId', fields: INFORMATION_FIELDS },
  'claim.information_expired': { source: 'claims', subject: 'claimId', fields: INFORMATION_FIELDS },
  'claim.information_cancelled': { source: 'claims', subject: 'claimId', fields: INFORMATION_FIELDS },
  'animal.ownership_changed': { source: 'animals', subject: 'animalId', fields: ['fromPartyId', 'toPartyId', 'from'] },
  'animal.died': { source: 'animals', subject: 'animalId', fields: ['deceasedOn'] },
  'notice.created': { source: 'communications', subject: 'noticeId', fields: ['noticeType', 'schema', 'recipientPartyId', 'language', 'policyId', 'applicationId', 'invoiceId', 'dueBy', 'documentMaker'] },
  'notice.document_made': { source: 'communications', subject: 'noticeId', fields: ['noticeType', 'documentId', 'sha256'] },
  'notice.delivered': { source: 'communications', subject: 'noticeId', fields: ['deliveryId', 'channel', 'sentAt', 'documentId', 'late'] },
  'notice.failed': { source: 'communications', subject: 'noticeId', fields: ['deliveryId', 'channel'] },
  'invoice.issued': { source: 'billing', subject: 'invoiceId', fields: ['invoiceNo', 'accountId', 'partyId', 'issueDate', 'dueDate', 'total', 'currency', 'reference', 'policyIds'] },
  // A run failed (ADR 0037), for the insurer's operations to alert on. The error stays inside Petvold.
  'job.failed': { source: 'scheduling', subject: 'runId', fields: ['job', 'trigger', 'startedAt'] },
  'policy.issued': { source: 'policies', subject: 'policyId', fields: ['transactionId', 'animalId', 'policyholderPartyId', 'productVersion', 'startDate', 'endDate', 'premium', 'paymentInterval', 'applicationId'] },
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

/** An event from a module's outbox, with its market, as the relay hands it over. The subject's id is in its field. */
export interface SourceEvent {
  id: string;
  type: string;
  policyId?: string;
  applicationId?: string;
  claimId?: string;
  animalId?: string;
  noticeId?: string;
  runId?: string;
  invoiceId?: string;
  market: string;
  occurredAt: Timestamp;
  data: Record<string, unknown>;
  /** The event's position in its module's outbox. Omitted for events that do not come from an outbox, e.g. job.failed. */
  sequence?: number;
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
  /**
   * The CloudEvents extension `sequence`: the position in the source's outbox,
   * zero-padded to 20 digits so that it orders as a string. Increasing per
   * source; a gap does not mean an event is missing.
   */
  sequence?: string;
}

/** The public form of an event, or null if it is not public. Pure. */
export function toCloudEvent(e: SourceEvent): CloudEvent | null {
  const spec = PUBLIC_EVENTS[e.type];
  if (!spec) return null;
  const subject = e[spec.subject];
  if (!subject) return null;
  const data: Record<string, unknown> = { [spec.subject]: subject };
  for (const f of spec.fields) if (e.data[f] !== undefined) data[f] = structuredClone(e.data[f]);
  // An application that led to a policy names it.
  if (spec.subject === 'applicationId' && e.policyId) data.policyId = e.policyId;
  return {
    specversion: '1.0',
    id: e.id,
    source: `/petvold/${spec.source}`,
    type: `petvold.${e.type}.v1`,
    subject,
    time: e.occurredAt,
    datacontenttype: 'application/json',
    market: e.market,
    data,
    ...(e.sequence === undefined ? {} : { sequence: String(e.sequence).padStart(20, '0') }),
  };
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
  /** Since when every attempt has failed. After five days the subscription is disabled. Cleared by a delivery. */
  failingSince?: Timestamp;
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
  /** When a person sent it again. The three days count from here. */
  retriedAt?: Timestamp;
  /** When the event's data was removed, 30 days after it was delivered or given up (ADR 0033 point 10). */
  prunedAt?: Timestamp;
  createdAt: Timestamp;
}

export interface DeliveryFilter {
  subscriptionId?: string;
  status?: DeliveryStatus;
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
  /** Stores the outcome of an attempt, or a person's retry. */
  recordAttempt(d: Delivery): Promise<void>;
  getDelivery(id: string): Promise<Delivery | null>;
  /** Oldest first. */
  listDeliveries(filter: DeliveryFilter): Promise<Delivery[]>;
  /** Sets or clears when the subscription started failing, without a new revision. */
  setFailingSince(subscriptionId: string, at: Timestamp | null): Promise<void>;
  /** Removes `data` from delivered and dead deliveries last tried before `before`. Returns how many. */
  prune(before: Timestamp, now: Timestamp): Promise<number>;
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
/** A subscription where every attempt has failed this long is disabled (ADR 0033). */
export const DISABLE_AFTER_MS = 5 * 86_400_000;
/** The data of a delivered or dead event is kept this long (ADR 0033 point 10). */
export const KEEP_DATA_MS = 30 * 86_400_000;

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
    const { failingSince: _f, ...kept } = rest;
    const next: StoredSubscription = {
      ...(input.status === 'active' ? kept : rest),
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

  /** Deliveries across subscriptions, e.g. every dead one: the list for a person. */
  async allDeliveries(filter: DeliveryFilter): Promise<Delivery[]> {
    return this.d.store.listDeliveries(filter);
  }

  /** Sends a dead delivery again, with three new days. Not one whose data has been removed. */
  async retry(subscriptionId: string, deliveryId: string): Promise<Delivery> {
    const d = await this.d.store.getDelivery(deliveryId);
    if (!d || d.subscriptionId !== subscriptionId) throw new WebhookError('not_found', `Delivery ${deliveryId} does not exist`);
    if (d.status !== 'dead') throw new WebhookError('conflict', `Delivery ${deliveryId} is ${d.status}; only a dead one is sent again`);
    if (d.prunedAt) throw new WebhookError('conflict', `Delivery ${deliveryId} was given up more than 30 days ago and its data is removed`);
    const now = this.d.clock.now();
    const next: Delivery = { ...d, status: 'pending', attempts: 0, nextAttemptAt: now, retriedAt: now };
    await this.d.store.recordAttempt(next);
    return next;
  }

  /** Sends every dead delivery of a subscription again. Returns how many. */
  async retryAll(subscriptionId: string): Promise<number> {
    const dead = (await this.deliveries(subscriptionId, 'dead')).filter((d) => !d.prunedAt);
    for (const d of dead) await this.retry(subscriptionId, d.id);
    return dead.length;
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

  /** Notes that an attempt failed or succeeded; disables a subscription that has failed for five days. */
  async noteOutcome(s: StoredSubscription, ok: boolean, now: Timestamp): Promise<void> {
    if (ok) {
      if (s.failingSince) await this.d.store.setFailingSince(s.id, null);
      return;
    }
    if (!s.failingSince) return this.d.store.setFailingSince(s.id, now);
    if (Date.parse(now) - Date.parse(s.failingSince) > DISABLE_AFTER_MS) await this.disable(s.id, `Nothing delivered since ${s.failingSince}`);
  }

  /** Marks a subscription disabled, e.g. when the receiver answers 410 Gone. */
  async disable(id: string, reason: string): Promise<void> {
    const cur = await this.stored(id);
    if (cur.status === 'disabled') return;
    const { failingSince: _f, ...rest } = cur;
    await this.save({ ...rest, status: 'disabled', disabledReason: reason, revision: cur.revision + 1, changedBy: 'petvold-webhooks', changedAt: this.d.clock.now() });
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
  private prunedAt = 0;

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
      // Once an hour: remove the data of events delivered or given up 30 days ago.
      if (Date.parse(now) - this.prunedAt >= 3_600_000) {
        this.prunedAt = Date.parse(now);
        const pruned = await this.d.store.prune(new Date(Date.parse(now) - KEEP_DATA_MS).toISOString(), now);
        if (pruned) this.d.log?.(`[webhooks] removed the data of ${pruned} old deliveries`);
      }
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
      await this.d.service.noteOutcome(sub, true, now);
      return 'delivered';
    }
    const lastError = error ?? `HTTP ${status}`;
    if (status === 410) {
      await this.d.service.disable(sub.id, 'The receiver answered 410 Gone');
      this.d.log?.(`[webhooks] ${sub.id} disabled: 410 Gone`);
    }
    const next = status === 410 ? null : nextAttemptAt(delivery.retriedAt ?? delivery.createdAt, attempt.attempts, now, this.d.random);
    await this.d.store.recordAttempt({
      ...attempt,
      ...(status !== undefined ? { lastStatus: status } : {}),
      lastError,
      ...(next ? { status: 'pending', nextAttemptAt: next } : { status: 'dead' }),
    });
    if (status !== 410) await this.d.service.noteOutcome(sub, false, now);
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

  async getDelivery(id: string) {
    const d = this.queue.find((x) => x.id === id);
    return d ? structuredClone(d) : null;
  }

  async listDeliveries(f: DeliveryFilter) {
    return structuredClone(this.queue.filter((d) => (!f.subscriptionId || d.subscriptionId === f.subscriptionId) && (!f.status || d.status === f.status)));
  }

  async setFailingSince(id: string, at: Timestamp | null) {
    const s = this.subs.find((x) => x.id === id);
    if (!s) return;
    if (at) s.failingSince = at;
    else delete s.failingSince;
  }

  async prune(before: Timestamp, now: Timestamp) {
    let n = 0;
    for (const d of this.queue) {
      if (d.status === 'pending' || d.prunedAt || (d.lastAttemptAt ?? d.createdAt) >= before) continue;
      d.event = { ...d.event, data: {} };
      d.prunedAt = now;
      n++;
    }
    return n;
  }
}
