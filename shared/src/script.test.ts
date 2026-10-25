import { describe, expect, it } from 'vitest';
import { AgentScript, ScriptAction } from './script.js';

describe('AgentScript', () => {
  it('parses every action kind', () => {
    const queue = [
      { kind: 'tool', tool: 'Read', arg: 'a.ts', fail: false },
      { kind: 'message', text: 'hi' },
      { kind: 'update', progress: 50, text: 'half' },
      { kind: 'stage', to: 'testing' },
      { kind: 'block', question: 'why?' },
      { kind: 'read_answer', text: 'because' },
      { kind: 'read_comment', text: 'fix' },
      { kind: 'submit', summary: 's', resultLink: 'l' },
    ];
    const s = AgentScript.parse({ version: 1, queue, askedTicketIds: ['T-1'], prngState: 42 });
    expect(s.queue).toHaveLength(8);
  });
  it('rejects bad version, progress, stage and unknown kind', () => {
    expect(
      AgentScript.safeParse({ version: 2, queue: [], askedTicketIds: [], prngState: 1 }).success,
    ).toBe(false);
    expect(ScriptAction.safeParse({ kind: 'update', progress: 101, text: '' }).success).toBe(false);
    expect(ScriptAction.safeParse({ kind: 'stage', to: 'planning' }).success).toBe(false);
    expect(ScriptAction.safeParse({ kind: 'nope' }).success).toBe(false);
  });
});
