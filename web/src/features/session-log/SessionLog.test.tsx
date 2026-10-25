import { SessionDetail, type LogEntry } from '@agent-ops/shared';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createFakeNetwork,
  errorResponse,
  jsonResponse,
  type FakeNetwork,
} from '../../test/fakeNetwork';
import { SEED_LAST_SEQ, seedSessionDetail } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

afterEach(() => {
  cleanup();
});

/** Seed detail enriched with the aggregates the seed builder leaves at zero. */
function detail(id: 'S-0409' | 'S-0412', over: Partial<SessionDetail> = {}): SessionDetail {
  const base = seedSessionDetail(id);
  const running = id === 'S-0412';
  return SessionDetail.parse({
    ...base,
    tokens: { input: 12_345, output: 678, cacheRead: 1_234_567, cacheWrite: 98_765 },
    costUsd: 0.79,
    costByType: { input: 0.04, output: 0.01, cacheRead: 0.37, cacheWrite: 0.37 },
    tokenActivity: [
      { activity: 'editing_code', steps: 2, tokens: tk(10), costUsd: 0.1, share: 0.13 },
      { activity: 'reasoning_replies', steps: 5, tokens: tk(30), costUsd: 0.3, share: 0.38 },
      { activity: 'session_context', steps: 1, tokens: tk(2), costUsd: 0.02, share: 0.03 },
      { activity: 'reading_code', steps: 2, tokens: tk(20), costUsd: 0.2, share: 0.25 },
      { activity: 'running_commands', steps: 3, tokens: tk(15), costUsd: 0.15, share: 0.19 },
    ],
    topSteps: [
      { index: 10, at: '2026-10-24T11:31:12Z', label: 'Bash npm test -- stream', costUsd: 0.21 },
      {
        index: 7,
        at: '2026-10-24T11:21:40Z',
        label: 'Plan: (1) accept the Last-Event-ID header',
        costUsd: 0.1,
      },
    ],
    stages: running
      ? [{ stage: 'implementing', from: '2026-10-24T14:00:55Z', to: null }]
      : [
          { stage: 'planning', from: '2026-10-24T11:20:10Z', to: '2026-10-24T11:21:41Z' },
          { stage: 'implementing', from: '2026-10-24T11:21:41Z', to: '2026-10-24T11:36:05Z' },
        ],
    ...over,
  });
}

function tk(n: number) {
  return { input: n * 100, output: n * 10, cacheRead: n * 1000, cacheWrite: n * 50 };
}

function withDetail(d: SessionDetail, net: FakeNetwork = createFakeNetwork()): FakeNetwork {
  return net.on(
    'GET',
    `/sessions/${d.id}`,
    jsonResponse(SessionDetail, d, { asOfSeq: SEED_LAST_SEQ }),
  );
}

async function openLog(d: SessionDetail) {
  const app = renderApp({ route: `/sessions/${d.id}`, network: withDetail(d) });
  // The loading frame already carries the id as its title: wait for the loaded log itself.
  await screen.findByText('Session log');
  return app;
}

const filterButton = (name: RegExp | string) =>
  within(screen.getByRole('group', { name: 'Entry type' })).getByRole('button', { name });
const errorGroup = () => screen.getByRole('group', { name: 'Jump between failed tool calls' });
const entry = (index: number) => {
  const el = document.getElementById(`log-entry-${index}`);
  if (!el) throw new Error(`no entry ${index}`);
  return el;
};
/** Log rows in DOM order: the list items that carry a `log-entry-<n>` anchor. */
const entryRows = () =>
  screen.getAllByRole('listitem').filter((li) => li.id.startsWith('log-entry-'));
const hasEntry = (index: number) => document.getElementById(`log-entry-${index}`) !== null;

describe('Header and breadcrumbs (UI-AC-121)', () => {
  it('shows breadcrumb, MOCK banner, id, running note and the facts for a running session', async () => {
    await openLog(detail('S-0412'));

    // Contract: breadcrumb MISSION CONTROL / <agent> / <session>, Back button, MOCK DATA banner.
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'MISSION CONTROL' })).toHaveAttribute(
      'href',
      '/mission-control',
    );
    expect(within(crumbs).getByRole('link', { name: 'alpha' })).toHaveAttribute(
      'href',
      '/agents/alpha',
    );
    expect(within(crumbs).getByText('S-0412')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /^← BACK TO/ })).toBeInTheDocument();
    const banner = screen.getByRole('note');
    expect(banner).toHaveTextContent('MOCK DATA');
    expect(banner).toHaveTextContent('demo log, not a real session');

    // Contract: label, running notice, then Agent / Ticket links, Model, Time «Today hh:mm – now», Duration, Status.
    expect(screen.getByText('Session log')).toBeInTheDocument();
    expect(
      screen.getByText('SESSION STILL RUNNING — LATEST ENTRY AT THE BOTTOM'),
    ).toBeInTheDocument();
    const fact = (term: string) =>
      screen.getByText(term, { selector: 'dt' }).parentElement as HTMLElement;
    expect(within(fact('Agent')).getByRole('link', { name: 'alpha →' })).toHaveAttribute(
      'href',
      '/agents/alpha',
    );
    expect(within(fact('Ticket')).getByRole('link', { name: 'T-12 →' })).toHaveAttribute(
      'href',
      '/tickets/T-12',
    );
    expect(fact('Model')).toHaveTextContent('sonnet-5-5');
    expect(fact('Time')).toHaveTextContent('Today 14:00 – now');
    // Clock 14:32:00 minus start 14:00:50.
    expect(fact('Duration')).toHaveTextContent('31m');
    expect(fact('Status')).toHaveTextContent('RUNNING');
  });

  it('omits the running notice for a finished session and shows «none» for a missing ticket', async () => {
    await openLog(detail('S-0409', { ticketId: null }));

    // Contract: running notice only WHILE running; no ticket → «none» (not a link); Time ends at the end hh:mm.
    expect(screen.queryByText(/SESSION STILL RUNNING/)).not.toBeInTheDocument();
    const fact = (term: string) =>
      screen.getByText(term, { selector: 'dt' }).parentElement as HTMLElement;
    expect(fact('Ticket')).toHaveTextContent('none');
    expect(within(fact('Ticket')).queryByRole('link')).not.toBeInTheDocument();
    expect(fact('Time')).toHaveTextContent('Today 11:20 – 12:32');
    expect(fact('Duration')).toHaveTextContent('1h 11m');
    expect(fact('Status')).toHaveTextContent('DONE');
  });
});

describe('Token cells (UI-AC-122)', () => {
  it('shows token totals with their cost and the COST cell with the step count', async () => {
    await openLog(detail('S-0409'));

    // Contract: four token cells (tokens + their cost) and an ink COST cell «SUM OF N STEPS · MOCK PRICES».
    const cell = (label: string) =>
      screen.getByText(label, { selector: 'span' }).parentElement as HTMLElement;
    expect(cell('INPUT')).toHaveTextContent('12.3K$0.04');
    expect(cell('OUTPUT')).toHaveTextContent('678$0.01');
    expect(cell('CACHE READ')).toHaveTextContent('1.23M$0.37');
    expect(cell('CACHE WRITE')).toHaveTextContent('98.8K$0.37');
    // 5 + 2 + 1 + 2 + 3 = 13 steps with tokens.
    expect(cell('COST')).toHaveTextContent('$0.79SUM OF 13 STEPS · MOCK PRICES');
  });

  it('labels the cost cell COST SO FAR while the session is running', async () => {
    await openLog(detail('S-0412'));

    // Contract: WHILE Running the cost cell reads COST SO FAR.
    expect(screen.getByText('COST SO FAR')).toBeInTheDocument();
    expect(screen.queryByText('COST', { selector: 'span' })).not.toBeInTheDocument();
  });
});

describe('Where the tokens went (UI-AC-123)', () => {
  it('shows the explanation, the step note and an activity table sorted by cost', async () => {
    await openLog(detail('S-0409'));
    const section = screen.getByRole('region', { name: 'Where the tokens went' });

    // Contract: note «by kind of work · N steps with tokens», the four-token explanation, columns, rows by cost desc.
    expect(within(section).getByText('by kind of work · 13 steps with tokens')).toBeInTheDocument();
    expect(
      within(section).getByText(
        'Input — new text the model reads (file contents, command output). Output — what it writes (replies, edits). Cache read — context reused from earlier turns, cheap. Cache write — context stored for reuse, mostly at session start.',
      ),
    ).toBeInTheDocument();
    const table = within(section).getByRole('table', { name: 'Tokens by kind of work' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['ACTIVITY', 'STEPS', 'INPUT', 'OUTPUT', 'CACHE R', 'CACHE W', 'COST', 'SHARE']);
    const body = within(table).getAllByRole('row').slice(1);
    expect(body.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Reasoning & replies',
      'Reading code',
      'Running commands',
      'Editing code',
      'Session context',
    ]);
    expect(
      within(body[0] as HTMLElement)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Reasoning & replies', '5', '3.0K', '300', '30.0K', '1.5K', '$0.30', '39%']);
  });

  it.each([
    ['Reasoning & replies', /^MESSAGES/],
    ['Session context', /^STAGES & SYSTEM/],
    ['Reading code', /^TOOL CALLS/],
  ])('switches the log filter when the %s row is clicked', async (activity, filter) => {
    const { user } = await openLog(detail('S-0409'));
    expect(filterButton(/^ALL/)).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: activity }));

    // Contract: Reasoning → MESSAGES, Session context → STAGES & SYSTEM, any other → TOOL CALLS.
    expect(filterButton(filter)).toHaveAttribute('aria-pressed', 'true');
    expect(filterButton(/^ALL/)).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Filters and search (UI-AC-124)', () => {
  it('offers the five filters with counts and narrows the log by type', async () => {
    const { user } = await openLog(detail('S-0409'));

    // Contract: S-0409 has 19 entries: 6 messages, 8 tool calls (2 failed), 5 stage/system lines.
    const labels = within(screen.getByRole('group', { name: 'Entry type' }))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual([
      'ALL · 19',
      'MESSAGES · 6',
      'TOOL CALLS · 8',
      '▲ ERRORS · 2',
      'STAGES & SYSTEM · 5',
    ]);
    expect(filterButton(/^ALL/)).toHaveAttribute('aria-pressed', 'true');

    await user.click(filterButton(/^▲ ERRORS/));
    // Contract: ERRORS shows only the failed tool calls (entries 10 and 15).
    expect([10, 15].every(hasEntry)).toBe(true);
    expect([2, 5, 13, 4, 3].some(hasEntry)).toBe(false);

    await user.click(filterButton(/^MESSAGES/));
    expect([0, 4, 7, 11, 16, 17].every(hasEntry)).toBe(true);
    expect(hasEntry(2)).toBe(false);

    await user.click(filterButton(/^STAGES & SYSTEM/));
    expect([1, 3, 8, 14, 18].every(hasEntry)).toBe(true);
    expect(hasEntry(4)).toBe(false);
  });

  it('searches text, tool name, argument and output case-insensitively', async () => {
    const { user } = await openLog(detail('S-0409'));
    const search = screen.getByRole('searchbox', { name: 'Search in log' });
    const visible = () => [...Array(19).keys()].filter(hasEntry);

    // Contract: matches the entry text …
    await user.type(search, 'MONOTONIC');
    expect(visible()).toEqual([7]);
    // … the tool name …
    await user.clear(search);
    await user.type(search, 'grep');
    expect(visible()).toEqual([6]);
    // … the tool argument …
    await user.clear(search);
    await user.type(search, 'npm run typecheck');
    expect(visible()).toEqual([15]);
    // … and the tool output.
    await user.clear(search);
    await user.type(search, 'expected: 5 events');
    expect(visible()).toEqual([10]);
  });

  it('shows «Nothing matches this filter.» when nothing matches', async () => {
    const { user } = await openLog(detail('S-0409'));

    await user.type(screen.getByRole('searchbox', { name: 'Search in log' }), 'zzz-no-such-text');

    // Contract: an empty result set shows the explanatory line instead of a blank log.
    expect(screen.getByText('Nothing matches this filter.')).toBeInTheDocument();
    expect(hasEntry(0)).toBe(false);
  });
});

describe('Error jump (UI-AC-125, UI-AC-126)', () => {
  const scrolled = vi.fn();
  beforeAll(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrolled,
      configurable: true,
      writable: true,
    });
  });
  afterAll(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });
  afterEach(() => scrolled.mockClear());

  it('shows ERROR 1 OF 2 for S-0409, cycles with ↓ (twice returns to the first) and ↑, ringing and scrolling to the target', async () => {
    const { user } = await openLog(detail('S-0409'));
    const badge = () => within(errorGroup()).getByText(/ERROR \d OF \d/);

    // Contract: the cursor starts on the first error of two (AC-15: "reset the error cursor to the first error").
    expect(badge()).toHaveTextContent('▲ ERROR 1 OF 2');
    expect(within(errorGroup()).getByRole('button', { name: 'Previous error' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );

    // Contract: ↓ moves to the next failed call (entry 15), scrolls to it and rings it.
    await user.click(within(errorGroup()).getByRole('button', { name: 'Next error' }));
    expect(badge()).toHaveTextContent('▲ ERROR 2 OF 2');
    await waitFor(() => expect(scrolled.mock.contexts.at(-1)).toBe(entry(15)));
    // The tool box has no role or name; reach it from its visible failure mark.
    const box = (i: number) =>
      within(entry(i)).getByText('▲').closest('[data-failed]') as HTMLElement;
    expect(box(15).className).toMatch(/ring/);
    expect(box(10).className).not.toMatch(/ring/);

    // Contract: ↓ twice returns to the first error (cyclic).
    await user.click(within(errorGroup()).getByRole('button', { name: 'Next error' }));
    expect(badge()).toHaveTextContent('▲ ERROR 1 OF 2');
    await waitFor(() => expect(scrolled.mock.contexts.at(-1)).toBe(entry(10)));
    expect(box(10).className).toMatch(/ring/);
    expect(box(15).className).not.toMatch(/ring/);

    // Contract: ↑ from the first error wraps to the last one.
    await user.click(within(errorGroup()).getByRole('button', { name: 'Previous error' }));
    expect(badge()).toHaveTextContent('▲ ERROR 2 OF 2');
    await waitFor(() => expect(scrolled.mock.contexts.at(-1)).toBe(entry(15)));
  });

  it('resets the type filter to ALL and clears the search before landing on the error', async () => {
    const { user } = await openLog(detail('S-0409'));
    await user.click(filterButton(/^MESSAGES/));
    await user.type(screen.getByRole('searchbox', { name: 'Search in log' }), 'plan');
    expect(hasEntry(15)).toBe(false);

    await user.click(within(errorGroup()).getByRole('button', { name: 'Next error' }));

    // Contract: the jump must never land on a hidden entry: filter → ALL, search cleared.
    expect(filterButton(/^ALL/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox', { name: 'Search in log' })).toHaveValue('');
    expect(hasEntry(15)).toBe(true);
  });

  it('shows NO ERRORS and aria-disabled arrows for S-0412, and the arrows do nothing', async () => {
    const { user } = await openLog(detail('S-0412'));

    // Contract: no failed call → «NO ERRORS» and both arrows aria-disabled.
    expect(within(errorGroup()).getByText('NO ERRORS')).toBeInTheDocument();
    const prev = within(errorGroup()).getByRole('button', { name: 'Previous error' });
    const next = within(errorGroup()).getByRole('button', { name: 'Next error' });
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    expect(next).toHaveAttribute('aria-disabled', 'true');

    await user.click(next);
    await user.click(prev);
    expect(within(errorGroup()).getByText('NO ERRORS')).toBeInTheDocument();
    expect(scrolled).not.toHaveBeenCalled();
    expect(filterButton(/^▲ ERRORS · 0/)).toBeInTheDocument();
  });
});

describe('Entry rendering (UI-AC-127)', () => {
  it('renders operator, agent, tool, stage and system entries in order with their markers', async () => {
    await openLog(detail('S-0409'));

    // Contract: chronological order — entry ids ascend in the DOM.
    const ids = entryRows().map((li) => Number(li.id.replace('log-entry-', '')));
    expect(ids).toEqual([...Array(19).keys()]);

    // Contract: operator bubble.
    expect(within(entry(0)).getByText('● OPERATOR')).toBeInTheDocument();
    expect(within(entry(0)).getByText(/^Pick up T-12 from Agent Ops/)).toBeInTheDocument();
    // Contract: agent text with «<in> IN · <out> OUT · <cr> CACHE R · <cw> CACHE W · $cost».
    expect(within(entry(4)).getByText('◇ AGENT')).toBeInTheDocument();
    expect(
      within(entry(4)).getByText('12.4K IN · 610 OUT · 0 CACHE R · 18.2K CACHE W · $0.00'),
    ).toBeInTheDocument();
    // Contract: stage rule «■ <STAGE>» with AGENT REPORT.
    expect(within(entry(3)).getByText('■ PLANNING')).toBeInTheDocument();
    expect(within(entry(3)).getByText('AGENT REPORT')).toBeInTheDocument();
    expect(within(entry(14)).getByText('■ TESTING')).toBeInTheDocument();
    // Contract: system line «— <text>» with its tokens.
    expect(within(entry(1)).getByText(/^— Session started/)).toBeInTheDocument();
    expect(
      within(entry(1)).getByText(/^4\.1K IN · 0 OUT · 0 CACHE R · 22\.6K CACHE W/),
    ).toBeInTheDocument();
    // Contract: system line without tokens has none.
    expect(within(entry(18)).getByText('— Session ended · 1h 12m')).toBeInTheDocument();
    // Contract: tool box shows ✓ for a passing and ▲ for a failed call, name, argument, «result · NS» and tokens.
    expect(within(entry(13)).getByText('✓')).toBeInTheDocument();
    expect(within(entry(13)).getByText('Bash')).toBeInTheDocument();
    expect(within(entry(13)).getByText('npm test -- stream')).toBeInTheDocument();
    expect(within(entry(13)).getByText(/^EXIT 0 · \d+S$/)).toBeInTheDocument();
    expect(within(entry(13)).getByText(/^1\.7K IN · 108 OUT/)).toBeInTheDocument();
    expect(within(entry(10)).getByText('▲')).toBeInTheDocument();
    expect(within(entry(10)).getByText('EXIT 1 · 41S')).toBeInTheDocument();
    expect(within(entry(10)).queryByText('▲')).not.toBeNull();
    expect(within(entry(13)).queryByText('▲')).toBeNull();
  });

  it('renders log text and tool output as plain text, never as markup', async () => {
    const d = detail('S-0409');
    const payload =
      '<img src=x onerror="window.__pwned=1"> <b>bold</b> <script>window.__pwned=2</script>';
    const entries: LogEntry[] = d.entries.map((e) =>
      e.index === 4
        ? { ...e, text: payload }
        : e.index === 10 && e.tool
          ? { ...e, tool: { ...e.tool, output: `${payload}\nline 2` } }
          : e,
    );
    await openLog({ ...d, entries });

    // Contract: markup in agent text and tool output is shown literally and creates no elements.
    expect(within(entry(4)).getByText(payload)).toBeInTheDocument();
    expect(within(entry(4)).queryByRole('img')).toBeNull();
    expect(within(entry(10)).queryByRole('img')).toBeNull();
    for (const tag of ['b', 'script']) {
      expect(entry(4).getElementsByTagName(tag)).toHaveLength(0);
      expect(entry(10).getElementsByTagName(tag)).toHaveLength(0);
    }
    expect(within(entry(10)).getByText(/^<img src=x onerror=/)).toHaveTextContent(payload);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe('Long tool output (UI-AC-128)', () => {
  it('collapses an output longer than 4 lines to its first 4, and expands/collapses with aria-expanded', async () => {
    const { user } = await openLog(detail('S-0409'));
    const failed = entry(10);

    // Contract: 10-line output shows 4 lines and «+ SHOW 6 MORE LINES» (aria-expanded=false).
    const toggle = within(failed).getByRole('button', { name: '+ SHOW 6 MORE LINES' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(failed).getByText(/Expected: 5 events/)).toBeInTheDocument();
    expect(within(failed).queryByText(/Received: 3 events/)).not.toBeInTheDocument();

    await user.click(toggle);
    // Contract: expanded shows everything and the toggle becomes «− COLLAPSE».
    const collapse = within(failed).getByRole('button', { name: '− COLLAPSE' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    expect(within(failed).getByText(/Received: 3 events/)).toBeInTheDocument();

    await user.click(collapse);
    expect(within(failed).getByRole('button', { name: '+ SHOW 6 MORE LINES' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(within(failed).queryByText(/Received: 3 events/)).not.toBeInTheDocument();
  });

  it('shows outputs of 4 lines or fewer in full with no toggle', async () => {
    await openLog(detail('S-0409'));

    // Contract: a 4-line output (entry 5) and a 3-line one (entry 13) have no toggle; a 7-line one (entry 9) has.
    expect(within(entry(5)).queryByRole('button')).not.toBeInTheDocument();
    expect(within(entry(13)).queryByRole('button')).not.toBeInTheDocument();
    expect(
      within(entry(9)).getByRole('button', { name: '+ SHOW 3 MORE LINES' }),
    ).toBeInTheDocument();
  });
});

describe('Aside (UI-AC-129)', () => {
  it('lists the most expensive steps and the stages of the session', async () => {
    await openLog(detail('S-0409'));
    const steps = screen.getByRole('region', { name: 'Most expensive steps' });

    // Contract: each step shows hh:mm, label and cost; costliest first.
    const items = within(steps)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items[0]).toBe('11:31Bash npm test -- stream$0.21');
    expect(items[1]).toBe('11:21Plan: (1) accept the Last-Event-ID header$0.10');

    // Contract: stages show name and «hh:mm – <hh:mm|now>».
    const stages = screen.getByRole('region', { name: 'Stages in this session' });
    expect(
      within(stages)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Planning11:20 – 11:21', 'Implementing11:21 – 11:36']);
  });

  it('shows «now» for an open stage and a fallback when no stage was reported', async () => {
    cleanup();
    await openLog(detail('S-0412'));
    expect(
      within(screen.getByRole('region', { name: 'Stages in this session' })).getByText(
        '14:00 – now',
      ),
    ).toBeInTheDocument();

    cleanup();
    await openLog(detail('S-0409', { stages: [] }));
    // Contract: no stages → «No stage reported in this session.»
    expect(screen.getByText('No stage reported in this session.')).toBeInTheDocument();
  });
});

describe('Running session grows (UI-AC-130)', () => {
  it('appends new entries at the bottom and updates counts and totals after a refetch', async () => {
    const d = detail('S-0412');
    const { queryClient, network } = await openLog(d);
    expect(filterButton(/^ALL/)).toHaveTextContent('ALL · 13');
    expect(hasEntry(13)).toBe(false);

    const last = d.entries.at(-1) as LogEntry;
    const grown = SessionDetail.parse({
      ...d,
      costUsd: 0.95,
      entryCount: 14,
      entries: [
        ...d.entries,
        {
          ...last,
          index: 13,
          type: 'agent',
          text: 'A brand new reply',
          tool: null,
          tokens: null,
          costUsd: null,
          at: '2026-10-24T14:31:00Z',
        },
      ],
    });
    network.on(
      'GET',
      '/sessions/S-0412',
      jsonResponse(SessionDetail, grown, { asOfSeq: SEED_LAST_SEQ + 1 }),
    );
    await act(() => queryClient.invalidateQueries());

    // Contract: the new entry is the last row and the counts and cost update in place.
    expect(await screen.findByText('A brand new reply')).toBeInTheDocument();
    expect(filterButton(/^ALL/)).toHaveTextContent('ALL · 14');
    const ids = entryRows().map((li) => li.id);
    expect(ids.at(-1)).toBe('log-entry-13');
    expect(screen.getByText('COST SO FAR').parentElement).toHaveTextContent('$0.95');
  });
});

describe('Unknown session', () => {
  it("shows «Session <id> doesn't exist.» with a link back to Mission Control", async () => {
    renderApp({ route: '/sessions/S-9999' });

    // Contract: an unknown session id yields a not-found page, not a blank or error screen.
    expect(
      await screen.findByRole('heading', { level: 1, name: "Session S-9999 doesn't exist." }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← BACK TO MISSION CONTROL' })).toHaveAttribute(
      'href',
      '/mission-control',
    );
  });

  it('shows the load error with Retry on a server failure', async () => {
    const net = createFakeNetwork().on(
      'GET',
      '/sessions/S-0409',
      errorResponse(500, 'internal', 'Boom.'),
    );
    renderApp({ route: '/sessions/S-0409', network: net });

    // Contract: failures other than 404 are a retryable error, never partial numbers.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t load session log — the server is not responding.',
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Opening a different session resets local state (UI-AC-15)', () => {
  function usageNet(): FakeNetwork {
    const net = createFakeNetwork();
    withDetail(detail('S-0409'), net);
    withDetail(detail('S-0412'), net);
    return net;
  }

  it('starts at ALL, empty search, collapsed outputs and error 1 after visiting another session', async () => {
    const { user } = renderApp({ route: '/usage', network: usageNet() });
    const open = async (id: string) => {
      await user.click(await screen.findByRole('link', { name: `${id} →` }));
      await screen.findByText('Session log');
    };
    const back = () => user.click(screen.getByRole('button', { name: /^← BACK TO/ }));

    // Dirty the first session: filter, search, expanded output and the error cursor on error 2.
    await open('S-0409');
    await user.click(filterButton(/^TOOL CALLS/));
    await user.type(screen.getByRole('searchbox', { name: 'Search in log' }), 'bash');
    await user.click(within(errorGroup()).getByRole('button', { name: 'Next error' }));
    await user.click(within(entry(10)).getByRole('button', { name: '+ SHOW 6 MORE LINES' }));
    expect(within(errorGroup()).getByText(/ERROR 2 OF 2/)).toBeInTheDocument();
    await back();

    // Open a different session, then the first again.
    await open('S-0412');
    await back();
    await open('S-0409');

    // Contract: the log starts clean — ALL filter, empty search, collapsed output, cursor on the first error.
    expect(filterButton(/^ALL/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('searchbox', { name: 'Search in log' })).toHaveValue('');
    expect(within(entry(10)).getByRole('button', { name: '+ SHOW 6 MORE LINES' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(within(errorGroup()).getByText(/ERROR 1 OF 2/)).toBeInTheDocument();
  });
});

describe('UTC rendering (UI-AC-138)', () => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('shows simulation times in UTC although the browser zone is America/Los_Angeles', async () => {
    // Guard: the zone really changed (14:00Z would be 07:00 in Los Angeles).
    expect(new Date('2026-10-24T14:00:00Z').getHours()).not.toBe(14);

    await openLog(detail('S-0412'));

    // Contract: times (Time fact, entry stamps, aside) show the UTC clock reading, never the local one.
    expect(screen.getByText('Time', { selector: 'dt' }).parentElement).toHaveTextContent(
      'Today 14:00 – now',
    );
    expect(within(entry(0)).getByText('14:00')).toBeInTheDocument();
    expect(screen.getByText('14:00 – now')).toBeInTheDocument();
  });
});
