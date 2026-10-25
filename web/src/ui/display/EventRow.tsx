import type { Event } from '@agent-ops/shared';
import { Link } from 'react-router';
import { formatClock } from '../../lib/format';
import { SourceMark } from './SourceMark';
import styles from './EventRow.module.css';

/** UI-AC-105: the text is `payload.summary` verbatim, as plain text; fallback is the event `type`. */
export function eventText(event: Pick<Event, 'type' | 'payload'>): string {
  const summary = (event.payload as { summary?: unknown }).summary;
  return typeof summary === 'string' && summary !== '' ? summary : event.type;
}

export interface EventRowProps {
  event: Pick<Event, 'at' | 'source' | 'warn' | 'type' | 'payload' | 'agentId' | 'ticketId'>;
}

export function EventRow({ event }: EventRowProps) {
  return (
    <li className={`${styles.row} ${event.warn ? styles.warn : ''}`}>
      <span className={styles.time}>{formatClock(event.at)}</span>
      <SourceMark source={event.source} />
      <span className={styles.who}>
        {event.source === 'operator' ? (
          'you'
        ) : event.agentId ? (
          <Link to={`/agents/${event.agentId}`}>{event.agentId}</Link>
        ) : null}
      </span>
      <span className={styles.text}>{eventText(event)}</span>
      <span className={styles.ticket}>
        {event.ticketId && <Link to={`/tickets/${event.ticketId}`}>{event.ticketId}</Link>}
      </span>
    </li>
  );
}
