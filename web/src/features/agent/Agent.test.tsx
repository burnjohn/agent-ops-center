import { screen, waitFor, within } from '@testing-library/react';
import { AgentPageResponse, type SaidVsDid } from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import {
  createFakeNetwork,
  errorResponse,
  jsonResponse,
  type FakeNetwork,
} from '../../test/fakeNetwork';
import { SEED_LAST_SEQ, seedAgents, seedSessionSummaries } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

const alphaSessions = () =>
  seedSessionSummaries()
    .filter((s) => s.agentId === 'alpha')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 10);

const SAID_VS_DID: SaidVsDid = {
  rows: [
    {
      seq: 44,
      at: '2026-10-24T14:16:00Z',
      said: null,
      did: 'Edit started · src/stream/sse.ts',
      mismatch: false,
    },
    {
      seq: 30,
      at: '2026-10-24T14:10:00Z',
      said: 'Tests pass',
      did: 'Bash failed · npm test',
      mismatch: true,
    },
    {
      seq: 20,
      at: '2026-10-24T14:05:00Z',
      said: 'Stage → Implementing',
      did: null,
      mismatch: false,
    },
  ],
  mismatchCount: 1,
  notes: [
    {
      from: '2026-10-24T14:05:00Z',
      to: '2026-10-24T14:16:00Z',
      text: 'Said tests passed while the test run failed.',
    },
  ],
};

function pageBody(overrides: Partial<AgentPageResponse> = {}): AgentPageResponse {
  const alpha = seedAgents().find((a) => a.id === 'alpha')!;
  return AgentPageResponse.parse({
    agent: alpha,
    kpis: { sessions7d: 12, ticketsDone: 4, toolCallsToday: 31, cost7dUsd: 8.5 },
    saidVsDid: SAID_VS_DID,
    sessions: alphaSessions(),
    sessionsTotal: 42,
    tickets: [
      { id: 'T-12', title: 'Stream replay', status: 'in_progress' },
      { id: 'T-1', title: 'First ticket', status: 'done' },
      { id: 'T-3', title: 'Third ticket', status: 'review' },
      { id: 'T-5', title: 'Fifth ticket', status: 'done' },
    ],
    dataSource: 'mock',
    ...overrides,
  });
}

function setup(body: AgentPageResponse = pageBody(), route = '/agents/alpha') {
  const net: FakeNetwork = createFakeNetwork();
  net.on(
    'GET',
    /^\/agents\/[^/]+$/,
    jsonResponse(AgentPageResponse, body, { asOfSeq: SEED_LAST_SEQ }),
  );
  const app = renderApp({ route, network: net });
  return { ...app, net };
}

/** The title is also shown by the loading frame, so wait for page content instead. */
const heading = () => screen.findByText('Sessions · 7d');

describe('Agent page header', () => {
  it('shows id, kind from data, health with SEEN, stage badge, ticket and session buttons, and KPIs', async () => {
    setup();
    await heading();

    // UI-AC-106: badges `<kind>`, `<health> · SEEN <ago>` (clock 14:32:00, lastSeen 14:31:58), `0N <STAGE>`.
    expect(screen.getByText('REAL · CLAUDE CODE')).toBeInTheDocument();
    expect(screen.getByText(/· SEEN 2S/)).toHaveTextContent('■ ONLINE · SEEN 2S');
    expect(screen.getByText('02 IMPLEMENTING')).toBeInTheDocument();
    // Buttons for the held ticket and the running session.
    expect(screen.getByRole('button', { name: 'T-12 · open ticket' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open current session log' })).toBeInTheDocument();

    // KPIs from the server; the cost tile links to /usage without filters.
    expect(screen.getByText('Sessions · 7d').parentElement).toHaveTextContent('12');
    expect(screen.getByText('Tickets done').parentElement).toHaveTextContent('4');
    expect(screen.getByText('Tool calls · today').parentElement).toHaveTextContent('31');
    const cost = screen.getByRole('link', { name: /Cost · 7d \(mock\)/ });
    expect(cost).toHaveAttribute('href', '/usage');
    expect(cost).toHaveTextContent('$8.50');
  });

  it('shows kind SIMULATED and stage badge from data for a simulated agent', async () => {
    const sim = seedAgents().find((a) => a.id === 'sim-2')!;
    setup(pageBody({ agent: { ...sim, stage: 'awaiting_review' }, sessions: [] }), '/agents/sim-2');
    await heading();
    // UI-AC-93 / AC-106: kind comes from data; stage badge 04.
    expect(screen.getByText('SIMULATED')).toBeInTheDocument();
    expect(screen.getByText('04 AWAITING REVIEW')).toBeInTheDocument();
  });

  it('omits the ticket and session buttons when the agent holds no ticket and has no running session', async () => {
    const charlie = { ...seedAgents().find((a) => a.id === 'charlie')!, stage: 'idle' as const };
    const completed = alphaSessions().filter((s) => s.status !== 'running');
    setup(pageBody({ agent: { ...charlie, id: 'alpha' }, sessions: completed }));
    await heading();
    // UI-AC-106: buttons appear only with a held ticket / a Running session.
    expect(screen.queryByRole('button', { name: /open ticket/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open current session log' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('00 IDLE')).toBeInTheDocument();
  });

  it('opens the ticket and the running session from the buttons', async () => {
    const { user, net } = setup();
    await heading();
    await user.click(screen.getByRole('button', { name: 'T-12 · open ticket' }));
    // UI-AC-106: navigates to the ticket.
    await waitFor(() => expect(net.calls('GET', '/tickets/T-12').length).toBeGreaterThan(0));
  });

  it('opens the current session log', async () => {
    const { user, net } = setup();
    await heading();
    await user.click(screen.getByRole('button', { name: 'Open current session log' }));
    // UI-AC-106: the running session is S-0412.
    await waitFor(() => expect(net.calls('GET', '/sessions/S-0412').length).toBeGreaterThan(0));
  });

  it('renders health as reported (offline) with a text mark', async () => {
    const alpha = { ...seedAgents().find((a) => a.id === 'alpha')!, health: 'offline' as const };
    setup(pageBody({ agent: alpha }));
    await heading();
    // UI-AC-26: server health is shown as-is.
    expect(screen.getByText(/· SEEN 2S/)).toHaveTextContent('□ OFFLINE · SEEN 2S');
  });

  it('shows a not-found state for an unknown agent', async () => {
    const net = createFakeNetwork();
    net.on('GET', /^\/agents\/[^/]+$/, errorResponse(404, 'not_found', 'Agent not found.'));
    renderApp({ route: '/agents/ghost', network: net });
    // UI-AC-17: unknown id -> «Agent ghost doesn't exist.» with a way back.
    expect(
      await screen.findByRole('heading', { name: "Agent ghost doesn't exist." }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← BACK TO MISSION CONTROL' })).toHaveAttribute(
      'href',
      '/mission-control',
    );
  });
});

describe('Agent page Said vs did', () => {
  it('shows the subtitle, columns, rows, mismatch badge and note from the server', async () => {
    setup();
    await heading();
    const section = within(screen.getByRole('region', { name: 'Said vs did' }));

    // UI-AC-107 + U-7: «reported», not «reported over MCP»; N = number of rows.
    expect(
      section.getByText(
        'What alpha reported next to what its tools actually did — latest 3 events.',
      ),
    ).toBeInTheDocument();
    expect(section.queryByText(/MCP/)).not.toBeInTheDocument();

    const table = within(section.getByRole('table', { name: 'Said vs did' }));
    expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'TIME',
      '■ SAID — AGENT REPORT',
      '◆ DID — AGENT TELEMETRY',
    ]);
    expect(table.getAllByRole('row')).toHaveLength(1 + 3);
    expect(table.getByText('14:10')).toBeInTheDocument();
    expect(table.getByText('Tests pass')).toBeInTheDocument();

    // UI-AC-107: badge and the note format «▲ <hh:mm>–<hh:mm> <text>».
    expect(section.getByText('▲ 1 MISMATCH')).toBeInTheDocument();
    expect(
      section.getByText('▲ 14:05–14:16 Said tests passed while the test run failed.'),
    ).toBeInTheDocument();
  });

  it('flags only rows the server marked as mismatches (the UI computes nothing)', async () => {
    setup();
    await heading();
    const table = within(screen.getByRole('table', { name: 'Said vs did' }));
    // UI-AC-107: the flagged DID cell is marked, a row whose said/did differ but is not flagged is not.
    expect(table.getByText('Bash failed · npm test')).toHaveAttribute('data-mismatch', 'true');
    expect(table.getByText('Edit started · src/stream/sse.ts')).not.toHaveAttribute(
      'data-mismatch',
    );
  });

  it('hides the badge and notes when the server reports no mismatches', async () => {
    setup(
      pageBody({
        saidVsDid: {
          rows: SAID_VS_DID.rows.map((r) => ({ ...r, mismatch: false })),
          mismatchCount: 0,
          notes: [],
        },
      }),
    );
    await heading();
    // UI-AC-107: badge only when N >= 1.
    expect(screen.queryByText(/MISMATCH/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^▲ \d\d:\d\d–/)).not.toBeInTheDocument();
  });

  it('shows notes for at most the two most recent mismatches', async () => {
    const note = (h: number) => ({
      from: `2026-10-24T${String(h).padStart(2, '0')}:00:00Z`,
      to: `2026-10-24T${String(h).padStart(2, '0')}:10:00Z`,
      text: `Note at ${h}`,
    });
    setup(
      pageBody({
        saidVsDid: { ...SAID_VS_DID, mismatchCount: 3, notes: [note(14), note(13), note(12)] },
      }),
    );
    await heading();
    // UI-AC-107: two most recent only.
    expect(screen.getByText('▲ 14:00–14:10 Note at 14')).toBeInTheDocument();
    expect(screen.getByText('▲ 13:00–13:10 Note at 13')).toBeInTheDocument();
    expect(screen.queryByText(/Note at 12/)).not.toBeInTheDocument();
    expect(screen.getByText('▲ 3 MISMATCH')).toBeInTheDocument();
  });
});

describe('Agent page Sessions and Tickets', () => {
  it('lists the 10 newest sessions with the mock tag, hint, sorted header and footnote', async () => {
    setup();
    await heading();
    const section = within(screen.getByRole('region', { name: 'Sessions' }));
    const table = within(section.getByRole('table', { name: 'Sessions' }));

    // UI-AC-108
    expect(section.getByText('Click a session to read its full log')).toBeInTheDocument();
    expect(table.getByRole('columnheader', { name: /STARTED/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    for (const name of ['SESSION', 'DURATION', 'TICKET', 'MODEL', 'STATUS', 'TOKENS', 'COST']) {
      expect(table.getByRole('columnheader', { name })).toBeInTheDocument();
    }
    const rows = table.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(10);
    // Newest first: the running S-0412 (started 14:00:50 today) leads.
    expect(within(rows[0]!).getByRole('link', { name: 'S-0412' })).toHaveAttribute(
      'href',
      '/sessions/S-0412',
    );
    expect(within(rows[0]!).getByText('RUNNING')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Today 14:00')).toBeInTheDocument();
    // Running duration uses the Simulation Clock: 14:32:00 - 14:00:50 = 31m.
    expect(within(rows[0]!).getByText('31m')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: 'T-12' })).toHaveAttribute(
      'href',
      '/tickets/T-12',
    );

    expect(section.getByText(/Showing 10 of 42 sessions/).textContent).toBe(
      'Showing 10 of 42 sessions · all of them in Usage & Cost',
    );
    expect(section.getByRole('link', { name: 'Usage & Cost' })).toHaveAttribute('href', '/usage');
  });

  // TODO: suspected bug — UI-AC-108 asks for a dashed `MOCK DATA` tag next to the Sessions heading, but
  // features/agent/index.tsx:136 renders `<MockTag />`, whose text is only «MOCK» (ui/display/MockBanner.tsx:17).
  it('labels the Sessions section with a MOCK DATA tag', async () => {
    setup();
    await heading();
    const section = within(screen.getByRole('region', { name: 'Sessions' }));
    expect(section.getByText('MOCK DATA')).toBeInTheDocument();
  });

  it('shows — for a session without a ticket and the failed mark as text', async () => {
    const noTicket = alphaSessions().map((s, i) =>
      i === 1 ? { ...s, ticketId: null, status: 'failed' as const } : s,
    );
    setup(pageBody({ sessions: noTicket }));
    await heading();
    const table = within(screen.getByRole('table', { name: 'Sessions' }));
    const row = table.getAllByRole('row')[2]!;
    // UI-AC-108: TICKET shows — and STATUS carries a word, not colour alone.
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).getByText('FAILED')).toBeInTheDocument();
  });

  it('opens the Session Log when a row (outside its links) is clicked', async () => {
    const { user, net } = setup();
    await heading();
    const table = within(screen.getByRole('table', { name: 'Sessions' }));
    const row = table.getAllByRole('row')[1]!;
    await user.click(within(row).getByText('RUNNING'));
    // UI-AC-108: every row opens the Session Log.
    await waitFor(() => expect(net.calls('GET', '/sessions/S-0412').length).toBeGreaterThan(0));
  });

  it('lists the agent tickets as links with id, title and status', async () => {
    setup();
    await heading();
    const section = within(screen.getByRole('region', { name: 'Tickets' }));
    const links = section.getAllByRole('link');

    // UI-AC-109: T-12, T-1, T-3, T-5 in the server's order, each linking to the ticket.
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/tickets/T-12',
      '/tickets/T-1',
      '/tickets/T-3',
      '/tickets/T-5',
    ]);
    expect(links[0]).toHaveTextContent('T-12');
    expect(links[0]).toHaveTextContent('Stream replay');
    expect(links[0]).toHaveTextContent('IN PROGRESS');
    expect(links[2]).toHaveTextContent('REVIEW');
    expect(links[3]).toHaveTextContent('DONE');
  });
});
