import { describe, expect, it } from 'vitest';
import type { Event } from '@agent-ops/shared';
import { SseFanOut } from './fan-out.js';

const ev = (seq: number) => ({ seq }) as unknown as Event;

describe('SseFanOut', () => {
  it('delivers to all subscribers, isolates failures and unsubscribes', () => {
    const bus = new SseFanOut();
    const got: number[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    const off = bus.subscribe((events) => got.push(...events.map((e) => e.seq)));
    bus.publish([ev(1), ev(2)]);
    off();
    bus.publish([ev(3)]);
    expect(got).toEqual([1, 2]);
    expect(bus.size).toBe(1);
  });
});
