import {
  ModelPricesResponse,
  SimulationState,
  UsageResponse,
  type Period,
} from '@agent-ops/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakeNetwork, jsonResponse, type FakeNetwork } from '../../test/fakeNetwork';
import { SEED_LAST_SEQ, buildSimulation } from '../../test/fixtures';
import { renderApp } from '../../test/renderApp';

afterEach(() => {
  cleanup();
});

const DAY_MS = 86_400_000;
/** Seed Simulation Clock is 2026-10-24T14:32:00Z: the 30 chart days run Sep 25 … Oct 24. */
const LAST_DAY = Date.UTC(2026, 9, 24);

function costPerDay(inPeriodDays: number) {
  return Array.from({ length: 30 }, (_, i) => ({
    date: new Date(LAST_DAY - (29 - i) * DAY_MS).toISOString().slice(0, 10),
    inPeriod: i >= 30 - inPeriodDays,
    isToday: i === 29,
    costUsd: i === 29 ? 30 : 5 + (i % 5),
  }));
}

const item = (key: string | null, costUsd: number, total: number) => ({
  key,
  costUsd,
  share: costUsd / total,
});

function usageFor(period: Period) {
  if (period === '7d') {
    return UsageResponse.parse({
      period,
      dataSource: 'mock',
      kpis: {
        totalCostUsd: 80.5,
        tokens: 400_000,
        cacheReadShare: 0.5,
        sessions: 40,
        runningNow: 4,
        avgCostUsd: 2.01,
        medianCostUsd: 1.5,
      },
      costPerDay: costPerDay(7),
      peakUsd: 30,
      breakdowns: { byAgent: [], byTicket: [], byModel: [], byActivity: [] },
    });
  }
  if (period === 'today') {
    return UsageResponse.parse({
      period,
      dataSource: 'mock',
      kpis: {
        totalCostUsd: 0,
        tokens: 0,
        cacheReadShare: 0,
        sessions: 0,
        runningNow: 0,
        avgCostUsd: 0,
        medianCostUsd: 0,
      },
      costPerDay: costPerDay(1).map((d) => ({ ...d, costUsd: 0 })),
      peakUsd: 0,
      breakdowns: { byAgent: [], byTicket: [], byModel: [], byActivity: [] },
    });
  }
  const total = 100;
  return UsageResponse.parse({
    period,
    dataSource: 'mock',
    kpis: {
      totalCostUsd: 305.19,
      tokens: 12_345_678,
      cacheReadShare: 0.873,
      sessions: 121,
      runningNow: 4,
      avgCostUsd: 2.52,
      medianCostUsd: 2.1,
    },
    costPerDay: costPerDay(30),
    peakUsd: 30,
    breakdowns: {
      // Seven agents: only the six costliest may be listed. `retired` is the cheapest.
      byAgent: [
        item('retired', 0.5, total),
        item('sim-3', 5, total),
        item('alpha', 40, total),
        item('bravo', 20, total),
        item('charlie', 15, total),
        item('sim-1', 10, total),
        item('sim-2', 9.5, total),
      ],
      // Eight tickets incl. «No ticket» (null) which is the costliest; T-8 and T-9 are cut.
      byTicket: [
        item(null, 50, total),
        item('T-1', 10, total),
        item('T-2', 9, total),
        item('T-3', 8, total),
        item('T-4', 7, total),
        item('T-5', 6, total),
        item('T-8', 2, total),
        item('T-9', 1, total),
      ],
      byModel: [
        item('haiku-5-5', 5, total),
        item('sonnet-5-5', 60, total),
        item('opus-5-5', 35, total),
      ],
      byActivity: [
        item('editing_code', 30, total),
        item('reading_code', 25, total),
        item('reasoning_replies', 20, total),
        item('running_commands', 10, total),
        item('agent_ops', 8, total),
        item('session_context', 7, total),
      ],
    },
  });
}

/** Usage and prices with the fixed numbers these tests assert; `/sessions` is the server-like default. */
function withUsageApi(
  net: FakeNetwork = createFakeNetwork(),
  opts: { playing?: boolean; usage?: (p: Period) => ReturnType<typeof usageFor> } = {},
): FakeNetwork {
  net.on('GET', '/usage', (req) =>
    jsonResponse(UsageResponse, (opts.usage ?? usageFor)(req.query.get('period') as Period), {
      asOfSeq: SEED_LAST_SEQ,
    }),
  );
  net.on('GET', '/model-prices', () =>
    jsonResponse(
      ModelPricesResponse,
      {
        items: [
          {
            model: 'sonnet-5-5',
            inputPerM: 3,
            outputPerM: 15,
            cacheReadPerM: 0.3,
            cacheWritePerM: 3.75,
          },
          {
            model: 'opus-5-5',
            inputPerM: 15,
            outputPerM: 75,
            cacheReadPerM: 1.5,
            cacheWritePerM: 18.75,
          },
          {
            model: 'haiku-5-5',
            inputPerM: 1,
            outputPerM: 5,
            cacheReadPerM: 0.1,
            cacheWritePerM: 1.25,
          },
        ],
        dataSource: 'mock',
      },
      { asOfSeq: SEED_LAST_SEQ },
    ),
  );
  if (opts.playing) {
    net.on(
      'GET',
      '/simulation',
      jsonResponse(SimulationState, buildSimulation({ playing: true }), { asOfSeq: SEED_LAST_SEQ }),
    );
  }
  return net;
}

async function renderUsage(net: FakeNetwork = withUsageApi()) {
  const app = renderApp({ route: '/usage', network: net });
  await screen.findByRole('table', { name: 'Sessions' });
  return app;
}

function kpi(label: string): HTMLElement {
  const tile = screen.getByText(label).parentElement;
  if (!tile) throw new Error(`no KPI ${label}`);
  return tile;
}

const region = (name: string) => screen.getByRole('region', { name });
const sessionsTable = () => screen.getByRole('table', { name: 'Sessions' });
const rowCount = () => within(sessionsTable()).getAllByRole('row').length - 1;
const lastSessionsQuery = (net: FakeNetwork) => net.calls('GET', '/sessions').at(-1)?.query;

describe('Usage & Cost header (UI-AC-110)', () => {
  it('shows the MOCK DATA banner, title and the period control defaulting to 30 DAYS', async () => {
    await renderUsage();

    // Contract: striped MOCK DATA banner carries the PDR-0007 disclaimer.
    const banner = screen.getByRole('note');
    expect(banner).toHaveTextContent('MOCK DATA');
    expect(banner).toHaveTextContent(
      'Fixed demo set plus the simulated agents’ live sessions — not real spend. Live token capture is not connected yet (PDR-0007).',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Usage & Cost' })).toBeInTheDocument();

    // Contract: period options in order, 30 DAYS pressed by default.
    const group = screen.getByRole('group', { name: 'Period' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['TODAY', '7 DAYS', '30 DAYS', 'ALL TIME']);
    expect(within(group).getByRole('button', { name: '30 DAYS' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group).getByRole('button', { name: '7 DAYS' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('KPIs and period (UI-AC-111, UI-AC-112)', () => {
  it('shows the four KPIs with their sub-lines for the seed 30-day period', async () => {
    await renderUsage();

    // Contract: golden total $305.19; 121 sessions, 4 running now; cache-read share as a whole percent.
    expect(kpi('TOTAL COST')).toHaveTextContent('$305.19');
    expect(kpi('TOTAL COST')).toHaveTextContent('LAST 30 DAYS');
    expect(kpi('TOKENS')).toHaveTextContent('12.35M');
    expect(kpi('TOKENS')).toHaveTextContent('87% CACHE READ');
    expect(kpi('SESSIONS')).toHaveTextContent('121');
    expect(kpi('SESSIONS')).toHaveTextContent('4 RUNNING NOW');
    expect(kpi('AVG / SESSION')).toHaveTextContent('$2.52');
    expect(kpi('AVG / SESSION')).toHaveTextContent('MEDIAN $2.10');
  });
});

describe('Period switching', () => {
  it('requests usage and sessions for the picked period, recomputes KPIs and resets 24 rows to 12', async () => {
    const app = await renderUsage();
    const { user, network } = app;

    // Grow the table to 24 rows first.
    await user.click(screen.getByRole('button', { name: 'Show 12 more' }));
    await waitFor(() => expect(rowCount()).toBe(24));

    await user.click(screen.getByRole('button', { name: '7 DAYS' }));

    // Contract: every KPI/breakdown/table is recomputed for the new period and the table is back at 12 rows.
    await waitFor(() => expect(kpi('TOTAL COST')).toHaveTextContent('$80.50'));
    expect(kpi('TOTAL COST')).toHaveTextContent('LAST 7 DAYS');
    expect(kpi('SESSIONS')).toHaveTextContent('40');
    expect(screen.getByRole('button', { name: '7 DAYS' })).toHaveAttribute('aria-pressed', 'true');
    expect(network.calls('GET', '/usage').at(-1)?.query.get('period')).toBe('7d');
    const q = lastSessionsQuery(network);
    expect(q?.get('period')).toBe('7d');
    expect(q?.get('limit')).toBe('12');
    await waitFor(() => expect(rowCount()).toBe(12));
  });
});

describe('Empty period (UI-AC-113)', () => {
  it('shows zero KPIs and the Play hint while the simulation is not auto-playing', async () => {
    const { user } = await renderUsage();
    await user.click(screen.getByRole('button', { name: 'TODAY' }));

    // Contract: no session in the period → zero KPIs and the full copy including «or press Play…».
    expect(
      await screen.findByText(
        'No sessions in this period yet. Pick a longer period, or press Play to let the simulated agents work.',
      ),
    ).toBeInTheDocument();
    expect(kpi('TOTAL COST')).toHaveTextContent('$0.00');
    expect(kpi('SESSIONS')).toHaveTextContent('0');
    expect(kpi('SESSIONS')).toHaveTextContent('0 RUNNING NOW');
  });

  it('drops the «press Play» part while auto-play is on', async () => {
    const { user } = await renderUsage(withUsageApi(createFakeNetwork(), { playing: true }));
    await user.click(screen.getByRole('button', { name: 'TODAY' }));

    // Contract: with auto-play on, the hint to press Play is omitted.
    expect(
      await screen.findByText('No sessions in this period yet. Pick a longer period.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/press Play/)).not.toBeInTheDocument();
  });
});

describe('Cost per day (UI-AC-114)', () => {
  it('describes the chart, shows PEAK, a 4-step USD axis and a TODAY label', async () => {
    await renderUsage();
    const chart = region('Cost per day');

    // Contract: heading note + accessible description + axis peak, ⅔, ⅓, $0.
    expect(
      within(chart).getByText(/USD · last 30 days · selected period in ink · PEAK \$30\.00/),
    ).toBeInTheDocument();
    expect(
      within(chart).getByRole('img', { name: 'Cost per day over the last 30 days, peak $30.00' }),
    ).toBeInTheDocument();
    for (const tick of ['$30.00', '$20.00', '$10.00', '$0.00']) {
      expect(within(chart).getByText(tick)).toBeInTheDocument();
    }
    // Contract: the last of the four date labels is TODAY and the first is the first day (Sep 25).
    expect(within(chart).getByText('SEP 25')).toBeInTheDocument();
    expect(within(chart).getByText('TODAY')).toBeInTheDocument();
    expect(within(chart).getByText('OCT 14')).toBeInTheDocument();
  });

  // TODO: suspected bug — costXLabels picks the first intermediate label with Math.round(29 / 3) = 10, which
  // is Oct 5. The spec's seed labels are SEP 25 / OCT 4 / OCT 14 / TODAY (day indexes 0, 9, 19, 29).
  // ref: web/src/features/usage/model.ts:50
  it('labels the chart SEP 25 / OCT 4 / OCT 14 / TODAY on the seed clock', async () => {
    await renderUsage();
    const chart = region('Cost per day');

    // Contract (AC-114 observable): exactly these four labels, derived from the Simulation Clock.
    expect(within(chart).getByText('OCT 4')).toBeInTheDocument();
  });

  it('shows a «<Mon D|Today> · $x.xx» tooltip when a bar is hovered', async () => {
    const { user } = await renderUsage();
    const chart = region('Cost per day');
    // The SVG bars have no accessible handle; the hit rectangles are the 10-unit-wide rects, one per slot.
    const hits = [...chart.getElementsByTagName('rect')].filter(
      (r) => r.getAttribute('width') === '10',
    );
    expect(hits).toHaveLength(30);

    await user.hover(hits[0] as Element);
    // Contract: first day is Sep 25 with its cost; last day reads «Today».
    expect(await within(chart).findByText('Sep 25 · $5.00')).toBeInTheDocument();
    await user.hover(hits[29] as Element);
    expect(await within(chart).findByText('Today · $30.00')).toBeInTheDocument();
  });
});

describe('Model prices (UI-AC-115)', () => {
  it('shows the MOCK tag, the explainer and a 2-decimal price table', async () => {
    await renderUsage();
    const prices = region('Model prices');

    // Contract: MOCK tag + explainer copy + columns MODEL, IN, OUT, C·READ, C·WRITE with 2 decimals.
    expect(within(prices).getByText('MOCK')).toBeInTheDocument();
    expect(
      within(prices).getByText('USD per 1M tokens. Every cost in the app = tokens × these prices.'),
    ).toBeInTheDocument();
    const table = within(prices).getByRole('table', { name: 'Model prices' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['MODEL', 'IN', 'OUT', 'C·READ', 'C·WRITE']);
    const sonnet = within(table).getByRole('button', { name: 'sonnet-5-5' }).closest('tr');
    expect(sonnet).not.toBeNull();
    expect(
      within(sonnet as HTMLElement)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['sonnet-5-5', '3.00', '15.00', '0.30', '3.75']);
  });

  it('sets the sessions Model filter when a price row is clicked', async () => {
    const { user, network } = await renderUsage();

    await user.click(within(region('Model prices')).getByRole('button', { name: 'sonnet-5-5' }));

    // Contract: clicking a model row sets the sessions table's Model filter to it.
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('sonnet-5-5');
    await waitFor(() => expect(lastSessionsQuery(network)?.get('model')).toBe('sonnet-5-5'));
    expect(await screen.findByText(/· FILTERED/)).toBeInTheDocument();
  });
});

describe('Breakdowns (UI-AC-116)', () => {
  it('lists the six costliest agents by cost descending as links to the agent', async () => {
    await renderUsage();
    const byAgent = region('By agent');

    // Contract: titled «Cost · share», 6 rows, costliest first, the cheapest (7th) dropped.
    expect(within(byAgent).getByText('Cost · share')).toBeInTheDocument();
    const rows = within(byAgent).getAllByRole('link');
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.textContent)).toEqual([
      'alpha$40.0040%',
      'bravo$20.0020%',
      'charlie$15.0015%',
      'sim-1$10.0010%',
      'sim-2$9.5010%',
      'sim-3$5.005%',
    ]);
    expect(within(byAgent).queryByText('retired')).not.toBeInTheDocument();
    expect(rows[0]).toHaveAttribute('href', '/agents/alpha');
  });

  it('shows «No ticket» as a non-link row and ticket rows as links to the ticket', async () => {
    await renderUsage();
    const byTicket = region('By ticket');

    // Contract: 6 costliest rows incl. «No ticket»; «No ticket» is not a link; T-8/T-9 are cut.
    expect(within(byTicket).getByText('No ticket')).toBeInTheDocument();
    expect(within(byTicket).queryByRole('link', { name: /No ticket/ })).not.toBeInTheDocument();
    const links = within(byTicket).getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links[0]).toHaveAttribute('href', '/tickets/T-1');
    expect(links[0]).toHaveTextContent('T-1 Event store on SQLite');
    expect(within(byTicket).queryByText(/T-8/)).not.toBeInTheDocument();
    expect(within(byTicket).queryByText(/T-9/)).not.toBeInTheDocument();
  });

  it('shows model rows as filter buttons and every activity as a plain row', async () => {
    const { user, network } = await renderUsage();

    // Contract: model rows set the Model filter.
    const byModel = region('By model');
    expect(
      within(byModel)
        .getAllByRole('button')
        .map((b) => b.textContent?.split('$')[0]),
    ).toEqual(['sonnet-5-5', 'opus-5-5', 'haiku-5-5']);
    await user.click(within(byModel).getByRole('button', { name: /opus-5-5/ }));
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('opus-5-5');
    await waitFor(() => expect(lastSessionsQuery(network)?.get('model')).toBe('opus-5-5'));

    // Contract: «By activity» shows all rows (6 > the 6-row cap boundary is still all of them), none a link.
    const byActivity = region('By activity');
    expect(within(byActivity).getAllByRole('listitem')).toHaveLength(6);
    expect(within(byActivity).queryByRole('link')).not.toBeInTheDocument();
    expect(within(byActivity).queryByRole('button')).not.toBeInTheDocument();
    expect(within(byActivity).getAllByRole('listitem')[0]).toHaveTextContent(
      'Editing code$30.0030%',
    );
  });
});

describe('Sessions table (UI-AC-117)', () => {
  it('shows N OF M, the columns, newest-first rows, running asterisk and the footnote', async () => {
    await renderUsage();

    // Contract: note «12 OF 121 · SORTED BY START TIME», 12 rows, «Show 12 more», footnote.
    expect(screen.getByText('12 OF 121 · SORTED BY START TIME')).toBeInTheDocument();
    expect(rowCount()).toBe(12);
    expect(screen.getByRole('button', { name: 'Show 12 more' })).toBeInTheDocument();
    expect(screen.getByText('* running session — cost so far, not final.')).toBeInTheDocument();
    const table = sessionsTable();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'SESSION',
      'AGENT',
      'TICKET',
      'MODEL',
      'STARTED',
      'DURATION',
      'STATUS',
      'INPUT',
      'OUTPUT',
      'CACHE R',
      'CACHE W',
      'COST',
    ]);

    // Contract: newest first; S-0415 is a running session with no ticket (`—`), started «Today 14:29».
    const first = within(table).getAllByRole('row')[1] as HTMLElement;
    const cells = within(first)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells.slice(0, 7)).toEqual([
      'S-0415 →',
      'charlie',
      '—',
      'haiku-5-5',
      'Today 14:29',
      '2m',
      '● RUNNING',
    ]);
    expect(cells[11]).toMatch(/^\$\d+\.\d\d\*$/); // running cost carries `*`
    expect(within(first).getByRole('link', { name: 'S-0415 →' })).toHaveAttribute(
      'href',
      '/sessions/S-0415',
    );

    // Contract: a finished session shows ■ DONE, a date for earlier days, and no asterisk on its cost.
    const done = within(table).getByRole('link', { name: 'S-0410 →' }).closest('tr') as HTMLElement;
    const doneCells = within(done)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(doneCells[6]).toBe('■ DONE');
    expect(doneCells[11]).toMatch(/^\$\d+\.\d\d$/);
    const older = within(table)
      .getByRole('link', { name: 'S-0114 →' })
      .closest('tr') as HTMLElement;
    expect(within(older).getAllByRole('cell')[4]).toHaveTextContent('Oct 23 13:02');
  });

  it('adds 12 more rows per «Show 12 more» click', async () => {
    const { user, network } = await renderUsage();

    await user.click(screen.getByRole('button', { name: 'Show 12 more' }));

    // Contract: the page grows by 12 and the note counts the shown rows.
    await waitFor(() => expect(rowCount()).toBe(24));
    expect(screen.getByText('24 OF 121 · SORTED BY START TIME')).toBeInTheDocument();
    expect(lastSessionsQuery(network)?.get('limit')).toBe('24');
  });
});

describe('Sorting (UI-AC-118)', () => {
  it('sorts descending by a numeric column with ↓ and returns to start order on a second click', async () => {
    const { user, network } = await renderUsage();
    const header = () => within(sessionsTable()).getByRole('columnheader', { name: /^INPUT/ });

    // Contract: numeric headers are buttons with aria-sort; inactive = none.
    expect(header()).toHaveAttribute('aria-sort', 'none');
    await user.click(within(header()).getByRole('button'));

    // Contract: first click → descending by it, `↓` after the label, note names the sort.
    await waitFor(() => expect(header()).toHaveAttribute('aria-sort', 'descending'));
    expect(header()).toHaveTextContent('INPUT ↓');
    expect(await screen.findByText(/SORTED BY INPUT/)).toBeInTheDocument();
    expect(lastSessionsQuery(network)?.get('sort')).toBe('input');

    // Contract: second click returns to start-time order.
    await user.click(within(header()).getByRole('button'));
    await waitFor(() => expect(header()).toHaveAttribute('aria-sort', 'none'));
    expect(await screen.findByText(/SORTED BY START TIME/)).toBeInTheDocument();
  });
});

describe('Filters (UI-AC-119)', () => {
  it('resets the table to 12 rows and marks the note FILTERED when Agent or Model changes', async () => {
    const { user, network } = await renderUsage();
    await user.click(screen.getByRole('button', { name: 'Show 12 more' }));
    await waitFor(() => expect(rowCount()).toBe(24));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'alpha');

    // Contract: changing the Agent filter resets paging to 12 rows and narrows to that agent's sessions.
    await waitFor(() =>
      expect(screen.getByText('12 OF 46 · SORTED BY START TIME · FILTERED')).toBeInTheDocument(),
    );
    expect(lastSessionsQuery(network)?.get('agentId')).toBe('alpha');
    expect(lastSessionsQuery(network)?.get('limit')).toBe('12');
    expect(rowCount()).toBe(12);

    await user.click(screen.getByRole('button', { name: 'Show 12 more' }));
    await waitFor(() => expect(rowCount()).toBe(24));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'opus-5-5');

    // Contract: changing the Model filter also resets to 12 rows.
    await waitFor(() => expect(lastSessionsQuery(network)?.get('model')).toBe('opus-5-5'));
    expect(lastSessionsQuery(network)?.get('limit')).toBe('12');
    await waitFor(() => expect(rowCount()).toBeLessThanOrEqual(12));
  });
});

describe('Opening a session (UI-AC-120)', () => {
  it('opens the Session Log from the S-xxxx link', async () => {
    const { user } = await renderUsage();

    await user.click(within(sessionsTable()).getByRole('link', { name: 'S-0410 →' }));

    // Contract: the link opens that session's log.
    expect(await screen.findByRole('heading', { level: 1, name: 'S-0410' })).toBeInTheDocument();
  });

  it('opens the Session Log when the row itself is clicked', async () => {
    const { user } = await renderUsage();
    const row = within(sessionsTable())
      .getByRole('link', { name: 'S-0410 →' })
      .closest('tr') as HTMLElement;

    await user.click(within(row).getByText('sonnet-5-5'));

    // Contract: clicking anywhere on the row opens the session.
    expect(await screen.findByRole('heading', { level: 1, name: 'S-0410' })).toBeInTheDocument();
  });
});

describe('Module-level state survives navigation (UI-AC-14)', () => {
  it('keeps period, sort and filters after opening a session and coming back', async () => {
    const { user } = await renderUsage();
    await user.click(screen.getByRole('button', { name: '7 DAYS' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'alpha');
    await user.click(
      within(within(sessionsTable()).getByRole('columnheader', { name: /^OUTPUT/ })).getByRole(
        'button',
      ),
    );
    await waitFor(() => expect(screen.getByText(/SORTED BY OUTPUT/)).toBeInTheDocument());

    await user.click(within(sessionsTable()).getAllByRole('link')[0] as HTMLElement);
    await screen.findByRole('heading', { level: 1, name: /^S-\d+$/ });
    await user.click(screen.getByRole('button', { name: /^← BACK TO/ }));

    // Contract: navigation never changes the Usage controls; only an Operator action does.
    await screen.findByRole('table', { name: 'Sessions' });
    expect(screen.getByRole('button', { name: '7 DAYS' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Agent' })).toHaveValue('alpha');
    expect(await screen.findByText(/SORTED BY OUTPUT/)).toBeInTheDocument();
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

  it('shows start times and the chart ending in TODAY by the UTC clock under America/Los_Angeles', async () => {
    // Guard: the zone really changed (14:29Z would be 07:29 in Los Angeles).
    expect(new Date('2026-10-24T14:29:50Z').getHours()).not.toBe(14);
    await renderUsage();

    // Contract: table start times and chart day labels follow the UTC date/time of the Simulation Clock.
    const first = within(sessionsTable())
      .getByRole('link', { name: 'S-0415 →' })
      .closest('tr') as HTMLElement;
    expect(within(first).getAllByRole('cell')[4]).toHaveTextContent('Today 14:29');
    const older = within(sessionsTable())
      .getByRole('link', { name: 'S-0114 →' })
      .closest('tr') as HTMLElement;
    expect(within(older).getAllByRole('cell')[4]).toHaveTextContent('Oct 23 13:02');
    const chart = region('Cost per day');
    expect(within(chart).getByText('SEP 25')).toBeInTheDocument();
    expect(within(chart).getByText('TODAY')).toBeInTheDocument();
  });
});
