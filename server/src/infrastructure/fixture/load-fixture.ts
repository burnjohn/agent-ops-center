import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { count, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { EVENTS_LOCK_KEY } from '../db/locks.js';
import {
  agentSimState,
  agents,
  events,
  idCounters,
  modelPrices,
  sessionLogEntries,
  sessions,
  simulationState,
  tickets,
} from '../db/schema.js';
import { parseFixtureData, type FixtureData } from './fixture-data.js';

/** Transaction handle of `Db`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const CHUNK = 500;

const DEFAULT_FIXTURE_URL = new URL('../../../fixture/fixture.json', import.meta.url);

/** Reads and validates the committed seed fixture (`server/fixture/fixture.json`) or the file at `path`. */
export function readFixture(path?: string): FixtureData {
  const file = path ?? fileURLToPath(DEFAULT_FIXTURE_URL);
  return parseFixtureData(JSON.parse(readFileSync(file, 'utf8')) as unknown);
}

const d = (iso: string): Date => new Date(iso);
const dn = (iso: string | null): Date | null => (iso === null ? null : new Date(iso));

async function insertChunked<T>(
  rows: readonly T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

/** Takes the events advisory lock for the rest of the transaction (same lock as every command, ADR-0009). */
export async function lockEvents(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${EVENTS_LOCK_KEY})`);
}

/**
 * Inserts the whole fixture inside the caller's transaction (tables must be empty). Returns the first `seq`
 * of the inserted events, which is the new journal floor.
 */
export async function insertFixture(
  tx: Tx,
  fx: FixtureData,
  now: Date = new Date(),
): Promise<number> {
  if (fx.events.length === 0)
    throw new Error('Fixture has no events; cannot derive the journal floor');

  await insertChunked(fx.modelPrices, (c) => tx.insert(modelPrices).values(c));

  // agents <-> tickets/sessions reference each other (non-deferrable FKs): agents first with their "current"
  // pointers cleared, then tickets and sessions, then the pointers are set.
  await insertChunked(fx.agents, (c) =>
    tx.insert(agents).values(
      c.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        model: a.model,
        stage: a.stage,
        currentTicketId: null,
        currentSessionId: null,
        currentToolName: a.currentToolName,
        currentToolArg: a.currentToolArg,
        currentToolStartedAt: dn(a.currentToolStartedAt),
        lastToolName: a.lastToolName,
        lastToolArg: a.lastToolArg,
        lastToolOk: a.lastToolOk,
        lastToolAt: dn(a.lastToolAt),
        lastSeenAt: d(a.lastSeenAt),
        createdAt: d(a.createdAt),
      })),
    ),
  );

  await insertChunked(fx.tickets, (c) =>
    tx.insert(tickets).values(
      c.map((t) => ({
        id: t.id,
        number: t.number,
        title: t.title,
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
        priority: t.priority,
        status: t.status,
        assigneeId: t.assigneeId,
        blockedQuestion: t.blockedQuestion,
        answer: t.answer,
        reviewSummary: t.reviewSummary,
        resultLink: t.resultLink,
        reviewComment: t.reviewComment,
        lastUpdateText: t.lastUpdateText,
        lastUpdateAt: dn(t.lastUpdateAt),
        createdAt: d(t.createdAt),
        updatedAt: d(t.updatedAt),
      })),
    ),
  );

  await insertChunked(fx.sessions, (c) =>
    tx.insert(sessions).values(
      c.map((s) => ({
        id: s.id,
        number: s.number,
        agentId: s.agentId,
        ticketId: s.ticketId,
        model: s.model,
        status: s.status,
        startedAt: d(s.startedAt),
        endedAt: dn(s.endedAt),
      })),
    ),
  );

  const entries = fx.sessions.flatMap((s) =>
    s.entries.map((e) => ({
      sessionId: s.id,
      ordinal: e.ordinal,
      at: d(e.at),
      kind: e.kind,
      text: e.text,
      stage: e.stage,
      toolName: e.toolName,
      toolArg: e.toolArg,
      toolOk: e.toolOk,
      toolResult: e.toolResult,
      toolDurationSec: e.toolDurationSec,
      toolOutput: e.toolOutput,
      inputTokens: e.tokens?.input ?? null,
      outputTokens: e.tokens?.output ?? null,
      cacheReadTokens: e.tokens?.cacheRead ?? null,
      cacheWriteTokens: e.tokens?.cacheWrite ?? null,
      tokenActivity: e.tokenActivity,
    })),
  );
  await insertChunked(entries, (c) => tx.insert(sessionLogEntries).values(c));

  for (const a of fx.agents) {
    if (a.currentTicketId === null && a.currentSessionId === null) continue;
    await tx
      .update(agents)
      .set({ currentTicketId: a.currentTicketId, currentSessionId: a.currentSessionId })
      .where(eq(agents.id, a.id));
  }

  await insertChunked(fx.agentSimStates, (c) => tx.insert(agentSimState).values(c));

  // Events in prototype order; one chunk at a time so the identity `seq` follows array order.
  let floor: number | null = null;
  for (let i = 0; i < fx.events.length; i += CHUNK) {
    const rows = await tx
      .insert(events)
      .values(
        fx.events.slice(i, i + CHUNK).map((e) => ({
          at: d(e.at),
          source: e.source,
          category: e.category,
          type: e.type,
          agentId: e.agentId,
          ticketId: e.ticketId,
          sessionId: e.sessionId,
          payload: e.payload,
          warn: e.warn,
        })),
      )
      .returning({ seq: events.seq });
    for (const r of rows) floor = floor === null ? r.seq : Math.min(floor, r.seq);
  }
  if (floor === null) throw new Error('Fixture events were not inserted');

  await tx.insert(idCounters).values([
    { name: 'ticket', nextValue: fx.nextTicketNumber },
    { name: 'session', nextValue: fx.nextSessionNumber },
  ]);
  await tx.insert(simulationState).values({
    id: 1,
    clockAt: d(fx.clockAt),
    seed: fx.seed,
    journalFloorSeq: floor,
    seededAt: now,
  });
  return floor;
}

/**
 * Loads the fixture when `agents` is empty (one transaction under the events lock; the emptiness check runs
 * after the lock so two starting processes cannot both load). Returns whether it loaded.
 */
export async function loadFixtureIfEmpty(
  db: Db,
  fixture: FixtureData = readFixture(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockEvents(tx);
    const [row] = await tx.select({ n: count() }).from(agents);
    if ((row?.n ?? 0) > 0) return false;
    await insertFixture(tx, fixture);
    return true;
  });
}
