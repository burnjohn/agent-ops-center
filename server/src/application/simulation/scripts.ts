import type { AgentScript, ScriptAction } from '@agent-ops/shared';
import type { TicketState } from '../../domain/index.js';
import type { SimScripts } from '../services/ticket-work.js';

export type ScriptStage = 'planning' | 'implementing' | 'testing';

export interface TicketFiles {
  /** Keyword used in greps, test names and the result link. */
  kw: string;
  a: string;
  b: string;
  /** Question asked when a high-priority ticket blocks. */
  q: string;
}

const KNOWN: Record<string, readonly [string, string, string, string]> = {
  'T-12': [
    'stream',
    'src/stream/sse.ts',
    'src/stream/replay.ts',
    'Should replay cap at a maximum number of events?',
  ],
  'T-9': [
    'a11y',
    'web/src/board/keyboardMove.ts',
    'web/src/board/Card.tsx',
    'Should M also work inside the ticket view?',
  ],
  'T-8': [
    'seed',
    'src/sim/seed.ts',
    'src/sim/fixtures.ts',
    'Which priorities should the demo tickets cover?',
  ],
  'T-13': [
    'ingest',
    'src/telemetry/ingest.ts',
    'src/telemetry/limits.ts',
    'Should the rate limit be per agent or global?',
  ],
  'T-11': [
    'event-log',
    'web/src/mission/EventLog.tsx',
    'web/src/mission/format.ts',
    'Show duration in seconds or mm:ss?',
  ],
  'T-10': [
    'filters',
    'web/src/board/filters.ts',
    'web/src/board/Board.tsx',
    'Should filters be shareable between Operators?',
  ],
  'T-14': [
    'empty-state',
    'web/src/mission/Empty.tsx',
    'web/src/mission/MissionControl.tsx',
    'Link to docs or start a simulation directly?',
  ],
};

/** Prototype `files()`: per-ticket keyword, two files and the question. */
export function ticketFiles(ticket: Pick<TicketState, 'id'>): TicketFiles {
  const slug = ticket.id.toLowerCase();
  const m = KNOWN[ticket.id] ?? [
    slug,
    `src/features/${slug}.ts`,
    `test/${slug}.test.ts`,
    'Should this apply to simulated agents too?',
  ];
  return { kw: m[0], a: m[1], b: m[2], q: m[3] };
}

const tool = (name: string, arg: string, fail = false): ScriptAction => ({
  kind: 'tool',
  tool: name,
  arg,
  fail,
});

/**
 * Prototype `plan()` in §C7 form (API-AC-48). `asked` = the agent already blocked once on this ticket;
 * a `high` priority ticket blocks only when it has not asked before. Tests fail on odd ticket numbers.
 */
export function scriptFor(
  stage: ScriptStage,
  ticket: Pick<TicketState, 'id' | 'number' | 'title' | 'priority'>,
  asked: boolean,
): ScriptAction[] {
  const f = ticketFiles(ticket);
  if (stage === 'planning') {
    return [
      tool('Read', 'docs/specs/abstract-project-spec.md'),
      tool('Grep', `"${f.kw}" src/`),
      {
        kind: 'message',
        text: `Plan for ${ticket.id}: change ${f.a} and ${f.b}, then cover it with a focused test.`,
      },
      { kind: 'stage', to: 'implementing' },
    ];
  }
  if (stage === 'implementing') {
    return [
      tool('Read', f.a),
      tool('Edit', f.a),
      { kind: 'update', progress: 35, text: `First change in ${f.a}` },
      ...(ticket.priority === 'high' && !asked
        ? [{ kind: 'block', question: f.q } satisfies ScriptAction]
        : []),
      tool('Edit', f.b),
      { kind: 'message', text: 'Implementation is in place; moving on to tests.' },
      { kind: 'update', progress: 70, text: 'Implementation complete' },
      { kind: 'stage', to: 'testing' },
    ];
  }
  return [
    tool('Bash', `npm test -- ${f.kw}`, ticket.number % 2 === 1),
    { kind: 'update', progress: 85, text: 'Tests pass' },
    tool('Bash', 'npm run typecheck'),
    { kind: 'message', text: `All green. Submitting ${ticket.id} for review.` },
    {
      kind: 'submit',
      summary: `Implemented “${ticket.title}”. Changed ${f.a} and ${f.b}; tests and typecheck pass.`,
      resultLink: `PR #${40 + ticket.number} · feat/${f.kw}`,
    },
  ];
}

/** The `SimScripts` port implementation the composition root hands to the ticket commands. */
export function createSimScripts(): SimScripts {
  return {
    queuePlanning(script: AgentScript, ticket: TicketState): AgentScript {
      return {
        ...script,
        queue: scriptFor('planning', ticket, script.askedTicketIds.includes(ticket.id)),
      };
    },
    queueReadComment(script: AgentScript, ticket: TicketState): AgentScript {
      return {
        ...script,
        queue: [
          { kind: 'read_comment', text: ticket.reviewComment ?? '' },
          { kind: 'stage', to: 'implementing' },
        ],
      };
    },
    queueReadAnswer(script: AgentScript, ticket: TicketState): AgentScript {
      return {
        ...script,
        queue: [{ kind: 'read_answer', text: ticket.answer ?? '' }, ...script.queue],
      };
    },
  };
}
