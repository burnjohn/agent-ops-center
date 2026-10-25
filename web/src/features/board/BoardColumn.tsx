import type { DragEvent, ReactNode } from 'react';
import type { TicketStatus } from '@agent-ops/shared';
import { STATUS_LABEL, STATUS_NUMBER } from '../../lib/labels';
import type { DropHint } from '../moves';
import styles from './BoardColumn.module.css';

export interface BoardColumnProps {
  status: TicketStatus;
  count: number;
  /** Null when nothing is dragged or for the card's own column. */
  hint: DropHint | null;
  hovered: boolean;
  empty: string | null;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  children: ReactNode;
}

export function BoardColumn({
  status,
  count,
  hint,
  hovered,
  empty,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: BoardColumnProps) {
  const classes = [
    styles.column,
    status === 'done' ? styles.doneColumn : '',
    hint?.accepts ? (hovered ? styles.acceptingHover : styles.accepting) : '',
    hint && !hint.accepts ? styles.refusing : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section
      aria-label={STATUS_LABEL[status]}
      className={classes}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.num}>{STATUS_NUMBER[status]}</span>
          <h2 className={styles.name}>{STATUS_LABEL[status]}</h2>
        </div>
        <span className={styles.count} aria-label={`${count} tickets`}>
          {count}
        </span>
      </div>
      {hint && <p className={`${styles.hint} ${hint.accepts ? styles.hintOk : ''}`}>{hint.text}</p>}
      <div className={styles.cards}>
        {children}
        {empty && <p className={styles.empty}>{empty}</p>}
      </div>
    </section>
  );
}
