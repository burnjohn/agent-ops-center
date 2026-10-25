import type { Event } from '@agent-ops/shared';

/** Called by the unit of work only after COMMIT; never on rollback. */
export interface EventPublisher {
  publish(events: readonly Event[]): void;
}

export type EventListener = (events: readonly Event[]) => void;

export interface EventSubscriber {
  /** Returns the unsubscribe function. */
  subscribe(listener: EventListener): () => void;
}
