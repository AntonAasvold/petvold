import type { ClaimsOutbox, Clock, EventSink } from './ports.ts';

/**
 * Publishes pending events from the outbox, oldest first, and marks each one
 * as published after it has been delivered. Stops at the first failure and
 * leaves that event and the rest for the next run, so delivery is at least
 * once and in order. Returns the number of events published.
 *
 * Run it on an interval or after each write. Only one relay may run per
 * outbox at a time; several relays would need row locking (`skip locked`).
 */
export async function relayOutbox(outbox: ClaimsOutbox, sink: EventSink, clock: Clock, limit = 100): Promise<number> {
  const pending = await outbox.pendingEvents(limit);
  let published = 0;
  for (const entry of pending) {
    await sink.publish(entry.event);
    await outbox.markPublished([entry.id], clock.now());
    published++;
  }
  return published;
}
