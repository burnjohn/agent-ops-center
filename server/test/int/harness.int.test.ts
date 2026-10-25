import { count } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { agents, sessionLogEntries } from '../../src/infrastructure/db/schema.js';
import { freshFixture, openTestDb, withTx } from './db.js';
import { parseSse } from './sse-client.js';

const handle = openTestDb();

describe('integration harness', () => {
  beforeEach(() => freshFixture(handle.db));

  it('loads the seed fixture into the test database (6 agents)', async () => {
    // contract: a fresh fixture contains exactly the 6 seeded agents
    const rows = await handle.db.select({ n: count() }).from(agents);
    expect(rows[0]?.n).toBe(6);
  });

  it('rolls back withTx writes and resets state between tests', async () => {
    // contract: changes inside withTx never persist
    const before = await handle.db.select({ n: count() }).from(sessionLogEntries);
    await withTx(handle.db, (tx) => tx.delete(sessionLogEntries));
    const after = await handle.db.select({ n: count() }).from(sessionLogEntries);
    expect(before[0]?.n).toBeGreaterThan(0);
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});

describe('parseSse', () => {
  it('parses id/event/data and skips comments', () => {
    // contract: comment-only blocks are not messages; fields map to message parts
    const msgs = parseSse(': hi\n\nid: 7\nevent: ticket\ndata: {"a":1}\n\n');
    expect(msgs).toEqual([{ id: '7', event: 'ticket', data: '{"a":1}' }]);
  });
});
