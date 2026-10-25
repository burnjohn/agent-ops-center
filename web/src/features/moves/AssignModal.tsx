import { useMemo } from 'react';
import type { Agent } from '@agent-ops/shared';
import { useAgents } from '../../api/queries';
import { HEALTH_LABEL, KIND_LABEL, STAGE_LABEL } from '../../lib/labels';
import { Button } from '../../ui/controls';
import { Modal } from '../../ui/overlay';
import styles from './Moves.module.css';

export const ALL_BUSY_TEXT =
  'Every agent is busy. Mark one of their tickets done or release it to Ready first.';
const FOOTNOTE =
  'An agent works on one ticket at a time, so busy agents are greyed out. The chosen agent moves to Planning and starts a session.';

interface AssignModalProps {
  ticketId: string;
  ticketTitle: string;
  pending: boolean;
  onCancel: () => void;
  onPick: (agent: Agent) => void;
}

const isFree = (a: Agent) => a.currentTicketId === null;

function stateNote(a: Agent): string {
  if (isFree(a)) {
    const h = HEALTH_LABEL[a.health];
    return a.health === 'online' ? `${h.glyph} FREE · ${h.word}` : `${h.glyph} ${h.word} · FREE`;
  }
  return `BUSY · ${a.currentTicketId} · ${STAGE_LABEL[a.stage].toUpperCase()}`;
}

/** UI-AC-54…57: rows follow the live agents query, so they update as agents free up or get busy. */
export function AssignModal({
  ticketId,
  ticketTitle,
  pending,
  onCancel,
  onPick,
}: AssignModalProps) {
  const { data: agents } = useAgents();
  const sorted = useMemo(() => {
    const list = agents ?? [];
    return [...list.filter(isFree), ...list.filter((a) => !isFree(a))];
  }, [agents]);
  const allBusy = agents !== undefined && sorted.every((a) => !isFree(a));

  return (
    <Modal
      title={`Who takes ${ticketId}?`}
      onClose={onCancel}
      actions={<Button onClick={onCancel}>Cancel</Button>}
    >
      <div className={styles.stack}>
        <p className={styles.sub}>{ticketTitle}</p>
        {allBusy && (
          <p role="alert" className={styles.alert}>
            {ALL_BUSY_TEXT}
          </p>
        )}
        <ul className={styles.list} aria-label="Agents">
          {sorted.map((a) => {
            const busy = !isFree(a);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className={styles.row}
                  aria-disabled={busy || pending || undefined}
                  onClick={() => {
                    if (!busy && !pending) onPick(a);
                  }}
                >
                  <span>
                    <span className={styles.agentId}>{a.id}</span>{' '}
                    <span className={styles.kind}>{KIND_LABEL[a.kind]}</span>
                  </span>
                  <span className={styles.state}>{stateNote(a)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className={styles.note}>{FOOTNOTE}</p>
      </div>
    </Modal>
  );
}
