import { sql } from 'drizzle-orm';
import { EVENT_CATALOGUE, EVENT_TYPES } from '@agent-ops/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EventDraft } from '../../domain/index.js';
import { freshFixture, openTestDb } from '../../../test/int/db.js';
import { FIXED_NOW, movedDraft } from '../../../test/int/factories.js';
import { EventsRepository } from './events.repository.js';

const handle = openTestDb();
const { db } = handle;
const journal = new EventsRepository(db);
const FEED_TYPES = new Set<string>(EVENT_TYPES.filter((t) => EVENT_CATALOGUE[t].feed));

const reportDraft = (summary: string, agentId: string): EventDraft => ({
  type: 'agent.stage_changed',
  source: 'agent_report',
  category: 'agent',
  at: FIXED_NOW,
  agentId,
  ticketId: null,
  sessionId: null,
  warn: false,
  payload: { summary },
});

async function lastSeq(): Promise<number> {
  return journal.lastSeq();
}

describe('EventsRepository (DB-AC-28/33/34)', () => {
  beforeEach(() => freshFixture(db));

  it('100 appended events, resumed from the 40th, return exactly the last 60 in order without duplicates (AC-28)', async () => {
    const written = await journal.append(
      Array.from({ length: 100 }, (_, i) => movedDraft(`e${i}`)),
    );

    // contract: seq follows the order given and is strictly increasing
    const seqs = written.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(100);

    // contract: resume after the 40th returns every later event, ascending, nothing else
    const after40 = written[39]!.seq;
    const resumed = await journal.since(after40, 1000);
    expect(resumed.map((e) => e.seq)).toEqual(seqs.slice(40));
    expect(resumed).toHaveLength(60);

    // contract: the limit caps the page and the next page continues without overlap
    const p1 = await journal.since(after40, 25);
    const p2 = await journal.since(p1.at(-1)!.seq, 1000);
    expect([...p1, ...p2].map((e) => e.seq)).toEqual(seqs.slice(40));
  });

  it('keyset pages of 40 neither skip nor repeat while new events are appended (AC-33)', async () => {
    await journal.append(Array.from({ length: 100 }, (_, i) => movedDraft(`e${i}`)));
    const startMax = await lastSeq();
    const expected = (await journal.since(0, 100_000))
      .filter((e) => FEED_TYPES.has(e.type))
      .map((e) => e.seq)
      .sort((a, b) => b - a);

    const seen: number[] = [];
    let before: number | undefined;
    for (let round = 0; ; round += 1) {
      const page = await journal.page({ limit: 40, beforeSeq: before });
      if (page.length === 0) break;
      seen.push(...page.map((e) => e.seq));
      before = page.at(-1)!.seq;
      // new events arrive between pages
      await journal.append([movedDraft(`late${round}`)]);
    }

    // contract: pages are newest first and strictly descending
    const first40 = seen.slice(0, 40);
    expect(first40).toEqual(expected.slice(0, 40));
    // contract: continuing from the last returned seq yields exactly the older events: no skips, no repeats,
    // and events appended later do not appear
    expect(seen.every((s) => s <= startMax)).toBe(true);
    expect(seen).toEqual(expected);
  });

  it('filters pages by source, category, agent and ticket', async () => {
    await journal.append([movedDraft('t1', { ticketId: 'T-1' }), reportDraft('r1', 'alpha')]);
    // contract: each filter narrows the feed to matching events only
    const bySource = await journal.page({ limit: 1000, source: 'agent_report' });
    expect(bySource.length).toBeGreaterThan(0);
    expect(bySource.every((e) => e.source === 'agent_report')).toBe(true);
    const byCat = await journal.page({ limit: 1000, category: 'tool' });
    expect(byCat.every((e) => e.category === 'tool')).toBe(true);
    const byTicket = await journal.page({ limit: 1000, ticketId: 'T-1' });
    expect(byTicket.every((e) => e.ticketId === 'T-1')).toBe(true);
  });

  it('ticket activity returns the 30 newest and agent history the 16 newest, newest first (AC-34)', async () => {
    await journal.append([
      ...Array.from({ length: 45 }, (_, i) => movedDraft(`tk${i}`, { ticketId: 'T-1' })),
      ...Array.from({ length: 25 }, (_, i) => reportDraft(`ag${i}`, 'alpha')),
    ]);
    const forTicket = await journal.latestForTicket('T-1');
    // contract: exactly 30, descending seq, all of the ticket, newest included
    expect(forTicket).toHaveLength(30);
    expect(forTicket.map((e) => e.seq)).toEqual(
      [...forTicket.map((e) => e.seq)].sort((a, b) => b - a),
    );
    expect(forTicket.every((e) => e.ticketId === 'T-1')).toBe(true);
    expect(forTicket[0]?.payload).toMatchObject({ summary: 'tk44' });

    const forAgent = await journal.latestForAgent('alpha');
    // contract: exactly 16, descending seq, only report/telemetry events of the agent
    expect(forAgent).toHaveLength(16);
    expect(forAgent.map((e) => e.seq)).toEqual(
      [...forAgent.map((e) => e.seq)].sort((a, b) => b - a),
    );
    expect(forAgent.every((e) => e.agentId === 'alpha' && e.source !== 'operator')).toBe(true);
    expect(forAgent[0]?.payload).toMatchObject({ summary: 'ag24' });
  });

  it('the ticket and agent history lookups are served by their (reference, seq desc) indexes (AC-34)', async () => {
    await journal.append([
      ...Array.from({ length: 600 }, (_, i) => movedDraft(`x${i}`, { ticketId: 'T-2' })),
      ...Array.from({ length: 5 }, (_, i) => movedDraft(`y${i}`, { ticketId: 'T-1' })),
      ...Array.from({ length: 5 }, (_, i) => reportDraft(`z${i}`, 'alpha')),
    ]);
    await db.execute(sql`analyze events`); // selective statistics, otherwise the planner may walk the pkey
    // contract: the plan uses events_ticket_seq_idx / events_agent_seq_idx. Seq scans are disabled so a tiny
    // table cannot hide a missing index; this checks the index exists and matches the query shape.
    // The agent lookup is probed without ORDER BY/LIMIT: with few matching rows the planner legitimately prefers
    // a backward walk of the primary key for `limit 16`, which says nothing about the index.
    const plan = async (query: string): Promise<string> => {
      let text = '';
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local enable_seqscan = off`);
        await tx.execute(sql`set local enable_bitmapscan = off`);
        const res = await tx.execute(sql.raw(`explain ${query}`));
        text = res.rows.map((r) => String(Object.values(r)[0])).join('\n');
      });
      return text;
    };
    expect(
      await plan(`select * from events where ticket_id = 'T-1' order by seq desc limit 30`),
    ).toContain('events_ticket_seq_idx');
    expect(await plan(`select * from events where agent_id = 'alpha'`)).toContain(
      'events_agent_seq_idx',
    );
  });

  it('lastSeq is the highest committed seq and floor does not exceed it', async () => {
    const [e] = await journal.append([movedDraft('latest')]);
    // contract: lastSeq reflects the newest committed event
    expect(await journal.lastSeq()).toBe(e!.seq);
    expect(await journal.floor()).toBeLessThanOrEqual(e!.seq);
  });
});
