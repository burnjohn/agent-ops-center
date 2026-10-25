import type { Event } from '@agent-ops/shared';
import type { EventDraft } from '../../domain/index.js';
import { ConstraintRace } from '../ports/errors.js';
import type { EventPublisher } from '../ports/publisher.js';
import type {
  AgentRepository,
  ModelPriceRepository,
  SessionRepository,
  SimStateRepository,
  SimulationStateRepository,
  TicketRepository,
} from '../ports/repositories.js';
import type { TxContext, UnitOfWork } from '../ports/unit-of-work.js';
import { FakeClock } from './fake-clock.js';
import type { InMemoryStore } from './in-memory-store.js';

/** In-memory repositories reading `store.data` live, so a restored snapshot is seen immediately. */
export function createRepositories(store: InMemoryStore) {
  const tickets: TicketRepository = {
    get: async (id) => store.data.tickets.get(id) ?? null,
    list: async () => [...store.data.tickets.values()],
    insert: async (t) => {
      if (store.data.tickets.has(t.id)) throw new ConstraintRace('counter_collision');
      if (t.title.trim() === '') throw new ConstraintRace('empty_title');
      store.data.tickets.set(t.id, t);
    },
    update: async (t) => {
      store.data.tickets.set(t.id, t);
    },
  };
  const agents: AgentRepository = {
    get: async (id) => store.data.agents.get(id) ?? null,
    list: async () => [...store.data.agents.values()],
    update: async (a) => {
      store.data.agents.set(a.id, a);
    },
  };
  const sessions: SessionRepository = {
    get: async (id) => store.data.sessions.get(id) ?? null,
    insert: async (s) => {
      if (store.data.sessions.has(s.id)) throw new ConstraintRace('counter_collision');
      const running = [...store.data.sessions.values()].some(
        (x) => x.agentId === s.agentId && x.status === 'running',
      );
      if (s.status === 'running' && running) throw new ConstraintRace('agent_busy');
      store.data.sessions.set(s.id, s);
    },
    update: async (s) => {
      store.data.sessions.set(s.id, s);
    },
    appendEntry: async (sessionId, entry) => {
      const list = store.data.entries.get(sessionId) ?? [];
      list.push(entry);
      store.data.entries.set(sessionId, list);
    },
    entries: async (sessionId) =>
      [...(store.data.entries.get(sessionId) ?? [])].sort((a, b) => a.index - b.index),
    runningFor: async (agentId) =>
      [...store.data.sessions.values()].find(
        (s) => s.agentId === agentId && s.status === 'running',
      ) ?? null,
  };
  const simState: SimStateRepository = {
    get: async (id) => store.data.simState.get(id) ?? null,
    list: async () => [...store.data.simState.values()],
    save: async (s) => {
      store.data.simState.set(s.agentId, s);
    },
  };
  const modelPrices: ModelPriceRepository = {
    get: async (m) => store.data.prices.get(m) ?? null,
    list: async () => [...store.data.prices.values()],
  };
  const simulation: SimulationStateRepository = {
    get: async () => ({ ...store.data.simulation }),
  };
  return { tickets, agents, sessions, simState, modelPrices, simulation };
}

/**
 * Serialises `run` calls (like the events advisory lock), snapshots the store, rolls it back on a throw
 * and publishes the committed events only after success.
 */
export class FakeUnitOfWork implements UnitOfWork {
  private readonly repos;
  private readonly clock;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: InMemoryStore,
    private readonly publisher: EventPublisher,
  ) {
    this.repos = createRepositories(store);
    this.clock = new FakeClock(store);
  }

  run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    const result = this.tail.then(() => this.execute(fn));
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async execute<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    const before = this.store.snapshot();
    const eventsBefore = this.store.events.length;
    const committed: Event[] = [];
    const tx: TxContext = {
      ...this.repos,
      clock: this.clock,
      appendEvents: async (drafts: readonly EventDraft[]) => {
        const realAt = new Date().toISOString();
        const events = drafts.map(
          (d) => ({ ...d, seq: this.store.nextSeq++, realAt }) as unknown as Event,
        );
        this.store.events.push(...events);
        committed.push(...events);
        return events;
      },
      nextNumber: async (counter) => {
        const n = this.store.data.counters[counter];
        this.store.data.counters[counter] = n + 1;
        return n;
      },
    };
    try {
      const value = await fn(tx);
      if (committed.length > 0) this.publisher.publish(committed);
      return value;
    } catch (err) {
      this.store.restore(before);
      this.store.events.length = eventsBefore;
      throw err;
    }
  }
}
