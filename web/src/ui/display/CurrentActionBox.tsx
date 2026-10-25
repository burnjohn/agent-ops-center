import type { Agent } from '@agent-ops/shared';
import { formatAge, formatTimer, secondsBetween, type TimeInput } from '../../lib/format';
import styles from './CurrentActionBox.module.css';

export interface CurrentActionBoxProps {
  agent: Pick<
    Agent,
    | 'health'
    | 'stage'
    | 'currentTool'
    | 'lastTool'
    | 'currentTicketId'
    | 'pausedAfterRelease'
    | 'lastSeenAt'
  >;
  /** Set when the agent's ticket is Blocked: the agent's question and when it was asked. */
  blocked?: { question: string; since: TimeInput } | null;
  /** Simulation Clock. */
  now: TimeInput;
  /** Auto-play state; the running square pulses only while playing (UI-AC-98). */
  playing: boolean;
}

interface View {
  tone: 'running' | 'blocked' | 'failed' | 'dashed' | 'plain';
  mark: string;
  title: string;
  detail: string;
  meta?: string;
  pulse?: boolean;
}

/** UI-AC-97: the first matching state wins. */
export function describeAction({ agent, blocked, now, playing }: CurrentActionBoxProps): View {
  if (agent.currentTool) {
    return {
      tone: 'running',
      mark: '■',
      title: `${agent.currentTool.name} · running`,
      detail: agent.currentTool.arg,
      meta: formatTimer(secondsBetween(agent.currentTool.startedAt, now)),
      pulse: playing,
    };
  }
  if (blocked) {
    return {
      tone: 'blocked',
      mark: '■',
      title: 'Blocked — needs Operator',
      detail: blocked.question,
      meta: formatAge(blocked.since, now),
    };
  }
  if (agent.lastTool && !agent.lastTool.ok) {
    return {
      tone: 'failed',
      mark: '▲',
      title: `${agent.lastTool.name} · failed`,
      detail: agent.lastTool.arg,
      meta: `${formatAge(agent.lastTool.at, now)} AGO`,
    };
  }
  if (agent.health === 'offline') {
    return {
      tone: 'dashed',
      mark: '□',
      title: 'No activity',
      detail: `Last event ${formatAge(agent.lastSeenAt, now)} ago`,
    };
  }
  if (agent.stage === 'awaiting_review') {
    return {
      tone: 'dashed',
      mark: '□',
      title: 'Waiting for your review',
      detail: agent.currentTicketId
        ? `${agent.currentTicketId} is in Review`
        : 'Ticket is in Review',
    };
  }
  if (!agent.currentTicketId) {
    return {
      tone: 'dashed',
      mark: '□',
      title: agent.pausedAfterRelease ? 'Paused after release' : 'Idle',
      detail: 'Polling for the next Ready ticket',
    };
  }
  return { tone: 'plain', mark: '■', title: 'Thinking', detail: 'Between tool calls' };
}

export function CurrentActionBox(props: CurrentActionBoxProps) {
  const view = describeAction(props);
  return (
    <div className={`${styles.box} ${styles[view.tone]}`}>
      <div className={styles.head}>
        <span
          aria-hidden="true"
          className={`${styles.mark} ${view.tone === 'running' ? styles.live : ''} ${view.pulse ? styles.pulse : ''}`}
        >
          {view.mark}
        </span>
        <span className={styles.title}>{view.title}</span>
        {view.meta && <span className={styles.meta}>{view.meta}</span>}
      </div>
      <div className={styles.detail}>{view.detail}</div>
    </div>
  );
}
