import type { Ticket } from '@agent-ops/shared';
import { useGatedReason } from '../../app/ActionGate';
import { Button } from '../../ui/controls';
import { useMoveTicket } from '../moves';
import { MOVE_NOTE, MOVE_TARGETS, moveLabel, moveRefusal } from './model';
import styles from './Ticket.module.css';

type MoveApi = ReturnType<typeof useMoveTicket>;

function MoveButton({ ticket, to, move }: { ticket: Ticket; to: Ticket['status']; move: MoveApi }) {
  const own = moveRefusal(ticket.status, to);
  const reason = useGatedReason(own);
  return (
    <Button
      disabledReason={reason}
      disabled={move.isPending}
      onClick={() => move.requestMove(ticket, to)}
    >
      {moveLabel(ticket.status, to)}
    </Button>
  );
}

/** UI-AC-71, AC-72: one button per other column; refused ones keep focus and explain themselves. */
export function MovePanel({ ticket, move }: { ticket: Ticket; move: MoveApi }) {
  return (
    <section aria-labelledby="move-heading">
      <h2 id="move-heading" className={styles.heading}>
        C — Move
      </h2>
      <div className={styles.moves}>
        {MOVE_TARGETS.filter((to) => to !== ticket.status).map((to) => (
          <MoveButton key={to} ticket={ticket} to={to} move={move} />
        ))}
      </div>
      <p className={styles.note}>{MOVE_NOTE}</p>
    </section>
  );
}
