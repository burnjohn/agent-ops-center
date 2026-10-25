import { useLayoutEffect, useRef, useState } from 'react';
import type { LogEntry } from '@agent-ops/shared';
import { LogLine } from './LogLine';
import styles from './ConsoleLog.module.css';

const BOTTOM_SLACK_PX = 4;

export interface ConsoleLogProps {
  /** Changing it resets the scroll to the bottom (a different session). */
  sessionId: string;
  entries: readonly LogEntry[];
  tail: string | null;
}

/** The terminal: `role="log"`, newest at the bottom, sticks to the bottom only when already there (U-11). */
export function ConsoleLog({ sessionId, entries, tail }: ConsoleLogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastSession = useRef<string | null>(null);
  const lastCount = useRef(0);
  const [hasNew, setHasNew] = useState(false);

  const scrollToBottom = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setHasNew(false);
  };

  useLayoutEffect(() => {
    const grew = entries.length > lastCount.current;
    const switched = lastSession.current !== sessionId;
    lastSession.current = sessionId;
    lastCount.current = entries.length;
    if (switched || atBottom.current) {
      scrollToBottom();
    } else if (grew) {
      setHasNew(true);
    }
  }, [sessionId, entries.length, tail]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
    if (atBottom.current) setHasNew(false);
  };

  return (
    <div className={styles.wrap}>
      <div
        ref={ref}
        role="log"
        aria-label="Agent console"
        tabIndex={0}
        className={styles.log}
        onScroll={onScroll}
      >
        <div className={styles.inner}>
          {entries.map((entry) => (
            <LogLine key={entry.index} entry={entry} />
          ))}
          {tail !== null && (
            <div className={styles.tail}>
              <span />
              <span />
              <span>{`▍ ${tail}`}</span>
            </div>
          )}
        </div>
      </div>
      {hasNew && (
        <button type="button" className={styles.newLines} onClick={scrollToBottom}>
          ↓ NEW LINES
        </button>
      )}
    </div>
  );
}
