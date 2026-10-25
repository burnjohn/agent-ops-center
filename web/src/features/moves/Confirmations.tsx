import { AlertDialog } from '../../ui/overlay';
import { Button } from '../../ui/controls';
import { STATUS_LABEL } from '../../lib/labels';
import type { TicketStatus } from '@agent-ops/shared';
import styles from './Moves.module.css';

interface ConfirmProps {
  ticketId: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

interface ShellProps extends ConfirmProps {
  title: string;
  keepLabel: string;
  confirmLabel: string;
  children: string;
}

function ConfirmShell({
  title,
  keepLabel,
  confirmLabel,
  children,
  pending,
  onCancel,
  onConfirm,
}: ShellProps) {
  return (
    <AlertDialog
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>{keepLabel}</Button>
          <Button variant="primary" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className={styles.sub}>{children}</p>
    </AlertDialog>
  );
}

/** UI-AC-58 */
export function ReleaseConfirm({ agentName, ...rest }: ConfirmProps & { agentName: string }) {
  return (
    <ConfirmShell
      {...rest}
      title={`Move ${rest.ticketId} to Ready?`}
      keepLabel="Keep it with the agent"
      confirmLabel="Release ticket"
    >
      {`${agentName} is assigned to it. The agent stops working on ${rest.ticketId}, gets a refusal with the reason on its next call, and becomes free for other work.`}
    </ConfirmShell>
  );
}

/** UI-AC-59 */
export function MarkDoneConfirm({
  agentName,
  blocked,
  ...rest
}: ConfirmProps & { agentName: string; blocked: boolean }) {
  return (
    <ConfirmShell
      {...rest}
      title={`Mark ${rest.ticketId} done?`}
      keepLabel="Keep it with the agent"
      confirmLabel="Mark done"
    >
      {`${agentName} is working on it. The agent stops, its session ends as Completed, and it becomes free for other work.${blocked ? ' The block is cleared.' : ''}`}
    </ConfirmShell>
  );
}

/** UI-AC-60 */
export function ReopenConfirm({ to, ...rest }: ConfirmProps & { to: TicketStatus }) {
  return (
    <ConfirmShell
      {...rest}
      title={`Reopen ${rest.ticketId} in ${STATUS_LABEL[to]}?`}
      keepLabel="Keep it in Done"
      confirmLabel="Reopen ticket"
    >
      The ticket becomes unassigned work again. Its history and sessions stay.
    </ConfirmShell>
  );
}
