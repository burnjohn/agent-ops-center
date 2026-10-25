import type { Event } from '@agent-ops/shared';
import type { EventPublisher } from '../../src/application/ports/publisher.js';
import type { ReadQueries } from '../../src/application/ports/read-queries.js';
import type { SimClock } from '../../src/application/ports/clock.js';
import type { EventDraft } from '../../src/domain/index.js';
import type { DbHandle } from '../../src/infrastructure/db/client.js';
import { PgSnapshotReader, type ReadQueriesFactory } from '../../src/infrastructure/db/snapshot.js';
import { PgUnitOfWork, type RepoFactory } from '../../src/infrastructure/db/unit-of-work.js';
import { createAgentRepository } from '../../src/infrastructure/repositories/agents.repository.js';
import { createModelPriceRepository } from '../../src/infrastructure/repositories/model-prices.repository.js';
import { createSessionRepository } from '../../src/infrastructure/repositories/sessions.repository.js';
import { createSimStateRepository } from '../../src/infrastructure/repositories/sim-state.repository.js';
import { createSimulationStateRepository } from '../../src/infrastructure/repositories/simulation-state.repository.js';
import { createTicketRepository } from '../../src/infrastructure/repositories/tickets.repository.js';
import { agentPage } from '../../src/infrastructure/queries/agent-page.js';
import { getAgent, listAgents } from '../../src/infrastructure/queries/agents.js';
import { listModelPrices } from '../../src/infrastructure/queries/model-prices.js';
import {
  overview,
  readNextTicketNumber,
  readSimulation,
} from '../../src/infrastructure/queries/overview.js';
import { getSessionDetail } from '../../src/infrastructure/queries/session-detail.js';
import { listSessions } from '../../src/infrastructure/queries/sessions.js';
import { getTicket, listTickets } from '../../src/infrastructure/queries/tickets.js';
import { ticketSessions } from '../../src/infrastructure/queries/ticket-detail.js';
import { getUsage } from '../../src/infrastructure/queries/usage.js';

/** Stands in for the container (T32): wires repositories and read queries to a transaction. */
export const FIXED_NOW = '2026-01-01T00:00:00.000Z';

const fixedClock: SimClock = { now: () => FIXED_NOW, advance: () => undefined };

export const repoFactory: RepoFactory = (tx) => ({
  tickets: createTicketRepository(tx),
  agents: createAgentRepository(tx),
  sessions: createSessionRepository(tx),
  simState: createSimStateRepository(tx),
  modelPrices: createModelPriceRepository(tx),
  simulation: createSimulationStateRepository(tx),
  clock: fixedClock,
});

export const queriesFactory: ReadQueriesFactory = (tx): Omit<ReadQueries, 'journal'> => ({
  simulation: () => readSimulation(tx),
  listTickets: () => listTickets(tx),
  getTicket: (id) => getTicket(tx, id),
  ticketSessions: (id) => ticketSessions(tx, id),
  listAgents: () => listAgents(tx),
  getAgent: (id) => getAgent(tx, id),
  agentPage: (id) => agentPage(tx, id),
  overview: () => overview(tx),
  nextTicketNumber: () => readNextTicketNumber(tx),
  listSessions: (q) => listSessions(tx, q),
  sessionDetail: async (id) => {
    const raw = await getSessionDetail(tx, id);
    return raw as Awaited<ReturnType<ReadQueries['sessionDetail']>>;
  },
  usage: (q) => getUsage(tx, q),
  modelPrices: () => listModelPrices(tx),
});

/** Test double for the publisher seam: records each published batch. */
export class RecordingPublisher implements EventPublisher {
  readonly batches: Event[][] = [];
  onPublish: (events: readonly Event[]) => void = () => undefined;
  publish(events: readonly Event[]): void {
    this.batches.push([...events]);
    this.onPublish(events);
  }
}

export function makeUow(handle: DbHandle, publisher: EventPublisher): PgUnitOfWork {
  return new PgUnitOfWork(handle, repoFactory, publisher);
}

export function makeSnapshotReader(handle: DbHandle): PgSnapshotReader {
  return new PgSnapshotReader(handle, queriesFactory);
}

/** A valid feed event draft (`ticket.moved`, operator). */
export function movedDraft(
  summary: string,
  refs: { ticketId?: string | null; agentId?: string | null } = {},
): EventDraft {
  return {
    type: 'ticket.moved',
    source: 'operator',
    category: 'ticket',
    at: FIXED_NOW,
    agentId: refs.agentId ?? null,
    ticketId: refs.ticketId ?? null,
    sessionId: null,
    warn: false,
    payload: { summary, from: 'backlog', to: 'ready' },
  };
}
