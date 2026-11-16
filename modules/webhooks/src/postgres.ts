/**
 * WebhookStore against the schema `webhooks` (migration 0033). Connect with the
 * service role `webhooks_service`. Workers claim due deliveries with
 * `for update skip locked`, so several instances never send the same one at once.
 */
import type pg from 'pg';
import { WebhookConflictError, type Delivery, type DeliveryFilter, type StoredSubscription, type Timestamp, type WebhookStore } from './index.ts';

const UNIQUE_VIOLATION = '23505';
const iso = (t: unknown) => (t instanceof Date ? t.toISOString() : new Date(String(t)).toISOString());

export class PostgresWebhookStore implements WebhookStore {
  constructor(private readonly pool: pg.Pool) {}

  async createSubscription(s: StoredSubscription): Promise<void> {
    await this.pool
      .query(
        `insert into webhooks.subscription (subscription_id, url, event_types, markets, description, status, disabled_reason, secret, previous_secret,
           previous_secret_until, revision, created_by, created_at, changed_by, changed_at, failing_since)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        subscriptionRow(s),
      )
      .catch((e: { code?: string }) => {
        if (e.code === UNIQUE_VIOLATION) throw new WebhookConflictError(`Webhook subscription ${s.id} exists`);
        throw e;
      });
  }

  async getSubscription(id: string): Promise<StoredSubscription | null> {
    const { rows } = await this.pool.query(`select * from webhooks.subscription where subscription_id = $1`, [id]);
    return rows[0] ? toSubscription(rows[0]) : null;
  }

  async listSubscriptions(): Promise<StoredSubscription[]> {
    const { rows } = await this.pool.query(`select * from webhooks.subscription order by created_at, subscription_id`);
    return rows.map(toSubscription);
  }

  async updateSubscription(s: StoredSubscription): Promise<void> {
    const r = await this.pool.query(
      `update webhooks.subscription set url = $2, event_types = $3, markets = $4, description = $5, status = $6, disabled_reason = $7, secret = $8,
         previous_secret = $9, previous_secret_until = $10, revision = $11, created_by = $12, created_at = $13, changed_by = $14, changed_at = $15,
         failing_since = $16
       where subscription_id = $1 and revision = $11 - 1`,
      subscriptionRow(s),
    );
    if (r.rowCount !== 1) throw new WebhookConflictError(`Webhook subscription ${s.id} has changed`);
  }

  async enqueue(ds: Delivery[]): Promise<number> {
    let n = 0;
    for (const d of ds) {
      const r = await this.pool.query(
        `insert into webhooks.delivery (delivery_id, subscription_id, event_id, event_type, event, status, attempts, next_attempt_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (subscription_id, event_id) do nothing`,
        [d.id, d.subscriptionId, d.eventId, d.eventType, JSON.stringify(d.event), d.status, d.attempts, d.nextAttemptAt, d.createdAt],
      );
      n += r.rowCount ?? 0;
    }
    return n;
  }

  async claimDue(now: Timestamp, limit: number, leaseUntil: Timestamp): Promise<Delivery[]> {
    const { rows } = await this.pool.query(
      `update webhooks.delivery d set next_attempt_at = $3
       where d.delivery_id in (
         select x.delivery_id from webhooks.delivery x join webhooks.subscription s using (subscription_id)
         where x.status = 'pending' and x.next_attempt_at <= $1 and s.status = 'active'
         order by x.next_attempt_at, x.delivery_id limit $2 for update of x skip locked)
       returning d.*`,
      [now, limit, leaseUntil],
    );
    return rows.map(toDelivery).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  async recordAttempt(d: Delivery): Promise<void> {
    await this.pool.query(
      `update webhooks.delivery set status = $2, attempts = $3, next_attempt_at = $4, last_attempt_at = $5, last_status = $6, last_error = $7, delivered_at = $8,
         retried_at = $9
       where delivery_id = $1`,
      [d.id, d.status, d.attempts, d.nextAttemptAt, d.lastAttemptAt ?? null, d.lastStatus ?? null, d.lastError ?? null, d.deliveredAt ?? null, d.retriedAt ?? null],
    );
  }

  async getDelivery(id: string): Promise<Delivery | null> {
    const { rows } = await this.pool.query(`select * from webhooks.delivery where delivery_id = $1`, [id]);
    return rows[0] ? toDelivery(rows[0]) : null;
  }

  async listDeliveries(f: DeliveryFilter): Promise<Delivery[]> {
    const { rows } = await this.pool.query(
      `select * from webhooks.delivery where ($1::text is null or subscription_id = $1) and ($2::text is null or status = $2) order by created_at, delivery_id`,
      [f.subscriptionId ?? null, f.status ?? null],
    );
    return rows.map(toDelivery);
  }

  async setFailingSince(subscriptionId: string, at: Timestamp | null): Promise<void> {
    await this.pool.query(`update webhooks.subscription set failing_since = $2 where subscription_id = $1`, [subscriptionId, at]);
  }

  async prune(before: Timestamp, now: Timestamp): Promise<number> {
    const r = await this.pool.query(
      `update webhooks.delivery set event = jsonb_set(event, '{data}', '{}'::jsonb), pruned_at = $2
       where status in ('delivered', 'dead') and pruned_at is null and coalesce(last_attempt_at, created_at) < $1`,
      [before, now],
    );
    return r.rowCount ?? 0;
  }
}

function subscriptionRow(s: StoredSubscription): unknown[] {
  return [
    s.id,
    s.url,
    JSON.stringify(s.eventTypes),
    JSON.stringify(s.markets),
    s.description ?? null,
    s.status,
    s.disabledReason ?? null,
    s.secret,
    s.previousSecret ?? null,
    s.previousSecretUntil ?? null,
    s.revision,
    s.createdBy,
    s.createdAt,
    s.changedBy,
    s.changedAt,
    s.failingSince ?? null,
  ];
}

function toSubscription(r: Record<string, any>): StoredSubscription {
  return {
    id: r.subscription_id,
    url: r.url,
    eventTypes: r.event_types,
    markets: r.markets,
    ...(r.description ? { description: r.description } : {}),
    status: r.status,
    ...(r.disabled_reason ? { disabledReason: r.disabled_reason } : {}),
    revision: r.revision,
    createdBy: r.created_by,
    createdAt: iso(r.created_at),
    changedBy: r.changed_by,
    changedAt: iso(r.changed_at),
    ...(r.previous_secret_until ? { previousSecretUntil: iso(r.previous_secret_until) } : {}),
    ...(r.failing_since ? { failingSince: iso(r.failing_since) } : {}),
    secret: r.secret,
    ...(r.previous_secret ? { previousSecret: r.previous_secret } : {}),
  };
}

function toDelivery(r: Record<string, any>): Delivery {
  return {
    id: r.delivery_id,
    subscriptionId: r.subscription_id,
    eventId: r.event_id,
    eventType: r.event_type,
    event: r.event,
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: iso(r.next_attempt_at),
    ...(r.last_attempt_at ? { lastAttemptAt: iso(r.last_attempt_at) } : {}),
    ...(r.last_status !== null ? { lastStatus: r.last_status } : {}),
    ...(r.last_error ? { lastError: r.last_error } : {}),
    ...(r.delivered_at ? { deliveredAt: iso(r.delivered_at) } : {}),
    ...(r.retried_at ? { retriedAt: iso(r.retried_at) } : {}),
    ...(r.pruned_at ? { prunedAt: iso(r.pruned_at) } : {}),
    createdAt: iso(r.created_at),
  };
}
