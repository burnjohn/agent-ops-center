import type { LogEntry } from '@agent-ops/shared';
import { formatClock } from '../../lib/format';
import { STAGE_LABEL } from '../../lib/labels';
import { tokenLine } from './model';
import styles from './LogLine.module.css';

/** One console row: `hh:mm:ss · <tag> · <text>` (UI-AC-80). All content is rendered as text. */
export function LogLine({ entry }: { entry: LogEntry }) {
  const { tool } = entry;
  const failed = entry.type === 'tool' && tool !== null && !tool.ok;
  const tag = entry.type === 'tool' ? (failed ? '✗ tool' : '$ tool') : entry.type;
  const tagClass = entry.type === 'tool' ? (failed ? styles.err : styles.ok) : styles[entry.type];

  let text = entry.text ?? '';
  if (entry.type === 'stage') {
    const label = entry.stage
      ? STAGE_LABEL[entry.stage].toUpperCase()
      : text.replace('STAGE → ', '');
    text = `── ${label} ──`;
  }
  if (entry.type === 'tool' && tool) text = `${tool.name}  ${tool.arg}`;

  const tokens = entry.tokens ? tokenLine(entry.tokens, entry.costUsd) : null;

  return (
    <div
      className={`${styles.row} ${entry.type === 'stage' ? styles.stageRow : ''} ${failed ? styles.failedRow : ''}`}
    >
      <span className={styles.time}>{formatClock(entry.at)}</span>
      <span className={`${styles.tag} ${tagClass}`}>{tag}</span>
      <div className={styles.body}>
        <span
          className={`${styles.text} ${entry.type === 'operator' ? styles.operatorText : ''} ${
            entry.type === 'stage' ? styles.stageText : ''
          } ${entry.type === 'system' ? styles.systemText : ''} ${failed ? styles.errText : ''}`}
        >
          {text}
        </span>
        {tool && (
          <span className={`${styles.sub} ${failed ? styles.errText : ''}`}>
            {`→ ${tool.result} · ${tool.durationSec}s`}
          </span>
        )}
        {tokens && <span className={styles.sub}>{tokens}</span>}
        {tool?.output && (
          <pre className={`${styles.output} ${failed ? styles.outputErr : ''}`}>{tool.output}</pre>
        )}
      </div>
    </div>
  );
}
