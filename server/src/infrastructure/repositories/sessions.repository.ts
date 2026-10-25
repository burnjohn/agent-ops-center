import { and, asc, eq, sql } from 'drizzle-orm';
import type { SessionRepository, StoredLogEntry } from '../../application/ports/repositories.js';
import type { SessionState } from '../../domain/index.js';
import type { Db } from '../db/client.js';
import { sessionLogEntries, sessions } from '../db/schema.js';
import type { Tx } from '../fixture/load-fixture.js';
import {
  entryToDomain,
  entryToRow,
  sessionToDomain,
  sessionToPatch,
  sessionToRow,
} from './mappers.js';

/** Sessions and their log entries. Insert/update/append only; no delete path (DB-AC-41). */
export class SessionsRepository implements SessionRepository {
  constructor(private readonly q: Db | Tx) {}

  private select() {
    return this.q
      .select({
        session: sessions,
        entryCount: sql<number>`(select count(*)::int from ${sessionLogEntries} e where e.session_id = "sessions"."id")`,
      })
      .from(sessions);
  }

  async get(id: string): Promise<SessionState | null> {
    const [r] = await this.select().where(eq(sessions.id, id)).limit(1);
    return r === undefined ? null : sessionToDomain(r.session, r.entryCount);
  }

  async insert(session: SessionState): Promise<void> {
    await this.q.insert(sessions).values(sessionToRow(session));
  }

  async update(session: SessionState): Promise<void> {
    await this.q.update(sessions).set(sessionToPatch(session)).where(eq(sessions.id, session.id));
  }

  /** The ordinal comes from the entry (`index`, assigned by the domain); the unique (session, ordinal) index guards it. */
  async appendEntry(sessionId: string, entry: StoredLogEntry): Promise<void> {
    await this.q.insert(sessionLogEntries).values(entryToRow(sessionId, entry));
  }

  async entries(sessionId: string): Promise<StoredLogEntry[]> {
    const rows = await this.q
      .select()
      .from(sessionLogEntries)
      .where(eq(sessionLogEntries.sessionId, sessionId))
      .orderBy(asc(sessionLogEntries.ordinal));
    return rows.map(entryToDomain);
  }

  async runningFor(agentId: string): Promise<SessionState | null> {
    const [r] = await this.select()
      .where(and(eq(sessions.agentId, agentId), eq(sessions.status, 'running')))
      .limit(1);
    return r === undefined ? null : sessionToDomain(r.session, r.entryCount);
  }
}

export const createSessionRepository = (q: Db | Tx): SessionRepository => new SessionsRepository(q);
