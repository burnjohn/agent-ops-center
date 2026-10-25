import type { Event } from '@agent-ops/shared';
import type {
  EventListener,
  EventPublisher,
  EventSubscriber,
} from '../../application/ports/index.js';

/** In-process fan-out (ADR-0004): the unit of work publishes committed events, open streams subscribe. */
export class SseFanOut implements EventPublisher, EventSubscriber {
  private readonly listeners = new Set<EventListener>();

  publish(events: readonly Event[]): void {
    if (events.length === 0) return;
    for (const listener of [...this.listeners]) {
      try {
        listener(events);
      } catch {
        // one broken connection must not affect the others or the committed command
      }
    }
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get size(): number {
    return this.listeners.size;
  }
}
