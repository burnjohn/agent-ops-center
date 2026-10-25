import { entryCostUsd, sumTokens, type ModelPrice, type TokenUsage } from '@agent-ops/shared';
import { utcDay, type SessionState } from '../../domain/index.js';
import type {
  AgentPageRaw,
  AgentRow,
  ModelTokens,
  OverviewRaw,
  ReadQueries,
  SessionDetailRaw,
  SessionListQuery,
  SessionListRaw,
  SessionRow,
  SnapshotReader,
  UsageQuery,
  UsageRaw,
  UsageTokens,
} from '../ports/read-queries.js';
import { InMemoryEventJournal } from './in-memory-journal.js';
import type { InMemoryStore } from './in-memory-store.js';

const DAY_MS = 86_400_000;

export class InMemoryReadQueries implements ReadQueries {
  readonly journal: InMemoryEventJournal;

  constructor(private readonly store: InMemoryStore) {
    this.journal = new InMemoryEventJournal(store);
  }

  private get d() {
    return this.store.data;
  }

  private sessionTokens(s: SessionState): TokenUsage {
    return sumTokens((this.d.entries.get(s.id) ?? []).flatMap((e) => (e.tokens ? [e.tokens] : [])));
  }

  private row(s: SessionState): SessionRow {
    return { session: s, tokens: this.sessionTokens(s) };
  }

  private byModel(sessions: SessionState[]): ModelTokens[] {
    const groups = new Map<string, TokenUsage[]>();
    for (const s of sessions) {
      const list = groups.get(s.model) ?? [];
      list.push(this.sessionTokens(s));
      groups.set(s.model, list);
    }
    return [...groups].map(([model, items]) => ({ model, tokens: sumTokens(items) }));
  }

  private inPeriod(s: SessionState, q: UsageQuery): boolean {
    const day = utcDay(s.startedAt);
    return day >= q.fromDay && day <= q.toDay;
  }

  private cost(r: SessionRow): number {
    const price = this.d.prices.get(r.session.model);
    return price ? entryCostUsd(r.tokens, price) : 0;
  }

  private simOf(id: string): AgentRow['sim'] {
    const s = this.d.simState.get(id);
    return s ? { silent: s.silent, script: s.script } : null;
  }

  async nextTicketNumber() {
    return this.d.counters.ticket;
  }

  async simulation() {
    return { ...this.d.simulation };
  }

  async listTickets() {
    return [...this.d.tickets.values()];
  }

  async getTicket(id: string) {
    return this.d.tickets.get(id) ?? null;
  }

  async ticketSessions(ticketId: string): Promise<SessionRow[]> {
    return [...this.d.sessions.values()]
      .filter((s) => s.ticketId === ticketId)
      .map((s) => this.row(s));
  }

  async getAgent(id: string): Promise<AgentRow | null> {
    const agent = this.d.agents.get(id);
    if (!agent) return null;
    const today = utcDay(this.d.simulation.clockAt);
    const todays = [...this.d.sessions.values()].filter(
      (s) => s.agentId === id && utcDay(s.startedAt) === today,
    );
    return {
      agent,
      todayTokens: this.byModel(todays),
      pendingRefusalTicketId: this.d.simState.get(id)?.pendingRefusalTicketId ?? null,
      sim: this.simOf(id),
    };
  }

  async listAgents(): Promise<AgentRow[]> {
    const rows = await Promise.all([...this.d.agents.keys()].map((id) => this.getAgent(id)));
    return rows.flatMap((r) => (r ? [r] : []));
  }

  async agentPage(agentId: string): Promise<AgentPageRaw | null> {
    const row = await this.getAgent(agentId);
    if (!row) return null;
    const now = Date.parse(this.d.simulation.clockAt);
    const mine = [...this.d.sessions.values()]
      .filter((s) => s.agentId === agentId)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    const week = mine.filter((s) => now - Date.parse(s.startedAt) <= 7 * DAY_MS);
    const today = utcDay(this.d.simulation.clockAt);
    const toolCallsToday = mine
      .filter((s) => utcDay(s.startedAt) === today)
      .flatMap((s) => this.d.entries.get(s.id) ?? [])
      .filter((e) => e.type === 'tool').length;
    const tickets = [...this.d.tickets.values()].filter(
      (t) =>
        t.assigneeId === agentId ||
        this.store.events.some((e) => e.agentId === agentId && e.ticketId === t.id),
    );
    return {
      row,
      sessions7d: week.map((s) => this.row(s)),
      doneTicketCount: [...this.d.tickets.values()].filter(
        (t) => t.assigneeId === agentId && t.status === 'done',
      ).length,
      toolCallsToday,
      tokens7d: this.byModel(week),
      recentSessions: mine.slice(0, 10).map((s) => this.row(s)),
      sessionTotal: mine.length,
      tickets,
    };
  }

  async overview(): Promise<OverviewRaw> {
    const tickets = [...this.d.tickets.values()];
    return {
      agents: [...this.d.agents.values()],
      blockedCount: tickets.filter((t) => t.blockedQuestion !== null).length,
      reviewCount: tickets.filter((t) => t.status === 'review').length,
    };
  }

  async listSessions(q: SessionListQuery): Promise<SessionListRaw> {
    const rows = [...this.d.sessions.values()]
      .filter(
        (s) =>
          this.inPeriod(s, q) &&
          (q.agentId === undefined || s.agentId === q.agentId) &&
          (q.model === undefined || s.model === q.model),
      )
      .map((s) => this.row(s));
    const key = (r: SessionRow): number =>
      q.sort === 'startedAt'
        ? Date.parse(r.session.startedAt)
        : q.sort === 'cost'
          ? this.cost(r)
          : r.tokens[q.sort];
    const dir = q.order === 'asc' ? 1 : -1;
    rows.sort((a, b) => (key(a) - key(b)) * dir || a.session.number - b.session.number);
    return { rows: rows.slice(q.offset, q.offset + q.limit), total: rows.length };
  }

  async sessionDetail(id: string): Promise<SessionDetailRaw | null> {
    const s = this.d.sessions.get(id);
    if (!s) return null;
    const entries = [...(this.d.entries.get(id) ?? [])].sort((a, b) => a.index - b.index);
    return { row: this.row(s), entries };
  }

  async usage(q: UsageQuery): Promise<UsageRaw> {
    const sessions = [...this.d.sessions.values()].filter((s) => this.inPeriod(s, q));
    const sums = (list: SessionState[]): UsageTokens[] => {
      const groups = new Map<
        string,
        { model: string; activity: UsageTokens['activity']; items: TokenUsage[] }
      >();
      for (const s of list) {
        for (const e of this.d.entries.get(s.id) ?? []) {
          if (!e.tokens) continue;
          const k = `${s.model}|${e.activity ?? ''}`;
          const g = groups.get(k) ?? { model: s.model, activity: e.activity, items: [] };
          g.items.push(e.tokens);
          groups.set(k, g);
        }
      }
      return [...groups.values()].map((g) => ({
        model: g.model,
        activity: g.activity,
        tokens: sumTokens(g.items),
      }));
    };
    const group = <K>(key: (s: SessionState) => K): [K, SessionState[]][] => {
      const m = new Map<K, SessionState[]>();
      for (const s of sessions) m.set(key(s), [...(m.get(key(s)) ?? []), s]);
      return [...m];
    };
    const days = [...new Set(sessions.map((s) => utcDay(s.startedAt)))].sort();
    return {
      byAgent: group((s) => s.agentId).map(([agentId, l]) => ({ agentId, sums: sums(l) })),
      byTicket: group((s) => s.ticketId).map(([ticketId, l]) => ({ ticketId, sums: sums(l) })),
      perDay: days.map((day) => ({
        day,
        sums: this.byModel(sessions.filter((s) => utcDay(s.startedAt) === day)),
      })),
      perSession: sessions.map((s) => this.row(s)),
    };
  }

  async modelPrices(): Promise<ModelPrice[]> {
    return [...this.d.prices.values()];
  }
}

/** Snapshot reader over the in-memory store: the callback sees the store as it was when `read` began. */
export class InMemorySnapshotReader implements SnapshotReader {
  constructor(private readonly store: InMemoryStore) {}

  async read<T>(fn: (q: ReadQueries) => Promise<T>): Promise<{ data: T; asOfSeq: number }> {
    const asOfSeq = this.store.events.at(-1)?.seq ?? 0;
    return { data: await fn(new InMemoryReadQueries(this.store)), asOfSeq };
  }
}
