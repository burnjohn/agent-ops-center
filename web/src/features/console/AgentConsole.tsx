import { Link } from 'react-router';
import type { StepMode } from '@agent-ops/shared';
import { useStepAgent } from '../../api/commands';
import { useAgents, useSession, useSimulation, useTicket } from '../../api/queries';
import { Button } from '../../ui/controls';
import { formatMoney, formatStart } from '../../lib/format';
import { ConsoleLog } from './ConsoleLog';
import { CONSOLE_SESSIONS_MAX, EMPTY_TEXT, defaultSessionId, stepView, tailText } from './model';
import { chooseSession, useChosenSession } from './selection';
import styles from './AgentConsole.module.css';

export interface AgentConsoleProps {
  ticketId: string;
}

/** Ticket page section `D — Agent console` (UI-AC-77…87). */
export function AgentConsole({ ticketId }: AgentConsoleProps) {
  const ticketQuery = useTicket(ticketId);
  const agentsQuery = useAgents();
  const simulation = useSimulation();
  const stepAgent = useStepAgent();
  const chosen = useChosenSession(ticketId);

  const detail = ticketQuery.data;
  const sessions = (detail?.sessions ?? []).slice(0, CONSOLE_SESSIONS_MAX);
  const selectedId =
    chosen && sessions.some((s) => s.id === chosen)
      ? chosen
      : defaultSessionId(sessions, detail?.ticket.assigneeId ?? null);
  const summary = sessions.find((s) => s.id === selectedId);

  return (
    <section aria-labelledby="console-heading" className={styles.section}>
      <div className={styles.head}>
        <h2 id="console-heading" className={styles.heading}>
          D — Agent console
        </h2>
        {detail && summary && selectedId && (
          <>
            <div role="tablist" aria-label="Sessions of this ticket" className={styles.tabs}>
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={s.id === selectedId}
                  className={`${styles.tab} ${s.id === selectedId ? styles.tabOn : ''}`}
                  onClick={() => chooseSession(ticketId, s.id)}
                >
                  {s.status === 'running' ? `${s.id} ●` : s.id}
                </button>
              ))}
            </div>
            <ConsoleActions
              ticketId={ticketId}
              sessionId={selectedId}
              ticket={detail.ticket}
              agents={agentsQuery.data}
              pending={stepAgent.isPending}
              onStep={(agentId, mode) => stepAgent.mutate({ agentId, ticketId, mode })}
              errorMessage={stepAgent.error?.message}
            />
          </>
        )}
      </div>
      {detail && sessions.length === 0 && <p className={styles.empty}>{EMPTY_TEXT}</p>}
      {detail && summary && selectedId && (
        <div role="tabpanel" aria-label={`Session ${selectedId}`}>
          <ConsoleMeta
            summary={summary}
            agentName={
              agentsQuery.data?.find((a) => a.id === summary.agentId)?.name ?? summary.agentId
            }
            now={simulation.data?.clock}
            hint={hintFor(detail.ticket, agentsQuery.data)}
          />
          <ConsoleTerminal
            sessionId={selectedId}
            tail={tailText(
              summary,
              detail.ticket,
              agentsQuery.data?.find((a) => a.id === detail.ticket.assigneeId),
            )}
          />
        </div>
      )}
    </section>
  );
}

function ConsoleTerminal({ sessionId, tail }: { sessionId: string; tail: string | null }) {
  const session = useSession(sessionId);
  return <ConsoleLog sessionId={sessionId} entries={session.data?.entries ?? []} tail={tail} />;
}

type Ticket = NonNullable<ReturnType<typeof useTicket>['data']>['ticket'];
type Agents = ReturnType<typeof useAgents>['data'];

function hintFor(ticket: Ticket, agents: Agents): string {
  const agent = agents?.find((a) => a.id === ticket.assigneeId);
  const view = stepView(ticket, agent);
  if (view.kind === 'buttons') return view.hint;
  return view.kind === 'text' ? view.text : '';
}

interface ActionsProps {
  ticketId: string;
  sessionId: string;
  ticket: Ticket;
  agents: Agents;
  pending: boolean;
  errorMessage: string | undefined;
  onStep: (agentId: string, mode: StepMode) => void;
}

function ConsoleActions({
  sessionId,
  ticket,
  agents,
  pending,
  errorMessage,
  onStep,
}: ActionsProps) {
  const agent = agents?.find((a) => a.id === ticket.assigneeId);
  const view = stepView(ticket, agent);
  return (
    <div className={styles.actions}>
      {view.kind === 'buttons' && agent && (
        <>
          <Button size="sm" glyph="▸" disabled={pending} onClick={() => onStep(agent.id, 'step')}>
            NEXT STEP
          </Button>
          <Button
            size="sm"
            variant="primary"
            glyph="▸▸"
            disabled={pending}
            onClick={() => onStep(agent.id, 'to_next_stage')}
          >
            RUN TO NEXT STAGE
          </Button>
        </>
      )}
      <Link to={`/sessions/${sessionId}`} className={styles.fullLog}>
        FULL LOG →
      </Link>
      {errorMessage && (
        <span role="alert" className={styles.error}>
          {errorMessage}
        </span>
      )}
    </div>
  );
}

interface MetaProps {
  summary: {
    id: string;
    model: string;
    startedAt: string;
    status: string;
    entryCount: number;
    costUsd: number;
  };
  agentName: string;
  now: string | undefined;
  hint: string;
}

function ConsoleMeta({ summary, agentName, now, hint }: MetaProps) {
  const started = formatStart(summary.startedAt, now ?? summary.startedAt);
  const cost = `${formatMoney(summary.costUsd)}${summary.status === 'running' ? ' so far' : ''}`;
  return (
    <div className={styles.meta}>
      <span>{`${summary.id} · ${agentName} · ${summary.model} · ${started} · ${summary.entryCount} entries · ${cost}`}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
