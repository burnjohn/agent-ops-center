import type { Event } from '@agent-ops/shared';
import type { EventListener, EventPublisher, EventSubscriber } from '../ports/publisher.js';

/** Records every publish call and fans out to subscribers. */
export class RecordingPublisher implements EventPublisher, EventSubscriber {
  readonly batches: Event[][] = [];
  private readonly listeners = new Set<EventListener>();

  get events(): Event[] {
    return this.batches.flat();
  }

  publish(events: readonly Event[]): void {
    this.batches.push([...events]);
    for (const l of [...this.listeners]) l(events);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
