import { describe, expect, it } from 'vitest';
import * as e from './enums.js';

describe('enums', () => {
  it('exposes the C1 values', () => {
    expect(e.TicketStatus.options).toEqual(['backlog', 'ready', 'in_progress', 'review', 'done']);
    expect(e.AgentStage.options).toEqual([
      'idle',
      'planning',
      'implementing',
      'testing',
      'awaiting_review',
    ]);
    expect(e.EventCategory.options).toEqual(['ticket', 'agent', 'tool']);
    expect(e.Period.options).toEqual(['today', '7d', '30d', 'all']);
    expect(e.TOKEN_ACTIVITIES).toHaveLength(7);
    expect(e.STEP_STOPS).toHaveLength(5);
  });
  it('rejects unknown values', () => {
    expect(e.EventCategory.safeParse('simulation').success).toBe(false);
    expect(e.AgentHealth.safeParse('Online').success).toBe(false);
  });
});
