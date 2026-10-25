import { useState, type FormEvent } from 'react';
import {
  CRITERIA_MAX_COUNT,
  CRITERION_MAX,
  DESCRIPTION_MAX,
  MSG_TITLE_REQUIRED,
  TITLE_MAX,
  type Priority,
} from '@agent-ops/shared';
import { useCreateTicket } from '../../api/commands';
import { useSimulation } from '../../api/queries';
import { PRIORITY_LABEL } from '../../lib/labels';
import { Button, Segmented, TextArea, TextField } from '../../ui/controls';
import { Modal, useToast } from '../../ui/overlay';
import { useSimulationHold } from '../simulation';
import { commandErrorText, fieldErrors } from './commandError';
import styles from './Moves.module.css';

const PRIORITY_OPTIONS = (['high', 'medium', 'low'] as const).map((value) => ({
  value,
  label: PRIORITY_LABEL[value],
}));

interface NewTicketModalProps {
  onClose: () => void;
}

/** UI-AC-88…90 (+ AC-21, AC-34: typed text survives a failed command). */
export function NewTicketModal({ onClose }: NewTicketModalProps) {
  const { data: sim } = useSimulation();
  const create = useCreateTicket();
  const { showToast } = useToast();
  useSimulationHold(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [criteriaText, setCriteriaText] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const nextId = sim?.nextTicketId ?? 'T-N';
  const formId = 'new-ticket-form';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setErrors({ title: MSG_TITLE_REQUIRED });
      return;
    }
    const criteria = criteriaText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (criteria.length > CRITERIA_MAX_COUNT) {
      setErrors({ acceptanceCriteria: `At most ${CRITERIA_MAX_COUNT} criteria.` });
      return;
    }
    if (criteria.some((c) => c.length > CRITERION_MAX)) {
      setErrors({ acceptanceCriteria: `A criterion can be at most ${CRITERION_MAX} characters.` });
      return;
    }
    create.mutate(
      { title: trimmed, description, acceptanceCriteria: criteria, priority },
      {
        onSuccess: (result) => {
          showToast(
            `${result.ticket?.id ?? nextId} created in Backlog — move it to Ready for agents`,
          );
          onClose();
        },
        onError: (error) => {
          const fields = fieldErrors(error);
          setErrors(fields);
          showToast(
            Object.keys(fields).length > 0
              ? 'Couldn’t create the ticket: check the highlighted fields.'
              : `Couldn’t create the ticket: ${commandErrorText(error)}`,
          );
        },
      },
    );
  };

  const clear = (key: string) => setErrors((prev) => (key in prev ? { ...prev, [key]: '' } : prev));

  return (
    <Modal
      title="New ticket"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={create.isPending}>
            Create ticket
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.stack} onSubmit={submit} noValidate>
        <p className={styles.note}>{`Goes to Backlog as ${nextId}`}</p>
        <TextField
          label="Title"
          required
          value={title}
          maxLength={TITLE_MAX}
          error={errors.title || undefined}
          onChange={(e) => {
            setTitle(e.target.value);
            clear('title');
          }}
        />
        <TextArea
          label="Description"
          value={description}
          maxLength={DESCRIPTION_MAX}
          error={errors.description || undefined}
          onChange={(e) => {
            setDescription(e.target.value);
            clear('description');
          }}
        />
        <TextArea
          label="Acceptance criteria"
          value={criteriaText}
          error={errors.acceptanceCriteria || undefined}
          aria-describedby="new-ticket-criteria-help"
          onChange={(e) => {
            setCriteriaText(e.target.value);
            clear('acceptanceCriteria');
          }}
        />
        <p id="new-ticket-criteria-help" className={styles.note}>
          One criterion per line.
        </p>
        <Segmented
          label="Priority"
          options={PRIORITY_OPTIONS}
          value={priority}
          onChange={setPriority}
        />
      </form>
    </Modal>
  );
}
