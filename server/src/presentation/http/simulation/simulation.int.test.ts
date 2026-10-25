/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP/DB JSON bodies are asserted structurally, not typed */
import { asc } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Container } from '../../../container.js';
import { events, sessionLogEntries, sessions } from '../../../infrastructure/db/schema.js';
import { buildTestApp } from '../../../../test/int/app.js';
import { freshFixture, openTestDb } from '../../../../test/int/db.js';

// Simulation HTTP integration (T41): real container + real Postgres, Fastify `inject`, no mocks.
// Play ticks are driven through the container's play control; the 1.6 s timer is used only in AC-54.

const handle = openTestDb();
let c: Container;

interface Res<T = any> {
  status: number;
  headers: Record<string, unknown>;
  body: T;
}

async function call(method: 'GET' | 'POST', url: string, payload?: unknown): Promise<Res> {
  const opts: InjectOptions = {
    method,
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  };
  const r = await c.app.inject(opts);
  return { status: r.statusCode, headers: r.headers, body: r.json() };
}
const post = (url: string, body: unknown = {}): Promise<Res> => call('POST', url, body);
const get = (url: string): Promise<Res> => call('GET', url);

const stepAll = (): Promise<Res> => post('/api/simulation/step');
const stepAgent = (
  agentId: string,
  ticketId: string,
  mode: 'step' | 'to_next_stage' = 'step',
): Promise<Res> => post(`/api/simulation/agents/${agentId}/step`, { ticketId, mode });

type Row = typeof events.$inferSelect;
async function journal(): Promise<Row[]> {
  return c.handle.db.select().from(events).orderBy(asc(events.seq));
}
async function maxSeq(): Promise<number> {
  const rows = await journal();
  return rows[rows.length - 1]?.seq ?? 0;
}
async function after(seq: number): Promise<Row[]> {
  return (await journal()).filter((e) => e.seq > seq);
}
const clockOf = async (): Promise<string> => (await get('/api/simulation')).body.clock as string;
const agentOf = async (id: string): Promise<any> =>
  ((await get('/api/agents')).body as any[]).find((a) => a.id === id);
const ticketOf = async (id: string): Promise<any> =>
  ((await get('/api/tickets')).body as any[]).find((t) => t.id === id);
const types = (rows: Row[]): string[] => rows.map((e) => e.type);

beforeEach(async () => {
  await freshFixture(handle.db);
  c = (await buildTestApp()) as unknown as Container;
});

describe('GET /api/simulation (API-AC-38/58 shape)', () => {
  it('returns the simulation state with X-As-Of-Seq equal to the journal head', async () => {
    // contract: the snapshot reports clock, play/hold flags, step length and carries the head seq header
    const res = await get('/api/simulation');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      playing: false,
      held: false,
      stepSeconds: 6,
      playIntervalMs: 1600,
      lastSeq: expect.any(Number),
      healthThresholds: { staleAfterSec: 30, offlineAfterSec: 120 },
    });
    expect(res.headers['x-as-of-seq']).toBe(String(await maxSeq()));
  });
});

describe('API-AC-43: nothing happens without a command', () => {
  it('idle server keeps the clock and the journal head unchanged', async () => {
    // contract: with Play off the server changes no state without a client command
    const seq = await maxSeq();
    const clock = await clockOf();
    await get('/api/agents');
    await get('/api/tickets');
    await new Promise((r) => setTimeout(r, 1800)); // longer than one Play interval
    expect(await maxSeq()).toBe(seq);
    expect(await clockOf()).toBe(clock);
  });
});

describe('API-AC-44: Next step commits one atomic step', () => {
  it('advances the clock by 6 s, journals log.appended per new entry and ends with simulation.stepped', async () => {
    // contract: one step = clock +6 s, one agent action, simulation.stepped last, one entry event per new log row
    const seq = await maxSeq();
    const clock = new Date(await clockOf()).getTime();
    const logsBefore = (await c.handle.db.select().from(sessionLogEntries)).length;
    const res = await stepAgent('alpha', 'T-12');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ steps: 1, stoppedBecause: 'single', seq: expect.any(Number) });

    expect(new Date(await clockOf()).getTime() - clock).toBe(6000);
    const batch = await after(seq);
    expect(batch[batch.length - 1]?.type).toBe('simulation.stepped');
    expect(batch[batch.length - 1]?.seq).toBe(res.body.seq);
    expect(batch[batch.length - 1]?.payload).toMatchObject({ mode: 'step' });
    // contiguous seqs: the whole step is one transaction
    expect(batch.map((e) => e.seq)).toEqual(batch.map((_, i) => seq + 1 + i));

    const logsAfter = (await c.handle.db.select().from(sessionLogEntries)).length;
    expect(batch.filter((e) => e.type === 'log.appended')).toHaveLength(logsAfter - logsBefore);
    expect(logsAfter).toBeGreaterThan(logsBefore);
  });
});

describe('API-AC-39/40/42: heartbeats and health on clock advances', () => {
  it('keeps responsive waiting agents online with journal-only heartbeats (20 steps of alpha)', async () => {
    // contract: a waiting responsive agent gets one agent.heartbeat per advance and never turns stale
    const seq = await maxSeq();
    let done = 0;
    for (let i = 0; i < 20; i++) {
      const ticket = (await agentOf('alpha')).currentTicketId as string | null;
      if (ticket === null) break;
      const r = await stepAgent('alpha', ticket);
      if (r.status !== 200) {
        // alpha blocked on its high-priority question: answer it and carry on
        expect(r.body).toMatchObject({ error: { code: 'cannot_step' } });
        await post(`/api/tickets/${ticket}/answer`, { answer: 'Go with the simplest option.' });
        continue;
      }
      done += 1;
    }
    expect(done).toBeGreaterThanOrEqual(10);
    const batch = await after(seq);
    const sim1 = batch.filter((e) => e.type === 'agent.heartbeat' && e.agentId === 'sim-1');
    expect(sim1).toHaveLength(done);
    expect((await agentOf('sim-1')).health).toBe('online');
    // heartbeats are journal-only: absent from the feed
    const feed = (await get('/api/events?limit=200')).body;
    expect(JSON.stringify(feed)).not.toContain('agent.heartbeat');
  });

  /** Advances the clock `n` times with single-agent steps of alpha/bravo (sim-2 and sim-3 never act). */
  async function advanceWithRealAgents(n: number): Promise<void> {
    let done = 0;
    for (let guard = 0; done < n && guard < n * 4; guard++) {
      for (const id of ['alpha', 'bravo']) {
        if (done >= n) break;
        const ticketId = (await agentOf(id)).currentTicketId as string | null;
        if (ticketId === null) continue;
        const r = await stepAgent(id, ticketId);
        if (r.status === 200) done += 1;
        else if ((await ticketOf(ticketId)).blockedQuestion)
          await post(`/api/tickets/${ticketId}/answer`, { answer: 'Proceed.' });
      }
    }
    expect(done).toBe(n);
  }

  it('never refreshes the unresponsive sim-3 and degrades sim-2 to offline after 12 advances with one health event', async () => {
    // contract: stale agents are not refreshed; sim-2 (gap 48 s) crosses 120 s on the 12th advance, once
    const seq = await maxSeq();
    const sim3Seen = (await agentOf('sim-3')).lastSeenAt;
    await advanceWithRealAgents(11);
    expect((await agentOf('sim-2')).health).toBe('stale');
    expect(
      (await after(seq)).filter((e) => e.type === 'agent.health_changed' && e.agentId === 'sim-2'),
    ).toHaveLength(0);
    await advanceWithRealAgents(1);
    expect((await agentOf('sim-2')).health).toBe('offline');
    const changes = (await after(seq)).filter(
      (e) => e.type === 'agent.health_changed' && e.agentId === 'sim-2',
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.payload).toMatchObject({ from: 'stale', to: 'offline' });
    expect((await agentOf('sim-3')).lastSeenAt).toBe(sim3Seen);
  });

  it('degrades the stale sim-2 to offline after 12 simulation-wide steps (AC-40)', async () => {
    // contract: a stale agent is never refreshed, whichever step kind advances the clock
    for (let i = 0; i < 12; i++) expect((await stepAll()).status).toBe(200);
    expect((await agentOf('sim-2')).health).toBe('offline');
  });
});

describe('API-AC-41: offline agent with a running session', () => {
  it('fails the session with the interrupted entry on the next advance (approve T-6, assign sim-3)', async () => {
    // contract: assigning the unresponsive offline sim-3 opens a session that the next advance fails
    const approve = await post('/api/tickets/T-6/move', { to: 'done', expectedStatus: 'review' });
    expect(approve.status).toBe(200);
    const assign = await post('/api/tickets/T-14/assign', {
      agentId: 'sim-3',
      expectedStatus: 'backlog',
    });
    expect(assign.status).toBe(200);
    const sessionId = (await agentOf('sim-3')).currentSessionId as string;
    expect(sessionId).toEqual(expect.any(String));

    const seq = await maxSeq();
    expect((await stepAll()).status).toBe(200);
    const batch = await after(seq);
    expect(types(batch)).toContain('session.ended');

    const rows = await c.handle.db.select().from(sessions);
    expect(rows.find((s) => s.id === sessionId)).toMatchObject({ status: 'failed' });
    const logs = (await c.handle.db.select().from(sessionLogEntries)).filter(
      (l) => l.sessionId === sessionId,
    );
    expect(JSON.stringify(logs)).toContain('Session interrupted — agent went Offline');
  });
});

describe('API-AC-45: cannot_step reasons', () => {
  it.each([
    ['bravo', 'T-12', 'bravo is no longer on T-12.'],
    ['sim-2', 'T-7', 'Waiting for your review'],
    ['sim-1', 'T-8', 'Blocked — answer above to continue'],
  ])('refuses %s on %s with a 409 and the reason', async (agentId, ticketId, reason) => {
    // contract: refusal is 409 cannot_step carrying the exact reason and writes nothing
    const seq = await maxSeq();
    const res = await stepAgent(agentId, ticketId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'cannot_step', reason });
    const run = await stepAgent(agentId, ticketId, 'to_next_stage');
    expect(run.status).toBe(409);
    expect(await maxSeq()).toBe(seq);
  });

  it('reports "<agent> is not responding." for an assigned unresponsive agent', async () => {
    // contract: sim-3 holding an In Progress ticket cannot be stepped
    await post('/api/tickets/T-6/move', { to: 'done', expectedStatus: 'review' });
    await post('/api/tickets/T-14/assign', { agentId: 'sim-3', expectedStatus: 'backlog' });
    const res = await stepAgent('sim-3', 'T-14');
    expect(res.status).toBe(409);
    expect(res.body.error.reason).toBe('sim-3 is not responding.');
  });
});

describe('API-AC-46: run to next stage', () => {
  it('steps until the stage changes and reports steps and the stop reason', async () => {
    // contract: alpha stops as soon as its stage differs from the one it started in
    const before = (await agentOf('alpha')).stage as string;
    const seq = await maxSeq();
    const res = await stepAgent('alpha', 'T-12', 'to_next_stage');
    expect(res.status).toBe(200);
    expect(
      res.body.stoppedBecause === 'stage_changed' || res.body.stoppedBecause === 'waiting',
    ).toBe(true);
    expect(res.body.steps).toBeGreaterThanOrEqual(1);
    const stepped = (await after(seq)).filter((e) => e.type === 'simulation.stepped');
    expect(stepped).toHaveLength(res.body.steps);
    expect(stepped.every((e) => (e.payload as any).mode === 'to_next_stage')).toBe(true);
    if (res.body.stoppedBecause === 'stage_changed')
      expect((await agentOf('alpha')).stage).not.toBe(before);
    else expect((await ticketOf('T-12')).blockedQuestion).toBeTruthy();
  });
});

describe('API-AC-47..53: scripted T-13 run by a claiming agent', () => {
  it('claims, blocks once, fails a tool once, submits the PR and refuses after a release', async () => {
    // contract: charlie claims the high Ready ticket T-13, blocks once, fails the tests once (odd id), submits PR #53
    const seq = await maxSeq();
    // step-all until somebody claims T-13 (cooldowns / ordering may take a few steps)
    for (let i = 0; i < 5 && (await ticketOf('T-13')).status === 'ready'; i++) await stepAll();
    const t13 = await ticketOf('T-13');
    expect(t13.status).toBe('in_progress');
    const claimer = t13.agentId ?? t13.assigneeId ?? t13.agent?.id;
    expect(claimer).toEqual(expect.any(String));
    const claim = (await after(seq)).find(
      (e) => e.type === 'ticket.assigned' && e.ticketId === 'T-13',
    );
    expect(claim?.source).toBe('agent_report');
    expect(claim?.payload).toMatchObject({ claim: true });

    // drive the agent to completion, answering its question once
    for (let guard = 0; guard < 60 && (await ticketOf('T-13')).status === 'in_progress'; guard++) {
      const r = await stepAgent(claimer, 'T-13');
      if (r.status === 409) {
        expect(r.body.error.reason).toBe('Blocked — answer above to continue');
        expect(
          (await post('/api/tickets/T-13/answer', { answer: 'Use a token bucket.' })).status,
        ).toBe(200);
      }
    }
    const done = await ticketOf('T-13');
    expect(done.status).toBe('review');
    expect(JSON.stringify(done)).toContain('PR #53 · feat/ingest');

    const mine = (await after(seq)).filter((e) => e.ticketId === 'T-13');
    expect(types(mine).filter((t) => t === 'ticket.blocked')).toHaveLength(1);
    expect(types(mine).filter((t) => t === 'tool.failed')).toHaveLength(1);
    expect(types(mine)).toEqual(
      expect.arrayContaining(['ticket.submitted', 'session.ended', 'agent.stage_changed']),
    );
    // AC-53: agents never set Done
    expect(mine.some((e) => e.type === 'ticket.moved' && (e.payload as any).to === 'done')).toBe(
      false,
    );
  });

  it('answers a refusal into the new session after release then assign (PDR-0006)', async () => {
    // contract: after a release the agent's next step is a refusal, written into the newly assigned session
    const res = await post('/api/tickets/T-12/move', {
      to: 'ready',
      expectedStatus: 'in_progress',
      confirmed: true,
    });
    expect(res.body).toMatchObject({ seq: expect.any(Number) });
    expect(res.status).toBe(200);
    expect((await agentOf('alpha')).pausedAfterRelease).toBe(true);
    const assign = await post('/api/tickets/T-11/assign', {
      agentId: 'alpha',
      expectedStatus: 'ready',
    });
    expect(assign.status).toBe(200);
    const newSession = (await agentOf('alpha')).currentSessionId as string;

    const seq = await maxSeq();
    expect((await stepAgent('alpha', 'T-11')).status).toBe(200);
    const batch = await after(seq);
    const refused = batch.find((e) => e.type === 'agent.refused');
    expect(refused).toMatchObject({ agentId: 'alpha', warn: true });
    const logs = (await c.handle.db.select().from(sessionLogEntries)).filter(
      (l) => l.sessionId === newSession,
    );
    expect(JSON.stringify(logs)).toContain('agent-ops refused the update');
    expect((await agentOf('alpha')).pausedAfterRelease).toBe(false);
  });
});

describe('API-AC-54/55/56: Play, Step and holds', () => {
  it('Step is refused while Play is on, and Play/Pause emit one event each and are no-ops when unchanged', async () => {
    // contract: play_changed only on a real change; header Step refused with simulation_playing while playing
    const seq = await maxSeq();
    expect((await post('/api/simulation/pause')).body.playing).toBe(false);
    expect(await maxSeq()).toBe(seq);
    const play = await post('/api/simulation/play');
    expect(play.body).toMatchObject({ playing: true, seq: expect.any(Number) });
    await post('/api/simulation/play');
    const refused = await stepAll();
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('simulation_playing');
    expect((await get('/api/simulation')).body.playing).toBe(true);
    await post('/api/simulation/pause');
    const changes = (await after(seq)).filter((e) => e.type === 'simulation.play_changed');
    expect(changes).toHaveLength(2);
    expect(changes.map((e) => (e.payload as any).playing)).toEqual([true, false]);
    expect((await stepAll()).status).toBe(200);
  });

  it('plays about 5 s of real time as ~3 play steps, each advancing the clock by 6 s', async () => {
    // contract: one simulation-wide step per 1.6 s while Play is on; each marks mode "play"
    const seq = await maxSeq();
    const clock = new Date(await clockOf()).getTime();
    await post('/api/simulation/play');
    await new Promise((r) => setTimeout(r, 5100));
    await post('/api/simulation/pause');
    const plays = (await after(seq)).filter(
      (e) => e.type === 'simulation.stepped' && (e.payload as any).mode === 'play',
    );
    expect(plays.length).toBeGreaterThanOrEqual(3);
    expect(plays.length).toBeLessThanOrEqual(4);
    expect(new Date(await clockOf()).getTime() - clock).toBe(plays.length * 6000);
  }, 15_000);

  it('a hold blocks Play ticks, release resumes them, and holds write no event', async () => {
    // contract: while any client holds, ticks are skipped; hold/release journal nothing
    const clientId = '11111111-1111-4111-8111-111111111111';
    await post('/api/simulation/play');
    const seq = await maxSeq();
    const held = await post('/api/simulation/hold', { clientId, held: true });
    expect(held.body).toMatchObject({ held: true, expiresAt: expect.any(String) });
    expect((await get('/api/simulation')).body.held).toBe(true);
    expect(await maxSeq()).toBe(seq);
    await new Promise((r) => setTimeout(r, 3400));
    expect(await maxSeq()).toBe(seq);
    const rel = await post('/api/simulation/hold', { clientId, held: false });
    expect(rel.body).toEqual({ held: false, expiresAt: null });
    expect((await get('/api/simulation')).body.held).toBe(false);
    await new Promise((r) => setTimeout(r, 2000));
    await post('/api/simulation/pause');
    expect(
      types(await after(seq)).filter((t) => t === 'simulation.stepped').length,
    ).toBeGreaterThanOrEqual(1);
  }, 15_000);

  it('a hold expires 15 s after it was granted', async () => {
    // contract: expiry is 15 s after the last grant (expiresAt is wall clock); verified without waiting 15 s
    const before = Date.now();
    const held = await post('/api/simulation/hold', {
      clientId: '22222222-2222-4222-8222-222222222222',
      held: true,
    });
    const delta = new Date(held.body.expiresAt as string).getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(14_900);
    expect(delta).toBeLessThanOrEqual(16_000);
  });
});

describe('API-AC-57: determinism', () => {
  const normalise = (rows: Row[]): unknown[] => {
    const base = rows[0]?.seq ?? 0;
    return rows.map((e) => ({ ...e, seq: e.seq - base, realAt: undefined }));
  };
  async function run(): Promise<unknown[]> {
    const seq = await maxSeq();
    await stepAll();
    await stepAll();
    await stepAgent('alpha', 'T-12');
    await post('/api/tickets/T-13/assign', { agentId: 'charlie', expectedStatus: 'ready' });
    await stepAgent('charlie', 'T-13', 'to_next_stage');
    await stepAll();
    return normalise(await after(seq));
  }

  it('replays the same commands on a fresh database into an identical journal (ignoring realAt, absolute seq)', async () => {
    // contract: same data + same command sequence => same events (types, payloads, at, ids) in the same order
    const first = await run();
    await c.close();
    await freshFixture(handle.db);
    c = (await buildTestApp()) as unknown as Container;
    const second = await run();
    expect(first.length).toBeGreaterThan(10);
    expect(second).toEqual(first);
  });
});
