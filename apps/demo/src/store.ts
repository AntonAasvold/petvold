/**
 * The demo's storage: the events, each accepted call, the rejected calls and
 * the settings. Postgres in the demo (postgres.ts), memory in tests and when
 * DEMO_DATABASE_URL is 'memory'.
 */
import type { CloudEvent } from './cloud-event.ts';
import { typePattern } from './cloud-event.ts';

export interface StoredEvent {
  id: string;
  /** The order the demo first received it in. */
  seq: number;
  event: CloudEvent;
  receivedAt: string;
  /** Accepted calls with this event: more than one is a duplicate delivery. */
  deliveries: number;
}

export interface Delivery {
  webhookId: string;
  receivedAt: string;
  headers: Record<string, string>;
}

export interface Rejected {
  id: number;
  webhookId: string | null;
  receivedAt: string;
  reason: string;
  headers: Record<string, string>;
  body: string;
}

export interface EventFilter {
  /** policy.issued, or policy.* for every policy event. */
  type?: string;
  market?: string;
  subject?: string;
  /** Times as ISO 8601; from inclusive, to exclusive. */
  from?: string;
  to?: string;
}

export interface Counts {
  events: number;
  deliveries: number;
  rejected: number;
}

export interface Store {
  /** Stores the event once by its id, and the call every time. */
  receive(event: CloudEvent, delivery: Delivery): Promise<{ duplicate: boolean }>;
  reject(r: Omit<Rejected, 'id'>): Promise<void>;
  /** Newest first by the event's time, then by receipt. */
  events(filter: EventFilter, limit: number, offset: number): Promise<StoredEvent[]>;
  event(id: string): Promise<{ stored: StoredEvent; deliveries: Delivery[] } | null>;
  rejected(limit: number): Promise<Rejected[]>;
  counts(): Promise<Counts>;
  setting<T>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown, at: string): Promise<void>;
  close(): Promise<void>;
}

/** The SQL LIKE pattern as a test, for the memory store. */
export function likeTest(pattern: string): (s: string) => boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '\\') re += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (c === '%') re += '.*';
    else if (c === '_') re += '.';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const r = new RegExp(`^${re}$`);
  return (s) => r.test(s);
}

export function matchesFilter(e: CloudEvent, f: EventFilter): boolean {
  if (f.type && !likeTest(typePattern(f.type))(e.type)) return false;
  if (f.market && e.market !== f.market) return false;
  if (f.subject && e.subject !== f.subject) return false;
  const t = Date.parse(e.time);
  if (f.from && t < Date.parse(f.from)) return false;
  if (f.to && t >= Date.parse(f.to)) return false;
  return true;
}

export class MemoryStore implements Store {
  private byId = new Map<string, { stored: StoredEvent; deliveries: Delivery[] }>();
  private rejects: Rejected[] = [];
  private settings = new Map<string, unknown>();
  private seq = 0;

  async receive(event: CloudEvent, delivery: Delivery) {
    const found = this.byId.get(event.id);
    if (found) {
      found.deliveries.push(delivery);
      found.stored.deliveries++;
      return { duplicate: true };
    }
    this.byId.set(event.id, { stored: { id: event.id, seq: ++this.seq, event, receivedAt: delivery.receivedAt, deliveries: 1 }, deliveries: [delivery] });
    return { duplicate: false };
  }

  async reject(r: Omit<Rejected, 'id'>) {
    this.rejects.push({ ...r, id: this.rejects.length + 1 });
  }

  async events(filter: EventFilter, limit: number, offset: number) {
    return [...this.byId.values()]
      .map((x) => x.stored)
      .filter((s) => matchesFilter(s.event, filter))
      .sort((a, b) => Date.parse(b.event.time) - Date.parse(a.event.time) || b.seq - a.seq)
      .slice(offset, offset + limit)
      .map((s) => ({ ...s }));
  }

  async event(id: string) {
    const x = this.byId.get(id);
    return x ? { stored: { ...x.stored }, deliveries: [...x.deliveries] } : null;
  }

  async rejected(limit: number) {
    return [...this.rejects].reverse().slice(0, limit);
  }

  async counts() {
    let deliveries = 0;
    for (const x of this.byId.values()) deliveries += x.deliveries.length;
    return { events: this.byId.size, deliveries, rejected: this.rejects.length };
  }

  async setting<T>(key: string) {
    return (this.settings.has(key) ? this.settings.get(key) : null) as T | null;
  }

  async setSetting(key: string, value: unknown) {
    this.settings.set(key, value);
  }

  async close() {}
}
