import type { EventSource } from '@agent-ops/shared';
import { SOURCE_LABEL } from '../../lib/labels';
import styles from './SourceMark.module.css';

/** UI-AC-104: ● Operator, ■ Agent Report, ◆ Agent Telemetry (muted), — System. */
export function SourceMark({ source }: { source: EventSource }) {
  const { glyph, name } = SOURCE_LABEL[source];
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={`${styles.mark} ${source === 'agent_telemetry' ? styles.muted : ''}`}
    >
      {glyph}
    </span>
  );
}
