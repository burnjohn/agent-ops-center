import type { DragEvent, KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Agent, Ticket } from '@agent-ops/shared';
import { formatAge } from '../../lib/format';
import { STAGE_LABEL } from '../../lib/labels';
import { PriorityBars, StageStepper } from '../../ui/display';
import styles from './TicketCard.module.css';

export interface TicketCardProps {
  ticket: Ticket;
  agent: Agent | undefined;
  clock: string | undefined;
  blocked: boolean;
  updated: boolean;
  dragging: boolean;
  draggable: boolean;
  onDragStart: (ticket: Ticket, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

/** UI-AC-38…41: one focus stop (the card), Enter or click anywhere opens the ticket. */
export function TicketCard({
  ticket,
  agent,
  clock,
  blocked,
  updated,
  dragging,
  draggable,
  onDragStart,
  onDragEnd,
}: TicketCardProps) {
  const navigate = useNavigate();
  const path = `/tickets/${encodeURIComponent(ticket.id)}`;
  const done = ticket.status === 'done';
  const open = () => navigate(path);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault();
      open();
    }
  };

  const onThisTicket = agent !== undefined && agent.currentTicketId === ticket.id;
  const showAgent = ticket.assigneeId !== null && !done;
  const stageText = onThisTicket && agent ? STAGE_LABEL[agent.stage].toUpperCase() : 'WAITING';
  const stepperStage = onThisTicket && agent ? agent.stage : 'idle';
  const update = ticket.lastUpdate?.text;

  const classes = [
    styles.card,
    blocked ? styles.blocked : '',
    done ? styles.done : '',
    updated ? styles.updated : '',
    dragging ? styles.dragging : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={classes}
      tabIndex={0}
      aria-label={`${ticket.id} ${ticket.title}`}
      draggable={draggable}
      onDragStart={(e) => onDragStart(ticket, e)}
      onDragEnd={onDragEnd}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <div className={styles.head}>
        <span className={styles.id}>{ticket.id}</span>
        <PriorityBars priority={ticket.priority} />
        {updated && !blocked && (
          <span className={styles.flag}>
            <span className={styles.square} aria-hidden="true" />
            UPDATED
          </span>
        )}
        {blocked && <span className={styles.flagBlocked}>■ BLOCKED</span>}
      </div>
      <Link
        to={path}
        tabIndex={-1}
        className={styles.title}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      >
        {ticket.title}
      </Link>
      {blocked && <p className={styles.question}>{ticket.blockedQuestion}</p>}
      {showAgent && (
        <div className={styles.agent}>
          <StageStepper stage={stepperStage} />
          <div className={styles.agentRow}>
            <span className={styles.agentId}>{ticket.assigneeId}</span>
            <span className={styles.sub}>{stageText}</span>
            <span className={`${styles.sub} ${styles.age}`}>
              {clock ? formatAge(ticket.updatedAt, clock) : ''}
            </span>
          </div>
        </div>
      )}
      {!blocked && !done && update && <p className={`${styles.update} ${styles.sub}`}>{update}</p>}
    </article>
  );
}
