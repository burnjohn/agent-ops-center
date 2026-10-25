import { describe, expect, it } from 'vitest';
import { createSimScripts, scriptFor, ticketFiles } from './scripts.js';

const t = (n: number, priority: 'high' | 'medium' | 'low' = 'medium') => ({
  id: `T-${n}`,
  number: n,
  title: `Ticket ${n}`,
  priority,
});

describe('scriptFor (API-AC-48)', () => {
  it('Planning: read spec, grep keyword, plan message, report implementing', () => {
    const q = scriptFor('planning', t(13), false);
    expect(q.map((a) => a.kind)).toEqual(['tool', 'tool', 'message', 'stage']);
    expect(q[1]).toMatchObject({ tool: 'Grep', arg: '"ingest" src/' });
    expect(q[3]).toEqual({ kind: 'stage', to: 'implementing' });
  });

  it('Implementing blocks only for high priority that has not asked', () => {
    const kinds = (p: 'high' | 'medium', asked: boolean) =>
      scriptFor('implementing', t(13, p), asked).map((a) => a.kind);
    expect(kinds('high', false)).toContain('block');
    expect(kinds('high', true)).not.toContain('block');
    expect(kinds('medium', false)).not.toContain('block');
    expect(kinds('high', false)).toEqual([
      'tool',
      'tool',
      'update',
      'block',
      'tool',
      'message',
      'update',
      'stage',
    ]);
  });

  it('Testing: the test run fails on odd ticket numbers and the link is PR #<40+n>', () => {
    const odd = scriptFor('testing', t(13), false);
    const even = scriptFor('testing', t(12), false);
    expect(odd[0]).toMatchObject({ kind: 'tool', fail: true });
    expect(even[0]).toMatchObject({ kind: 'tool', fail: false });
    expect(odd.at(-1)).toMatchObject({ kind: 'submit', resultLink: 'PR #53 · feat/ingest' });
  });

  it('falls back to generic files for unknown tickets', () => {
    expect(ticketFiles({ id: 'T-99' })).toMatchObject({ kw: 't-99', a: 'src/features/t-99.ts' });
  });
});

describe('createSimScripts', () => {
  const base = { version: 1 as const, queue: [], askedTicketIds: ['T-1'], prngState: 5 };
  const ticket = {
    ...t(9),
    reviewComment: 'rename it',
    answer: 'yes',
  } as unknown as Parameters<ReturnType<typeof createSimScripts>['queuePlanning']>[1];

  it('queuePlanning replaces the queue and keeps asked ids and prng state', () => {
    const s = createSimScripts().queuePlanning(base, ticket);
    expect(s.queue[0]).toMatchObject({ kind: 'tool', tool: 'Read' });
    expect(s.askedTicketIds).toEqual(['T-1']);
    expect(s.prngState).toBe(5);
  });

  it('queueReadComment reads the comment then reports implementing', () => {
    const s = createSimScripts().queueReadComment(
      { ...base, queue: [{ kind: 'message', text: 'x' }] },
      ticket,
    );
    expect(s.queue).toEqual([
      { kind: 'read_comment', text: 'rename it' },
      { kind: 'stage', to: 'implementing' },
    ]);
  });

  it('queueReadAnswer puts the answer first and keeps the rest', () => {
    const s = createSimScripts().queueReadAnswer(
      { ...base, queue: [{ kind: 'message', text: 'x' }] },
      ticket,
    );
    expect(s.queue).toEqual([
      { kind: 'read_answer', text: 'yes' },
      { kind: 'message', text: 'x' },
    ]);
  });
});
