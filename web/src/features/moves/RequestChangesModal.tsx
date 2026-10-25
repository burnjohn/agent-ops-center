import { useState, type FormEvent } from 'react';
import { COMMENT_MAX, MSG_COMMENT_REQUIRED } from '@agent-ops/shared';
import { Button, TextArea } from '../../ui/controls';
import { Modal } from '../../ui/overlay';
import styles from './Moves.module.css';

interface RequestChangesModalProps {
  ticketId: string;
  agentName: string;
  pending: boolean;
  /** Server-side field error (400 details); typed text is kept on failure (UI-AC-34). */
  serverError?: string | undefined;
  onCancel: () => void;
  onSend: (comment: string) => void;
}

/** UI-AC-61, UI-AC-69: an empty comment sends nothing. */
export function RequestChangesModal({
  ticketId,
  agentName,
  pending,
  serverError,
  onCancel,
  onSend,
}: RequestChangesModalProps) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const formId = `request-changes-${ticketId}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const trimmed = comment.trim();
    if (!trimmed) {
      setError(MSG_COMMENT_REQUIRED);
      return;
    }
    onSend(trimmed);
  };

  return (
    <Modal
      title={`Send ${ticketId} back to ${agentName}`}
      onClose={onCancel}
      actions={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={pending}>
            Send back
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.stack} onSubmit={submit} noValidate>
        <TextArea
          label="What should change?"
          required
          value={comment}
          maxLength={COMMENT_MAX}
          error={error ?? serverError}
          onChange={(e) => {
            setComment(e.target.value);
            setError(undefined);
          }}
        />
        <p className={styles.note}>
          The ticket returns to In Progress for the same agent, who reads this comment first.
        </p>
      </form>
    </Modal>
  );
}
