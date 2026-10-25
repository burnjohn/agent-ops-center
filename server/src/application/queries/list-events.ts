import type { EventsPageResponse, EventsQuery } from '@agent-ops/shared';
import type { SnapshotReader } from '../ports/read-queries.js';

/** API-AC-25: feed events only, newest first, keyset on `beforeSeq`. */
export function listEvents(snapshots: SnapshotReader, query: EventsQuery) {
  return snapshots.read(async (q): Promise<EventsPageResponse> => {
    const rows = await q.journal.page({ ...query, limit: query.limit + 1 });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextBeforeSeq: rows.length > query.limit && last ? last.seq : null,
    };
  });
}
