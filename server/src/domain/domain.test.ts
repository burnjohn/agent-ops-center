import { describe, expect, it } from 'vitest';
import * as agentMod from './agent.js';
import { DomainRefusal } from './errors.js';
import * as ev from './event-builders.js';
import { formatSessionId, formatTicketId, parseSessionId, parseTicketId } from './ids.js';
import * as sess from './session.js';
import { addSeconds, utcDay } from './time.js';
import { ctxTok, hashK, toolOut, toolTok } from './token-generation.js';
import * as tk from './ticket.js';

const NOW = '2026-10-24T14:32:00.000Z';
const LATER = '2026-10-24T14:32:06.000Z';

describe('ids', () => {
  it('formats and parses', () => {
    expect(formatTicketId(17)).toBe('T-17');
    expect(parseTicketId('T-17')).toBe(17);
    expect(parseTicketId('T-0')).toBeNull();
    expect(parseTicketId('T-07')).toBeNull();
    expect(formatSessionId(416)).toBe('S-0416');
    expect(formatSessionId(10000)).toBe('S-10000');
    expect(parseSessionId('S-0416')).toBe(416);
    expect(parseSessionId('S-12')).toBeNull();
    expect(() => formatTicketId(0)).toThrow(RangeError);
  });
});

describe('time', () => {
  it('adds seconds and extracts the UTC day', () => {
    expect(addSeconds(NOW, 6)).toBe(LATER);
    expect(addSeconds('2026-10-24T23:59:59.000Z', 1)).toBe('2026-10-25T00:00:00.000Z');
    expect(utcDay('2026-10-24T23:59:59.000Z')).toBe('2026-10-24');
  });
});

describe('ticket', () => {
  const base = () =>
    tk.createTicket({
      number: 17,
      title: '  Fix it ',
      acceptanceCriteria: [' a ', '', '  '],
      now: NOW,
    });

  it('creates in backlog with trimmed fields (AC-7)', () => {
    const t = base();
    expect(t).toMatchObject({
      id: 'T-17',
      title: 'Fix it',
      status: 'backlog',
      priority: 'medium',
      acceptanceCriteria: ['a'],
    });
    expect(t.createdAt).toBe(NOW);
  });

  it('rejects a blank title with the AC-8 message', () => {
    try {
      tk.createTicket({ number: 1, title: '   ', now: NOW });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainRefusal);
      expect(e).toMatchObject({
        code: 'validation_failed',
        message: 'Title is required.',
        path: 'title',
      });
    }
  });

  it('assign clears blocked question and review comment, touches updatedAt (AC-19, AC-22)', () => {
    const t = { ...base(), blockedQuestion: 'q', reviewComment: 'c' };
    const a = tk.assignTo(t, 'alpha', LATER);
    expect(a).toMatchObject({
      status: 'in_progress',
      assigneeId: 'alpha',
      blockedQuestion: null,
      reviewComment: null,
      updatedAt: LATER,
    });
  });

  it('release / reopen / markDone / approve', () => {
    const t = tk.assignTo(base(), 'alpha', NOW);
    expect(tk.release({ ...t, blockedQuestion: 'q' }, LATER)).toMatchObject({
      status: 'ready',
      assigneeId: null,
      blockedQuestion: null,
    });
    expect(tk.markDone({ ...t, blockedQuestion: 'q' }, LATER)).toMatchObject({
      status: 'done',
      blockedQuestion: null,
      assigneeId: 'alpha',
    });
    expect(tk.reopen(tk.markDone(t, NOW), 'ready', LATER)).toMatchObject({
      status: 'ready',
      assigneeId: null,
    });
    expect(tk.approve(t, LATER).status).toBe('done');
  });

  it('requestChanges stores trimmed comment and rejects blank (AC-17/18)', () => {
    const t = tk.assignTo(base(), 'alpha', NOW);
    expect(tk.requestChanges(t, '  fix  ', LATER)).toMatchObject({
      status: 'in_progress',
      reviewComment: 'fix',
      assigneeId: 'alpha',
    });
    expect(() => tk.requestChanges(t, ' ', LATER)).toThrow(
      'A comment is required — tell the agent what to change.',
    );
  });

  it('answer needs a blocked ticket and a non-empty text (AC-21)', () => {
    const t = tk.block(base(), 'why?', NOW);
    expect(tk.answer(t, ' yes ', LATER)).toMatchObject({ blockedQuestion: null, answer: 'yes' });
    expect(() => tk.answer(t, ' ', LATER)).toThrow('Write an answer before unblocking.');
    expect(() => tk.answer(base(), 'x', LATER)).toThrow(
      expect.objectContaining({ code: 'not_blocked' }),
    );
  });

  it('submit and update', () => {
    const t = tk.submit({ ...base(), reviewComment: 'old' }, 'done', 'PR #41', LATER);
    expect(t).toMatchObject({
      status: 'review',
      reviewSummary: 'done',
      resultLink: 'PR #41',
      reviewComment: null,
    });
    expect(tk.update(base(), 'half', LATER).lastUpdate).toEqual({ text: 'half', at: LATER });
  });

  it('does not mutate its input', () => {
    const t = base();
    tk.assignTo(t, 'alpha', LATER);
    expect(t.status).toBe('backlog');
  });
});

describe('agent', () => {
  const a: agentMod.AgentState = {
    id: 'alpha',
    name: 'Alpha',
    kind: 'real',
    model: 'sonnet-5-5',
    stage: 'idle',
    lastSeenAt: NOW,
    currentTicketId: null,
    currentSessionId: null,
    lastSessionId: null,
    currentTool: null,
    lastTool: null,
    pausedAfterRelease: false,
  };

  it('takes a ticket, runs a tool, goes idle', () => {
    const t = agentMod.takeTicket(a, 'T-1', 'S-0001');
    expect(t).toMatchObject({
      stage: 'planning',
      currentTicketId: 'T-1',
      currentSessionId: 'S-0001',
      lastSessionId: 'S-0001',
    });
    const running = agentMod.startTool(t, 'Read', 'x', NOW);
    expect(running.currentTool).toEqual({ name: 'Read', arg: 'x', startedAt: NOW });
    const done = agentMod.finishTool(running, false, LATER);
    expect(done.currentTool).toBeNull();
    expect(done.lastTool).toEqual({ name: 'Read', arg: 'x', ok: false, at: LATER });
    const idle = agentMod.goIdle(done, { pausedAfterRelease: true });
    expect(idle).toMatchObject({
      stage: 'idle',
      currentTicketId: null,
      currentSessionId: null,
      lastSessionId: 'S-0001',
      pausedAfterRelease: true,
    });
    expect(agentMod.markSeen(idle, LATER).lastSeenAt).toBe(LATER);
    expect(agentMod.setStage(idle, 'testing').stage).toBe('testing');
  });
});

describe('session', () => {
  it('assigns per-session ordinals in write order and ends once', () => {
    let s = sess.startSession({
      number: 416,
      agentId: 'alpha',
      ticketId: 'T-1',
      model: 'm',
      now: NOW,
    });
    expect(s).toMatchObject({ id: 'S-0416', status: 'running', endedAt: null, entryCount: 0 });
    const r1 = sess.appendEntry(s, { at: NOW, type: 'system', text: 'Session started' });
    const r2 = sess.appendEntry(r1.session, { at: NOW, type: 'agent', text: 'hi' });
    expect([r1.entry.index, r2.entry.index]).toEqual([0, 1]);
    s = sess.endSession(r2.session, 'completed', LATER);
    expect(s).toMatchObject({ status: 'completed', endedAt: LATER, entryCount: 2 });
    expect(() => sess.endSession(s, 'failed', LATER)).toThrow(DomainRefusal);
    expect(() => sess.appendEntry(s, { at: LATER, type: 'agent' })).toThrow(DomainRefusal);
  });
});

describe('event builders', () => {
  const r = { at: NOW, ticketId: 'T-1', agentId: 'alpha', sessionId: 'S-0001' };

  it('builds operator summaries with display names', () => {
    expect(ev.ticketMoved(r, 'backlog', 'ready').payload.summary).toBe('Moved Backlog → Ready');
    expect(ev.ticketAssigned(r, 'ready')).toMatchObject({
      source: 'operator',
      category: 'ticket',
      warn: false,
      payload: { summary: 'Moved Ready → In Progress · assigned to alpha', claim: false },
    });
    expect(ev.ticketReleased(r, 'alpha').payload.summary).toBe(
      'Moved In Progress → Ready · released alpha',
    );
    expect(ev.ticketReopened(r, 'ready').payload.summary).toBe('Moved Done → Ready');
    expect(ev.ticketApproved(r, 'alpha').payload.summary).toBe('Approved T-1');
    expect(ev.ticketChangesRequested(r, 'fix', 'alpha').payload.summary).toBe(
      'Requested changes · “fix”',
    );
    expect(ev.ticketUnblocked(r, 'yes', 'alpha').payload.summary).toBe('Answered alpha · “yes”');
  });

  it('marks self-claims as agent_report with claim true', () => {
    expect(ev.ticketClaimed(r)).toMatchObject({
      source: 'agent_report',
      payload: { summary: 'Claimed T-1', claim: true, from: 'ready' },
    });
  });

  it('sets warn per catalogue rule', () => {
    expect(ev.ticketBlocked(r, 'q').warn).toBe(true);
    expect(ev.agentRefused(r, 'x').warn).toBe(true);
    expect(ev.toolFailed(r, 'Bash', 'npm test', 3, 'FAILED').warn).toBe(true);
    expect(ev.toolFailed(r, 'Bash', 'npm test', 3, 'FAILED').payload.summary).toBe(
      'Bash failed · npm test · FAILED',
    );
    expect(ev.toolFinished(r, 'Read', 'a', 1, 'ok').warn).toBe(false);
    expect(ev.healthChanged(r, 'online', 'stale').warn).toBe(true);
    expect(ev.healthChanged(r, 'offline', 'online').warn).toBe(false);
    expect(ev.healthChanged(r, 'online', 'stale').payload.summary).toBe('alpha is Stale');
    expect(ev.sessionEnded(r, 'failed').warn).toBe(true);
    expect(ev.sessionEnded(r, 'completed').warn).toBe(false);
    expect(ev.sessionEnded(r, 'completed').payload.summary).toBe('Session S-0001 completed');
  });

  it('uses the right source and category per family', () => {
    expect(ev.toolStarted(r, 'Read', 'a')).toMatchObject({
      source: 'agent_telemetry',
      category: 'tool',
    });
    expect(ev.stageChanged(r, 'idle', 'planning')).toMatchObject({
      source: 'agent_report',
      category: 'agent',
      payload: { summary: 'Stage → Planning' },
    });
    expect(ev.simulationStepped(r, 'step', LATER, ['alpha'])).toMatchObject({
      source: 'system',
      category: 'agent',
    });
    expect(ev.simulationPlayChanged(r, true)).toMatchObject({
      source: 'operator',
      category: 'agent',
    });
    expect(ev.ticketSubmitted(r, 's', 'PR #41').payload.summary).toBe(
      'Submitted for review · PR #41',
    );
    expect(ev.ticketUpdated(r, 'half', 35).payload.summary).toBe('Update · half · 35%');
    expect(ev.sessionStarted(r, 'm').payload.summary).toBe('Session S-0001 started');
  });
});

describe('token generation (prototype port)', () => {
  it('matches values computed from the prototype formulas', () => {
    const e = { type: 'tool', tool: 'Read', arg: 'src/a.ts', t: 42 };
    expect(hashK(e)).toBe(54199);
    expect(toolTok(e)).toEqual({ input: 5381, output: 99, cacheRead: 101881, cacheWrite: 2281 });
    const c = { type: 'system', text: 'Session started', t: 3 };
    expect(hashK(c)).toBe(42077);
    expect(ctxTok(c)).toEqual({ input: 3877, output: 0, cacheRead: 0, cacheWrite: 23387 });
  });

  it('is deterministic and non-negative for every tool family', () => {
    for (const tool of ['agent-ops.update', 'Read', 'Grep', 'Edit', 'Bash', 'Other']) {
      const e = { type: 'tool', tool, arg: 'x', t: 5, ok: false };
      expect(toolTok(e)).toEqual(toolTok(e));
      for (const v of Object.values(toolTok(e))) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('builds tool output like the prototype', () => {
    expect(toolOut({ type: 'tool', tool: 'Bash', arg: 'npm run typecheck', t: 1 })).toBe(
      '> tsc --noEmit\nFound 0 errors.',
    );
    expect(toolOut({ type: 'tool', tool: 'Bash', arg: 'npm test', t: 1, d: 4 })).toBe(
      '> vitest run\n ✓ 12 tests passed\nTime: 6.4 s',
    );
    expect(toolOut({ type: 'tool', tool: 'Grep', arg: '"x"', t: 1, result: '0 MATCHES' })).toBe(
      'no matches',
    );
    expect(toolOut({ type: 'tool', tool: 'Edit', arg: 'a', t: 1, d: 2 })).toContain(
      '@@ -12,4 +12,8 @@',
    );
    expect(toolOut({ type: 'tool', tool: 'Nope', arg: 'a', t: 1 })).toBeNull();
  });
});
