import { useParams } from 'react-router';
import { useAgents, useSimulation, useTicket } from '../../api/queries';
import { ApiError } from '../../api/client';
import { BackBar } from '../../app/BackBar';
import { EntityNotFound } from '../../app/EntityNotFound';
import { ScreenFrame } from '../../app/ScreenFrame';
import { BOARD_PATH } from '../../app/routeInfo';
import { STATUS_LABEL } from '../../lib/labels';
import { PriorityBars } from '../../ui/display';
import { AgentConsole } from '../console';
import { useMoveTicket } from '../moves';
import { Activity, SessionsCost, WhoIsOnIt } from './Aside';
import { MovePanel } from './MovePanel';
import { isJustUpdated, statusBadge } from './model';
import { BlockedPanel, Notes, ReviewPanel } from './Panels';
import styles from './Ticket.module.css';

/** Ticket page (UI-AC-62…76). All user text is rendered as text, never as markup. */
export default function Screen() {
  const { ticketId = '' } = useParams();
  const query = useTicket(ticketId);
  const agents = useAgents();
  const simulation = useSimulation();
  const move = useMoveTicket();

  if (query.error instanceof ApiError && query.error.status === 404) {
    return <EntityNotFound kind="Ticket" id={ticketId} />;
  }
  if (query.isError) {
    return (
      <ScreenFrame title={ticketId} screen="ticket" error onRetry={() => void query.refetch()} />
    );
  }
  if (!query.data) {
    return <ScreenFrame title={ticketId} screen="ticket" loading />;
  }

  const { ticket, activity, sessions } = query.data;
  const agent = agents.data?.find((a) => a.id === ticket.assigneeId);
  const agentName = agent?.name ?? ticket.assigneeId ?? 'The agent';
  const now = simulation.data?.clock;
  const blocked = ticket.status === 'in_progress' && ticket.blockedQuestion !== null;

  return (
    <div className={styles.page}>
      <BackBar
        crumbs={[
          { label: 'BOARD', to: BOARD_PATH },
          { label: STATUS_LABEL[ticket.status].toUpperCase(), to: BOARD_PATH },
          { label: ticket.id },
        ]}
      />
      <div className={styles.badges}>
        <span className={styles.badge}>{ticket.id}</span>
        <PriorityBars priority={ticket.priority} />
        <span className={`${styles.badge} ${styles.status}`}>{statusBadge(ticket.status)}</span>
        {isJustUpdated(ticket.updatedAt, now) && (
          <span className={styles.updated}>
            <span aria-hidden="true">■</span> JUST UPDATED
          </span>
        )}
      </div>
      <h1 className={styles.title}>{ticket.title}</h1>
      <div className={styles.layout}>
        <div className={styles.main}>
          {blocked && <BlockedPanel ticket={ticket} agentName={agentName} />}
          {ticket.status === 'review' && (
            <ReviewPanel
              ticket={ticket}
              agentName={agentName}
              approving={move.isPending}
              onApprove={() => move.requestMove(ticket, 'done')}
            />
          )}
          <Notes ticket={ticket} />
          <section aria-labelledby="description-heading">
            <h2 id="description-heading" className={styles.heading}>
              A — Description
            </h2>
            {ticket.description ? (
              <p className={styles.text}>{ticket.description}</p>
            ) : (
              <p className={styles.empty}>No description.</p>
            )}
          </section>
          <section aria-labelledby="criteria-heading">
            <h2 id="criteria-heading" className={styles.heading}>
              B — Acceptance criteria · {ticket.acceptanceCriteria.length}
            </h2>
            {ticket.acceptanceCriteria.length === 0 ? (
              <p className={styles.empty}>No acceptance criteria yet.</p>
            ) : (
              <ol className={styles.criteria}>
                {ticket.acceptanceCriteria.map((c, i) => (
                  <li key={`${i}-${c}`}>
                    <span className={styles.num}>{String(i + 1).padStart(2, '0')}</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <MovePanel ticket={ticket} move={move} />
          <AgentConsole ticketId={ticket.id} />
        </div>
        <aside className={styles.aside} aria-label="Ticket context">
          <WhoIsOnIt
            ticket={ticket}
            agent={agent}
            sessions={sessions}
            now={now}
            playing={simulation.data?.playing ?? false}
          />
          <SessionsCost sessions={sessions} />
          <Activity activity={activity} />
        </aside>
      </div>
      {move.dialog}
    </div>
  );
}
