import type { Event } from '@agent-ops/shared';
import type { EventDraft } from '../../domain/index.js';
import type { SimClock } from './clock.js';
import type {
  AgentRepository,
  ModelPriceRepository,
  SessionRepository,
  SimStateRepository,
  SimulationStateRepository,
  TicketRepository,
} from './repositories.js';

/** Everything a command may touch inside one transaction. */
export interface TxContext {
  readonly tickets: TicketRepository;
  readonly agents: AgentRepository;
  readonly sessions: SessionRepository;
  readonly simState: SimStateRepository;
  readonly modelPrices: ModelPriceRepository;
  readonly simulation: SimulationStateRepository;
  readonly clock: SimClock;
  /** Appends drafts to the journal in order and returns them with `seq`/`realAt`. */
  appendEvents(drafts: readonly EventDraft[]): Promise<Event[]>;
  /** Takes the next gap-free number from the persistent counter, in this transaction. */
  nextNumber(counter: 'ticket' | 'session'): Promise<number>;
}

/**
 * One command = one transaction. Any throw rolls everything back and publishes nothing; on success the
 * committed events are published after COMMIT.
 */
export interface UnitOfWork {
  run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
}
