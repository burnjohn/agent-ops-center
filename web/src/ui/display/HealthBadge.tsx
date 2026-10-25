import type { AgentHealth } from '@agent-ops/shared';
import { HEALTH_LABEL } from '../../lib/labels';
import styles from './HealthBadge.module.css';

/** Renders the health exactly as reported by the server (UI-AC-26); never derives it. */
export function HealthBadge({ health }: { health: AgentHealth }) {
  const { glyph, word } = HEALTH_LABEL[health];
  return (
    <span className={`${styles.badge} ${styles[health]}`}>
      <span aria-hidden="true">{glyph}</span> {word}
    </span>
  );
}
