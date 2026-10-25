import { describe, expect, it } from 'vitest';
import { tokenActivityOf } from './token-activity.js';

describe('tokenActivityOf', () => {
  it.each([
    [{ type: 'agent' }, 'reasoning_replies'],
    [{ type: 'tool', tool: 'Read' }, 'reading_code'],
    [{ type: 'tool', tool: 'Grep' }, 'reading_code'],
    [{ type: 'tool', tool: 'Edit' }, 'editing_code'],
    [{ type: 'tool', tool: 'Bash' }, 'running_commands'],
    [{ type: 'tool', tool: 'agent-ops.report' }, 'agent_ops'],
    [{ type: 'tool', tool: 'Write' }, 'other'],
    [{ type: 'system', text: 'Session started · model x' }, 'session_context'],
    [{ type: 'system', text: 'Ticket released by Operator' }, 'other'],
    [{ type: 'stage' }, 'other'],
    [{ type: 'operator' }, 'other'],
  ] as const)('%j -> %s', (entry, activity) => {
    expect(tokenActivityOf(entry)).toBe(activity);
  });
});
