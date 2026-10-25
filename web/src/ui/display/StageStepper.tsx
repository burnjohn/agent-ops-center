import type { AgentStage } from '@agent-ops/shared';
import { STAGE_LABEL } from '../../lib/labels';
import a11y from './a11y.module.css';
import styles from './StageStepper.module.css';

const SEGMENTS: readonly { stage: AgentStage; label: string }[] = [
  { stage: 'planning', label: 'PLAN' },
  { stage: 'implementing', label: 'IMPL' },
  { stage: 'testing', label: 'TEST' },
  { stage: 'awaiting_review', label: 'REVIEW' },
];

export interface StageStepperProps {
  stage: AgentStage;
  showLabels?: boolean;
}

/** UI-AC-96: current segment ink, passed muted, future line; Idle = all empty. */
export function StageStepper({ stage, showLabels = false }: StageStepperProps) {
  const current = SEGMENTS.findIndex((s) => s.stage === stage);
  return (
    <div className={styles.stepper}>
      <span className={a11y.srOnly}>Stage: {STAGE_LABEL[stage]}</span>
      <div className={styles.segments} aria-hidden="true">
        {SEGMENTS.map((s, i) => {
          const state =
            current === -1 || i > current
              ? styles.future
              : i === current
                ? styles.current
                : styles.passed;
          return (
            <div key={s.stage} className={styles.cell}>
              <span className={`${styles.segment} ${state}`} />
              {showLabels && (
                <span className={`${styles.label} ${i === current ? styles.labelCurrent : ''}`}>
                  {s.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
