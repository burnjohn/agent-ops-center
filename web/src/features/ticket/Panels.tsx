import { useState, type FormEvent } from 'react';
import {
  ANSWER_MAX,
  COMMENT_MAX,
  MSG_ANSWER_REQUIRED,
  MSG_COMMENT_REQUIRED,
  type Ticket,
} from '@agent-ops/shared';
import { useAnswerTicket, useRequestChanges } from '../../api/commands';
import { useGatedReason } from '../../app/ActionGate';
import { Button, TextArea } from '../../ui/controls';
import { useToast } from '../../ui/overlay';
import { commandErrorText } from '../moves';
import styles from './Ticket.module.css';

/** UI-AC-64, AC-65: the agent's question and the Operator's answer. */
export function BlockedPanel({ ticket, agentName }: { ticket: Ticket; agentName: string }) {
  const { showToast } = useToast();
  const answerTicket = useAnswerTicket();
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const gated = useGatedReason();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (answerTicket.isPending || gated) return;
    const trimmed = answer.trim();
    if (!trimmed) {
      setError(MSG_ANSWER_REQUIRED);
      return;
    }
    answerTicket.mutate(
      { id: ticket.id, answer: trimmed },
      {
        onSuccess: () => {
          setAnswer('');
          setError(undefined);
          showToast(`${ticket.id} unblocked — the agent continues`);
        },
        onError: (e) => setError(commandErrorText(e)),
      },
    );
  };

  return (
    <section aria-labelledby="blocked-heading" className={styles.panelAttn}>
      <h2 id="blocked-heading" className={styles.panelAttnHead}>
        <span aria-hidden="true">■</span> Blocked — {agentName} needs your answer
      </h2>
      <blockquote className={styles.quote}>“{ticket.blockedQuestion}”</blockquote>
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextArea
          label="Your answer"
          required
          placeholder="The agent reads this on its next step"
          value={answer}
          maxLength={ANSWER_MAX}
          error={error}
          onChange={(e) => {
            setAnswer(e.target.value);
            setError(undefined);
          }}
        />
        <div className={styles.actions}>
          <Button
            variant="primary"
            type="submit"
            disabled={answerTicket.isPending}
            disabledReason={gated}
          >
            Send answer &amp; unblock
          </Button>
        </div>
      </form>
    </section>
  );
}

/** UI-AC-66…69: summary, result line, approve and the inline request-changes form. */
export function ReviewPanel({
  ticket,
  agentName,
  onApprove,
  approving,
}: {
  ticket: Ticket;
  agentName: string;
  onApprove: () => void;
  approving: boolean;
}) {
  const { showToast } = useToast();
  const requestChanges = useRequestChanges();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const gated = useGatedReason();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (requestChanges.isPending || gated) return;
    const trimmed = comment.trim();
    if (!trimmed) {
      setError(MSG_COMMENT_REQUIRED);
      return;
    }
    requestChanges.mutate(
      { id: ticket.id, comment: trimmed, expectedStatus: ticket.status },
      {
        onSuccess: () => {
          setOpen(false);
          setComment('');
          setError(undefined);
          showToast(`${ticket.id} sent back to In Progress`);
        },
        onError: (e) => setError(commandErrorText(e)),
      },
    );
  };

  return (
    <section aria-labelledby="review-heading" className={styles.panel}>
      <h2 id="review-heading" className={styles.panelHead}>
        Ready for review · Submitted by {agentName}
      </h2>
      <p className={styles.text}>
        {ticket.reviewSummary ? ticket.reviewSummary : 'No summary provided.'}
      </p>
      {ticket.resultLink && (
        <p className={styles.result}>
          <span className={styles.resultTag}>RESULT</span>
          <span>{ticket.resultLink}</span>
        </p>
      )}
      {open ? (
        <form className={styles.form} onSubmit={submit} noValidate>
          <TextArea
            label={`Comment for ${agentName}`}
            required
            placeholder="What should change before this can be approved?"
            value={comment}
            maxLength={COMMENT_MAX}
            error={error}
            onChange={(e) => {
              setComment(e.target.value);
              setError(undefined);
            }}
          />
          <p className={styles.note}>
            The ticket returns to In Progress for the same agent, who reads this comment on its next
            step.
          </p>
          <div className={styles.actions}>
            <Button
              variant="primary"
              type="submit"
              disabled={requestChanges.isPending}
              disabledReason={gated}
            >
              Send back to {agentName}
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                setError(undefined);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button
            variant="primary"
            glyph="✓"
            disabled={approving}
            disabledReason={gated}
            onClick={onApprove}
          >
            Approve
          </Button>
          <Button glyph="↩" disabledReason={gated} onClick={() => setOpen(true)}>
            Request changes
          </Button>
        </div>
      )}
    </section>
  );
}

/** UI-AC-70. */
export function Notes({ ticket }: { ticket: Ticket }) {
  const returned = ticket.status === 'in_progress' && ticket.reviewComment !== null;
  const answered = ticket.answer !== null;
  if (!returned && !answered) return null;
  return (
    <>
      {returned && (
        <p className={styles.noteBox}>
          <span className={styles.noteLabel}>Returned from review · </span>
          {ticket.reviewComment}
        </p>
      )}
      {answered && (
        <p className={styles.noteBox}>
          <span className={styles.noteLabel}>You answered · </span>
          {ticket.answer}
        </p>
      )}
    </>
  );
}
