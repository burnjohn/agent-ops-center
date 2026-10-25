import { EVENT_PAYLOADS, entryCostUsd, type AgentScript } from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import {
  session as sessionRules,
  ticket as ticketRules,
  type AgentState,
  type EventDraft,
  type TicketState,
} from '../../domain/index.js';
import type { AgentSimState } from '../ports/repositories.js';
import { createTestPorts } from '../testing/index.js';
import { agentAct, type ActResult } from './agent-act.js';
import { nextInt } from './prng.js';
import { createSimScripts, scriptFor } from './scripts.js';

const T0 = '2026-10-24T14:00:00.000Z';
const scripts = createSimScripts();

const emptyScript = (): AgentScript => ({
  version: 1,
  queue: [],
  askedTicketIds: [],
  prngState: 20261024,
});

function mkTicket(n: number, patch: Partial<TicketState> = {}): TicketState {
  return { ...ticketRules.createTicket({ number: n, title: `Ticket ${n}`, now: T0 }), ...patch };
}

function mkAgent(id: string, patch: Partial<AgentState> = {}): AgentState {
  return {
    id,
    name: id,
    kind: 'simulated',
    model: 'sonnet-5-5',
    stage: 'idle',
    lastSeenAt: T0,
    currentTicketId: null,
    currentSessionId: null,
    lastSessionId: null,
    currentTool: null,
    lastTool: null,
    pausedAfterRelease: false,
    ...patch,
  };
}

function setup() {
  const p = createTestPorts();
  p.store.data.simulation.clockAt = T0; // agents are seeded last seen at T0, i.e. online
  const seedSim = (agentId: string, patch: Partial<AgentSimState> = {}) =>
    p.store.data.simState.set(agentId, {
      agentId,
      scenario: 'free_agent',
      script: emptyScript(),
      silent: false,
      pendingRefusalTicketId: null,
      cooldownSteps: 0,
      ...patch,
    });
  /** alpha working on `ticket` with a running session and the given queue. */
  const working = (
    ticket: TicketState,
    queue: AgentScript['queue'],
    stage: AgentState['stage'] = 'implementing',
  ) => {
    p.store.seedTicket({ ...ticket, status: 'in_progress', assigneeId: 'alpha' });
    const s = sessionRules.startSession({
      number: 1,
      agentId: 'alpha',
      ticketId: ticket.id,
      model: 'sonnet-5-5',
      now: T0,
    });
    p.store.seedSession(s);
    p.store.seedAgent(
      mkAgent('alpha', {
        stage,
        currentTicketId: ticket.id,
        currentSessionId: s.id,
        lastSessionId: s.id,
      }),
    );
    seedSim('alpha', { script: { ...emptyScript(), queue } });
    return s;
  };
  const act = async (agentId: string, simulationWide = false) => {
    const events: EventDraft[] = [];
    let result!: ActResult;
    await p.uow.run(async (tx) => {
      result = await agentAct(tx, scripts, agentId, { simulationWide }, events);
      await tx.appendEvents(events);
    });
    return { result, types: events.map((e) => e.type), events };
  };
  const step = async (agentId: string, simulationWide = false) => {
    p.clock.advance(6);
    return act(agentId, simulationWide);
  };
  const agent = (id: string) => p.store.data.agents.get(id)!;
  const sim = (id: string) => p.store.data.simState.get(id)!;
  const ticket = (id: string) => p.store.data.tickets.get(id)!;
  const entries = (sid: string) => p.store.data.entries.get(sid) ?? [];
  return { p, seedSim, working, act, step, agent, sim, ticket, entries };
}

describe('agentAct branches (API-AC-47)', () => {
  it('(1) unresponsive agent does nothing', async () => {
    const s = setup();
    s.working(mkTicket(9), [{ kind: 'message', text: 'hi' }]);
    s.seedSim('alpha', {
      silent: true,
      script: { ...emptyScript(), queue: [{ kind: 'message', text: 'hi' }] },
    });
    const r = await s.step('alpha');
    expect(r.result.kind).toBe('silent');
    expect(r.types).toEqual([]);
    expect(s.sim('alpha').script.queue).toHaveLength(1);
    expect(s.agent('alpha').lastSeenAt).toBe(T0);
  });

  it('(2) pending refusal: agent.refused, system entry in the open session, cleared (API-AC-52)', async () => {
    const s = setup();
    const sess = s.working(mkTicket(10), [{ kind: 'message', text: 'hi' }]);
    s.seedSim('alpha', {
      pendingRefusalTicketId: 'T-12',
      cooldownSteps: 3,
      script: { ...emptyScript(), queue: [{ kind: 'message', text: 'hi' }] },
    });
    const r = await s.step('alpha');
    expect(r.result.kind).toBe('refusal');
    expect(r.types).toEqual(['agent.refused', 'log.appended']);
    expect(r.events[0]).toMatchObject({
      warn: true,
      ticketId: 'T-12',
      payload: { summary: 'Refused: T-12 was released by Operator — stopping work on it' },
    });
    expect(s.entries(sess.id).at(-1)).toMatchObject({
      type: 'system',
      text: 'agent-ops refused the update: T-12 is no longer assigned to alpha. Next: wait, then claim the next ticket.',
    });
    expect(s.sim('alpha').pendingRefusalTicketId).toBeNull();
    expect(s.sim('alpha').cooldownSteps).toBe(3);
    // the next step continues the new work
    expect((await s.step('alpha')).result.kind).toBe('cooldown');
  });

  it('(3) cooldown only decrements', async () => {
    const s = setup();
    s.working(mkTicket(9), [{ kind: 'message', text: 'hi' }]);
    s.seedSim('alpha', {
      cooldownSteps: 2,
      script: { ...emptyScript(), queue: [{ kind: 'message', text: 'hi' }] },
    });
    const r = await s.step('alpha');
    expect(r.result.kind).toBe('cooldown');
    expect(r.types).toEqual([]);
    expect(s.sim('alpha').cooldownSteps).toBe(1);
    expect(s.sim('alpha').script.queue).toHaveLength(1);
  });

  it('(4) running tool is finished with duration, tokens, output and tool.finished (API-AC-49)', async () => {
    const s = setup();
    const price = {
      model: 'sonnet-5-5',
      inputPerM: 3,
      outputPerM: 15,
      cacheReadPerM: 0.3,
      cacheWritePerM: 3.75,
    };
    s.p.store.seedPrice(price);
    const sess = s.working(mkTicket(12), [
      { kind: 'tool', tool: 'Edit', arg: 'src/a.ts', fail: false },
      { kind: 'message', text: 'next' },
    ]);
    expect((await s.step('alpha')).types).toEqual(['tool.started']);
    expect(s.agent('alpha').currentTool).toMatchObject({ name: 'Edit', arg: 'src/a.ts' });
    const fin = await s.step('alpha');
    expect(fin.types).toEqual(['log.appended', 'tool.finished']);
    expect(fin.events[1]?.payload).toMatchObject({ durationSec: 6, tool: 'Edit' });
    const e = s.entries(sess.id).at(-1)!;
    expect(e.type).toBe('tool');
    expect(e.tool).toMatchObject({ name: 'Edit', ok: true, durationSec: 6 });
    expect(e.tool?.output).toContain('@@');
    expect(e.tokens).not.toBeNull();
    expect(e.activity).toBe('editing_code');
    // log.appended carries a contract-valid LogEntry with the entry cost (ADR-0009: same unit of work)
    const logged = fin.events[0]!;
    expect(logged).toMatchObject({
      type: 'log.appended',
      source: 'system',
      category: 'agent',
      sessionId: sess.id,
    });
    expect(() => EVENT_PAYLOADS['log.appended'].parse(logged.payload)).not.toThrow();
    expect(
      (logged.payload as unknown as { entry: { index: number; costUsd: number } }).entry,
    ).toMatchObject({
      index: e.index,
      costUsd: entryCostUsd(e.tokens!, price),
    });
    expect(s.agent('alpha').currentTool).toBeNull();
    expect(s.agent('alpha').lastTool).toMatchObject({ name: 'Edit', ok: true });
    expect(s.sim('alpha').script.queue).toEqual([{ kind: 'message', text: 'next' }]);
  });

  it('(4) a failed tool emits tool.failed (warn) and queues explain, Edit A, rerun', async () => {
    const s = setup();
    s.working(
      mkTicket(13, { priority: 'high' }),
      [
        { kind: 'tool', tool: 'Bash', arg: 'npm test -- ingest', fail: true },
        { kind: 'message', text: 'after' },
      ],
      'testing',
    );
    await s.step('alpha');
    const fin = await s.step('alpha');
    expect(fin.types).toEqual(['log.appended', 'tool.failed']);
    expect(fin.events[1]).toMatchObject({ warn: true });
    expect(s.agent('alpha').lastTool).toMatchObject({ ok: false });
    expect(s.sim('alpha').script.queue.map((a) => a.kind)).toEqual([
      'message',
      'tool',
      'tool',
      'message',
    ]);
    expect(s.sim('alpha').script.queue[2]).toMatchObject({
      tool: 'Bash',
      arg: 'npm test -- ingest',
      fail: false,
    });
  });

  it('(5) Blocked or Review ticket: heartbeat only', async () => {
    const s = setup();
    s.working(mkTicket(9, { blockedQuestion: 'q?' }), [{ kind: 'message', text: 'hi' }]);
    const r = await s.step('alpha');
    expect(r.result.kind).toBe('heartbeat');
    expect(r.types).toEqual(['agent.heartbeat']);
    expect(s.sim('alpha').script.queue).toHaveLength(1);
    expect(s.agent('alpha').lastSeenAt).toBe(s.p.clock.now());

    const s2 = setup();
    s2.working(mkTicket(9), []);
    s2.p.store.seedTicket({ ...s2.ticket('T-9'), status: 'review' });
    expect((await s2.step('alpha')).types).toEqual(['agent.heartbeat']);
  });

  it('(6) no ticket: heartbeat in a single step, claim only in a simulation-wide step (API-AC-51)', async () => {
    const s = setup();
    s.p.store.seedAgent(mkAgent('charlie'));
    s.seedSim('charlie');
    s.p.store.seedTicket(mkTicket(10, { status: 'ready', priority: 'medium' }));
    s.p.store.seedTicket(mkTicket(13, { status: 'ready', priority: 'high' }));
    s.p.store.seedTicket(mkTicket(11, { status: 'ready', priority: 'high' }));
    expect((await s.step('charlie')).types).toEqual(['agent.heartbeat']);
    const r = await s.step('charlie', true);
    expect(r.result.kind).toBe('claim');
    expect(r.types).toEqual([
      'ticket.assigned',
      'agent.stage_changed',
      'session.started',
      'log.appended',
      'log.appended',
      'log.appended',
    ]);
    expect(r.events[0]).toMatchObject({
      source: 'agent_report',
      ticketId: 'T-11',
      payload: { claim: true, summary: 'Claimed T-11' },
    });
    expect(s.agent('charlie')).toMatchObject({ stage: 'planning', currentTicketId: 'T-11' });
    expect(s.ticket('T-11')).toMatchObject({ status: 'in_progress', assigneeId: 'charlie' });
    expect(s.sim('charlie').script.queue[0]).toMatchObject({ kind: 'tool', tool: 'Read' });
    const sid = s.agent('charlie').currentSessionId!;
    expect(s.entries(sid).map((e) => e.type)).toEqual(['system', 'tool', 'stage']);
  });

  it('(6) no Ready ticket: only a heartbeat even in a simulation-wide step', async () => {
    const s = setup();
    s.p.store.seedAgent(mkAgent('charlie'));
    s.seedSim('charlie');
    expect((await s.step('charlie', true)).types).toEqual(['agent.heartbeat']);
  });

  it('(7) message, update, stage actions', async () => {
    const s = setup();
    const sess = s.working(mkTicket(9), [
      { kind: 'message', text: 'working' },
      { kind: 'update', progress: 35, text: 'First change' },
      { kind: 'stage', to: 'testing' },
    ]);
    const m = await s.step('alpha');
    expect(m.types).toEqual(['log.appended']);
    expect(s.entries(sess.id).at(-1)).toMatchObject({ type: 'agent', text: 'working' });
    expect(s.entries(sess.id).at(-1)?.tokens).not.toBeNull();

    const u = await s.step('alpha');
    expect(u.types).toEqual(['ticket.updated', 'log.appended']);
    expect(s.ticket('T-9').lastUpdate).toMatchObject({ text: 'First change' });

    const st = await s.step('alpha');
    expect(st.types).toEqual(['agent.stage_changed', 'log.appended']);
    expect(s.agent('alpha').stage).toBe('testing');
    expect(s.entries(sess.id).at(-1)).toMatchObject({
      type: 'stage',
      stage: 'testing',
      text: 'STAGE → TESTING',
    });
    expect(s.sim('alpha').script.queue).toEqual(scriptFor('testing', s.ticket('T-9'), false));
  });

  it('(7) read_answer and read_comment', async () => {
    const s = setup();
    const sess = s.working(mkTicket(9), [
      { kind: 'read_answer', text: 'yes' },
      { kind: 'read_comment', text: 'rename' },
    ]);
    expect((await s.step('alpha')).types).toEqual(['ticket.answer_read', 'log.appended']);
    expect(s.entries(sess.id).at(-1)).toMatchObject({ type: 'operator', text: 'yes' });
    expect((await s.step('alpha')).types).toEqual(['ticket.comment_read', 'log.appended']);
    expect(s.entries(sess.id).at(-1)).toMatchObject({
      type: 'operator',
      text: 'Review comment: rename',
    });
  });

  it('(7) submit sets Review, awaiting_review and ends the session completed (API-AC-50)', async () => {
    const s = setup();
    const sess = s.working(
      mkTicket(9, { reviewComment: 'old' }),
      [{ kind: 'submit', summary: 'Done it', resultLink: 'PR #49 · feat/a11y' }],
      'testing',
    );
    const r = await s.step('alpha');
    expect(r.types).toEqual([
      'ticket.submitted',
      'agent.stage_changed',
      'log.appended',
      'log.appended',
      'session.ended',
    ]);
    expect(s.ticket('T-9')).toMatchObject({
      status: 'review',
      reviewSummary: 'Done it',
      resultLink: 'PR #49 · feat/a11y',
      reviewComment: null,
    });
    expect(s.agent('alpha')).toMatchObject({ stage: 'awaiting_review', currentTicketId: 'T-9' });
    expect(s.p.store.data.sessions.get(sess.id)?.status).toBe('completed');
    expect(s.entries(sess.id).map((e) => e.type)).toEqual(['tool', 'stage']);
    expect(s.entries(sess.id)[0]?.tool?.name).toBe('agent-ops · submit_for_review');
  });

  it('never touches a ticket the agent does not hold (API-AC-53)', async () => {
    const s = setup();
    s.working(mkTicket(9), [{ kind: 'message', text: 'x' }]);
    s.p.store.seedTicket({ ...s.ticket('T-9'), assigneeId: 'bravo' });
    const r = await s.step('alpha');
    expect(r.types).toEqual(['agent.heartbeat']);
    expect(s.sim('alpha').script.queue).toHaveLength(1);
  });
});

describe('scripted run of T-13 (high, odd)', () => {
  it('blocks once and fails the test once, then submits', async () => {
    const s = setup();
    const ticket13 = mkTicket(13, { priority: 'high', status: 'ready' });
    s.p.store.seedTicket(ticket13);
    s.p.store.seedAgent(mkAgent('charlie'));
    s.seedSim('charlie');
    s.p.store.data.counters.session = 416;

    await s.step('charlie', true); // claim -> Planning queued
    const all: string[] = [];
    let extraAfterFailure = -1;
    for (let i = 0; i < 80 && s.ticket('T-13').status !== 'review'; i++) {
      const t = s.ticket('T-13');
      if (t.blockedQuestion !== null) {
        const answered = ticketRules.answer(t, 'Per agent.', s.p.clock.now());
        s.p.store.seedTicket(answered);
        s.seedSim('charlie', {
          script: scripts.queueReadAnswer(s.sim('charlie').script, answered),
        });
      }
      const before = s.sim('charlie').script.queue.length;
      const r = await s.step('charlie');
      all.push(...r.types);
      if (r.types.includes('tool.failed')) {
        // the failed tool left the queue (-1) and three actions were queued (+3)
        extraAfterFailure = s.sim('charlie').script.queue.length - (before - 1);
      }
    }
    expect(all.filter((t) => t === 'ticket.blocked')).toHaveLength(1);
    expect(all.filter((t) => t === 'tool.failed')).toHaveLength(1);
    expect(extraAfterFailure).toBe(3);
    expect(all).toContain('ticket.submitted');
    expect(s.ticket('T-13')).toMatchObject({
      status: 'review',
      resultLink: 'PR #53 · feat/ingest',
    });
    expect(s.sim('charlie').script.askedTicketIds).toEqual(['T-13']);
  });
});

describe('property: random command sequences keep AC-53 (seeded, deterministic)', () => {
  const AGENTS = ['alpha', 'bravo', 'charlie'];

  for (const seed of [1, 7, 42, 20261024, 987654321]) {
    it(`never sets Done, touches a foreign ticket or holds two tickets (seed ${seed})`, async () => {
      const s = setup();
      const priorities = ['low', 'medium', 'high', 'medium', 'low', 'high'] as const;
      priorities.forEach((priority, i) =>
        s.p.store.seedTicket(mkTicket(i + 1, { priority, status: 'ready' })),
      );
      for (const id of AGENTS) {
        s.p.store.seedAgent(mkAgent(id));
        s.seedSim(id, { script: { ...emptyScript(), prngState: seed + id.length } });
      }

      let rng: AgentScript = { ...emptyScript(), prngState: seed };
      const draw = (bound: number): number => {
        const r = nextInt(rng, bound);
        rng = r.script;
        return r.value;
      };
      const snapshot = () =>
        new Map([...s.p.store.data.tickets].map(([k, t]) => [k, structuredClone(t)]));

      for (let i = 0; i < 160; i++) {
        const before = snapshot();
        const actors: string[] = [];
        if (draw(4) === 0) {
          s.p.clock.advance(6);
          for (const id of AGENTS) {
            await s.act(id, true);
            actors.push(id);
          }
        } else {
          const id = AGENTS[draw(AGENTS.length)]!;
          await s.step(id, draw(2) === 0);
          actors.push(id);
        }

        const now = s.p.store.data.tickets;
        for (const [id, t] of now) {
          expect(t.status === 'done', `${id} done at command ${i}`).toBe(
            before.get(id)?.status === 'done',
          );
          const prev = before.get(id)!;
          if (t.assigneeId !== prev.assigneeId) {
            // only a claim of a Ready ticket may change the holder, and only to the acting agent
            expect(prev.status, `${id} claimed from ${prev.status}`).toBe('ready');
            expect(actors).toContain(t.assigneeId);
          } else if (t.assigneeId === null || !actors.includes(t.assigneeId)) {
            expect(t, `${id} changed without a holder acting at command ${i}`).toEqual(prev);
          }
        }
        for (const id of AGENTS) {
          const held = [...now.values()].filter((t) => t.assigneeId === id && t.status !== 'done');
          expect(held.length, `${id} holds ${held.length} tickets`).toBeLessThanOrEqual(1);
        }
      }
    });
  }
});
