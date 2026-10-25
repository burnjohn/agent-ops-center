import type { AgentScript } from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import { nextInt, nextRandom, nextState, normalizeSeed, PM_MODULUS } from './prng.js';

const script = (prngState: number): AgentScript => ({
  version: 1,
  queue: [],
  askedTicketIds: [],
  prngState,
});

describe('prng (Park–Miller)', () => {
  it('matches the prototype recurrence for the fixture seed', () => {
    expect(nextState(20261024)).toBe((20261024 * 16807) % PM_MODULUS);
  });

  it('is deterministic and keeps the state in the script', () => {
    const a = nextRandom(script(20261024));
    const b = nextRandom(script(20261024));
    expect(a).toEqual(b);
    expect(a.script.prngState).toBe(nextState(20261024));
    expect(a.value).toBeGreaterThanOrEqual(0);
    expect(a.value).toBeLessThan(1);
  });

  it('never reaches the absorbing state 0', () => {
    expect(normalizeSeed(0)).toBe(1);
    expect(normalizeSeed(PM_MODULUS)).toBe(1);
    let s = 1;
    for (let i = 0; i < 1000; i++) {
      s = nextState(s);
      expect(s).toBeGreaterThan(0);
    }
  });

  it('draws bounded integers', () => {
    let s = script(7);
    for (let i = 0; i < 200; i++) {
      const d = nextInt(s, 5);
      s = d.script;
      expect(d.value).toBeGreaterThanOrEqual(0);
      expect(d.value).toBeLessThan(5);
    }
  });
});
