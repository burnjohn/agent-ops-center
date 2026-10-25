import { Link, useNavigate } from 'react-router';
import type { SessionSort, SessionSummary } from '@agent-ops/shared';
import {
  useAgents,
  useModelPrices,
  useSessions,
  useSimulation,
  useTickets,
  useUsage,
} from '../../api/queries';
import { Loading, ScreenFrame } from '../../app/ScreenFrame';
import {
  formatDuration,
  formatMoney,
  formatPercent,
  formatStart,
  formatTokens,
  secondsBetween,
} from '../../lib/format';
import { ACTIVITY_LABEL, SESSION_STATUS_LABEL } from '../../lib/labels';
import { Segmented, Select } from '../../ui/controls';
import { BarChart, BreakdownList, KpiTile, MockBanner, MockTag, DataTable } from '../../ui/display';
import type { BreakdownItem, DataColumn } from '../../ui/display';
import {
  BREAKDOWN_ROWS,
  NO_TICKET,
  PERIOD_NAME,
  PERIOD_OPTIONS,
  SORT_NAME,
  costAxis,
  costXLabels,
  dayLabel,
  emptyPeriodText,
} from './model';
import {
  PAGE_SIZE,
  setAgentFilter,
  setModelFilter,
  setPeriod,
  showMoreRows,
  toggleSort,
  useUsageControls,
} from './state';
import styles from './Usage.module.css';

const sessionPath = (id: string) => `/sessions/${encodeURIComponent(id)}`;

export default function Screen() {
  const controls = useUsageControls();
  const usage = useUsage({ period: controls.period });
  const prices = useModelPrices();
  const agents = useAgents();
  const tickets = useTickets();
  const simulation = useSimulation();
  const sim = simulation.data;
  const sessions = useSessions({
    period: controls.period,
    sort: controls.sort,
    limit: controls.rows,
    offset: 0,
    ...(controls.agentId ? { agentId: controls.agentId } : {}),
    ...(controls.model ? { model: controls.model } : {}),
  });
  const navigate = useNavigate();

  const failed =
    usage.isError || prices.isError || agents.isError || tickets.isError || simulation.isError;
  const pending = usage.isPending || prices.isPending || agents.isPending || tickets.isPending;
  const now = sim?.clock;
  // UI time is never the browser clock (UI-AC-25/138): wait for the Simulation Clock.
  if (failed || pending || now === undefined) {
    return (
      <ScreenFrame
        title="Usage & Cost"
        screen="Usage & Cost"
        loading={!failed}
        error={failed}
        onRetry={() => {
          void usage.refetch();
          void prices.refetch();
          void agents.refetch();
          void tickets.refetch();
          void simulation.refetch();
        }}
      />
    );
  }

  const u = usage.data;
  const agentName = new Map(agents.data.map((a) => [a.id, a.name]));
  const ticketTitle = new Map(tickets.data.map((t) => [t.id, t.title]));
  const filtered = controls.agentId !== '' || controls.model !== '';

  const top = (
    items: typeof u.breakdowns.byAgent,
    build: (key: string | null, costUsd: number) => BreakdownItem,
  ) =>
    [...items]
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, BREAKDOWN_ROWS)
      .map((i) => build(i.key, i.costUsd));

  const byAgent = top(u.breakdowns.byAgent, (key, costUsd) => ({
    key: key ?? 'none',
    name: key ? (agentName.get(key) ?? key) : '—',
    costUsd,
    ...(key ? { href: `/agents/${encodeURIComponent(key)}` } : {}),
  }));
  const byTicket = top(u.breakdowns.byTicket, (key, costUsd) => ({
    key: key ?? 'none',
    name: key ? `${key} ${ticketTitle.get(key) ?? ''}`.trim() : NO_TICKET,
    costUsd,
    ...(key ? { href: `/tickets/${encodeURIComponent(key)}` } : {}),
  }));
  const byModel = top(u.breakdowns.byModel, (key, costUsd) => ({
    key: key ?? 'none',
    name: key ?? '—',
    costUsd,
    ...(key ? { onSelect: () => setModelFilter(key) } : {}),
  }));
  const byActivity: BreakdownItem[] = u.breakdowns.byActivity.map((i) => ({
    key: i.key ?? 'none',
    name: i.key ? (ACTIVITY_LABEL[i.key as keyof typeof ACTIVITY_LABEL] ?? i.key) : '—',
    costUsd: i.costUsd,
  }));

  const bars = u.costPerDay.map((d) => ({
    key: d.date,
    tooltip: `${dayLabel(d.date, d.isToday)} · ${formatMoney(d.costUsd)}`,
    value: d.costUsd,
    inPeriod: d.inPeriod,
    today: d.isToday,
  }));

  const priceColumns: DataColumn<(typeof prices.data.items)[number]>[] = [
    {
      key: 'model',
      header: 'MODEL',
      render: (p) => (
        <button type="button" className={styles.pricesBtn} onClick={() => setModelFilter(p.model)}>
          {p.model}
        </button>
      ),
    },
    { key: 'in', header: 'IN', align: 'right', render: (p) => p.inputPerM.toFixed(2) },
    { key: 'out', header: 'OUT', align: 'right', render: (p) => p.outputPerM.toFixed(2) },
    { key: 'cr', header: 'C·READ', align: 'right', render: (p) => p.cacheReadPerM.toFixed(2) },
    { key: 'cw', header: 'C·WRITE', align: 'right', render: (p) => p.cacheWritePerM.toFixed(2) },
  ];

  const numeric = (
    key: SessionSort,
    header: string,
    pick: (s: SessionSummary) => string,
  ): DataColumn<SessionSummary> => ({
    key,
    header,
    align: 'right',
    sortable: true,
    render: pick,
  });
  const sessionColumns: DataColumn<SessionSummary>[] = [
    {
      key: 'session',
      header: 'SESSION',
      render: (s) => (
        <Link to={sessionPath(s.id)} className={styles.link}>
          {s.id} →
        </Link>
      ),
    },
    { key: 'agent', header: 'AGENT', render: (s) => agentName.get(s.agentId) ?? s.agentId },
    { key: 'ticket', header: 'TICKET', render: (s) => s.ticketId ?? '—' },
    { key: 'model', header: 'MODEL', render: (s) => s.model },
    { key: 'started', header: 'STARTED', render: (s) => formatStart(s.startedAt, now) },
    {
      key: 'duration',
      header: 'DURATION',
      align: 'right',
      render: (s) => formatDuration(secondsBetween(s.startedAt, s.endedAt ?? now)),
    },
    {
      key: 'status',
      header: 'STATUS',
      render: (s) => {
        const label = SESSION_STATUS_LABEL[s.status];
        const tone =
          s.status === 'running' ? styles.live : s.status === 'failed' ? styles.attn : undefined;
        return (
          <span className={tone}>
            {label.glyph} {label.word}
          </span>
        );
      },
    },
    numeric('input', 'INPUT', (s) => formatTokens(s.tokens.input)),
    numeric('output', 'OUTPUT', (s) => formatTokens(s.tokens.output)),
    numeric('cacheRead', 'CACHE R', (s) => formatTokens(s.tokens.cacheRead)),
    numeric('cacheWrite', 'CACHE W', (s) => formatTokens(s.tokens.cacheWrite)),
    numeric('cost', 'COST', (s) => `${formatMoney(s.costUsd)}${s.costIsFinal ? '' : '*'}`),
  ];

  const page = sessions.data;
  const remaining = page ? page.total - page.items.length : 0;

  return (
    <ScreenFrame title="Usage & Cost" screen="Usage & Cost">
      <MockBanner>
        Fixed demo set plus the simulated agents’ live sessions — not real spend. Live token capture
        is not connected yet (PDR-0007).
      </MockBanner>
      <div className={styles.page}>
        <div className={styles.top}>
          <Segmented
            label="Period"
            options={PERIOD_OPTIONS}
            value={controls.period}
            onChange={setPeriod}
          />
        </div>
        <div className={styles.kpis}>
          <KpiTile
            label="TOTAL COST"
            value={formatMoney(u.kpis.totalCostUsd)}
            sub={PERIOD_NAME[controls.period]}
          />
          <KpiTile
            label="TOKENS"
            value={formatTokens(u.kpis.tokens)}
            sub={`${formatPercent(u.kpis.cacheReadShare, 1)} CACHE READ`}
          />
          <KpiTile
            label="SESSIONS"
            value={u.kpis.sessions}
            sub={`${u.kpis.runningNow} RUNNING NOW`}
          />
          <KpiTile
            label="AVG / SESSION"
            value={formatMoney(u.kpis.avgCostUsd)}
            sub={`MEDIAN ${formatMoney(u.kpis.medianCostUsd)}`}
          />
        </div>
        {u.kpis.sessions === 0 && (
          <p className={styles.empty}>{emptyPeriodText(sim?.playing ?? false)}</p>
        )}

        <section className={styles.section} aria-label="Cost per day">
          <div className={styles.head}>
            <h2 className={styles.h2}>Cost per day</h2>
            <span className={styles.note}>
              USD · last 30 days · selected period in ink · PEAK {formatMoney(u.peakUsd)}
            </span>
          </div>
          <BarChart
            bars={bars}
            axis={costAxis(u.peakUsd)}
            xLabels={costXLabels(u.costPerDay)}
            description={`Cost per day over the last 30 days, peak ${formatMoney(u.peakUsd)}`}
          />
        </section>

        <section className={styles.section} aria-label="Model prices">
          <div className={styles.head}>
            <h2 className={styles.h2}>
              Model prices <MockTag />
            </h2>
            <span className={styles.note}>
              USD per 1M tokens. Every cost in the app = tokens × these prices.
            </span>
          </div>
          <DataTable
            caption="Model prices"
            columns={priceColumns}
            rows={prices.data.items}
            rowKey={(p) => p.model}
            onRowClick={(p) => setModelFilter(p.model)}
          />
        </section>

        <section className={styles.section} aria-label="Breakdowns">
          <div className={styles.breakdowns}>
            <BreakdownList title="By agent" items={byAgent} />
            <BreakdownList title="By ticket" items={byTicket} />
            <BreakdownList title="By model" items={byModel} />
            <BreakdownList title="By activity" items={byActivity} />
          </div>
        </section>

        <section className={styles.section} aria-label="Sessions">
          <div className={styles.head}>
            <h2 className={styles.h2}>Sessions</h2>
            {page && (
              <span className={styles.note}>
                {page.items.length} OF {page.total} · SORTED BY {SORT_NAME[controls.sort]}
                {filtered ? ' · FILTERED' : ''}
              </span>
            )}
          </div>
          <div className={styles.filters}>
            <Select
              label="Agent"
              value={controls.agentId}
              onChange={(e) => setAgentFilter(e.target.value)}
            >
              <option value="">All agents</option>
              {agents.data.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Select
              label="Model"
              value={controls.model}
              onChange={(e) => setModelFilter(e.target.value)}
            >
              <option value="">All models</option>
              {prices.data.items.map((p) => (
                <option key={p.model} value={p.model}>
                  {p.model}
                </option>
              ))}
            </Select>
          </div>
          {sessions.isError ? (
            <p role="alert" className={styles.empty}>
              Couldn’t load sessions — the server is not responding.
            </p>
          ) : !page ? (
            <Loading />
          ) : (
            <>
              <DataTable
                caption="Sessions"
                columns={sessionColumns}
                rows={page.items}
                rowKey={(s) => s.id}
                onRowClick={(s) => void navigate(sessionPath(s.id))}
                sortKey={controls.sort === 'start' ? null : controls.sort}
                onSort={(key) => toggleSort(key as SessionSort)}
                more={remaining}
                moreLabel={`Show ${Math.min(PAGE_SIZE, remaining)} more`}
                onShowMore={showMoreRows}
                emptyText="No sessions match."
              />
              <p className={styles.foot}>* running session — cost so far, not final.</p>
            </>
          )}
        </section>
      </div>
    </ScreenFrame>
  );
}
