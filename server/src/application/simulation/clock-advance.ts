import { deriveHealth, type AgentHealth } from '@agent-ops/shared';
import { agent as agentRules, eventBuilders, type EventDraft } from '../../domain/index.js';
import { endOpenSession } from '../services/ticket-work.js';
import type { TxContext } from '../ports/unit-of-work.js';

/** One Simulation Clock step (SIM-10, API-AC-44). */
export const STEP_SECONDS = 6;

export const SESSION_INTERRUPTED_TEXT = 'Session interrupted — agent went Offline';

export interface ClockAdvanceOptions {
  /** Agents that act in this step; they refresh their own last-seen, so no heartbeat is emitted for them. */
  actedAgentIds?: ReadonlySet<string>;
  seconds?: number;
}

/**
 * Advances the clock inside the caller's transaction (API-AC-38/39/40/41/42) and returns the drafts to
 * commit (the caller appends them, then `simulation.stepped` last):
 * - responsive agents that were online before the advance and did not act get last-seen refreshed and one
 *   journal-only `agent.heartbeat`; silent, stale and offline agents are never refreshed;
 * - every derived-health change emits `agent.health_changed`;
 * - every offline agent with a running session has it failed with the interrupted entry.
 */
export async function advanceClock(
  tx: TxContext,
  options: ClockAdvanceOptions = {},
): Promise<EventDraft[]> {
  const acted = options.actedAgentIds ?? new Set<string>();
  const before = tx.clock.now();
  tx.clock.advance(options.seconds ?? STEP_SECONDS);
  const now = tx.clock.now();

  const agents = await tx.agents.list();
  const simStates = new Map((await tx.simState.list()).map((s) => [s.agentId, s]));
  const events: EventDraft[] = [];

  for (const original of agents) {
    const wasHealth = deriveHealth(original, before);
    let agent = original;
    if (wasHealth === 'online' && !acted.has(agent.id) && !simStates.get(agent.id)?.silent) {
      agent = agentRules.markSeen(agent, now);
      await tx.agents.update(agent);
      events.push(
        eventBuilders.agentHeartbeat({
          at: now,
          agentId: agent.id,
          ticketId: agent.currentTicketId,
          sessionId: agent.currentSessionId,
        }),
      );
    }

    const nowHealth: AgentHealth = deriveHealth(agent, now);
    if (nowHealth !== wasHealth) {
      events.push(
        eventBuilders.healthChanged({ at: now, agentId: agent.id }, wasHealth, nowHealth),
      );
    }
    // Also covers an agent that was already offline when a session opened for it (API-AC-41).
    if (nowHealth === 'offline') {
      await endOpenSession(tx, agent, 'failed', events, { systemText: SESSION_INTERRUPTED_TEXT });
    }
  }
  return events;
}
