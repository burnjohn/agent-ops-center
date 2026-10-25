import type { FastifyInstance } from 'fastify';
import { createPlayControl, type PlayControl } from './application/simulation/play-control.js';
import { runToNextStage } from './application/simulation/run-to-next-stage.js';
import { createSimScripts } from './application/simulation/scripts.js';
import { stepAgent } from './application/simulation/step-agent.js';
import { stepAll } from './application/simulation/step-all.js';
import { answerTicket } from './application/commands/tickets/answer-ticket.js';
import { assignTicket } from './application/commands/tickets/assign-ticket.js';
import { createTicket } from './application/commands/tickets/create-ticket.js';
import { moveTicket } from './application/commands/tickets/move-ticket.js';
import { requestChanges } from './application/commands/tickets/request-changes.js';
import type { ReadQueries } from './application/ports/read-queries.js';
import { DbSimClock, withPrimedClock } from './infrastructure/clock/db-sim-clock.js';
import { createDb, type DbHandle } from './infrastructure/db/client.js';
import { PgSnapshotReader } from './infrastructure/db/snapshot.js';
import { PgUnitOfWork } from './infrastructure/db/unit-of-work.js';
import { resetToFixture } from './infrastructure/fixture/reset.js';
import { agentPage } from './infrastructure/queries/agent-page.js';
import { getAgent, listAgents } from './infrastructure/queries/agents.js';
import { listModelPrices } from './infrastructure/queries/model-prices.js';
import {
  overview,
  readNextTicketNumber,
  readSimulation,
} from './infrastructure/queries/overview.js';
import { getSessionDetail } from './infrastructure/queries/session-detail.js';
import { listSessions } from './infrastructure/queries/sessions.js';
import { ticketSessions } from './infrastructure/queries/ticket-detail.js';
import { getTicket, listTickets } from './infrastructure/queries/tickets.js';
import { getUsage } from './infrastructure/queries/usage.js';
import { createAgentRepository } from './infrastructure/repositories/agents.repository.js';
import { EventsRepository } from './infrastructure/repositories/events.repository.js';
import { createModelPriceRepository } from './infrastructure/repositories/model-prices.repository.js';
import { createSessionRepository } from './infrastructure/repositories/sessions.repository.js';
import { createSimStateRepository } from './infrastructure/repositories/sim-state.repository.js';
import { createSimulationStateRepository } from './infrastructure/repositories/simulation-state.repository.js';
import { createTicketRepository } from './infrastructure/repositories/tickets.repository.js';
import { createIntervalScheduler } from './infrastructure/scheduler/interval-scheduler.js';
import { SseFanOut } from './infrastructure/sse/fan-out.js';
import { buildApp } from './presentation/http/app.js';
import { agentRoutes } from './presentation/http/routes/agents.js';
import { eventRoutes } from './presentation/http/routes/events.js';
import { healthzRoutes } from './presentation/http/routes/healthz.js';
import { modelPriceRoutes } from './presentation/http/routes/model-prices.js';
import { overviewRoutes } from './presentation/http/routes/overview.js';
import { sessionRoutes } from './presentation/http/routes/sessions.js';
import { ticketRoutes } from './presentation/http/routes/tickets.js';
import { usageRoutes } from './presentation/http/routes/usage.js';
import { simulationRoutes } from './presentation/http/simulation/simulation-routes.js';
import { streamRoutes } from './presentation/http/stream.js';
import type { Config } from './infrastructure/config.js';

export interface Container {
  readonly app: FastifyInstance;
  readonly handle: DbHandle;
  readonly playControl: PlayControl;
  /** Stops timers and the HTTP server, then closes the pool. */
  close(): Promise<void>;
}

/** The only place that imports across all layers (ADR-0010) and instantiates adapters. */
export async function createContainer(
  config: Pick<Config, 'databaseUrl'> & Partial<Config>,
): Promise<Container> {
  const handle = createDb(config.databaseUrl);
  const fanOut = new SseFanOut();
  const scheduler = createIntervalScheduler();
  const scripts = createSimScripts();

  const uow = withPrimedClock(
    new PgUnitOfWork(
      handle,
      (tx) => {
        const clock = new DbSimClock(tx);
        return {
          tickets: createTicketRepository(tx),
          agents: createAgentRepository(tx),
          sessions: createSessionRepository(tx),
          simState: createSimStateRepository(tx),
          modelPrices: createModelPriceRepository(tx),
          simulation: createSimulationStateRepository(tx),
          clock,
          flush: () => clock.flush(),
        };
      },
      fanOut,
    ),
  );

  const snapshots = new PgSnapshotReader(handle, (tx): Omit<ReadQueries, 'journal'> => ({
    simulation: () => readSimulation(tx),
    nextTicketNumber: () => readNextTicketNumber(tx),
    listTickets: () => listTickets(tx),
    getTicket: (id) => getTicket(tx, id),
    ticketSessions: (id) => ticketSessions(tx, id),
    listAgents: () => listAgents(tx),
    getAgent: (id) => getAgent(tx, id),
    agentPage: (id) => agentPage(tx, id),
    overview: () => overview(tx),
    listSessions: (query) => listSessions(tx, query),
    sessionDetail: (id) => getSessionDetail(tx, id),
    usage: (query) => getUsage(tx, query),
    modelPrices: () => listModelPrices(tx),
  }));

  const stepDeps = { uow, scripts };
  const playControl = createPlayControl({
    ...stepDeps,
    scheduler,
    realNowMs: Date.now, // wall clock is allowed here only (hold expiry, API-AC-56)
    onTickError: (error) => console.error('play tick failed', error),
  });

  const commandDeps = { uow, scripts };
  const app = await buildApp({
    routes: [
      healthzRoutes(snapshots),
      ticketRoutes({
        snapshots,
        commands: {
          create: (body) => createTicket(commandDeps, body),
          move: (id, body) => moveTicket(commandDeps, id, body),
          assign: (id, body) => assignTicket(commandDeps, id, body),
          requestChanges: (id, body) => requestChanges(commandDeps, id, body),
          answer: (id, body) => answerTicket(commandDeps, id, body),
        },
      }),
      agentRoutes(snapshots),
      overviewRoutes(snapshots),
      eventRoutes(snapshots),
      sessionRoutes(snapshots),
      usageRoutes(snapshots),
      modelPriceRoutes(snapshots),
      simulationRoutes({
        snapshots,
        playControl,
        stepAgent: (input) => stepAgent(stepDeps, input),
        runToNextStage: (input) => runToNextStage(stepDeps, input),
        stepAll: (mode) => stepAll({ ...stepDeps, isPlaying: playControl.isPlaying }, mode),
      }),
      streamRoutes({
        journal: new EventsRepository(handle.db),
        subscriber: fanOut,
        scheduler,
        hello: async () => {
          const { data } = await snapshots.read((q) => q.simulation());
          return { clock: data.clockAt, playing: playControl.isPlaying() };
        },
      }),
    ],
  });

  return {
    app,
    handle,
    playControl,
    close: async () => {
      playControl.dispose();
      app.server.closeAllConnections(); // open SSE streams would block close()
      await app.close().catch(() => undefined);
      await handle.close().catch(() => undefined);
    },
  };
}

/** The reset command (CLI): refuses while a server holds the lock; returns the new journal floor. */
export function createResetCommand(config: Pick<Config, 'databaseUrl'>): {
  run(): Promise<number>;
  close(): Promise<void>;
} {
  const handle = createDb(config.databaseUrl);
  return {
    run: () => handle.guard((db) => resetToFixture(db, config.databaseUrl)),
    close: () => handle.close(),
  };
}
