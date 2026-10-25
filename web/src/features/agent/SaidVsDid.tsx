import type { SaidVsDid } from '@agent-ops/shared';
import { formatHourMinute } from '../../lib/format';
import { DataTable, type DataColumn } from '../../ui/display';
import type { SaidVsDidRow } from '@agent-ops/shared';
import styles from './Agent.module.css';

const columns: DataColumn<SaidVsDidRow>[] = [
  { key: 'time', header: 'TIME', render: (r) => formatHourMinute(r.at) },
  { key: 'said', header: '■ SAID — AGENT REPORT', render: (r) => r.said ?? '' },
  {
    key: 'did',
    header: '◆ DID — AGENT TELEMETRY',
    render: (r) => (
      <span
        className={r.mismatch ? styles.mismatchText : undefined}
        data-mismatch={r.mismatch || undefined}
      >
        {r.did ?? ''}
      </span>
    ),
  },
];

/** AC-107: rows, flags, count and notes come from the server; the UI never computes mismatches. */
export function SaidVsDidSection({ agentId, data }: { agentId: string; data: SaidVsDid }) {
  return (
    <section className={styles.section} aria-labelledby="agent-svd">
      <div className={styles.sectionHead}>
        <h2 id="agent-svd" className={styles.h2}>
          Said vs did
        </h2>
        {data.mismatchCount >= 1 && (
          <span className={styles.mismatchBadge}>▲ {data.mismatchCount} MISMATCH</span>
        )}
        <span className={styles.hint}>
          What {agentId} reported next to what its tools actually did — latest {data.rows.length}{' '}
          events.
        </span>
      </div>
      <div className={styles.svd}>
        <DataTable
          caption="Said vs did"
          columns={columns}
          rows={data.rows}
          rowKey={(r) => String(r.seq)}
        />
      </div>
      {data.notes.slice(0, 2).map((n) => (
        <p key={`${n.from}-${n.to}`} className={styles.note}>
          ▲ {formatHourMinute(n.from)}–{formatHourMinute(n.to)} {n.text}
        </p>
      ))}
    </section>
  );
}
