import { Link } from 'react-router';
import type { Agent, Event, SessionSummary, Ticket } from '@agent-ops/shared';
import { formatClock, formatMoney } from '../../lib/format';
import { KIND_LABEL, SESSION_STATUS_LABEL } from '../../lib/labels';
import { agentPath, sessionPath } from '../../app/routeInfo';
import {
  CurrentActionBox,
  HealthBadge,
  MockTag,
  SourceMark,
  StageStepper,
  eventText,
} from '../../ui/display';
import { MAX_SESSION_ROWS, NO_ASSIGNEE_TEXT } from './model';
import styles from './Ticket.module.css';

interface WhoProps {
  ticket: Ticket;
  agent: Agent | undefined;
  sessions: readonly SessionSummary[];
  now: string | undefined;
  playing: boolean;
}

/** UI-AC-73, AC-74. */
export function WhoIsOnIt({ ticket, agent, sessions, now, playing }: WhoProps) {
  const assigneeId = ticket.assigneeId;
  let body;
  if (assigneeId === null) {
    body = <p className={styles.empty}>{NO_ASSIGNEE_TEXT[ticket.status] ?? 'Nobody yet.'}</p>;
  } else {
    const onThis = agent?.currentTicketId === ticket.id;
    const mine = sessions.filter((s) => s.agentId === assigneeId);
    const running = mine.find((s) => s.status === 'running');
    const last = running ?? mine[0] ?? sessions[0];
    body = (
      <>
        <Link to={agentPath(assigneeId)} className={styles.agentLink}>
          {assigneeId}
        </Link>
        {agent && (
          <div className={styles.meta}>
            <span>{KIND_LABEL[agent.kind]}</span>
            <HealthBadge health={agent.health} />
          </div>
        )}
        {agent && onThis && (
          <>
            <StageStepper stage={agent.stage} showLabels />
            {now !== undefined && (
              <CurrentActionBox
                agent={agent}
                blocked={
                  ticket.blockedQuestion !== null
                    ? {
                        question: ticket.blockedQuestion,
                        since: ticket.lastUpdate?.at ?? ticket.updatedAt,
                      }
                    : null
                }
                now={now}
                playing={playing}
              />
            )}
          </>
        )}
        {agent && !onThis && (
          <p className={styles.empty}>
            {ticket.status === 'done' ? 'Finished here' : `${agent.name} has moved on`}
          </p>
        )}
        {last && (
          <Link to={sessionPath(last.id)} className={running ? styles.linkPrimary : styles.link}>
            {running && (
              <span aria-hidden="true" className={styles.liveSquare}>
                ■
              </span>
            )}
            {running ? 'Open current session log' : 'Open last session log'}
          </Link>
        )}
        <Link to={agentPath(assigneeId)} className={styles.link}>
          Agent page →
        </Link>
      </>
    );
  }
  return (
    <section aria-labelledby="who-heading" className={styles.box}>
      <h2 id="who-heading" className={styles.heading}>
        Who is on it
      </h2>
      {body}
    </section>
  );
}

/** UI-AC-75. `sessions` arrive newest first. */
export function SessionsCost({ sessions }: { sessions: readonly SessionSummary[] }) {
  const total = sessions.reduce((sum, s) => sum + s.costUsd, 0);
  return (
    <section aria-labelledby="cost-heading" className={styles.box}>
      <div className={styles.sessionHead}>
        <h2 id="cost-heading" className={styles.heading}>
          Sessions &amp; cost
        </h2>
        <MockTag />
      </div>
      {sessions.length === 0 ? (
        <p className={styles.empty}>No agent session has touched this ticket yet.</p>
      ) : (
        <>
          <div className={styles.total}>{formatMoney(total)}</div>
          <ul className={styles.list}>
            {sessions.slice(0, MAX_SESSION_ROWS).map((s) => {
              const st = SESSION_STATUS_LABEL[s.status];
              return (
                <li key={s.id}>
                  <Link to={sessionPath(s.id)}>{s.id}</Link> · {s.agentId} · {st.glyph} {st.word} ·{' '}
                  {formatMoney(s.costUsd)}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/** UI-AC-76: the server sends newest first; show the newest 30 oldest-first. */
export function Activity({ activity }: { activity: readonly Event[] }) {
  const ordered = [...activity].reverse();
  return (
    <section aria-labelledby="activity-heading" className={styles.box}>
      <h2 id="activity-heading" className={styles.heading}>
        Activity
      </h2>
      <p className={styles.legend}>● OPERATOR ■ REPORT ◆ TELEMETRY</p>
      <ul className={styles.list}>
        {ordered.map((e) => (
          <li key={e.seq} className={`${styles.event} ${e.warn ? styles.warn : ''}`}>
            <span className={styles.time}>{formatClock(e.at)}</span>
            <SourceMark source={e.source} />
            <span className={styles.eventText}>{eventText(e)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
