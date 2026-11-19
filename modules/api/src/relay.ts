/**
 * The relay for every module's outbox (ADR 0008, granskningen A5).
 *
 * Each source hands over its pending events in order. An event is marked as
 * published only after it was delivered, so delivery is at least once and the
 * receivers tolerate repeats (proposals by source event id, reassessment by
 * input hash). A failed event stops its source for this round, so later events
 * of the same source do not overtake it, and is retried with a growing pause.
 * After maxAttempts it is set aside as a dead letter: logged, kept unpublished
 * in the outbox, and skipped by this process so the rest can flow.
 */

export interface RelaySource<E extends { id: string }> {
  /** e.g. 'claims', 'animals', 'policies'. */
  name: string;
  pending(limit: number): Promise<E[]>;
  deliver(event: E): Promise<void>;
  markPublished(ids: string[], at: string): Promise<void>;
}

/** A source with its own event type, for a relay of mixed sources. */
export function relaySource<E extends { id: string }>(s: RelaySource<E>): RelaySource<{ id: string }> {
  return s as unknown as RelaySource<{ id: string }>;
}

export interface DeadLetter {
  source: string;
  eventId: string;
  attempts: number;
  lastError: string;
}

/** Where dead letters are kept, and the lease that makes one server the relay (ADR 0037). */
export interface RelayState {
  tryLease(key: string, holder: string, until: string, now: string): Promise<boolean>;
  releaseLease(key: string, holder: string): Promise<void>;
  saveDeadLetter(d: DeadLetter & { deadAt: string }): Promise<void>;
  deadLetters(): Promise<(DeadLetter & { deadAt: string })[]>;
  removeDeadLetter(source: string, eventId: string): Promise<boolean>;
}

export interface RelayOptions {
  clock: { now(): string };
  /**
   * With state, one server at a time is the relay: it holds the lease 'relay'
   * and renews it every round; the others wait. Dead letters are kept there,
   * so they outlive a restart. Without, the relay keeps them in memory.
   */
  state?: RelayState;
  /** This server, for the lease. */
  holder?: string;
  /** How long the lease lasts without a renewal. Default 30 s. */
  leaseMs?: number;
  /** Attempts before an event becomes a dead letter. Default 10. */
  maxAttempts?: number;
  /** Events per source and round. Default 100. */
  batchSize?: number;
  log?: (line: string) => void;
}

interface Attempt {
  count: number;
  /** Not before this time (ms since epoch). */
  retryAt: number;
  lastError: string;
}

export class Relay {
  private readonly attempts = new Map<string, Attempt>();
  private readonly dead = new Map<string, DeadLetter>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** When the dead letters were last read from the state, ms since epoch. */
  private loadedAt = -Infinity;
  private leading = false;

  constructor(
    private readonly sources: RelaySource<{ id: string }>[],
    private readonly o: RelayOptions,
  ) {}

  /** One round over every source. Returns how many events were delivered; 0 when another server is the relay. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let delivered = 0;
    try {
      if (!(await this.lead())) return 0;
      for (const s of this.sources) delivered += await this.drain(s);
    } finally {
      this.running = false;
    }
    return delivered;
  }

  private async drain(s: RelaySource<{ id: string }>): Promise<number> {
    const now = Date.parse(this.o.clock.now());
    let delivered = 0;
    for (const e of await s.pending(this.o.batchSize ?? 100)) {
      const key = `${s.name}:${e.id}`;
      if (this.dead.has(key)) continue;
      const a = this.attempts.get(key);
      if (a && a.retryAt > now) return delivered; // keep the order: wait for this one
      try {
        await s.deliver(e);
        await s.markPublished([e.id], this.o.clock.now());
        this.attempts.delete(key);
        delivered++;
      } catch (err) {
        const count = (a?.count ?? 0) + 1;
        const lastError = err instanceof Error ? err.message : String(err);
        if (count >= (this.o.maxAttempts ?? 10)) {
          this.attempts.delete(key);
          const letter = { source: s.name, eventId: e.id, attempts: count, lastError };
          this.dead.set(key, letter);
          await this.o.state?.saveDeadLetter({ ...letter, deadAt: this.o.clock.now() });
          this.o.log?.(`[relay] ${s.name} ${e.id} is a dead letter after ${count} attempts: ${lastError}`);
          continue; // the rest of the source may flow
        }
        // 1 s, 2 s, 4 s … up to 5 minutes.
        this.attempts.set(key, { count, retryAt: now + Math.min(1000 * 2 ** (count - 1), 300_000), lastError });
        this.o.log?.(`[relay] ${s.name} ${e.id} failed (attempt ${count}): ${lastError}`);
        return delivered;
      }
    }
    return delivered;
  }

  /** Events set aside after too many attempts, for the health check and an operator. */
  deadLetters(): DeadLetter[] {
    return [...this.dead.values()];
  }

  /** Whether this server is the relay now. */
  isLeading(): boolean {
    return this.o.state ? this.leading : true;
  }

  /** Sends a dead letter again: it is forgotten, and the next round tries the event from the start. */
  async retryDeadLetter(source: string, eventId: string): Promise<boolean> {
    const key = `${source}:${eventId}`;
    const had = this.dead.delete(key);
    this.attempts.delete(key);
    const stored = (await this.o.state?.removeDeadLetter(source, eventId)) ?? false;
    return had || stored;
  }

  /**
   * Takes or renews the lease, and as the relay reads the dead letters kept
   * there, at the first round and every 10 s, so they are skipped after a
   * restart too and one sent again elsewhere is tried.
   */
  private async lead(): Promise<boolean> {
    const st = this.o.state;
    if (!st) return true;
    const now = this.o.clock.now();
    const until = new Date(Date.parse(now) + (this.o.leaseMs ?? 30_000)).toISOString();
    this.leading = await st.tryLease('relay', this.holder(), until, now);
    // Read the dead letters again every 10 s: one sent again on another server is then tried here too.
    if (this.leading && Date.parse(now) - this.loadedAt >= 10_000) {
      this.dead.clear();
      for (const d of await st.deadLetters()) this.dead.set(`${d.source}:${d.eventId}`, { source: d.source, eventId: d.eventId, attempts: d.attempts, lastError: d.lastError });
      this.loadedAt = Date.parse(now);
    }
    return this.leading;
  }

  private holder(): string {
    return this.o.holder ?? 'relay';
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((err) => this.o.log?.(`[relay] ${String(err)}`)), intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((r) => setTimeout(r, 10));
    // Let go at once, so another server can take over without waiting for the lease to run out.
    if (this.o.state && this.leading) await this.o.state.releaseLease('relay', this.holder()).catch(() => {});
    this.leading = false;
  }
}
