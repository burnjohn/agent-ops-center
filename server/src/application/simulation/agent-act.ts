import type { AgentStage, TokenUsage } from '@agent-ops/shared';
import { deriveHealth, tokenActivityOf } from '@agent-ops/shared';
import {
  agent as agentRules,
  eventBuilders,
  session as sessionRules,
  ticket as ticketRules,
  toolOut,
  toolTok,
  type AgentState,
  type EventDraft,
  type NewEntry,
  type SessionState,
  type TicketState,
} from '../../domain/index.js';
import type { AgentSimState } from '../ports/repositories.js';
import type { TxContext } from '../ports/unit-of-work.js';
import {
  appendSystemEntry,
  logAppendedEvent,
  endOpenSession,
  startWork,
  type SimScripts,
} from '../services/ticket-work.js';
import { scriptFor, ticketFiles, type ScriptStage } from './scripts.js';

export type ActKind =
  | 'silent'
  | 'refusal'
  | 'cooldown'
  | 'tool_finished'
  | 'heartbeat'
  | 'claim'
  | 'tool_started'
  | 'message'
  | 'update'
  | 'stage'
  | 'block'
  | 'read_answer'
  | 'read_comment'
  | 'submit';

export interface ActResult {
  agentId: string;
  kind: ActKind;
}

export interface ActOptions {
  /** Play tick / header Step: only then may an agent without a ticket claim (API-AC-47 (6)). */
  simulationWide: boolean;
}

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 } as const;

/** Prototype `mtok`: message tokens derived from the clock only. */
function messageTokens(now: string): TokenUsage {
  const k = Math.floor(Date.parse(now) / 6000);
  return {
    input: 5000 + ((k * 1371) % 9000),
    output: 400 + ((k * 577) % 2600),
    cacheRead: 30000 + ((k * 9133) % 170000),
    cacheWrite: 1200 + ((k * 311) % 5000),
  };
}

const secondsBetween = (from: string, to: string): number =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));

/** Mutable working set of one `agentAct` call; persisted piecewise by the helpers below. */
interface Work {
  tx: TxContext;
  scripts: SimScripts;
  events: EventDraft[];
  now: string;
  agent: AgentState;
  sim: AgentSimState;
  ticket: TicketState | null;
  session: SessionState | null;
}

const refs = (w: Work) => ({
  at: w.now,
  agentId: w.agent.id,
  ticketId: w.ticket?.id ?? null,
  sessionId: w.session?.id ?? w.agent.currentSessionId,
});

/** Appends a log entry to the running session (no-op without one) and persists the session. */
async function log(w: Work, entry: NewEntry): Promise<void> {
  if (!w.session) return;
  const { session, entry: draft } = sessionRules.appendEntry(w.session, entry);
  const activity = entry.tokens
    ? tokenActivityOf({
        type: entry.type,
        text: entry.text ?? null,
        tool: entry.tool?.name ?? null,
      })
    : null;
  const stored = { ...draft, activity };
  await w.tx.sessions.appendEntry(session.id, stored);
  await w.tx.sessions.update(session);
  w.session = session;
  w.events.push(await logAppendedEvent(w.tx, session, stored));
}

/** A tool-call log entry for an instant `agent-ops` call (duration 0). */
async function logMcpCall(w: Work, name: string, arg: string, result: string): Promise<void> {
  await log(w, {
    at: w.now,
    type: 'tool',
    tool: { name, arg, ok: true, result, durationSec: 0, output: null },
    tokens: toolTok({ type: 'tool', tool: name, arg, t: w.now, ok: true, result, d: 0 }),
  });
}

async function logStage(w: Work, stage: AgentStage): Promise<void> {
  await log(w, {
    at: w.now,
    type: 'stage',
    text: `STAGE → ${stage.replace('_', ' ').toUpperCase()}`,
    stage,
  });
}

async function saveScript(w: Work, patch: Partial<AgentSimState>): Promise<void> {
  w.sim = { ...w.sim, ...patch };
  await w.tx.simState.save(w.sim);
}

async function saveAgent(w: Work, agent: AgentState): Promise<void> {
  w.agent = agent;
  await w.tx.agents.update(agent);
}

async function saveTicket(w: Work, ticket: TicketState): Promise<void> {
  w.ticket = ticket;
  await w.tx.tickets.update(ticket);
}

/**
 * Heartbeat only: last-seen refreshed and one journal-only `agent.heartbeat`. An agent that is already
 * stale/offline never heartbeats (API-AC-40), so its health keeps degrading.
 */
async function heartbeat(w: Work): Promise<ActKind> {
  if (deriveHealth(w.agent, w.now) !== 'online') return 'silent';
  await saveAgent(w, agentRules.markSeen(w.agent, w.now));
  w.events.push(eventBuilders.agentHeartbeat(refs(w)));
  return 'heartbeat';
}

/**
 * One action of one simulated agent (API-AC-47). The caller owns the transaction, the clock advance
 * and the `simulation.stepped` event. Everything is written through the same ports and `ticket-work`
 * services the Operator commands use (ADR-0008).
 */
export async function agentAct(
  tx: TxContext,
  scripts: SimScripts,
  agentId: string,
  options: ActOptions,
  events: EventDraft[],
): Promise<ActResult> {
  const agent = await tx.agents.get(agentId);
  if (!agent) throw new Error(`Unknown agent ${agentId}`);
  const sim = await tx.simState.get(agentId);
  const now = tx.clock.now();
  const ticket = agent.currentTicketId ? await tx.tickets.get(agent.currentTicketId) : null;
  const session = await tx.sessions.runningFor(agentId);
  const w: Work = {
    tx,
    scripts,
    events,
    now,
    agent,
    sim: sim ?? {
      agentId,
      scenario: 'none',
      script: { version: 1, queue: [], askedTicketIds: [], prngState: 1 },
      silent: false,
      pendingRefusalTicketId: null,
      cooldownSteps: 0,
    },
    ticket,
    session,
  };
  const kind = await decide(w, options);
  return { agentId, kind };
}

async function decide(w: Work, options: ActOptions): Promise<ActKind> {
  // (1) unresponsive -> nothing
  if (w.sim.silent) return 'silent';

  // (2) pending refusal (API-AC-52)
  const refusedId = w.sim.pendingRefusalTicketId;
  if (refusedId !== null) {
    w.events.push(
      eventBuilders.agentRefused(
        { ...refs(w), ticketId: refusedId },
        `Refused: ${refusedId} was released by Operator — stopping work on it`,
      ),
    );
    if (w.session) {
      w.session = await appendSystemEntry(
        w.tx,
        w.session,
        `agent-ops refused the update: ${refusedId} is no longer assigned to ${w.agent.id}. Next: wait, then claim the next ticket.`,
        w.events,
      );
    }
    await saveAgent(w, agentRules.markSeen(w.agent, w.now));
    await saveScript(w, { pendingRefusalTicketId: null });
    return 'refusal';
  }

  // (3) cooldown -> decrement only
  if (w.sim.cooldownSteps > 0) {
    await saveScript(w, { cooldownSteps: w.sim.cooldownSteps - 1 });
    return 'cooldown';
  }

  // (4) running tool -> finish it (API-AC-49)
  if (w.agent.currentTool) return finishTool(w);

  // A ticket the agent does not hold is never touched (API-AC-53).
  const mine = w.ticket && w.ticket.assigneeId === w.agent.id ? w.ticket : null;

  // (5) Blocked or in Review -> heartbeat only
  if (mine && (mine.blockedQuestion !== null || mine.status === 'review')) return heartbeat(w);

  // (6) no ticket -> claim only in a simulation-wide step
  if (!w.agent.currentTicketId) {
    return options.simulationWide ? claim(w) : heartbeat(w);
  }
  if (!mine || mine.status !== 'in_progress') return heartbeat(w);

  // (7) next queued scripted action
  return runNext(w, mine);
}

async function finishTool(w: Work): Promise<ActKind> {
  const running = w.agent.currentTool;
  if (!running) return heartbeat(w);
  const head = w.sim.script.queue[0];
  const isHead = head?.kind === 'tool' && head.tool === running.name && head.arg === running.arg;
  const ok = !(isHead && head.fail);
  const rest = isHead ? w.sim.script.queue.slice(1) : w.sim.script.queue;
  const g = secondsBetween(running.startedAt, w.now);
  const result = !ok
    ? 'EXIT 1'
    : running.name === 'Bash'
      ? 'EXIT 0'
      : running.name === 'Edit'
        ? `+${8 + (g % 30)} −${g % 7}`
        : 'OK';
  const kw = w.ticket ? ticketFiles(w.ticket).kw : 'x';
  const output = ok
    ? toolOut({
        type: 'tool',
        tool: running.name,
        arg: running.arg,
        t: running.startedAt,
        ok,
        result,
        d: g,
      })
    : `FAIL  test/${kw}.test.ts\n  ✕ handles the new case (41 ms)\n\n  Expected: true\n  Received: false\n\n    at Object.<anonymous> (test/${kw}.test.ts:18:22)\n\nTests: 1 failed, 12 passed, 13 total`;

  await log(w, {
    at: running.startedAt,
    type: 'tool',
    tool: { name: running.name, arg: running.arg, ok, result, durationSec: g, output },
    tokens: toolTok({
      type: 'tool',
      tool: running.name,
      arg: running.arg,
      t: running.startedAt,
      ok,
      result,
      d: g,
    }),
  });
  await saveAgent(w, agentRules.markSeen(agentRules.finishTool(w.agent, ok, w.now), w.now));
  w.events.push(
    ok
      ? eventBuilders.toolFinished(refs(w), running.name, running.arg, g, result)
      : eventBuilders.toolFailed(refs(w), running.name, running.arg, g, result),
  );

  let queue = rest;
  if (!ok && w.ticket) {
    const f = ticketFiles(w.ticket);
    queue = [
      { kind: 'message', text: `The test fails on the new case — fixing ${f.a}.` },
      { kind: 'tool', tool: 'Edit', arg: f.a, fail: false },
      { kind: 'tool', tool: running.name, arg: running.arg, fail: false },
      ...rest,
    ];
  }
  await saveScript(w, { script: { ...w.sim.script, queue } });
  return 'tool_finished';
}

/** AC-51: highest priority, then oldest `Ready` ticket. */
async function claim(w: Work): Promise<ActKind> {
  const ready = (await w.tx.tickets.list())
    .filter((t) => t.status === 'ready')
    .sort(
      (a, b) =>
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.number - b.number,
    );
  const best = ready[0];
  if (!best) return heartbeat(w);

  const started = await startWork(
    w.tx,
    w.scripts,
    { ticket: best, agent: w.agent, source: 'claim', from: 'ready' },
    w.events,
  );
  w.agent = started.agent;
  w.session = started.session;
  const sim = await w.tx.simState.get(w.agent.id);
  if (sim) w.sim = sim;
  await saveTicket(w, ticketRules.update(started.ticket, `Claimed by ${w.agent.id}`, w.now));
  await log(w, {
    at: w.now,
    type: 'tool',
    tool: {
      name: 'agent-ops · claim_next_ticket',
      arg: '{}',
      ok: true,
      result: best.id,
      durationSec: 0,
      output: `Claimed ${best.id} · ${best.title} · priority ${best.priority}`,
    },
    tokens: toolTok({
      type: 'tool',
      tool: 'agent-ops · claim_next_ticket',
      arg: '{}',
      t: w.now,
      ok: true,
      result: best.id,
      d: 0,
    }),
  });
  await logStage(w, 'planning');
  return 'claim';
}

async function runNext(w: Work, ticket: TicketState): Promise<ActKind> {
  const action = w.sim.script.queue[0];
  if (!action) return heartbeat(w);
  w.ticket = ticket;
  const rest = w.sim.script.queue.slice(1);
  const withQueue = (queue: typeof rest) => ({ script: { ...w.sim.script, queue } });
  await saveAgent(w, agentRules.markSeen(w.agent, w.now));

  switch (action.kind) {
    case 'tool': {
      // The action stays at the queue head while the tool runs; it carries the `fail` flag.
      await saveAgent(w, agentRules.startTool(w.agent, action.tool, action.arg, w.now));
      w.events.push(eventBuilders.toolStarted(refs(w), action.tool, action.arg));
      return 'tool_started';
    }
    case 'message': {
      await saveScript(w, withQueue(rest));
      await log(w, {
        at: w.now,
        type: 'agent',
        text: action.text,
        tokens: messageTokens(w.now),
      });
      return 'message';
    }
    case 'update': {
      await saveScript(w, withQueue(rest));
      await saveTicket(w, ticketRules.update(ticket, action.text, w.now));
      w.events.push(eventBuilders.ticketUpdated(refs(w), action.text, action.progress));
      await logMcpCall(w, 'agent-ops · post_update', `{ "progress": ${action.progress} }`, 'OK');
      return 'update';
    }
    case 'stage': {
      const from = w.agent.stage;
      const asked = w.sim.script.askedTicketIds.includes(ticket.id);
      const next = [...rest, ...scriptFor(action.to as ScriptStage, ticket, asked)];
      await saveScript(w, withQueue(next));
      await saveAgent(w, agentRules.setStage(w.agent, action.to));
      await saveTicket(w, { ...ticket, updatedAt: w.now });
      w.events.push(eventBuilders.stageChanged(refs(w), from, action.to));
      await logStage(w, action.to);
      return 'stage';
    }
    case 'block': {
      const asked = w.sim.script.askedTicketIds;
      await saveScript(w, {
        script: {
          ...w.sim.script,
          queue: rest,
          askedTicketIds: asked.includes(ticket.id) ? asked : [...asked, ticket.id],
        },
      });
      const blocked = ticketRules.update(
        ticketRules.block(ticket, action.question, w.now),
        'Asked Operator for input',
        w.now,
      );
      await saveTicket(w, blocked);
      w.events.push(eventBuilders.ticketBlocked(refs(w), action.question));
      await log(w, {
        at: w.now,
        type: 'agent',
        text: `I need input from the Operator: ${action.question}`,
        tokens: messageTokens(w.now),
      });
      return 'block';
    }
    case 'read_answer': {
      await saveScript(w, withQueue(rest));
      w.events.push(eventBuilders.ticketAnswerRead(refs(w)));
      await log(w, { at: w.now, type: 'operator', text: action.text });
      return 'read_answer';
    }
    case 'read_comment': {
      await saveScript(w, withQueue(rest));
      w.events.push(eventBuilders.ticketCommentRead(refs(w)));
      await log(w, { at: w.now, type: 'operator', text: `Review comment: ${action.text}` });
      return 'read_comment';
    }
    case 'submit': {
      await saveScript(w, withQueue(rest));
      await saveTicket(
        w,
        ticketRules.update(
          ticketRules.submit(ticket, action.summary, action.resultLink, w.now),
          'Submitted for review',
          w.now,
        ),
      );
      const from = w.agent.stage;
      await saveAgent(w, {
        ...agentRules.setStage(w.agent, 'awaiting_review'),
        currentTool: null,
        currentSessionId: null,
      });
      w.events.push(
        eventBuilders.ticketSubmitted(refs(w), action.summary, action.resultLink),
        eventBuilders.stageChanged(refs(w), from, 'awaiting_review'),
      );
      await logMcpCall(w, 'agent-ops · submit_for_review', `{ "ticketId": "${ticket.id}" }`, 'OK');
      await logStage(w, 'awaiting_review');
      await endOpenSession(w.tx, w.agent, 'completed', w.events, { ticketId: ticket.id });
      return 'submit';
    }
  }
}
