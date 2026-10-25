import { describe, expect, it } from 'vitest';
import { AgentId, IsoTimestamp, Money, NonNegativeInt, SessionId, TicketId } from './primitives.js';

describe('primitives', () => {
  it('TicketId', () => {
    expect(TicketId.safeParse('T-1').success).toBe(true);
    expect(TicketId.safeParse('T-42').success).toBe(true);
    expect(TicketId.safeParse('T-01').success).toBe(false);
    expect(TicketId.safeParse('T-0').success).toBe(false);
    expect(TicketId.safeParse('X-3').success).toBe(false);
  });
  it('SessionId', () => {
    expect(SessionId.safeParse('S-0416').success).toBe(true);
    expect(SessionId.safeParse('S-10000').success).toBe(true);
    expect(SessionId.safeParse('S-12').success).toBe(false);
  });
  it('AgentId', () => {
    expect(AgentId.safeParse('sim-1').success).toBe(true);
    expect(AgentId.safeParse('Alpha').success).toBe(false);
    expect(AgentId.safeParse('').success).toBe(false);
  });
  it('IsoTimestamp, ints, money', () => {
    expect(IsoTimestamp.safeParse('2026-10-24T10:00:00.000Z').success).toBe(true);
    expect(IsoTimestamp.safeParse('yesterday').success).toBe(false);
    expect(NonNegativeInt.safeParse(-1).success).toBe(false);
    expect(NonNegativeInt.safeParse(1.5).success).toBe(false);
    expect(Money.safeParse(0.123456789).success).toBe(true);
    expect(Money.safeParse(-0.01).success).toBe(false);
  });
});
