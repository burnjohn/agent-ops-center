import { memo } from 'react';
import type { LogEntry } from '@agent-ops/shared';
import { formatHourMinute, formatMoney, formatTokens } from '../../lib/format';
import { STAGE_LABEL } from '../../lib/labels';
import { COLLAPSED_LINES, entryAnchor, isFailedTool, outputLines } from './model';
import styles from './Entry.module.css';

export function tokenText(e: LogEntry): string | null {
  if (!e.tokens) return null;
  const t = e.tokens;
  const base = `${formatTokens(t.input)} IN · ${formatTokens(t.output)} OUT · ${formatTokens(t.cacheRead)} CACHE R · ${formatTokens(t.cacheWrite)} CACHE W`;
  return e.costUsd === null ? base : `${base} · ${formatMoney(e.costUsd)}`;
}

export interface EntryRowProps {
  entry: LogEntry;
  expanded: boolean;
  ringed: boolean;
  onToggle: (index: number) => void;
}

/** One log entry. Memoised by props so streaming appends do not re-render the rest (NFR-07). Text only, never markup. */
export const EntryRow = memo(function EntryRow({
  entry,
  expanded,
  ringed,
  onToggle,
}: EntryRowProps) {
  const tokens = tokenText(entry);
  return (
    <li id={entryAnchor(entry.index)} className={styles.row}>
      <span className={styles.time}>{formatHourMinute(entry.at)}</span>
      <div className={styles.body}>
        {entry.type === 'stage' && (
          <div className={styles.stage}>
            <span className={styles.stageName}>
              ■ {entry.stage ? STAGE_LABEL[entry.stage].toUpperCase() : (entry.text ?? '')}
            </span>
            <span className={styles.rule} aria-hidden="true" />
            <span className={styles.muted}>AGENT REPORT</span>
          </div>
        )}
        {entry.type === 'system' && (
          <p className={styles.system}>
            <span>— {entry.text}</span>
            {tokens && <span className={styles.tokens}>{tokens}</span>}
          </p>
        )}
        {entry.type === 'operator' && (
          <div className={styles.msg}>
            <span className={styles.who}>● OPERATOR</span>
            <p className={styles.bubble}>{entry.text}</p>
          </div>
        )}
        {entry.type === 'agent' && (
          <div className={styles.msg}>
            <div className={styles.agentHead}>
              <span className={styles.who}>◇ AGENT</span>
              {tokens && <span className={styles.tokens}>{tokens}</span>}
            </div>
            <p className={styles.agentText}>{entry.text}</p>
          </div>
        )}
        {entry.type === 'tool' && entry.tool && (
          <ToolBox
            entry={entry}
            tool={entry.tool}
            tokens={tokens}
            expanded={expanded}
            ringed={ringed}
            onToggle={onToggle}
          />
        )}
      </div>
    </li>
  );
});

function ToolBox({
  entry,
  tool,
  tokens,
  expanded,
  ringed,
  onToggle,
}: {
  entry: LogEntry;
  tool: NonNullable<LogEntry['tool']>;
  tokens: string | null;
  expanded: boolean;
  ringed: boolean;
  onToggle: (index: number) => void;
}) {
  const failed = isFailedTool(entry);
  const lines = tool.output ? outputLines(tool.output) : [];
  const canExpand = lines.length > COLLAPSED_LINES;
  const shown =
    canExpand && !expanded ? lines.slice(0, COLLAPSED_LINES).join('\n') : lines.join('\n');
  return (
    <div
      className={`${styles.tool} ${failed ? styles.failed : ''} ${ringed ? styles.ring : ''}`}
      data-failed={failed || undefined}
    >
      <div className={styles.toolHead}>
        <span className={failed ? styles.markErr : styles.markOk}>{failed ? '▲' : '✓'}</span>
        <span className={styles.toolName}>{tool.name}</span>
        <code className={styles.arg}>{tool.arg}</code>
        <span className={`${styles.result} ${failed ? styles.markErr : ''}`}>
          {tool.result} · {tool.durationSec}S
        </span>
      </div>
      {tokens && <p className={styles.toolTokens}>{tokens}</p>}
      {tool.output && (
        <>
          <pre className={styles.output}>{shown}</pre>
          {canExpand && (
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={expanded}
              onClick={() => onToggle(entry.index)}
            >
              {expanded ? '− COLLAPSE' : `+ SHOW ${lines.length - COLLAPSED_LINES} MORE LINES`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
