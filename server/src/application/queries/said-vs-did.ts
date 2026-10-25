import type { Event, SaidVsDid } from '@agent-ops/shared';

export const SAID_VS_DID_ROWS = 16;
export const MISMATCH_MIN_SPAN_SEC = 120;
export const SAID_VS_DID_NOTES = 2;

const summaryOf = (e: Event): string => (e.payload as { summary: string }).summary;
const isBash = (e: Event): boolean => (e.payload as { tool?: string }).tool === 'Bash';

/**
 * API-AC-29. `eventsNewestFirst` are the agent's last `agent_report`/`agent_telemetry` feed events;
 * `now` closes the span of a Testing report that is still the latest stage report.
 */
export function buildSaidVsDid(eventsNewestFirst: readonly Event[], now: string): SaidVsDid {
  const events = eventsNewestFirst.slice(0, SAID_VS_DID_ROWS).reverse();
  const mismatchSeqs = new Set<number>();
  const notes: SaidVsDid['notes'] = [];

  events.forEach((e, i) => {
    if (e.type !== 'agent.stage_changed' || e.payload.to !== 'testing') return;
    const next = events.slice(i + 1).find((x) => x.type === 'agent.stage_changed');
    const to = next?.at ?? now;
    const spanSec = (Date.parse(to) - Date.parse(e.at)) / 1000;
    if (spanSec < MISMATCH_MIN_SPAN_SEC) return;
    const within = events
      .slice(i + 1)
      .filter((x) => x.source === 'agent_telemetry' && (next === undefined || x.seq < next.seq));
    if (within.length === 0 || within.some(isBash)) return;
    mismatchSeqs.add(e.seq);
    notes.push({
      from: e.at,
      to,
      text: `Reported Testing, but ran no commands for ${Math.floor(spanSec / 60)} min — only reads and edits.`,
    });
  });

  return {
    rows: events.map((e) => {
      const report = e.source === 'agent_report';
      return {
        seq: e.seq,
        at: e.at,
        said: report ? summaryOf(e) : null,
        did: report ? null : summaryOf(e),
        mismatch: mismatchSeqs.has(e.seq),
      };
    }),
    mismatchCount: notes.length,
    notes: notes.slice(-SAID_VS_DID_NOTES),
  };
}
