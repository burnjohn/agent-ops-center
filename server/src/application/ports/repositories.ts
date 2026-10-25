import type { AgentScript, ModelPrice, TokenActivity } from '@agent-ops/shared';
import type { AgentState, LogEntryDraft, SessionState, TicketState } from '../../domain/index.js';

/** Repositories take the transaction they run in (implicitly, via the `TxContext` they came from). No deletes (DB-AC-41). */

export interface TicketRepository {
  get(id: string): Promise<TicketState | null>;
  list(): Promise<TicketState[]>;
  insert(ticket: TicketState): Promise<void>;
  update(ticket: TicketState): Promise<void>;
}

export interface AgentRepository {
  get(id: string): Promise<AgentState | null>;
  list(): Promise<AgentState[]>;
  update(agent: AgentState): Promise<void>;
}

/** A log entry as stored: the draft plus the token activity computed on write. */
export interface StoredLogEntry extends LogEntryDraft {
  activity: TokenActivity | null;
}

export interface SessionRepository {
  get(id: string): Promise<SessionState | null>;
  insert(session: SessionState): Promise<void>;
  update(session: SessionState): Promise<void>;
  appendEntry(sessionId: string, entry: StoredLogEntry): Promise<void>;
  /** Ordered by `index` (ordinal), never by `at`. */
  entries(sessionId: string): Promise<StoredLogEntry[]>;
  /** The running session of an agent, if any. */
  runningFor(agentId: string): Promise<SessionState | null>;
}

/** Per simulated agent script position (`agent_sim_state`). */
export interface AgentSimState {
  agentId: string;
  scenario: string;
  script: AgentScript;
  silent: boolean;
  pendingRefusalTicketId: string | null;
  cooldownSteps: number;
}

export interface SimStateRepository {
  get(agentId: string): Promise<AgentSimState | null>;
  list(): Promise<AgentSimState[]>;
  save(state: AgentSimState): Promise<void>;
}

export interface ModelPriceRepository {
  get(model: string): Promise<ModelPrice | null>;
  list(): Promise<ModelPrice[]>;
}

export interface SimulationRow {
  clockAt: string;
  seed: number;
  journalFloorSeq: number;
  seededAt: string;
}

/** The single `simulation_state` row. The clock itself is advanced through `SimClock`. */
export interface SimulationStateRepository {
  get(): Promise<SimulationRow>;
}
