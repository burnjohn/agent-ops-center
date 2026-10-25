import { describe, expect, it } from 'vitest';
import { EVENT_CATALOGUE, Event, EventType, isFeedEvent, isWarnEvent } from './events.js';

const HIDDEN = [
  'agent.heartbeat',
  'agent.health_changed',
  'session.started',
  'session.ended',
  'log.appended',
  'simulation.stepped',
  'simulation.play_changed',
];

const base = {
  seq: 1,
  at: '2026-10-24T14:32:00Z',
  realAt: '2026-10-24T14:32:00Z',
  agentId: 'alpha',
  ticketId: 'T-1',
  sessionId: 'S-0001',
};

describe('event catalogue', () => {
  it('has an entry per type and exactly 7 hidden types', () => {
    for (const t of EventType.options) expect(EVENT_CATALOGUE[t]).toBeDefined();
    const hidden = EventType.options.filter((t) => !EVENT_CATALOGUE[t].feed);
    expect([...hidden].sort()).toEqual([...HIDDEN].sort());
  });
  it('uses category agent for simulation events', () => {
    expect(EVENT_CATALOGUE['simulation.stepped'].category).toBe('agent');
    expect(EVENT_CATALOGUE['simulation.play_changed'].category).toBe('agent');
  });
  it('isFeedEvent follows the catalogue', () => {
    expect(isFeedEvent({ type: 'ticket.moved' })).toBe(true);
    expect(isFeedEvent({ type: 'agent.heartbeat' })).toBe(false);
  });
  it('applies warn rules', () => {
    expect(isWarnEvent({ type: 'agent.health_changed', payload: { to: 'online' } })).toBe(false);
    expect(isWarnEvent({ type: 'agent.health_changed', payload: { to: 'stale' } })).toBe(true);
    expect(isWarnEvent({ type: 'session.ended', payload: { status: 'failed' } })).toBe(true);
    expect(isWarnEvent({ type: 'session.ended', payload: { status: 'completed' } })).toBe(false);
    expect(isWarnEvent({ type: 'tool.failed', payload: {} })).toBe(true);
  });
});

describe('Event schema', () => {
  it('parses both ticket.assigned variants', () => {
    const op = {
      ...base,
      source: 'operator',
      category: 'ticket',
      type: 'ticket.assigned',
      warn: false,
      payload: {
        summary: 'x',
        from: 'backlog',
        agentId: 'alpha',
        sessionId: 'S-0001',
        claim: false,
      },
    };
    const claim = {
      ...base,
      source: 'agent_report',
      category: 'ticket',
      type: 'ticket.assigned',
      warn: false,
      payload: {
        summary: 'Claimed T-1',
        from: 'ready',
        agentId: 'alpha',
        sessionId: 'S-0001',
        claim: true,
      },
    };
    expect(Event.safeParse(op).success).toBe(true);
    expect(Event.safeParse(claim).success).toBe(true);
  });
  it('rejects unknown types and missing summary', () => {
    expect(
      Event.safeParse({
        ...base,
        source: 'system',
        category: 'agent',
        type: 'x.y',
        warn: false,
        payload: {},
      }).success,
    ).toBe(false);
    expect(
      Event.safeParse({
        ...base,
        source: 'agent_report',
        category: 'agent',
        type: 'agent.connected',
        warn: false,
        payload: {},
      }).success,
    ).toBe(false);
  });
});
