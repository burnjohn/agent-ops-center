import { describe, expect, it } from 'vitest';
import { ticket as ticketRules, type TicketState } from '../../domain/index.js';
import { stepAvailability } from './step-availability.js';

const T0 = '2026-10-24T14:00:00.000Z';
const ticket = (patch: Partial<TicketState> = {}): TicketState => ({
  ...ticketRules.createTicket({ number: 8, title: 'x', now: T0 }),
  status: 'in_progress',
  assigneeId: 'sim-1',
  ...patch,
});
const agent = { id: 'sim-1', currentTicketId: 'T-8' as string | null, currentTool: null };
const sim = (queueLen: number, silent = false) => ({
  silent,
  script: {
    version: 1 as const,
    queue: Array.from({ length: queueLen }, () => ({ kind: 'message' as const, text: '' })),
    askedTicketIds: [],
    prngState: 1,
  },
});

describe('stepAvailability (API-AC-45)', () => {
  it('is available with queued work', () => {
    expect(stepAvailability({ agent, ticket: ticket(), sim: sim(2) })).toEqual({
      available: true,
      reason: null,
    });
  });
  it('is available with only a running tool', () => {
    const a = { ...agent, currentTool: { name: 'Bash', arg: 'x', startedAt: T0 } };
    expect(stepAvailability({ agent: a, ticket: ticket(), sim: sim(0) }).available).toBe(true);
  });
  it('no longer on the named ticket', () => {
    expect(stepAvailability({ agent, ticketId: 'T-9', ticket: ticket(), sim: sim(1) }).reason).toBe(
      'sim-1 is no longer on T-9.',
    );
    expect(
      stepAvailability({
        agent: { ...agent, currentTicketId: null },
        ticketId: 'T-8',
        ticket: null,
        sim: sim(1),
      }).reason,
    ).toBe('sim-1 is no longer on T-8.');
  });
  it('Review and other statuses', () => {
    expect(
      stepAvailability({ agent, ticket: ticket({ status: 'review' }), sim: sim(1) }).reason,
    ).toBe('Waiting for your review');
    expect(
      stepAvailability({ agent, ticket: ticket({ status: 'done' }), sim: sim(1) }).reason,
    ).toBe('T-8 is not In Progress.');
  });
  it('Blocked, unresponsive, nothing left', () => {
    expect(
      stepAvailability({ agent, ticket: ticket({ blockedQuestion: 'q?' }), sim: sim(1) }).reason,
    ).toBe('Blocked — answer above to continue');
    expect(stepAvailability({ agent, ticket: ticket(), sim: sim(1, true) }).reason).toBe(
      'sim-1 is not responding.',
    );
    expect(stepAvailability({ agent, ticket: ticket(), sim: sim(0) }).reason).toBe(
      'sim-1 has nothing left to do on T-8.',
    );
  });
  it('no ticket and none named: unavailable without a reason', () => {
    expect(
      stepAvailability({ agent: { ...agent, currentTicketId: null }, ticket: null, sim: sim(0) }),
    ).toEqual({ available: false, reason: null });
  });
});
