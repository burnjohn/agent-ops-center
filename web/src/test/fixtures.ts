import {
  Agent,
  AgentListResponse,
  Event,
  ModelPrice,
  OverviewResponse,
  SessionDetail,
  SessionSummary,
  SimulationState,
  Ticket,
  TicketListResponse,
  type TokenUsage,
} from '@agent-ops/shared';
import raw from '../../../server/fixture/fixture.json';

/**
 * Contract-valid builders over the seed (`server/fixture/fixture.json`: T-1…T-16, six agents,
 * S-0409/S-0412, 44 events). Every builder output is parsed with the shared schema, so a fixture can
 * never drift from the contract. Builders return fresh deep copies; mutate freely.
 */

const clone = <T>(v: T): T => structuredClone(v);

interface RawTicket {
  lastUpdateText: string | null;
  lastUpdateAt: string | null;
  [k: string]: unknown;
}

const ZERO_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const SEED_CLOCK = raw.clockAt;
/** Highest seq of the seed journal (events are numbered 1…44 in fixture order). */
export const SEED_LAST_SEQ = raw.events.length;

export function buildTicket(overrides: Partial<Ticket> = {}): Ticket {
  const seed = raw.tickets[0] as unknown as RawTicket;
  const { lastUpdateText, lastUpdateAt, ...rest } = clone(seed);
  return Ticket.parse({
    ...rest,
    lastUpdate: lastUpdateText && lastUpdateAt ? { text: lastUpdateText, at: lastUpdateAt } : null,
    ...overrides,
  });
}

export function seedTickets(): Ticket[] {
  return TicketListResponse.parse(
    (raw.tickets as unknown as RawTicket[]).map(({ lastUpdateText, lastUpdateAt, ...rest }) => ({
      ...clone(rest),
      lastUpdate:
        lastUpdateText && lastUpdateAt ? { text: lastUpdateText, at: lastUpdateAt } : null,
    })),
  );
}

export function seedAgents(): Agent[] {
  return AgentListResponse.parse(
    raw.agents.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      model: a.model,
      stage: a.stage,
      health: 'online',
      lastSeenAt: a.lastSeenAt,
      currentTicketId: a.currentTicketId,
      currentSessionId: a.currentSessionId,
      lastSessionId: null,
      currentTool: a.currentToolName
        ? {
            name: a.currentToolName,
            arg: a.currentToolArg ?? '',
            startedAt: a.currentToolStartedAt,
          }
        : null,
      lastTool: a.lastToolName
        ? {
            name: a.lastToolName,
            arg: a.lastToolArg ?? '',
            ok: a.lastToolOk ?? true,
            at: a.lastToolAt,
          }
        : null,
      pausedAfterRelease: false,
      costTodayUsd: 0,
      step: { available: false, reason: null },
    })),
  );
}

/** The 44 seed events with journal numbers 1…44, oldest first. */
export function seedEvents(): Event[] {
  return raw.events.map((e, i) => Event.parse({ ...clone(e), seq: i + 1, realAt: e.at }));
}

/** One event of any type; pass the full payload (it is validated against the shared payload schema). */
export function buildEvent(
  seq: number,
  type: Event['type'],
  payload: Record<string, unknown>,
  extra: Partial<
    Pick<Event, 'at' | 'source' | 'category' | 'agentId' | 'ticketId' | 'sessionId' | 'warn'>
  > = {},
): Event {
  const category =
    type.split('.')[0] === 'ticket' ? 'ticket' : type.split('.')[0] === 'tool' ? 'tool' : 'agent';
  return Event.parse({
    seq,
    at: SEED_CLOCK,
    realAt: SEED_CLOCK,
    source: 'operator',
    category,
    type,
    agentId: null,
    ticketId: null,
    sessionId: null,
    warn: false,
    ...extra,
    payload,
  });
}

/** `ticket.created` for a ticket — the simplest event that visibly changes the Board. */
export function ticketCreatedEvent(seq: number, ticket: Ticket): Event {
  return buildEvent(
    seq,
    'ticket.created',
    { summary: `Created ${ticket.id}`, ticket },
    { ticketId: ticket.id },
  );
}

export function buildSimulation(overrides: Partial<SimulationState> = {}): SimulationState {
  return SimulationState.parse({
    clock: SEED_CLOCK,
    playing: false,
    held: false,
    lastSeq: SEED_LAST_SEQ,
    journalFloorSeq: 0,
    stepSeconds: 6,
    playIntervalMs: 1600,
    nextTicketId: `T-${raw.nextTicketNumber}`,
    healthThresholds: { staleAfterSec: 30, offlineAfterSec: 120, toolGraceSec: 600 },
    ...overrides,
  });
}

export function buildOverview(overrides: Partial<OverviewResponse> = {}): OverviewResponse {
  const agents = seedAgents();
  const tickets = seedTickets();
  return OverviewResponse.parse({
    agentsOnline: agents.length,
    agentsTotal: agents.length,
    blockedTickets: tickets.filter((t) => t.blockedQuestion !== null && t.status === 'in_progress')
      .length,
    reviewTickets: tickets.filter((t) => t.status === 'review').length,
    eventsPerMinute: Array.from({ length: 12 }, () => 0),
    clock: SEED_CLOCK,
    ...overrides,
  });
}

type RawSession = (typeof raw.sessions)[number];

function sessionById(id: string): RawSession {
  const s = raw.sessions.find((x) => x.id === id);
  if (!s) throw new Error(`fixture has no session ${id}`);
  return s;
}

function sumTokens(parts: (TokenUsage | null)[]): TokenUsage {
  return parts.reduce<TokenUsage>(
    (acc, t) =>
      t
        ? {
            input: acc.input + t.input,
            output: acc.output + t.output,
            cacheRead: acc.cacheRead + t.cacheRead,
            cacheWrite: acc.cacheWrite + t.cacheWrite,
          }
        : acc,
    { ...ZERO_TOKENS },
  );
}

export function seedSessionSummary(id: string): SessionSummary {
  const s = sessionById(id);
  const tokens = sumTokens(s.entries.map((e) => (e.tokens as TokenUsage | null) ?? null));
  return SessionSummary.parse({
    id: s.id,
    agentId: s.agentId,
    ticketId: s.ticketId,
    model: s.model,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    status: s.status,
    tokens,
    costUsd: 0,
    costIsFinal: s.status !== 'running',
    entryCount: s.entries.length,
  });
}

export function seedSessionSummaries(): SessionSummary[] {
  return raw.sessions.map((s) => seedSessionSummary(s.id));
}

/** Session detail (S-0409 completed, S-0412 running, or any seed session) with zero-cost aggregates. */
export function seedSessionDetail(id: string): SessionDetail {
  const s = sessionById(id);
  return SessionDetail.parse({
    ...seedSessionSummary(id),
    dataSource: 'mock',
    entries: s.entries.map((e) => ({
      index: e.ordinal,
      at: e.at,
      type: e.kind,
      text: e.text,
      stage: e.stage,
      tool: e.toolName
        ? {
            name: e.toolName,
            arg: e.toolArg ?? '',
            ok: e.toolOk ?? true,
            result: e.toolResult ?? '',
            durationSec: e.toolDurationSec ?? 0,
            output: e.toolOutput,
          }
        : null,
      tokens: e.tokens ?? null,
      costUsd: e.tokens ? 0 : null,
      activity: e.tokenActivity,
    })),
    costByType: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    tokenActivity: [],
    topSteps: [],
    stages: [],
  });
}

/** The seed price list (`modelPrices`), parsed. */
export function seedModelPrices(): ModelPrice[] {
  return raw.modelPrices.map((p) =>
    ModelPrice.parse({
      model: p.model,
      inputPerM: Number(p.inputPerM),
      outputPerM: Number(p.outputPerM),
      cacheReadPerM: Number(p.cacheReadPerM),
      cacheWritePerM: Number(p.cacheWritePerM),
    }),
  );
}
