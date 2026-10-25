import type { Event } from '@agent-ops/shared';
import { describe, expect, it } from 'vitest';
import { buildSaidVsDid } from './said-vs-did.js';

let seq = 0;
function ev(type: string, source: string, at: string, payload: Record<string, unknown>): Event {
  seq += 1;
  return {
    seq,
    at: `2026-10-24T${at}.000Z`,
    realAt: '2026-10-24T14:32:00.000Z',
    source,
    category: source === 'agent_telemetry' ? 'tool' : 'agent',
    type,
    agentId: 'alpha',
    ticketId: 'T-1',
    sessionId: null,
    warn: false,
    payload: { summary: type, ...payload },
  } as unknown as Event;
}
const stage = (at: string, to: string) =>
  ev('agent.stage_changed', 'agent_report', at, { from: 'implementing', to });
const tool = (at: string, name: string) =>
  ev('tool.finished', 'agent_telemetry', at, { tool: name, arg: '', durationSec: 1, result: 'ok' });
const newestFirst = (list: Event[]) => [...list].reverse();

describe('buildSaidVsDid (API-AC-29)', () => {
  it('marks Testing followed by >=120 s of only reads/edits as one mismatch', () => {
    seq = 0;
    const list = [stage('14:05:00', 'testing'), tool('14:07:00', 'Read'), tool('14:09:00', 'Edit')];
    const r = buildSaidVsDid(newestFirst(list), '2026-10-24T14:16:00.000Z');
    expect(r.mismatchCount).toBe(1);
    expect(r.rows.filter((x) => x.mismatch).map((x) => x.seq)).toEqual([1]);
    expect(r.notes).toEqual([
      {
        from: '2026-10-24T14:05:00.000Z',
        to: '2026-10-24T14:16:00.000Z',
        text: 'Reported Testing, but ran no commands for 11 min — only reads and edits.',
      },
    ]);
    expect(r.rows[0]).toMatchObject({ said: 'agent.stage_changed', did: null });
    expect(r.rows[1]).toMatchObject({ said: null, did: 'tool.finished' });
  });

  it('is no mismatch when a Bash tool ran, no telemetry exists, or the span is short', () => {
    seq = 0;
    const withBash = [
      stage('14:05:00', 'testing'),
      tool('14:06:00', 'Bash'),
      tool('14:09:00', 'Read'),
    ];
    expect(buildSaidVsDid(newestFirst(withBash), '2026-10-24T14:16:00.000Z').mismatchCount).toBe(0);
    seq = 0;
    const silent = [stage('14:05:00', 'testing')];
    expect(buildSaidVsDid(newestFirst(silent), '2026-10-24T14:16:00.000Z').mismatchCount).toBe(0);
    seq = 0;
    const short = [stage('14:05:00', 'testing'), tool('14:05:30', 'Read')];
    expect(buildSaidVsDid(newestFirst(short), '2026-10-24T14:06:00.000Z').mismatchCount).toBe(0);
  });

  it('closes the span at the next stage report and keeps only the last 2 notes', () => {
    seq = 0;
    const list = [
      stage('13:00:00', 'testing'),
      tool('13:01:00', 'Read'),
      stage('13:05:00', 'implementing'),
      stage('13:10:00', 'testing'),
      tool('13:11:00', 'Read'),
      stage('13:15:00', 'implementing'),
      stage('13:20:00', 'testing'),
      tool('13:21:00', 'Read'),
      stage('13:25:00', 'implementing'),
    ];
    const r = buildSaidVsDid(newestFirst(list), '2026-10-24T14:00:00.000Z');
    expect(r.mismatchCount).toBe(3);
    expect(r.notes.map((n) => n.from)).toEqual([
      '2026-10-24T13:10:00.000Z',
      '2026-10-24T13:20:00.000Z',
    ]);
    expect(r.notes[1]?.to).toBe('2026-10-24T13:25:00.000Z');
  });

  it('uses at most 16 events in time order', () => {
    seq = 0;
    const list = Array.from({ length: 20 }, (_, i) =>
      tool(`10:${String(i).padStart(2, '0')}:00`, 'Read'),
    );
    const r = buildSaidVsDid(newestFirst(list), '2026-10-24T14:00:00.000Z');
    expect(r.rows).toHaveLength(16);
    expect(r.rows[0]?.seq).toBe(5);
    expect(r.rows.at(-1)?.seq).toBe(20);
  });
});
