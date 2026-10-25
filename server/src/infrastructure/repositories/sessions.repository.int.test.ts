import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshFixture, openTestDb, withTx } from '../../../test/int/db.js';
import { SessionsRepository } from './sessions.repository.js';

const handle = openTestDb();
const { db } = handle;

describe('SessionsRepository (regression: correlated entryCount subquery)', () => {
  beforeEach(() => freshFixture(db));

  it('runningFor / get resolve entryCount from the outer session row, not from the entry id', async () => {
    await withTx(db, async (tx) => {
      const repo = new SessionsRepository(tx);
      const res = await tx.execute(sql`select agent_id from sessions where id = 'S-0412'`);
      const agentId = (res.rows[0] as { agent_id: string }).agent_id;
      const expected = await tx.execute(
        sql`select count(*)::int as n from session_log_entries where session_id = 'S-0412'`,
      );
      const n = (expected.rows[0] as { n: number }).n;
      expect(n).toBeGreaterThan(0);

      // contract: the query does not throw ("text = bigint") and counts the session's own entries
      const running = await repo.runningFor(agentId);
      expect(running?.id).toBe('S-0412');
      const got = await repo.get('S-0412');
      expect(got?.id).toBe('S-0412');
      expect(got?.status).toBe('running');
      expect(got?.entryCount).toBe(n);
      expect(await repo.get('S-9999')).toBeNull();
    });
  });

  it('entries() returns the session entries in ordinal order', async () => {
    const repo = new SessionsRepository(db);
    const entries = await repo.entries('S-0412');
    const got = await repo.get('S-0412');
    expect(entries).toHaveLength(got!.entryCount);
    expect(entries.map((e) => e.index)).toEqual(entries.map((_, i) => i));
  });
});
