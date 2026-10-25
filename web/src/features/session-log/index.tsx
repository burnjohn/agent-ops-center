import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { useAgents, useSession, useSimulation } from '../../api/queries';
import { BackBar } from '../../app/BackBar';
import { EntityNotFound } from '../../app/EntityNotFound';
import { MISSION_CONTROL_PATH, agentPath } from '../../app/routeInfo';
import { ScreenFrame } from '../../app/ScreenFrame';
import { Segmented } from '../../ui/controls';
import { MockBanner } from '../../ui/display';
import { EntryRow } from './Entry';
import {
  FILTER_LABEL,
  FILTER_ORDER,
  entryAnchor,
  filterCounts,
  filterForActivity,
  isFailedTool,
  matchesFilter,
  matchesSearch,
  type LogFilter,
} from './model';
import { Header, LogAside, TokenCells, WhereTokensWent } from './Panels';
import styles from './SessionLog.module.css';

/** Session Log (UI-AC-121…130). Log and tool output are rendered as plain text only. */
export default function Screen() {
  const { sessionId = '' } = useParams();
  const query = useSession(sessionId);
  const agents = useAgents();
  const simulation = useSimulation();

  if (query.error instanceof ApiError && query.error.status === 404) {
    return <EntityNotFound kind="Session" id={sessionId} />;
  }
  if (query.isError) {
    return (
      <ScreenFrame
        title={sessionId}
        screen="session log"
        error
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) {
    return <ScreenFrame title={sessionId} screen="session log" loading />;
  }
  const session = query.data;
  const agentName = agents.data?.find((a) => a.id === session.agentId)?.name ?? session.agentId;
  const now = simulation.data?.clock ?? session.endedAt ?? session.startedAt;

  // Keyed by session id: switching sessions resets filter, search, expanded outputs and error cursor (UI-AC-15).
  return <SessionLog key={session.id} session={session} agentName={agentName} now={now} />;
}

function SessionLog({
  session,
  agentName,
  now,
}: {
  session: NonNullable<ReturnType<typeof useSession>['data']>;
  agentName: string;
  now: string;
}) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const [cursor, setCursor] = useState(0);
  const [ringed, setRinged] = useState<number | null>(null);
  const [scrollTo, setScrollTo] = useState<{ index: number } | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  const failed = useMemo(() => session.entries.filter(isFailedTool), [session.entries]);
  const counts = useMemo(() => filterCounts(session.entries), [session.entries]);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(
    () => session.entries.filter((e) => matchesFilter(e, filter) && matchesSearch(e, needle)),
    [session.entries, filter, needle],
  );
  const toggle = useCallback((index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // Scroll after the filter reset has rendered the target entry.
  useEffect(() => {
    if (!scrollTo) return;
    const el = logRef.current?.querySelector(`#${entryAnchor(scrollTo.index)}`);
    el?.scrollIntoView?.({ block: 'center' });
  }, [scrollTo]);

  const n = failed.length;
  const current = n > 0 ? Math.min(cursor, n - 1) : 0;
  const jump = (delta: 1 | -1) => {
    if (n === 0) return;
    const next = (current + delta + n) % n;
    const target = failed[next];
    if (!target) return;
    setCursor(next);
    setFilter('all');
    setSearch('');
    setRinged(target.index);
    setScrollTo({ index: target.index });
  };

  return (
    <div>
      <BackBar
        crumbs={[
          { label: 'MISSION CONTROL', to: MISSION_CONTROL_PATH },
          { label: agentName, to: agentPath(session.agentId) },
          { label: session.id },
        ]}
      />
      <MockBanner>demo log, not a real session</MockBanner>
      <Header session={session} agentName={agentName} now={now} />
      <TokenCells session={session} />
      <WhereTokensWent
        session={session}
        onPick={(row) => setFilter(filterForActivity(row.activity))}
      />
      <div className={styles.split}>
        <main className={styles.main}>
          <div className={styles.toolbar}>
            <Segmented
              label="Entry type"
              value={filter}
              onChange={setFilter}
              options={FILTER_ORDER.map((f) => ({
                value: f,
                label: `${FILTER_LABEL[f]} · ${counts[f]}`,
              }))}
            />
            <input
              type="search"
              className={styles.search}
              aria-label="Search in log"
              placeholder="Search in log"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div role="group" aria-label="Jump between failed tool calls" className={styles.errors}>
              <span className={n > 0 ? styles.errBadge : styles.noErrBadge}>
                {n > 0 ? `▲ ERROR ${current + 1} OF ${n}` : 'NO ERRORS'}
              </span>
              <button
                type="button"
                className={styles.arrow}
                aria-label="Previous error"
                aria-disabled={n === 0}
                onClick={() => jump(-1)}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.arrow}
                aria-label="Next error"
                aria-disabled={n === 0}
                onClick={() => jump(1)}
              >
                ↓
              </button>
            </div>
          </div>
          <ol ref={logRef} className={styles.log} aria-live="polite">
            {visible.map((entry) => (
              <EntryRow
                key={entry.index}
                entry={entry}
                expanded={expanded.has(entry.index)}
                ringed={ringed === entry.index}
                onToggle={toggle}
              />
            ))}
          </ol>
          {visible.length === 0 && <p className={styles.empty}>Nothing matches this filter.</p>}
        </main>
        <LogAside session={session} />
      </div>
    </div>
  );
}
