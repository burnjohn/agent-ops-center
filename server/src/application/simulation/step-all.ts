import { DomainRefusal, eventBuilders, type EventDraft } from '../../domain/index.js';
import { commitEvents } from '../services/ticket-work.js';
import { agentAct } from './agent-act.js';
import { advanceClock } from './clock-advance.js';
import type { StepDeps } from './step-agent.js';

export type StepAllMode = 'step_all' | 'play';

export interface StepAllDeps extends StepDeps {
  /** Current Play flag; the Operator's single Step is refused while it is on (API-AC-55). */
  isPlaying: () => boolean;
}

/**
 * One simulation-wide step (API-AC-54/55): the clock advances once and every agent acts once in fixture
 * order (claims allowed). `play` ticks come from play-control; `step_all` is the header Step.
 */
export async function stepAll(
  deps: StepAllDeps,
  mode: StepAllMode = 'step_all',
): Promise<{ seq: number; steps: 1 }> {
  if (mode === 'step_all' && deps.isPlaying()) {
    throw new DomainRefusal('simulation_playing', 'Pause Play before stepping.');
  }
  return deps.uow.run(async (tx) => {
    const agents = await tx.agents.list();
    const events: EventDraft[] = await advanceClock(tx, {
      actedAgentIds: new Set(agents.map((a) => a.id)),
    });
    const acted: string[] = [];
    for (const agent of agents) {
      const result = await agentAct(tx, deps.scripts, agent.id, { simulationWide: true }, events);
      if (result.kind !== 'silent') acted.push(agent.id);
    }
    const now = tx.clock.now();
    events.push(eventBuilders.simulationStepped({ at: now }, mode, now, acted));
    const seq = await commitEvents(tx, events);
    return { seq, steps: 1 as const };
  });
}
