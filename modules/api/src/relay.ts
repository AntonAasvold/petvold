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

export interface RelayOptions {
  clock: { now(): string };
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

  constructor(
    private readonly sources: RelaySource<{ id: string }>[],
    private readonly o: RelayOptions,
  ) {}

  /** One round over every source. Returns how many events were delivered. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let delivered = 0;
    try {
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
          this.dead.set(key, { source: s.name, eventId: e.id, attempts: count, lastError });
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

  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch((err) => this.o.log?.(`[relay] ${String(err)}`)), intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((r) => setTimeout(r, 10));
  }
}
