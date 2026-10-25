import { Link } from 'react-router';
import type { SessionDetail } from '@agent-ops/shared';
import { agentPath, ticketPath } from '../../app/routeInfo';
import {
  formatDay,
  formatDuration,
  formatHourMinute,
  formatMoney,
  formatPercent,
  formatTokens,
  secondsBetween,
} from '../../lib/format';
import { ACTIVITY_LABEL, SESSION_STATUS_LABEL, STAGE_LABEL } from '../../lib/labels';
import { DataTable, type DataColumn } from '../../ui/display';
import { stepsWithTokens } from './model';
import styles from './SessionLog.module.css';

type ActivityRow = SessionDetail['tokenActivity'][number];

export function Header({
  session,
  agentName,
  now,
}: {
  session: SessionDetail;
  agentName: string;
  now: string;
}) {
  const running = session.status === 'running';
  const status = SESSION_STATUS_LABEL[session.status];
  const end = session.endedAt ?? now;
  const time = `${formatDay(session.startedAt, now)} ${formatHourMinute(session.startedAt)} – ${
    session.endedAt ? formatHourMinute(session.endedAt) : 'now'
  }`;
  return (
    <div className={styles.header}>
      <div className={styles.titleBlock}>
        <span className={styles.label}>Session log</span>
        <h1 className={styles.id}>{session.id}</h1>
        {running && (
          <span className={styles.running}>
            <span className={styles.liveSquare} aria-hidden="true" />
            SESSION STILL RUNNING — LATEST ENTRY AT THE BOTTOM
          </span>
        )}
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Agent</dt>
          <dd>
            <Link to={agentPath(session.agentId)}>{agentName} →</Link>
          </dd>
        </div>
        <div>
          <dt>Ticket</dt>
          <dd>
            {session.ticketId ? (
              <Link to={ticketPath(session.ticketId)}>{session.ticketId} →</Link>
            ) : (
              <span className={styles.muted}>none</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd className={styles.mono}>{session.model}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{time}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(secondsBetween(session.startedAt, end))}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span aria-hidden="true">{status.glyph}</span> {status.word}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function TokenCells({ session }: { session: SessionDetail }) {
  const { tokens: t, costByType: c } = session;
  const cells = [
    { label: 'INPUT', value: formatTokens(t.input), sub: formatMoney(c.input) },
    { label: 'OUTPUT', value: formatTokens(t.output), sub: formatMoney(c.output) },
    { label: 'CACHE READ', value: formatTokens(t.cacheRead), sub: formatMoney(c.cacheRead) },
    { label: 'CACHE WRITE', value: formatTokens(t.cacheWrite), sub: formatMoney(c.cacheWrite) },
  ];
  return (
    <div className={styles.cells}>
      {cells.map((cell) => (
        <div key={cell.label} className={styles.cell}>
          <span className={styles.cellLabel}>{cell.label}</span>
          <span className={styles.cellValue}>{cell.value}</span>
          <span className={styles.cellSub}>{cell.sub}</span>
        </div>
      ))}
      <div className={`${styles.cell} ${styles.costCell}`}>
        <span className={styles.cellLabel}>
          {session.status === 'running' ? 'COST SO FAR' : 'COST'}
        </span>
        <span className={styles.cellValue}>{formatMoney(session.costUsd)}</span>
        <span className={styles.cellSub}>
          SUM OF {stepsWithTokens(session)} STEPS · MOCK PRICES
        </span>
      </div>
    </div>
  );
}

export function WhereTokensWent({
  session,
  onPick,
}: {
  session: SessionDetail;
  onPick: (row: ActivityRow) => void;
}) {
  const rows = [...session.tokenActivity].sort((a, b) => b.costUsd - a.costUsd);
  const total = rows.reduce((s, r) => s + r.costUsd, 0);
  const columns: DataColumn<ActivityRow>[] = [
    {
      key: 'activity',
      header: 'ACTIVITY',
      render: (r) => (
        <button
          type="button"
          className={styles.rowBtn}
          title="Show these steps in the log"
          onClick={() => onPick(r)}
        >
          {ACTIVITY_LABEL[r.activity]}
        </button>
      ),
    },
    { key: 'steps', header: 'STEPS', align: 'right', render: (r) => r.steps },
    { key: 'input', header: 'INPUT', align: 'right', render: (r) => formatTokens(r.tokens.input) },
    {
      key: 'output',
      header: 'OUTPUT',
      align: 'right',
      render: (r) => formatTokens(r.tokens.output),
    },
    {
      key: 'cr',
      header: 'CACHE R',
      align: 'right',
      render: (r) => formatTokens(r.tokens.cacheRead),
    },
    {
      key: 'cw',
      header: 'CACHE W',
      align: 'right',
      render: (r) => formatTokens(r.tokens.cacheWrite),
    },
    { key: 'cost', header: 'COST', align: 'right', render: (r) => formatMoney(r.costUsd) },
    {
      key: 'share',
      header: 'SHARE',
      render: (r) => (
        <span className={styles.share}>
          <span className={styles.track} aria-hidden="true">
            <span
              className={styles.fill}
              style={{ width: `${total > 0 ? (r.costUsd / total) * 100 : 0}%` }}
            />
          </span>
          <span className={styles.pct}>{formatPercent(r.costUsd, total)}</span>
        </span>
      ),
    },
  ];
  return (
    <section aria-labelledby="tokens-went" className={styles.went}>
      <div className={styles.wentHead}>
        <h2 id="tokens-went" className={styles.h2}>
          Where the tokens went
        </h2>
        <span className={styles.label}>
          by kind of work · {stepsWithTokens(session)} steps with tokens
        </span>
      </div>
      <p className={styles.explain}>
        Input — new text the model reads (file contents, command output). Output — what it writes
        (replies, edits). Cache read — context reused from earlier turns, cheap. Cache write —
        context stored for reuse, mostly at session start.
      </p>
      <div className={styles.scrollX}>
        <DataTable
          caption="Tokens by kind of work"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.activity}
          onRowClick={onPick}
        />
      </div>
    </section>
  );
}

export function LogAside({ session }: { session: SessionDetail }) {
  const top = session.topSteps;
  const max = Math.max(0, ...top.map((s) => s.costUsd));
  return (
    <aside className={styles.aside}>
      <section aria-labelledby="top-steps" className={styles.asideSection}>
        <h2 id="top-steps" className={styles.h2}>
          Most expensive steps
        </h2>
        <ol className={styles.topList}>
          {top.map((s) => (
            <li key={s.index} className={styles.topItem}>
              <span className={styles.topTime}>{formatHourMinute(s.at)}</span>
              <span className={styles.topLabel}>{s.label}</span>
              <span className={styles.topCost}>{formatMoney(s.costUsd)}</span>
              <span className={styles.topTrack} aria-hidden="true">
                <span
                  className={styles.fill}
                  style={{ width: `${max > 0 ? (s.costUsd / max) * 100 : 0}%` }}
                />
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="stages" className={styles.asideSection}>
        <h2 id="stages" className={styles.h2}>
          Stages in this session
        </h2>
        {session.stages.length === 0 ? (
          <p className={styles.muted}>No stage reported in this session.</p>
        ) : (
          <ol className={styles.stageList}>
            {session.stages.map((s) => (
              <li key={`${s.stage}-${s.from}`} className={styles.stageItem}>
                <span className={styles.square} aria-hidden="true" />
                <span className={styles.stageName}>{STAGE_LABEL[s.stage]}</span>
                <span className={styles.label}>
                  {formatHourMinute(s.from)} – {s.to ? formatHourMinute(s.to) : 'now'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
