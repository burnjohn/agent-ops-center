import { screen, waitFor, within } from '@testing-library/react';
import {
  AgentListResponse,
  Event,
  EventsPageResponse,
  isFeedEvent,
  OverviewResponse,
  SimulationState,
  TicketListResponse,
  type Agent,
  type Ticket,
} from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import { FakeEventSource } from '../../test/FakeEventSource';
import { createFakeNetwork, jsonResponse, type FakeNetwork } from '../../test/fakeNetwork';
import {
  SEED_LAST_SEQ,
  buildEvent,
  buildOverview,
  buildSimulation,
  seedAgents,
  seedEvents,
} from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

const ROUTE = '/mission-control';

function serveAgents(net: FakeNetwork, agents: Agent[]): void {
  net.on('GET', '/agents', jsonResponse(AgentListResponse, agents, { asOfSeq: SEED_LAST_SEQ }));
}

function setup(opts: { agents?: Agent[]; events?: readonly Event[]; tickets?: Ticket[] } = {}) {
  const net = createFakeNetwork();
  if (opts.events) net.setEvents(opts.events);
  if (opts.agents) serveAgents(net, opts.agents);
  if (opts.tickets) {
    net.on(
      'GET',
      '/tickets',
      jsonResponse(TicketListResponse, opts.tickets, { asOfSeq: SEED_LAST_SEQ }),
    );
  }
  const app = renderApp({ route: ROUTE, network: net });
  return { ...app, net };
}

const withAgent = (agents: Agent[], id: string, patch: Partial<Agent>): Agent[] =>
  agents.map((a) => (a.id === id ? { ...a, ...patch } : a));

const card = (id: string) => screen.findByRole('article', { name: id });
const log = () => screen.findByRole('complementary', { name: 'Event Log' });

describe('Mission Control KPIs and legend', () => {
  it('shows title, the four KPIs from the overview, and the sparkline with its newest bar marked', async () => {
    const net = createFakeNetwork();
    const perMinute = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 2, 5];
    net.on(
      'GET',
      '/overview',
      jsonResponse(
        OverviewResponse,
        buildOverview({
          agentsOnline: 4,
          agentsTotal: 6,
          blockedTickets: 1,
          reviewTickets: 2,
          eventsPerMinute: perMinute,
        }),
        { asOfSeq: SEED_LAST_SEQ },
      ),
    );
    renderApp({ route: ROUTE, network: net });

    // UI-AC-91: title, `N/total`, and the values the server computed.
    expect(await screen.findByText('■ Agents online')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mission Control', level: 1 })).toBeInTheDocument();
    expect((await screen.findByText('■ Agents online')).parentElement).toHaveTextContent('4/6');
    const blocked = screen.getByRole('link', { name: /Blocked →/ });
    expect(blocked).toHaveAttribute('href', '/board');
    expect(blocked).toHaveTextContent('1');
    const review = screen.getByRole('link', { name: /In review →/ });
    expect(review).toHaveAttribute('href', '/board');
    expect(review).toHaveTextContent('2');

    // UI-AC-91: Events / min shows the newest bucket as its value and a 12-bar labelled sparkline.
    expect(screen.getByText('Events / min').parentElement).toHaveTextContent('5');
    const spark = screen.getByRole('img', { name: 'Events per minute, last 12 minutes' });
    const bars = spark.getElementsByTagName('rect');
    expect(bars).toHaveLength(12);
    // Only the newest bar is the live one.
    const live = [...bars].filter((b) => /sparkNewest/.test(b.getAttribute('class') ?? ''));
    expect(live).toEqual([bars[11]]);
  });

  it('builds the health legend from the server thresholds, not constants', async () => {
    const net = createFakeNetwork();
    renderApp({ route: ROUTE, network: net });
    // UI-AC-92 / PDR-0011: seed thresholds 30 s / 120 s / 600 s.
    expect(
      await screen.findByText(
        '■ ONLINE · ◐ STALE after 30 s · □ OFFLINE after 2 min · a running tool keeps an agent Online for up to 10 min',
      ),
    ).toBeInTheDocument();
  });
});

describe('Mission Control agent cards', () => {
  it('shows one card per agent with kind from data, health, ticket link, stepper, footer and LOG link', async () => {
    setup();
    const alpha = within(await card('alpha'));

    // UI-AC-93: id link, kind label taken from data (alpha is real, sim-1 is simulated).
    expect(alpha.getByRole('link', { name: 'alpha' })).toHaveAttribute('href', '/agents/alpha');
    expect(alpha.getByText('REAL · CLAUDE CODE')).toBeInTheDocument();
    expect(within(await card('sim-1')).getByText('SIMULATED')).toBeInTheDocument();
    expect(alpha.getByText('ONLINE')).toBeInTheDocument();

    // UI-AC-93: ticket as `<id> <title>` link.
    expect(alpha.getByRole('link', { name: /T-12/ })).toHaveAttribute('href', '/tickets/T-12');

    // UI-AC-96: stepper gives the stage to assistive tech and shows the four labelled segments.
    expect(alpha.getByText('Stage: Implementing')).toBeInTheDocument();
    for (const label of ['PLAN', 'IMPL', 'TEST', 'REVIEW']) {
      expect(alpha.getByText(label)).toBeInTheDocument();
    }

    // UI-AC-93: footer SEEN <ago> (clock 14:32:00, lastSeen 14:31:58), cost with MOCK tag, LOG to the current session.
    expect(alpha.getByText('SEEN 2S')).toBeInTheDocument();
    expect(alpha.getByText(/\$0\.00 TODAY/)).toBeInTheDocument();
    expect(alpha.getByText('MOCK')).toBeInTheDocument();
    expect(alpha.getByRole('link', { name: 'LOG ↗' })).toHaveAttribute('href', '/sessions/S-0412');
  });

  it('shows the waiting message and an empty stepper for an agent without a ticket', async () => {
    setup();
    const charlie = within(await card('charlie'));
    // UI-AC-93: no ticket -> fixed waiting copy.
    expect(charlie.getByText('No ticket — waiting for work in Ready')).toBeInTheDocument();
    // UI-AC-96: Idle -> no segment is current; the hidden text still names the stage.
    expect(charlie.getByText('Stage: Idle')).toBeInTheDocument();
  });

  it('LOG links to the last session when no session is current', async () => {
    const agents = withAgent(seedAgents(), 'alpha', {
      currentSessionId: null,
      lastSessionId: 'S-0409',
    });
    setup({ agents });
    // UI-AC-93: LOG goes to the current or last session.
    expect(within(await card('alpha')).getByRole('link', { name: 'LOG ↗' })).toHaveAttribute(
      'href',
      '/sessions/S-0409',
    );
  });

  it('keeps the ticket link target when the link inside a card is clicked', async () => {
    const { user, net } = setup();
    await user.click(within(await card('alpha')).getByRole('link', { name: /T-12/ }));
    // UI-AC-94: the ticket link opens the ticket (not the agent page).
    await waitFor(() => expect(net.calls('GET', '/tickets/T-12').length).toBeGreaterThan(0));
    expect(net.calls('GET', '/agents/alpha')).toHaveLength(0);
  });

  it('opens the agent page when the card body is clicked', async () => {
    const { user, net } = setup();
    await user.click(await card('bravo'));
    // UI-AC-94: a click outside inner links opens /agents/<id> (the page asks the server for that agent).
    await waitFor(() => expect(net.calls('GET', '/agents/bravo')).toHaveLength(1));
    expect(screen.queryByRole('article', { name: 'bravo' })).not.toBeInTheDocument();
  });

  it('keeps offline agents in the grid after all others, dimmed, and shows health as the server sent it', async () => {
    // alpha (first in server order) and charlie are offline/stale; everything else online.
    const agents = withAgent(withAgent(seedAgents(), 'alpha', { health: 'offline' }), 'bravo', {
      health: 'stale',
    });
    setup({ agents });
    await card('alpha');

    // UI-AC-95 / PDR-0010: server order, offline last.
    const order = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));
    expect(order).toEqual(['bravo', 'charlie', 'sim-1', 'sim-2', 'sim-3', 'alpha']);
    expect(screen.getByRole('article', { name: 'alpha' }).className).toMatch(/offline/);
    expect(screen.getByRole('article', { name: 'bravo' }).className).not.toMatch(/offline/);

    // UI-AC-26: health is rendered exactly as reported (text, not colour alone).
    expect(
      within(screen.getByRole('article', { name: 'alpha' })).getByText('OFFLINE'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'bravo' })).getByText('STALE'),
    ).toBeInTheDocument();
  });

  it('keeps several offline agents in their server order, after the rest', async () => {
    let agents = withAgent(seedAgents(), 'alpha', { health: 'offline' });
    agents = withAgent(agents, 'charlie', { health: 'offline' });
    setup({ agents });
    await card('alpha');
    // UI-AC-95: otherwise the server's order (alpha before charlie among the offline ones).
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
      'bravo',
      'sim-1',
      'sim-2',
      'sim-3',
      'alpha',
      'charlie',
    ]);
  });

  it('renders relative times from the Simulation Clock', async () => {
    setup();
    // UI-AC-25: sim-3 last seen 13:31:09, clock 14:32:00 -> 1H; sim-1 14:31:46 -> 14S.
    expect(within(await card('sim-3')).getByText('SEEN 1H')).toBeInTheDocument();
    expect(within(await card('sim-1')).getByText('SEEN 14S')).toBeInTheDocument();
  });
});

describe('Mission Control current-action box', () => {
  it('running tool: tool name, argument and m:ss timer from the clock', async () => {
    const agents = withAgent(seedAgents(), 'alpha', {
      currentTool: { name: 'Edit', arg: 'src/stream/sse.ts', startedAt: '2026-10-24T14:31:15Z' },
    });
    setup({ agents });
    const alpha = within(await card('alpha'));
    // UI-AC-97: `<tool> · running`, argument, timer = clock - startedAt = 0:45.
    expect(alpha.getByText('Edit · running')).toBeInTheDocument();
    expect(alpha.getByText('src/stream/sse.ts')).toBeInTheDocument();
    expect(alpha.getByText('0:45')).toBeInTheDocument();
  });

  it('blocked: shows the question and its age', async () => {
    const agents = withAgent(seedAgents(), 'sim-1', { currentTool: null });
    setup({ agents });
    const sim1 = within(await card('sim-1'));
    // UI-AC-97: T-8 is Blocked since 14:26:40 -> 5M ago at 14:32:00.
    expect(sim1.getByText('Blocked — needs Operator')).toBeInTheDocument();
    expect(sim1.getByText('Which priorities should the demo tickets cover?')).toBeInTheDocument();
    expect(sim1.getByText('5M')).toBeInTheDocument();
  });

  it('last tool failed: failed title, argument and "<ago> AGO"', async () => {
    setup();
    const sim2 = within(await card('sim-2'));
    // UI-AC-97: Bash failed at 14:19:30 -> 12M AGO.
    expect(sim2.getByText('Bash · failed')).toBeInTheDocument();
    expect(sim2.getByText('npm run lint')).toBeInTheDocument();
    expect(sim2.getByText('12M AGO')).toBeInTheDocument();
  });

  it('offline: "No activity" and the last-event age', async () => {
    const agents = withAgent(seedAgents(), 'sim-3', { health: 'offline' });
    setup({ agents });
    const sim3 = within(await card('sim-3'));
    // UI-AC-97: last seen 13:31:09 -> 1h ago.
    expect(sim3.getByText('No activity')).toBeInTheDocument();
    expect(sim3.getByText('Last event 1H ago')).toBeInTheDocument();
  });

  it('awaiting review: waits for the Operator and names the ticket', async () => {
    const agents = withAgent(seedAgents(), 'sim-2', { lastTool: null });
    setup({ agents });
    const sim2 = within(await card('sim-2'));
    // UI-AC-97
    expect(sim2.getByText('Waiting for your review')).toBeInTheDocument();
    expect(sim2.getByText('T-7 is in Review')).toBeInTheDocument();
  });

  it('idle: "Idle" or "Paused after release" with the polling hint', async () => {
    setup();
    const charlie = within(await card('charlie'));
    // UI-AC-97
    expect(charlie.getByText('Idle')).toBeInTheDocument();
    expect(charlie.getByText('Polling for the next Ready ticket')).toBeInTheDocument();
  });

  it('paused after release replaces the idle title', async () => {
    setup({ agents: withAgent(seedAgents(), 'charlie', { pausedAfterRelease: true }) });
    expect(within(await card('charlie')).getByText('Paused after release')).toBeInTheDocument();
  });

  it('otherwise: "Thinking" between tool calls', async () => {
    const agents = withAgent(seedAgents(), 'bravo', { currentTool: null });
    setup({ agents });
    const bravo = within(await card('bravo'));
    // UI-AC-97
    expect(bravo.getByText('Thinking')).toBeInTheDocument();
    expect(bravo.getByText('Between tool calls')).toBeInTheDocument();
  });

  it('pulses the running square only while auto-play is on', async () => {
    const net = createFakeNetwork();
    net.on(
      'GET',
      '/simulation',
      jsonResponse(SimulationState, buildSimulation({ playing: true }), { asOfSeq: SEED_LAST_SEQ }),
    );
    renderApp({ route: ROUTE, network: net });
    // The mark is aria-hidden and sits right before the «<tool> · running» title.
    const playingMark = within(await card('alpha')).getByText(
      / · running$/,
    ).previousElementSibling!;
    // UI-AC-98: Play on + tool running -> pulse.
    expect(playingMark.className).toMatch(/pulse/);
  });

  it('does not pulse with Play off', async () => {
    setup();
    const mark = within(await card('alpha')).getByText(/ · running$/).previousElementSibling!;
    // UI-AC-98: Play off -> static square.
    expect(mark.className).not.toMatch(/pulse/);
  });
});

describe('Event Log', () => {
  it('lists the newest 40 feed events, newest first, with source marks, who, text and ticket links', async () => {
    setup();
    const region = await log();
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(40));
    const rows = within(region).getAllByRole('listitem');

    // UI-AC-99: newest at top, text is the server summary.
    expect(within(rows[0]!).getByText('Edit started · src/stream/sse.ts')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('14:32:00')).toBeInTheDocument();
    // UI-AC-104: telemetry mark labelled with the source name; agent link; ticket link.
    expect(within(rows[0]!).getByRole('img', { name: 'Agent Telemetry' })).toHaveTextContent('◆');
    expect(within(rows[0]!).getByRole('link', { name: 'alpha' })).toHaveAttribute(
      'href',
      '/agents/alpha',
    );
    expect(within(rows[0]!).getByRole('link', { name: 'T-12' })).toHaveAttribute(
      'href',
      '/tickets/T-12',
    );
    // UI-AC-103: the hidden heartbeat (seq 41, "Checked review status") never appears.
    expect(within(region).queryByText('Checked review status')).not.toBeInTheDocument();
    expect(within(region).getByText('Newest first')).toBeInTheDocument();
  });

  it('marks warning events', async () => {
    const warn = buildEvent(
      45,
      'tool.failed',
      {
        summary: 'Bash failed · npm test',
        tool: 'Bash',
        arg: 'npm test',
        durationSec: 2,
        result: 'exit 1',
      },
      { source: 'agent_telemetry', agentId: 'alpha', ticketId: 'T-12', warn: true },
    );
    setup({ events: [...seedEvents(), warn] });
    const region = await log();
    const row = (await within(region).findByText('Bash failed · npm test')).closest('li')!;
    // UI-AC-99: warn rows are styled apart (text + class; the failed tool's text still reads in full).
    expect(row.className).toMatch(/warn/);
    expect(within(row).getByText('Bash failed · npm test')).toBeInTheDocument();
  });

  it('offers the source segments and category options', async () => {
    setup();
    const region = await log();
    // UI-AC-100: segmented source filter with aria-pressed, ALL selected by default.
    const group = within(region).getByRole('group', { name: 'Source' });
    expect(within(group).getByRole('button', { name: 'ALL' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const name of ['● OPERATOR', '■ REPORT', '◆ TELEMETRY']) {
      expect(within(group).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
    const select = within(region).getByRole('combobox', { name: 'Category' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All', 'Agents', 'Tickets', 'Tools']);
  });

  it('filters by source and asks the server for that source', async () => {
    const { user, net } = setup();
    const region = await log();
    await within(region).findAllByRole('listitem');

    await user.click(within(region).getByRole('button', { name: '● OPERATOR' }));

    // UI-AC-100: the filter is applied (pressed) and every remaining row is an Operator event.
    expect(within(region).getByRole('button', { name: '● OPERATOR' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => {
      const rows = within(region).getAllByRole('listitem');
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows)
        expect(within(row).getByRole('img', { name: 'Operator' })).toBeInTheDocument();
    });
    expect(net.calls('GET', '/events').some((r) => r.query.get('source') === 'operator')).toBe(
      true,
    );
    // Operator rows read `you`.
    expect(within(region).getAllByText('you').length).toBeGreaterThan(0);
  });

  it('keeps source, category and pause when leaving Mission Control and coming back (UI-AC-14)', async () => {
    const { user } = setup();
    const region = await log();
    await within(region).findAllByRole('listitem');
    await user.click(within(region).getByRole('button', { name: '● OPERATOR' }));
    await user.selectOptions(within(region).getByRole('combobox', { name: 'Category' }), 'Tickets');
    await user.click(within(region).getByRole('button', { name: 'Ⅱ PAUSE' }));

    await user.click(screen.getByRole('link', { name: /^01 Board/ }));
    await screen.findByRole('region', { name: /backlog/i });
    await user.click(screen.getByRole('link', { name: /^02 Mission Control/ }));

    const back = await log();
    expect(within(back).getByRole('button', { name: '● OPERATOR' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(back).getByRole('combobox', { name: 'Category' })).toHaveValue('ticket');
    expect(within(back).getByRole('button', { name: '▶ RESUME' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it.each([
    ['Agents', 'agent'],
    ['Tickets', 'ticket'],
    ['Tools', 'tool'],
  ])('maps the category "%s" to %s', async (label, category) => {
    const { user, net } = setup();
    const region = await log();
    await within(region).findAllByRole('listitem');

    await user.selectOptions(within(region).getByRole('combobox', { name: 'Category' }), label);

    // UI-AC-100 / AC-105: Agents->agent, Tickets->ticket, Tools->tool.
    await waitFor(() =>
      expect(net.calls('GET', '/events').some((r) => r.query.get('category') === category)).toBe(
        true,
      ),
    );
    const expectedCount = seedEvents().filter(
      (e) => isFeedEvent(e) && e.category === category,
    ).length;
    await waitFor(() =>
      expect(within(region).getAllByRole('listitem')).toHaveLength(Math.min(40, expectedCount)),
    );
  });

  it('shows Show 40 more with the remaining 3 feed events on the seed (43 feed events)', async () => {
    const { user } = setup();
    const region = await log();
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(40));

    // UI-AC-101 / Q2: 44 events, 43 in the feed -> 40 shown and the button is offered.
    await user.click(within(region).getByRole('button', { name: 'Show 40 more' }));

    // The second page holds feed count - 40 = 3 rows, and there is nothing more to load.
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(43));
    expect(within(region).queryByRole('button', { name: 'Show 40 more' })).not.toBeInTheDocument();
  });

  it('pages by 40: a longer feed needs several clicks and each adds the next 40 older events', async () => {
    const many = Array.from({ length: 95 }, (_, i) =>
      buildEvent(
        i + 1,
        'tool.started',
        { summary: `Step ${i + 1}`, tool: 'Read', arg: 'a.ts' },
        { source: 'agent_telemetry', agentId: 'alpha', ticketId: 'T-12' },
      ),
    );
    const { user } = setup({ events: many });
    const region = await log();
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(40));

    // UI-AC-101: next 40 older, then the rest (95 - 80 = 15).
    await user.click(within(region).getByRole('button', { name: 'Show 40 more' }));
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(80));
    await user.click(within(region).getByRole('button', { name: 'Show 40 more' }));
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(95));
    expect(within(region).queryByRole('button', { name: 'Show 40 more' })).not.toBeInTheDocument();
    // Newest first; the oldest event comes last.
    const rows = within(region).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Step 95')).toBeInTheDocument();
    expect(within(rows.at(-1)!).getByText('Step 1')).toBeInTheDocument();
  });

  it('shows no Show 40 more when 40 or fewer events match', async () => {
    const { user } = setup();
    const region = await log();
    await within(region).findAllByRole('listitem');
    await user.click(within(region).getByRole('button', { name: '● OPERATOR' }));
    // UI-AC-101: the button appears only when more events match than are shown.
    await waitFor(() => expect(within(region).getAllByRole('listitem').length).toBeLessThan(40));
    expect(within(region).queryByRole('button', { name: 'Show 40 more' })).not.toBeInTheDocument();
  });
});

describe('Event Log pause', () => {
  const newEvents = (): Event[] =>
    [45, 46, 47].map((seq) =>
      buildEvent(
        seq,
        'tool.started',
        { summary: `Fresh event ${seq}`, tool: 'Read', arg: 'x.ts' },
        { source: 'agent_telemetry', agentId: 'alpha', ticketId: 'T-12' },
      ),
    );

  it('holds new events behind a counted banner and inserts them all on RESUME', async () => {
    const { user, net } = setup();
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ });
    const region = await log();
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(40));

    // UI-AC-102: PAUSE flips to RESUME with aria-pressed=true; no banner while nothing is new.
    await user.click(within(region).getByRole('button', { name: 'Ⅱ PAUSE' }));
    expect(within(region).getByRole('button', { name: '▶ RESUME' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(region).queryByRole('button', { name: /NEW EVENTS/ })).not.toBeInTheDocument();

    // Three feed events and one hidden heartbeat arrive on the stream.
    net.setEvents([...seedEvents(), ...newEvents()]);
    for (const e of newEvents()) FakeEventSource.emitEvent(e);
    FakeEventSource.emitEvent(
      buildEvent(
        48,
        'agent.heartbeat',
        { summary: 'Checked review status' },
        { source: 'agent_report', agentId: 'alpha' },
      ),
    );

    // UI-AC-102 + AC-103: the banner counts the 3 feed events only; no new row appears while paused.
    const banner = await within(region).findByRole('button', {
      name: 'PAUSED · 3 NEW EVENTS — RESUME ↑',
    });
    expect(within(region).queryByText('Fresh event 47')).not.toBeInTheDocument();
    expect(within(region).getByText('Edit started · src/stream/sse.ts')).toBeInTheDocument();

    // Activating the banner inserts every held event, newest first, and resumes.
    await user.click(banner);
    const rows = within(region).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Fresh event 47')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Fresh event 46')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Fresh event 45')).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: /NEW EVENTS/ })).not.toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Ⅱ PAUSE' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('keeps the same rows while paused across several incoming events (UI-AC-102)', async () => {
    const { user, net } = setup();
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ });
    const region = await log();
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(40));
    const before = within(region)
      .getAllByRole('listitem')
      .map((r) => r.textContent);
    await user.click(within(region).getByRole('button', { name: 'Ⅱ PAUSE' }));

    const fresh = newEvents();
    for (let i = 0; i < fresh.length; i += 1) {
      net.setEvents([...seedEvents(), ...fresh.slice(0, i + 1)]);
      FakeEventSource.emitEvent(fresh[i]!);
      await within(region).findByRole('button', {
        name: `PAUSED · ${i + 1} NEW EVENTS — RESUME ↑`,
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(
        within(region)
          .getAllByRole('listitem')
          .map((r) => r.textContent),
      ).toEqual(before);
    }

    await user.click(within(region).getByRole('button', { name: /^PAUSED/ }));
    const rows = within(region).getAllByRole('listitem');
    expect(rows).toHaveLength(40);
    expect(within(rows[0]!).getByText('Fresh event 47')).toBeInTheDocument();
  });

  it('RESUME in the header also inserts the held events', async () => {
    const { user, net } = setup();
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ });
    const region = await log();
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(40));
    await user.click(within(region).getByRole('button', { name: 'Ⅱ PAUSE' }));

    net.setEvents([...seedEvents(), ...newEvents()]);
    FakeEventSource.emitEvent(newEvents()[0]!);
    await within(region).findByRole('button', { name: 'PAUSED · 3 NEW EVENTS — RESUME ↑' });

    await user.click(within(region).getByRole('button', { name: '▶ RESUME' }));
    // UI-AC-102: either control resumes and shows the held events.
    expect(within(region).getByText('Fresh event 47')).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: /NEW EVENTS/ })).not.toBeInTheDocument();
  });
});

describe('Event feed types and text', () => {
  it('never renders journal-only types even if a page contains them', async () => {
    const hidden = [
      buildEvent(
        45,
        'agent.heartbeat',
        { summary: 'Hidden heartbeat' },
        { source: 'agent_report', agentId: 'alpha' },
      ),
      buildEvent(
        46,
        'agent.health_changed',
        { summary: 'Hidden health change', from: 'online', to: 'stale' },
        { source: 'system', agentId: 'alpha' },
      ),
      buildEvent(
        47,
        'session.started',
        { summary: 'Hidden session start', model: 'sonnet-5-5' },
        { source: 'system' },
      ),
      buildEvent(
        48,
        'session.ended',
        { summary: 'Hidden session end', status: 'completed' },
        { source: 'system' },
      ),
      buildEvent(
        49,
        'simulation.stepped',
        {
          summary: 'Hidden step',
          mode: 'step_all',
          clock: '2026-10-24T14:32:06Z',
          actedAgentIds: [],
        },
        { source: 'system' },
      ),
      buildEvent(50, 'simulation.play_changed', { summary: 'Hidden play change', playing: true }),
    ];
    const net = createFakeNetwork();
    // A page that (wrongly) carries journal-only events next to one feed event.
    net.on(
      'GET',
      '/events',
      jsonResponse(
        EventsPageResponse,
        { items: [...hidden, ...seedEvents().slice(-1)].reverse(), nextBeforeSeq: null },
        { asOfSeq: 50 },
      ),
    );
    renderApp({ route: ROUTE, network: net });
    const region = await log();

    // UI-AC-103: only the feed event becomes a row.
    await within(region).findByText('Edit started · src/stream/sse.ts');
    expect(within(region).getAllByRole('listitem')).toHaveLength(1);
    expect(within(region).queryByText(/Hidden/)).not.toBeInTheDocument();
  });

  it('does not refetch the feed for a non-feed stream event', async () => {
    const { net } = setup();
    FakeEventSource.emitHello({ lastSeq: SEED_LAST_SEQ });
    const region = await log();
    await within(region).findAllByRole('listitem');
    const before = net.calls('GET', '/events').length;

    FakeEventSource.emitEvent(
      buildEvent(
        45,
        'agent.heartbeat',
        { summary: 'Checked review status' },
        { source: 'agent_report', agentId: 'alpha' },
      ),
    );
    await waitFor(() => expect(net.calls('GET', '/agents').length).toBeGreaterThan(1));

    // UI-AC-103: a heartbeat updates cached agent state only; the feed is not touched or counted.
    expect(net.calls('GET', '/events')).toHaveLength(before);
    expect(within(region).getAllByRole('listitem')).toHaveLength(40);
  });

  it('renders the summary verbatim as plain text and falls back to the type', async () => {
    const events = [
      buildEvent(
        1,
        'tool.started',
        { summary: '<b>bold</b> & more', tool: 'Read', arg: 'a' },
        { source: 'agent_telemetry', agentId: 'alpha' },
      ),
      buildEvent(
        2,
        'tool.started',
        { summary: '', tool: 'Read', arg: 'b' },
        { source: 'agent_telemetry', agentId: 'alpha' },
      ),
    ];
    setup({ events });
    const region = await log();

    // UI-AC-105: verbatim plain text (no markup interpretation).
    expect(await within(region).findByText('<b>bold</b> & more')).toBeInTheDocument();
    expect(region.getElementsByTagName('b')).toHaveLength(0);
    // UI-AC-105: no summary -> the event type.
    // TODO: contract unclear — payload.summary is required by the shared schema, so "missing" is
    // approximated by an empty string here.
    expect(within(region).getByText('tool.started')).toBeInTheDocument();
  });

  it('tells a claim from an operator assignment by source, each with its own summary', async () => {
    const claim = buildEvent(
      1,
      'ticket.assigned',
      {
        summary: 'Claimed T-12',
        from: 'ready',
        agentId: 'alpha',
        sessionId: 'S-0412',
        claim: true,
      },
      { source: 'agent_report', agentId: 'alpha', ticketId: 'T-12' },
    );
    const assign = buildEvent(
      2,
      'ticket.assigned',
      {
        summary: 'Moved Ready → In Progress · assigned to bravo',
        from: 'ready',
        agentId: 'bravo',
        sessionId: 'S-0413',
        claim: false,
      },
      { source: 'operator', agentId: 'bravo', ticketId: 'T-9' },
    );
    setup({ events: [claim, assign] });
    const region = await log();
    const rows = await within(region).findAllByRole('listitem');

    // UI-AC-105: newest first -> operator assignment, then the agent's claim.
    expect(
      within(rows[0]!).getByText('Moved Ready → In Progress · assigned to bravo'),
    ).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('img', { name: 'Operator' })).toBeInTheDocument();
    expect(within(rows[0]!).getByText('you')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Claimed T-12')).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('img', { name: 'Agent Report' })).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('link', { name: 'alpha' })).toBeInTheDocument();
  });

  it('renders a system-sourced event with the mark "—" and the label System', async () => {
    const system = buildEvent(
      1,
      'tool.started',
      { summary: 'System thing', tool: 'Read', arg: 'a' },
      { source: 'system' },
    );
    setup({ events: [system] });
    const region = await log();
    const row = (await within(region).findByText('System thing')).closest('li')!;
    // UI-AC-104
    const mark = within(row).getByRole('img', { name: 'System' });
    expect(mark).toHaveTextContent('—');
  });

  it('renders every source mark with its glyph', async () => {
    const mk = (seq: number, source: 'operator' | 'agent_report' | 'agent_telemetry') =>
      buildEvent(
        seq,
        'tool.started',
        { summary: `From ${source}`, tool: 'Read', arg: 'a' },
        { source },
      );
    setup({ events: [mk(1, 'operator'), mk(2, 'agent_report'), mk(3, 'agent_telemetry')] });
    const region = await log();
    await within(region).findByText('From operator');
    // UI-AC-104: ● Operator, ■ Agent Report, ◆ Agent Telemetry.
    expect(within(region).getByRole('img', { name: 'Operator' })).toHaveTextContent('●');
    expect(within(region).getByRole('img', { name: 'Agent Report' })).toHaveTextContent('■');
    expect(within(region).getByRole('img', { name: 'Agent Telemetry' })).toHaveTextContent('◆');
  });
});
