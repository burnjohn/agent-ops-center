import {
  entryCostUsd,
  sumTokens,
  tokenActivityOf,
  type AgentStage,
  type LogEntry,
  type LogEntryType,
  type SessionDetail,
  type TokenActivity,
  type TokenUsage,
} from '@agent-ops/shared';
import type { LogEntryRow, SnapshotReader } from '../ports/read-queries.js';
import { priceMap, priceOf, toSummary } from './list-sessions.js';

const TOP_STEPS = 5;

function stepLabel(e: LogEntry): string {
  if (e.tool) return `${e.tool.name} ${e.tool.arg}`;
  if (e.type === 'agent') return e.text ?? '';
  if (e.type === 'system' && (e.text ?? '').startsWith('Session started')) {
    return 'Session context loaded';
  }
  return e.text ?? e.type;
}

/** API-AC-30/31/32/33/34: full session detail; `null` data = unknown session id (route maps to 404). */
export function getSession(snapshots: SnapshotReader, id: string) {
  return snapshots.read(async (q): Promise<SessionDetail | null> => {
    const [raw, prices] = await Promise.all([q.sessionDetail(id), q.modelPrices()]);
    if (!raw) return null;
    const price = priceOf(priceMap(prices), raw.row.session.model);

    const entries: LogEntry[] = raw.entries.map((e: LogEntryRow) => ({
      index: e.index,
      at: e.at,
      type: e.type as LogEntryType,
      text: e.text,
      stage: e.stage as AgentStage | null,
      tool: e.tool,
      tokens: e.tokens,
      costUsd: e.tokens ? entryCostUsd(e.tokens, price) : null,
      activity:
        e.activity ??
        (e.tokens
          ? tokenActivityOf({
              type: e.type as LogEntryType,
              tool: e.tool?.name ?? null,
              text: e.text,
            })
          : null),
    }));

    // Totals are the sum of the entries (API-AC-32/33), not a separate figure.
    const tokens = sumTokens(entries.flatMap((e) => (e.tokens ? [e.tokens] : [])));
    const costUsd = entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);

    const costByType = {
      input: entryCostUsd({ input: tokens.input, output: 0, cacheRead: 0, cacheWrite: 0 }, price),
      output: entryCostUsd({ input: 0, output: tokens.output, cacheRead: 0, cacheWrite: 0 }, price),
      cacheRead: entryCostUsd(
        { input: 0, output: 0, cacheRead: tokens.cacheRead, cacheWrite: 0 },
        price,
      ),
      cacheWrite: entryCostUsd(
        { input: 0, output: 0, cacheRead: 0, cacheWrite: tokens.cacheWrite },
        price,
      ),
    };

    const byActivity = new Map<
      TokenActivity,
      { steps: number; items: TokenUsage[]; cost: number }
    >();
    for (const e of entries) {
      if (!e.tokens || !e.activity) continue;
      const g = byActivity.get(e.activity) ?? { steps: 0, items: [], cost: 0 };
      g.steps += 1;
      g.items.push(e.tokens);
      g.cost += e.costUsd ?? 0;
      byActivity.set(e.activity, g);
    }
    const tokenActivity = [...byActivity]
      .map(([activity, g]) => ({
        activity,
        steps: g.steps,
        tokens: sumTokens(g.items),
        costUsd: g.cost,
        share: costUsd > 0 ? g.cost / costUsd : 0,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    const topSteps = entries
      .filter((e) => (e.costUsd ?? 0) > 0)
      .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || a.index - b.index)
      .slice(0, TOP_STEPS)
      .map((e) => ({ index: e.index, at: e.at, label: stepLabel(e), costUsd: e.costUsd ?? 0 }));

    const marks = entries.flatMap((e) =>
      e.type === 'stage' && e.stage ? [{ stage: e.stage, at: e.at }] : [],
    );
    const session = raw.row.session;
    const stages = marks.map((m, i) => ({
      stage: m.stage,
      from: m.at,
      to: marks[i + 1]?.at ?? session.endedAt,
    }));

    return {
      ...toSummary({ session, tokens }, priceMap(prices), entries.length, costUsd),
      dataSource: 'mock',
      entries,
      costByType,
      tokenActivity,
      topSteps,
      stages,
    };
  });
}
