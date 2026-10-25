import { describe, expect, it } from 'vitest';
import { ticket as ticketRules } from '../../domain/index.js';
import { createPlayControl, HOLD_TTL_MS, PLAY_TICK_MS } from './play-control.js';
import { stepAll } from './step-all.js';
import { setup, T0 } from './step-agent.test.js';

function playSetup() {
  const p = setup();
  let nowMs = 1_000_000;
  const control = createPlayControl({ ...p.deps, scheduler: p.scheduler, realNowMs: () => nowMs });
  return { ...p, control, advanceReal: (ms: number) => (nowMs += ms) };
}

describe('ADR-0008: the simulator advances only on demand', () => {
  it('has Play off and writes nothing after construction', async () => {
    const p = playSetup();
    expect(p.control.isPlaying()).toBe(false);
    expect(p.scheduler.activeCount).toBe(0);
    await p.scheduler.tick();
    expect(p.publisher.events).toHaveLength(0);
    expect(p.store.data.simulation.clockAt).toBe(T0);
  });

  it('play emits play_changed, ticks step_all-style with mode play, pause stops the timer', async () => {
    const p = playSetup();
    await p.control.play();
    expect(PLAY_TICK_MS).toBe(1600);
    expect(p.publisher.events.map((e) => e.type)).toEqual(['simulation.play_changed']);
    await p.scheduler.tick();
    const stepped = p.publisher.events.filter((e) => e.type === 'simulation.stepped');
    expect(stepped).toHaveLength(1);
    expect(stepped[0]?.payload).toMatchObject({ mode: 'play' });
    expect(p.store.data.simulation.clockAt).toBe('2026-10-24T14:00:06.000Z');
    await p.control.pause();
    expect(p.scheduler.activeCount).toBe(0);
  });

  it('skips ticks while a hold is active and resumes on release or expiry (AC-56)', async () => {
    const p = playSetup();
    await p.control.play();
    p.control.setHold('c1', true);
    await p.scheduler.tick();
    expect(p.publisher.events.filter((e) => e.type === 'simulation.stepped')).toHaveLength(0);
    p.control.setHold('c1', false);
    await p.scheduler.tick();
    expect(p.publisher.events.filter((e) => e.type === 'simulation.stepped')).toHaveLength(1);
    p.control.setHold('c2', true);
    p.advanceReal(HOLD_TTL_MS + 1);
    await p.scheduler.tick();
    expect(p.publisher.events.filter((e) => e.type === 'simulation.stepped')).toHaveLength(2);
  });

  it('refuses a single Step while Play is on (AC-55) and lets idle agents claim in step_all', async () => {
    const p = playSetup();
    p.store.seedTicket({
      ...ticketRules.createTicket({ number: 13, title: 'Ready one', now: T0 }),
      status: 'ready',
    });
    const out = await stepAll({ ...p.deps, isPlaying: p.control.isPlaying }, 'step_all');
    expect(out.steps).toBe(1);
    expect(p.store.data.agents.get('sim-2')?.currentTicketId).toBe('T-13');
    expect(p.publisher.events.at(-1)?.payload).toMatchObject({ mode: 'step_all' });
    await p.control.play();
    await expect(
      stepAll({ ...p.deps, isPlaying: p.control.isPlaying }, 'step_all'),
    ).rejects.toMatchObject({ code: 'simulation_playing' });
  });
});
