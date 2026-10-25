import type { EventsQuery, SessionsQuery, UsageQuery } from '@agent-ops/shared';

/** Query keys per resource and params. Prefix keys let events invalidate whole families. */
export const keys = {
  simulation: () => ['simulation'] as const,
  tickets: () => ['tickets'] as const,
  ticket: (id: string) => ['ticket', id] as const,
  agents: () => ['agents'] as const,
  agent: (id: string) => ['agent', id] as const,
  overview: () => ['overview'] as const,
  eventsAll: () => ['events'] as const,
  events: (filters: Partial<Omit<EventsQuery, 'beforeSeq'>> = {}) => ['events', filters] as const,
  sessionsAll: () => ['sessions'] as const,
  sessions: (params: Partial<SessionsQuery> = {}) => ['sessions', params] as const,
  session: (id: string) => ['session', id] as const,
  usage: (params: Partial<UsageQuery> = {}) => ['usage', params] as const,
  modelPrices: () => ['model-prices'] as const,
};
