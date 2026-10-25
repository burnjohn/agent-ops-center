import type {
  EventCategory,
  EventSource,
  ModelPrice,
  TokenActivity,
  TokenUsage,
} from '@agent-ops/shared';
import type { AgentState, SessionState, TicketState } from '../../domain/index.js';
import type { EventJournal } from './event-journal.js';
import type { AgentSimState, SimulationRow } from './repositories.js';

/** Raw read rows: token sums carry the model, so cost is computed once in the application. */

export interface ModelTokens {
  model: string;
  tokens: TokenUsage;
}

export interface SessionRow {
  session: SessionState;
  tokens: TokenUsage;
}

export interface AgentRow {
  agent: AgentState;
  /** Token sums of today's sessions (UTC day of the simulation clock) per model. */
  todayTokens: ModelTokens[];
  pendingRefusalTicketId: string | null;
  /** Script facts behind step availability (API-AC-45); null when the agent has no sim-state row. */
  sim: Pick<AgentSimState, 'silent' | 'script'> | null;
}

export interface AgentPageRaw {
  row: AgentRow;
  /** Sessions started in the last 7 days. */
  sessions7d: SessionRow[];
  doneTicketCount: number;
  toolCallsToday: number;
  tokens7d: ModelTokens[];
  /** Ten newest sessions plus the total count. */
  recentSessions: SessionRow[];
  sessionTotal: number;
  /** Tickets with events for, or assigned to, the agent. */
  tickets: TicketState[];
}

export interface OverviewRaw {
  agents: AgentState[];
  blockedCount: number;
  reviewCount: number;
}

export type SessionSort = 'startedAt' | 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'cost';

export interface SessionListQuery {
  /** Inclusive UTC days `YYYY-MM-DD` of `started_at`. */
  fromDay: string;
  toDay: string;
  agentId?: string | undefined;
  model?: string | undefined;
  sort: SessionSort;
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export interface SessionListRaw {
  rows: SessionRow[];
  total: number;
}

export interface LogEntryRow {
  index: number;
  at: string;
  type: string;
  text: string | null;
  stage: string | null;
  tool: {
    name: string;
    arg: string;
    ok: boolean;
    result: string;
    durationSec: number;
    output: string | null;
  } | null;
  tokens: TokenUsage | null;
  activity: TokenActivity | null;
}

export interface SessionDetailRaw {
  row: SessionRow;
  entries: LogEntryRow[];
  /** Stage spans derived from `stage` entries are computed by the application. */
}

export interface UsageTokens extends ModelTokens {
  activity: TokenActivity | null;
}

export interface UsageRaw {
  byAgent: { agentId: string; sums: UsageTokens[] }[];
  /** `ticketId` null = sessions without a ticket. */
  byTicket: { ticketId: string | null; sums: UsageTokens[] }[];
  /** Per UTC day (30 days), oldest first. */
  perDay: { day: string; sums: ModelTokens[] }[];
  /** One entry per session in the period, for mean/median. */
  perSession: SessionRow[];
}

export interface UsageQuery {
  fromDay: string;
  toDay: string;
}

export interface FeedFilter {
  beforeSeq?: number | undefined;
  source?: EventSource | undefined;
  category?: EventCategory | undefined;
  agentId?: string | undefined;
  ticketId?: string | undefined;
  limit: number;
}

/** All raw reads, evaluated against one consistent snapshot. */
export interface ReadQueries {
  simulation(): Promise<SimulationRow>;
  /** The stored `id_counters` ticket counter: the number the next created ticket receives. */
  nextTicketNumber(): Promise<number>;
  listTickets(): Promise<TicketState[]>;
  getTicket(id: string): Promise<TicketState | null>;
  ticketSessions(ticketId: string): Promise<SessionRow[]>;
  listAgents(): Promise<AgentRow[]>;
  getAgent(id: string): Promise<AgentRow | null>;
  agentPage(agentId: string): Promise<AgentPageRaw | null>;
  overview(): Promise<OverviewRaw>;
  listSessions(query: SessionListQuery): Promise<SessionListRaw>;
  sessionDetail(id: string): Promise<SessionDetailRaw | null>;
  usage(query: UsageQuery): Promise<UsageRaw>;
  modelPrices(): Promise<ModelPrice[]>;
  readonly journal: EventJournal;
}

/** Runs `fn` in one REPEATABLE READ read-only snapshot; `asOfSeq` is the highest `seq` the snapshot includes. */
export interface SnapshotReader {
  read<T>(fn: (q: ReadQueries) => Promise<T>): Promise<{ data: T; asOfSeq: number }>;
}
