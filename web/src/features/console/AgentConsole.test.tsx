import {
  AgentListResponse,
  AgentStepResult,
  SessionDetail,
  TicketDetailResponse,
  type Agent,
  type LogEntry,
  type SessionSummary,
  type Ticket,
} from '@agent-ops/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeEventSource } from '../../test/FakeEventSource';
import {
  createFakeNetwork,
  errorResponse,
  jsonResponse,
  type FakeNetwork,
} from '../../test/fakeNetwork';
import {
  SEED_LAST_SEQ,
  buildEvent,
  seedAgents,
  seedEvents,
  seedSessionDetail,
  seedSessionSummaries,
  seedSessionSummary,
  seedTickets,
} from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

interface Setup {
  ticket?: Partial<Ticket>;
  /** Patches per agent id. */
  agents?: Record<string, Partial<Agent>>;
  /** Replaces the ticket's sessions (newest first). */
  sessions?: SessionSummary[];
}

/** Ticket detail with sessions newest first (API-AC-24), agents patched per test. */
function consoleNet(id: string, setup: Setup = {}): FakeNetwork {
  const net = createFakeNetwork();
  net.on('GET', `/tickets/${id}`, () => {
    const ticket = { ...seedTickets().find((t) => t.id === id)!, ...setup.ticket };
    const sessions =
      setup.sessions ??
      seedSessionSummaries()
        .filter((s) => s.ticketId === id)
        .reverse();
    const activity = seedEvents()
      .filter((e) => e.ticketId === id)
      .reverse();
    return jsonResponse(
      TicketDetailResponse,
      { ticket, activity, sessions, dataSource: 'mock' },
      { asOfSeq: SEED_LAST_SEQ },
    );
  });
  net.on('GET', '/agents', () =>
    jsonResponse(
      AgentListResponse,
      seedAgents().map((a) => ({ ...a, ...setup.agents?.[a.id] })),
      { asOfSeq: SEED_LAST_SEQ },
    ),
  );
  return net;
}

async function openConsole(
  id: string,
  setup: Setup = {},
  net: FakeNetwork = consoleNet(id, setup),
) {
  const app = renderApp({ route: `/tickets/${id}`, network: net });
  await screen.findByRole('heading', { name: 'D — Agent console' });
  return app;
}

const consoleSection = () =>
  screen.getByRole('heading', { name: 'D — Agent console' }).closest('section')!;
const rowTimes = (log: HTMLElement) => within(log).queryAllByText(/^\d\d:\d\d:\d\d$/);

const STEPPABLE = { alpha: { step: { available: true, reason: null }, currentTool: null } };

describe('tabs, meta line and links (UI-AC-77, AC-78)', () => {
  it('shows tabs for T-12 with ● on the running one, the meta line and FULL LOG to the selected session', async () => {
    await openConsole('T-12');
    const tabs = within(
      screen.getByRole('tablist', { name: 'Sessions of this ticket' }),
    ).getAllByRole('tab');

    // Contract: newest first, `●` after a Running one; default selection is the agent's Running session.
    expect(tabs.map((t) => t.textContent)).toEqual(['S-0412 ●', 'S-0409']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');

    // Contract: meta `<session> · <agent> · <model> · <day> <hh:mm> · N entries · $<cost>` (+ so far when Running).
    expect(
      within(consoleSection()).getByText(
        /^S-0412 · alpha · sonnet-5-5 · Today 14:00 · 13 entries · \$0\.00 so far$/,
      ),
    ).toBeInTheDocument();
    expect(within(consoleSection()).getByRole('link', { name: 'FULL LOG →' })).toHaveAttribute(
      'href',
      '/sessions/S-0412',
    );
  });

  it('switching tabs updates meta, FULL LOG and the log; completed sessions have no «so far» and no tail', async () => {
    const { user } = await openConsole('T-12');
    await user.click(screen.getByRole('tab', { name: 'S-0409' }));

    expect(screen.getByRole('tab', { name: 'S-0409' })).toHaveAttribute('aria-selected', 'true');
    expect(
      await within(consoleSection()).findByText(
        /^S-0409 · alpha · sonnet-5-5 · Today 11:20 · 19 entries · \$0\.00$/,
      ),
    ).toBeInTheDocument();
    expect(within(consoleSection()).getByRole('link', { name: 'FULL LOG →' })).toHaveAttribute(
      'href',
      '/sessions/S-0409',
    );
    // Contract: the tail line exists only for a Running session.
    expect(
      within(screen.getByRole('log', { name: 'Agent console' })).queryByText(/^▍/),
    ).not.toBeInTheDocument();
  });

  it('keeps the Operator tab choice for the ticket while the app stays open', async () => {
    const first = await openConsole('T-12');
    await first.user.click(screen.getByRole('tab', { name: 'S-0409' }));
    first.unmount();

    // Contract: a second visit to the same ticket reselects the chosen tab, not the default Running one.
    await openConsole('T-12');
    expect(screen.getByRole('tab', { name: 'S-0409' })).toHaveAttribute('aria-selected', 'true');
  });

  it('caps tabs at the 5 newest sessions and selects the newest when none is Running', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      ...seedSessionSummary('S-0409'),
      id: `S-05${String(7 - i).padStart(2, '0')}`,
    }));
    await openConsole('T-12', { sessions: many });
    // Contract: only the 5 newest sessions get tabs; the first (newest) is selected when nothing is Running.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'S-0507',
      'S-0506',
      'S-0505',
      'S-0504',
      'S-0503',
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });
});

describe('terminal rendering (UI-AC-79, AC-80)', () => {
  it('is a focusable log region labelled «Agent console»', async () => {
    await openConsole('T-12');
    const log = screen.getByRole('log', { name: 'Agent console' });
    expect(log).toHaveAttribute('tabindex', '0');
  });

  it('renders S-0409 rows: stage dividers, tool tags by outcome, results, token lines and full output', async () => {
    const { user } = await openConsole('T-12');
    await user.click(screen.getByRole('tab', { name: 'S-0409' }));
    const log = screen.getByRole('log', { name: 'Agent console' });
    await within(log).findByText('── PLANNING ──');

    // Contract: stage rows read `── <STAGE> ──`.
    for (const stage of ['PLANNING', 'IMPLEMENTING', 'TESTING']) {
      expect(within(log).getByText(`── ${stage} ──`)).toBeInTheDocument();
    }
    // Contract: one row per entry (19) with an hh:mm:ss time.
    expect(rowTimes(log)).toHaveLength(19);
    // Contract: failed tools differ by tag text (`✗ tool`), not only colour; successful ones are `$ tool`.
    expect(within(log).getAllByText('✗ tool')).toHaveLength(2);
    expect(within(log).getAllByText('$ tool').length).toBeGreaterThan(0);
    expect(within(log).getAllByText('operator')).toHaveLength(1);
    expect(within(log).getAllByText('system')).toHaveLength(2);
    // Contract: tool rows read `<tool>  <argument>` with a `→ <result> · Ns` line.
    expect(within(log).getAllByText(/^→ .+ · \d+s$/).length).toBeGreaterThan(0);
    // Contract: token line `<in> in · <out> out · <cache read> cache · $<step cost>`.
    expect(
      within(log).getAllByText(/^[\d.]+K? in · [\d.]+K? out · [\d.]+K? cache · \$\d+\.\d\d$/)
        .length,
    ).toBeGreaterThan(0);
    // Contract: the full tool output is shown in a pre-formatted block.
    const expected = seedSessionDetail('S-0409').entries.find(
      (e) => e.tool && !e.tool.ok && e.tool.output,
    )!;
    const pre = within(log).getAllByText((_, el) => el?.tagName === 'PRE');
    expect(pre.some((p) => p.textContent === expected.tool!.output)).toBe(true);
  });

  it('renders entry text as plain text, never markup', async () => {
    const net = consoleNet('T-12');
    const detail = seedSessionDetail('S-0412');
    const hostile: LogEntry = {
      ...detail.entries[1]!,
      index: 99,
      type: 'agent',
      text: '<b>bold</b><img src=x onerror=alert(1)>',
      tool: null,
      tokens: null,
      costUsd: null,
    };
    net.on(
      'GET',
      '/sessions/S-0412',
      jsonResponse(SessionDetail, { ...detail, entries: [hostile] }, { asOfSeq: SEED_LAST_SEQ }),
    );
    await openConsole('T-12', {}, net);
    const log = screen.getByRole('log', { name: 'Agent console' });
    expect(
      await within(log).findByText('<b>bold</b><img src=x onerror=alert(1)>'),
    ).toBeInTheDocument();
    expect(within(log).queryByRole('img')).toBeNull();
    expect(log.getElementsByTagName('b')).toHaveLength(0);
  });
});

describe('tail line (UI-AC-81)', () => {
  it.each([
    ['tool running', 'T-12', {}, 'Edit src/stream/sse.ts … running'],
    ['step possible', 'T-12', STEPPABLE, 'waiting for the next step'],
    [
      'agent on other work',
      'T-12',
      { alpha: { currentTicketId: 'T-9', currentSessionId: 'S-0413' } },
      'session open, agent is on other work',
    ],
    [
      'idle',
      'T-12',
      { alpha: { currentTool: null, step: { available: false, reason: null } } },
      'idle',
    ],
    ['blocked', 'T-8', {}, 'waiting for your answer above'],
  ] as const)('shows the %s state', async (_name, id, agents, text) => {
    await openConsole(id, { agents: agents as Record<string, Partial<Agent>> });
    // Contract: tail is `▍ <state>` for a Running session.
    expect(
      await within(screen.getByRole('log', { name: 'Agent console' })).findByText(`▍ ${text}`),
    ).toBeInTheDocument();
  });
});

describe('step controls (UI-AC-82…85)', () => {
  it('shows NEXT STEP, RUN TO NEXT STAGE and the hint for an In Progress ticket whose agent can step', async () => {
    await openConsole('T-12', { agents: STEPPABLE });
    const section = consoleSection();
    expect(await within(section).findByRole('button', { name: /NEXT STEP/ })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /RUN TO NEXT STAGE/ })).toBeInTheDocument();
    expect(within(section).getByText('Agents only move when you step them')).toBeInTheDocument();
  });

  it('sends Next step and Run to next stage for the assigned agent and ticket', async () => {
    const net = consoleNet('T-12', { agents: STEPPABLE });
    net.on(
      'POST',
      '/simulation/agents/alpha/step',
      jsonResponse(AgentStepResult, { seq: 45, steps: 1, stoppedBecause: 'single' }),
    );
    const { user } = await openConsole('T-12', {}, net);

    await user.click(await screen.findByRole('button', { name: /NEXT STEP/ }));
    await waitFor(() => expect(net.calls('POST', '/simulation/agents/alpha/step')).toHaveLength(1));
    // Contract: step mode `step`, bound to this ticket.
    expect(net.calls('POST', '/simulation/agents/alpha/step')[0]?.body).toEqual({
      ticketId: 'T-12',
      mode: 'step',
    });

    await user.click(screen.getByRole('button', { name: /RUN TO NEXT STAGE/ }));
    await waitFor(() => expect(net.calls('POST', '/simulation/agents/alpha/step')).toHaveLength(2));
    expect(net.calls('POST', '/simulation/agents/alpha/step')[1]?.body).toEqual({
      ticketId: 'T-12',
      mode: 'to_next_stage',
    });
  });

  it('shows a command failure as an alert next to the controls', async () => {
    const net = consoleNet('T-12', { agents: STEPPABLE });
    net.on(
      'POST',
      '/simulation/agents/alpha/step',
      errorResponse(409, 'stale_state', 'alpha cannot step now.'),
    );
    const { user } = await openConsole('T-12', {}, net);
    await user.click(await screen.findByRole('button', { name: /NEXT STEP/ }));
    expect(await within(consoleSection()).findByRole('alert')).toHaveTextContent(
      'alpha cannot step now.',
    );
  });

  it('hides the buttons and shows step.reason verbatim when the agent cannot step (sim-3)', async () => {
    await openConsole('T-6', {
      ticket: { status: 'in_progress' },
      agents: {
        'sim-3': {
          currentTicketId: 'T-6',
          step: { available: false, reason: 'sim-3 is not responding.' },
        },
      },
    });
    const section = consoleSection();
    // Contract: reason text is the server's, shown verbatim; no step buttons.
    expect(await within(section).findByText('sim-3 is not responding.')).toBeInTheDocument();
    expect(
      within(section).queryByRole('button', { name: /NEXT STEP|RUN TO NEXT STAGE/ }),
    ).not.toBeInTheDocument();
  });

  it('hides the buttons and shows «Blocked — answer above to continue» for a Blocked ticket (T-8), even if the agent can step', async () => {
    await openConsole('T-8', { agents: { 'sim-1': { step: { available: true, reason: null } } } });
    const section = consoleSection();
    expect(
      await within(section).findByText('Blocked — answer above to continue'),
    ).toBeInTheDocument();
    expect(
      within(section).queryByRole('button', { name: /NEXT STEP|RUN TO NEXT STAGE/ }),
    ).not.toBeInTheDocument();
  });

  it('shows «Waiting for your review» for a Review ticket whose session has already ended (T-7, U-4)', async () => {
    await openConsole('T-7');
    const section = consoleSection();
    // Contract: hint shown regardless of whether a session is still open (U-4 supersedes the prototype).
    expect(await within(section).findByText('Waiting for your review')).toBeInTheDocument();
    expect(
      within(section).queryByRole('button', { name: /NEXT STEP|RUN TO NEXT STAGE/ }),
    ).not.toBeInTheDocument();
  });
});

describe('empty state (UI-AC-87)', () => {
  it('shows the empty copy and no tabs or controls for a ticket without sessions (T-14)', async () => {
    await openConsole('T-14');
    const section = consoleSection();
    expect(
      within(section).getByText(
        'No agent has worked on this ticket yet. Move it to In Progress and pick an agent — its console appears here.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(within(section).queryByRole('link', { name: /FULL LOG/ })).not.toBeInTheDocument();
  });
});

describe('streamed lines and sticky bottom (UI-AC-85, AC-86, U-11)', () => {
  const NEW_TEXT = 'Streamed line one';

  /** Re-registers the running session with one more entry at `seq`, then streams the matching `log.appended`. */
  function stream(net: FakeNetwork, entryCountBefore: number, seq: number, text: string): void {
    const detail = seedSessionDetail('S-0412');
    const entry: LogEntry = {
      ...detail.entries[1]!,
      index: entryCountBefore,
      type: 'agent',
      text,
      tool: null,
      tokens: null,
      costUsd: null,
    };
    net.on(
      'GET',
      '/sessions/S-0412',
      jsonResponse(
        SessionDetail,
        { ...detail, entries: [...detail.entries, entry] },
        { asOfSeq: seq },
      ),
    );
    FakeEventSource.emitEvent(
      buildEvent(
        seq,
        'log.appended',
        { summary: text, entry },
        { sessionId: 'S-0412', agentId: 'alpha', ticketId: 'T-12' },
      ),
    );
  }

  /** jsdom has no layout: fake the geometry the stick-to-bottom logic reads. */
  function geometry(log: HTMLElement, scrollHeight: number, clientHeight: number) {
    Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(log, 'clientHeight', { configurable: true, get: () => clientHeight });
  }

  it('appends exactly one row per streamed log.appended and stays at the bottom', async () => {
    const net = consoleNet('T-12');
    await openConsole('T-12', {}, net);
    FakeEventSource.emitHello();
    const log = await screen.findByRole('log', { name: 'Agent console' });
    await waitFor(() => expect(rowTimes(log)).toHaveLength(13));
    geometry(log, 1000, 100);
    log.scrollTop = 900;
    fireEvent.scroll(log);

    stream(net, 13, SEED_LAST_SEQ + 1, NEW_TEXT);

    // Contract: one new console row per streamed entry.
    expect(await within(log).findByText(NEW_TEXT)).toBeInTheDocument();
    expect(rowTimes(log)).toHaveLength(14);
    // Contract: already at the bottom -> sticks to the bottom, no «new lines» button.
    expect(log.scrollTop).toBe(1000);
    expect(screen.queryByRole('button', { name: /NEW LINES/ })).not.toBeInTheDocument();
  });

  it('keeps the scroll position and offers ↓ NEW LINES when scrolled up; the button scrolls to the bottom', async () => {
    const net = consoleNet('T-12');
    const { user } = await openConsole('T-12', {}, net);
    FakeEventSource.emitHello();
    const log = await screen.findByRole('log', { name: 'Agent console' });
    await waitFor(() => expect(rowTimes(log)).toHaveLength(13));
    geometry(log, 1000, 100);
    log.scrollTop = 100;
    fireEvent.scroll(log);

    stream(net, 13, SEED_LAST_SEQ + 1, NEW_TEXT);

    // Contract: the Operator scrolled up -> position kept, a ↓ NEW LINES button appears.
    expect(await within(log).findByText(NEW_TEXT)).toBeInTheDocument();
    expect(log.scrollTop).toBe(100);
    const button = await screen.findByRole('button', { name: '↓ NEW LINES' });

    await user.click(button);
    expect(log.scrollTop).toBe(1000);
    expect(screen.queryByRole('button', { name: /NEW LINES/ })).not.toBeInTheDocument();
  });

  it('hides ↓ NEW LINES once the Operator scrolls back to the bottom by hand', async () => {
    const net = consoleNet('T-12');
    await openConsole('T-12', {}, net);
    FakeEventSource.emitHello();
    const log = await screen.findByRole('log', { name: 'Agent console' });
    await waitFor(() => expect(rowTimes(log)).toHaveLength(13));
    geometry(log, 1000, 100);
    log.scrollTop = 0;
    fireEvent.scroll(log);
    stream(net, 13, SEED_LAST_SEQ + 1, NEW_TEXT);
    await screen.findByRole('button', { name: '↓ NEW LINES' });

    log.scrollTop = 900;
    fireEvent.scroll(log);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /NEW LINES/ })).not.toBeInTheDocument(),
    );
  });
});
