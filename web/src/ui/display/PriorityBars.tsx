import type { Priority } from '@agent-ops/shared';
import { PRIORITY_LABEL } from '../../lib/labels';
import styles from './PriorityBars.module.css';

const HEIGHTS = [5, 8, 11] as const;
const LEVEL: Record<Priority, number> = { low: 1, medium: 2, high: 3 };

export function PriorityBars({ priority }: { priority: Priority }) {
  const filled = LEVEL[priority];
  return (
    <span className={styles.wrap}>
      <span className={styles.bars} aria-hidden="true">
        {HEIGHTS.map((h, i) => (
          <span
            key={h}
            className={i < filled ? styles.on : styles.off}
            style={{ height: `${h}px` }}
          />
        ))}
      </span>
      <span className={styles.word}>{PRIORITY_LABEL[priority]}</span>
    </span>
  );
}
