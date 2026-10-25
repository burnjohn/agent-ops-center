import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Agent, Ticket } from '@agent-ops/shared';
import { formatAge, formatMoney } from '../../lib/format';
import { KIND_LABEL } from '../../lib/labels';
import { CurrentActionBox, HealthBadge, MockTag, StageStepper } from '../../ui/display';
import { blockedOf } from './model';
import styles from './AgentCard.module.css';

export interface AgentCardProps {
  agent: Agent;
  tickets: readonly Ticket[];
  clock: string;
  playing: boolean;
}

/** UI-AC-93/94: whole card opens the agent page; inner links keep their own target. */
export function AgentCard({ agent, tickets, clock, playing }: AgentCardProps) {
  const navigate = useNavigate();
  const ticket = tickets.find((t) => t.id === agent.currentTicketId);
  const sessionId = agent.currentSessionId ?? agent.lastSessionId;
  const open = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('a, button')) return;
    void navigate(`/agents/${encodeURIComponent(agent.id)}`);
  };
  return (
    <article
      aria-label={agent.id}
      className={`${styles.card} ${agent.health === 'offline' ? styles.offline : ''}`}
      onClick={open}
    >
      <header className={styles.head}>
        <div className={styles.id}>
          <Link to={`/agents/${encodeURIComponent(agent.id)}`} className={styles.name}>
            {agent.id}
          </Link>
          <span className={styles.kind}>{KIND_LABEL[agent.kind]}</span>
        </div>
        <HealthBadge health={agent.health} />
      </header>
      {agent.currentTicketId ? (
        <Link
          to={`/tickets/${encodeURIComponent(agent.currentTicketId)}`}
          className={styles.ticket}
        >
          <span className={styles.ticketId}>{agent.currentTicketId}</span>
          {ticket && <span>{ticket.title}</span>}
        </Link>
      ) : (
        <p className={styles.none}>No ticket — waiting for work in Ready</p>
      )}
      <StageStepper stage={agent.stage} showLabels />
      <CurrentActionBox
        agent={agent}
        blocked={blockedOf(agent, tickets)}
        now={clock}
        playing={playing}
      />
      <footer className={styles.footer}>
        <span>SEEN {formatAge(agent.lastSeenAt, clock)}</span>
        <span>
          {formatMoney(agent.costTodayUsd)} TODAY <MockTag />
        </span>
        {sessionId && (
          <Link to={`/sessions/${encodeURIComponent(sessionId)}`} className={styles.log}>
            LOG ↗
          </Link>
        )}
      </footer>
    </article>
  );
}
