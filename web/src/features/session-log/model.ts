import type { LogEntry, SessionDetail, TokenActivity } from '@agent-ops/shared';

export type LogFilter = 'all' | 'messages' | 'tools' | 'errors' | 'stages';

export const FILTER_LABEL: Record<LogFilter, string> = {
  all: 'ALL',
  messages: 'MESSAGES',
  tools: 'TOOL CALLS',
  errors: '▲ ERRORS',
  stages: 'STAGES & SYSTEM',
};

export const FILTER_ORDER: readonly LogFilter[] = ['all', 'messages', 'tools', 'errors', 'stages'];

export const COLLAPSED_LINES = 4;

export const isFailedTool = (e: LogEntry): boolean =>
  e.type === 'tool' && e.tool !== null && !e.tool.ok;

export function matchesFilter(e: LogEntry, filter: LogFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'messages':
      return e.type === 'operator' || e.type === 'agent';
    case 'tools':
      return e.type === 'tool';
    case 'errors':
      return isFailedTool(e);
    case 'stages':
      return e.type === 'stage' || e.type === 'system';
  }
}

/** Case-insensitive match on text, tool name, argument and output (UI-AC-124). `needle` is pre-lowercased. */
export function matchesSearch(e: LogEntry, needle: string): boolean {
  if (needle === '') return true;
  const hay = [e.text, e.tool?.name, e.tool?.arg, e.tool?.output];
  return hay.some((s) => s != null && s.toLowerCase().includes(needle));
}

export function filterCounts(entries: readonly LogEntry[]): Record<LogFilter, number> {
  const counts: Record<LogFilter, number> = { all: 0, messages: 0, tools: 0, errors: 0, stages: 0 };
  for (const e of entries) {
    for (const f of FILTER_ORDER) if (matchesFilter(e, f)) counts[f] += 1;
  }
  return counts;
}

/** Clicking an activity row switches the log filter (UI-AC-123). */
export function filterForActivity(activity: TokenActivity): LogFilter {
  if (activity === 'reasoning_replies') return 'messages';
  if (activity === 'session_context') return 'stages';
  return 'tools';
}

export function outputLines(output: string): string[] {
  return output.replace(/\n$/, '').split('\n');
}

export const entryAnchor = (index: number): string => `log-entry-${index}`;

export const stepsWithTokens = (d: SessionDetail): number =>
  d.tokenActivity.reduce((n, r) => n + r.steps, 0);
