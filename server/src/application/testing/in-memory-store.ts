import type { Event, ModelPrice } from '@agent-ops/shared';
import type { AgentState, SessionState, TicketState } from '../../domain/index.js';
import type { AgentSimState, SimulationRow, StoredLogEntry } from '../ports/repositories.js';

export interface StoreData {
  tickets: Map<string, TicketState>;
  agents: Map<string, AgentState>;
  sessions: Map<string, SessionState>;
  entries: Map<string, StoredLogEntry[]>;
  simState: Map<string, AgentSimState>;
  prices: Map<string, ModelPrice>;
  simulation: SimulationRow;
  counters: { ticket: number; session: number };
}

/** The in-memory "database" shared by the fakes. `events`/`nextSeq` survive rollback (gaps are allowed). */
export class InMemoryStore {
  data: StoreData = {
    tickets: new Map(),
    agents: new Map(),
    sessions: new Map(),
    entries: new Map(),
    simState: new Map(),
    prices: new Map(),
    simulation: {
      clockAt: '2026-10-24T14:32:00.000Z',
      seed: 20261024,
      journalFloorSeq: 1,
      seededAt: '2026-10-24T14:32:00.000Z',
    },
    counters: { ticket: 1, session: 1 },
  };
  events: Event[] = [];
  nextSeq = 1;

  snapshot(): StoreData {
    return structuredClone(this.data);
  }

  restore(snapshot: StoreData): void {
    this.data = snapshot;
  }

  /** Test seeding helpers. */
  seedTicket(t: TicketState): void {
    this.data.tickets.set(t.id, t);
  }
  seedAgent(a: AgentState): void {
    this.data.agents.set(a.id, a);
  }
  seedSession(s: SessionState): void {
    this.data.sessions.set(s.id, s);
  }
  seedPrice(p: ModelPrice): void {
    this.data.prices.set(p.model, p);
  }
}
