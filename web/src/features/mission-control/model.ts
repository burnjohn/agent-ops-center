import {
  isFeedEvent,
  type Agent,
  type Event,
  type EventCategory,
  type EventSource,
  type SimulationState,
  type Ticket,
} from '@agent-ops/shared';

export type SourceFilter =
  'all' | Extract<EventSource, 'operator' | 'agent_report' | 'agent_telemetry'>;
export type CategoryFilter = 'all' | Extract<EventCategory, 'agent' | 'ticket' | 'tool'>;

export const SOURCE_OPTIONS = [
  { value: 'all', label: 'ALL' },
  { value: 'operator', label: '● OPERATOR' },
  { value: 'agent_report', label: '■ REPORT' },
  { value: 'agent_telemetry', label: '◆ TELEMETRY' },
] as const satisfies readonly { value: SourceFilter; label: string }[];

export const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'agent', label: 'Agents' },
  { value: 'ticket', label: 'Tickets' },
  { value: 'tool', label: 'Tools' },
] as const satisfies readonly { value: CategoryFilter; label: string }[];

/** UI-AC-95 / PDR-0010: the server's order, with Offline agents moved after all others. */
export function sortAgents(agents: readonly Agent[]): Agent[] {
  return [
    ...agents.filter((a) => a.health !== 'offline'),
    ...agents.filter((a) => a.health === 'offline'),
  ];
}

/** UI-AC-92: legend text built from the server's thresholds (PDR-0011). */
export function healthLegend(t: SimulationState['healthThresholds']): string {
  const min = (sec: number) => `${Math.round(sec / 60)} min`;
  return (
    `■ ONLINE · ◐ STALE after ${t.staleAfterSec} s · □ OFFLINE after ${min(t.offlineAfterSec)} · ` +
    `a running tool keeps an agent Online for up to ${min(t.toolGraceSec)}`
  );
}

/** The blocked question of the agent's ticket, if it is Blocked (UI-AC-97). */
export function blockedOf(
  agent: Agent,
  tickets: readonly Ticket[],
): { question: string; since: string } | null {
  const ticket = tickets.find((t) => t.id === agent.currentTicketId);
  if (!ticket || ticket.status !== 'in_progress' || ticket.blockedQuestion === null) return null;
  return { question: ticket.blockedQuestion, since: ticket.updatedAt };
}

/** Flatten pages (newest first), drop duplicates from overlapping refetches and non-feed types (UI-AC-103). */
export function mergeFeed(pages: readonly { items: readonly Event[] }[]): Event[] {
  const bySeq = new Map<number, Event>();
  for (const page of pages) {
    for (const event of page.items) {
      if (isFeedEvent(event)) bySeq.set(event.seq, event);
    }
  }
  return [...bySeq.values()].sort((a, b) => b.seq - a.seq);
}

export const maxSeq = (events: readonly Event[]): number =>
  events.reduce((m, e) => Math.max(m, e.seq), 0);
