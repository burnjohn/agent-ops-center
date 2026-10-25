import { useEventsFeed } from '../../api/queries';
import { Button, Segmented, Select } from '../../ui/controls';
import { EventRow } from '../../ui/display';
import { CATEGORY_OPTIONS, SOURCE_OPTIONS, maxSeq, mergeFeed, type CategoryFilter } from './model';
import {
  setEventCategory,
  setEventSource,
  pauseEventLog,
  resumeEventLog,
  useEventLogControls,
} from './eventLogState';
import styles from './EventLog.module.css';

/** UI-AC-99…103: filtered feed, `Show 40 more`, pause with held-event banner. */
export function EventLog() {
  const { source, category, heldSeq, frozen, frozenKey } = useEventLogControls();

  const filtered = useEventsFeed({
    ...(source !== 'all' && { source }),
    ...(category !== 'all' && { category }),
  });
  // Unfiltered feed: the banner counts all new events, whatever the filters (same query when unfiltered).
  const everything = useEventsFeed({});

  const rows = mergeFeed(filtered.data?.pages.map((p) => p.data) ?? []);
  const all = mergeFeed(everything.data?.pages.map((p) => p.data) ?? []);
  const paused = heldSeq !== null;
  // While paused the rows seen at pause time stay exactly as they were (refetches push held events into the
  // first page and would drop the oldest rows); older rows loaded by `Show 40 more` are merged in.
  const filterKey = `${source}|${category}`;
  const base = paused && frozenKey === filterKey ? frozen : [];
  const shown = paused
    ? mergeFeed([{ items: base }, { items: rows.filter((e) => e.seq <= heldSeq) }])
    : rows;
  const held = paused ? all.filter((e) => e.seq > heldSeq).length : 0;

  const togglePause = () =>
    paused ? resumeEventLog() : pauseEventLog(Math.max(maxSeq(rows), maxSeq(all)), rows, filterKey);

  return (
    <aside className={styles.log} aria-labelledby="event-log-title">
      <div className={styles.head}>
        <h2 id="event-log-title" className={styles.title}>
          Event Log
        </h2>
        <span className={styles.sub}>Newest first</span>
        <Button size="sm" className={styles.pause} aria-pressed={paused} onClick={togglePause}>
          {paused ? '▶ RESUME' : 'Ⅱ PAUSE'}
        </Button>
      </div>
      <div className={styles.filters}>
        <Segmented
          label="Source"
          options={SOURCE_OPTIONS}
          value={source}
          onChange={setEventSource}
        />
        <Select
          label="Category"
          value={category}
          onChange={(e) => setEventCategory(e.target.value as CategoryFilter)}
        >
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      {paused && held > 0 && (
        <button type="button" className={styles.banner} onClick={togglePause}>
          PAUSED · {held} NEW EVENTS — RESUME ↑
        </button>
      )}
      {filtered.isError ? (
        <p role="alert" className={styles.note}>
          Couldn’t load the Event Log.{' '}
          <Button size="sm" onClick={() => void filtered.refetch()}>
            Retry
          </Button>
        </p>
      ) : filtered.isPending ? (
        <p className={styles.note}>LOADING…</p>
      ) : (
        <ol className={styles.list}>
          {shown.map((e) => (
            <EventRow key={e.seq} event={e} />
          ))}
        </ol>
      )}
      {filtered.hasNextPage && (
        <div className={styles.more}>
          <Button
            disabled={filtered.isFetchingNextPage}
            onClick={() => void filtered.fetchNextPage()}
          >
            Show 40 more
          </Button>
        </div>
      )}
    </aside>
  );
}
