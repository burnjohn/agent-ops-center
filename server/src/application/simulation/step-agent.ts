import { DomainRefusal, eventBuilders, type EventDraft } from '../../domain/index.js';
import type { TxContext, UnitOfWork } from '../ports/unit-of-work.js';
import { commitEvents, type SimScripts } from '../services/ticket-work.js';
import { agentAct, type ActResult } from './agent-act.js';
import { advanceClock } from './clock-advance.js';
import { stepAvailability } from './step-availability.js';

export interface StepDeps {
  uow: UnitOfWork;
  scripts: SimScripts;
}

export interface StepAgentInput {
  agentId: string;
  ticketId: string;
}

export type SingleStepMode = 'step' | 'to_next_stage';

/** What one committed single-agent step left behind (used by run-to-next-stage). */
export interface StepOutcome {
  seq: number;
  act: ActResult;
  stageBefore: string;
  stageAfter: string;
  /** The agent can take no further step; `waiting` = needs the Operator, `no_work` = script exhausted. */
  stop: 'waiting' | 'no_work' | null;
}

async function availabilityOf(tx: TxContext, agentId: string, ticketId: string | null) {
  const agent = await tx.agents.get(agentId);
  if (!agent) throw new DomainRefusal('not_found', `Agent ${agentId} not found.`);
  const ticketKey = ticketId ?? agent.currentTicketId;
  const ticket = ticketKey ? await tx.tickets.get(ticketKey) : null;
  const sim = await tx.simState.get(agentId);
  const availability = stepAvailability({ agent, ticketId, ticket, sim });
  return { agent, ticket, sim, availability };
}

/** One transaction: availability check, clock advance, one `agentAct`, `simulation.stepped` last. */
export async function stepAgentOnce(
  deps: StepDeps,
  input: StepAgentInput,
  mode: SingleStepMode,
): Promise<StepOutcome> {
  return deps.uow.run(async (tx) => {
    const before = await availabilityOf(tx, input.agentId, input.ticketId);
    if (!before.availability.available) {
      throw new DomainRefusal(
        'cannot_step',
        before.availability.reason ?? `${input.agentId} cannot step.`,
        before.availability.reason ? { reason: before.availability.reason } : {},
      );
    }
    const events: EventDraft[] = await advanceClock(tx, {
      actedAgentIds: new Set([input.agentId]),
    });
    const act = await agentAct(tx, deps.scripts, input.agentId, { simulationWide: false }, events);
    const now = tx.clock.now();
    const after = await availabilityOf(tx, input.agentId, null);
    events.push(
      eventBuilders.simulationStepped(
        {
          at: now,
          agentId: input.agentId,
          ticketId: input.ticketId,
          sessionId: after.agent.currentSessionId ?? before.agent.currentSessionId,
        },
        mode,
        now,
        [input.agentId],
      ),
    );
    const seq = await commitEvents(tx, events);

    let stop: StepOutcome['stop'] = null;
    if (!after.availability.available) {
      const t = after.ticket;
      const needsOperator =
        !t ||
        t.status !== 'in_progress' ||
        t.blockedQuestion !== null ||
        after.sim?.silent === true;
      stop = needsOperator ? 'waiting' : 'no_work';
    }
    return {
      seq,
      act,
      stageBefore: before.agent.stage,
      stageAfter: after.agent.stage,
      stop,
    };
  });
}

/** Operator "Next step" (API-AC-44, AC-45). */
export async function stepAgent(
  deps: StepDeps,
  input: StepAgentInput,
): Promise<{ seq: number; act: ActResult }> {
  const out = await stepAgentOnce(deps, input, 'step');
  return { seq: out.seq, act: out.act };
}
