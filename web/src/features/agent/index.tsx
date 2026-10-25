import { Link, useNavigate, useParams } from 'react-router';
import type { AgentPageResponse, SessionSummary } from '@agent-ops/shared';
import { useAgent, useSimulation } from '../../api/queries';
import { ApiError } from '../../api/client';
import { BackBar } from '../../app/BackBar';
import { EntityNotFound } from '../../app/EntityNotFound';
import { ScreenFrame } from '../../app/ScreenFrame';
import {
  formatAge,
  formatDuration,
  formatMoney,
  formatStart,
  formatTokens,
  secondsBetween,
} from '../../lib/format';
import {
  KIND_LABEL,
  SESSION_STATUS_LABEL,
  STAGE_BADGE,
  STAGE_LABEL,
  STATUS_LABEL,
} from '../../lib/labels';
import { Button } from '../../ui/controls';
import { DataTable, HealthBadge, KpiTile, MockTag, type DataColumn } from '../../ui/display';
import { SaidVsDidSection } from './SaidVsDid';
import styles from './Agent.module.css';

const enc = encodeURIComponent;

function sessionColumns(clock: string): DataColumn<SessionSummary>[] {
  return [
    {
      key: 'session',
      header: 'SESSION',
      render: (s) => <Link to={`/sessions/${enc(s.id)}`}>{s.id}</Link>,
    },
    {
      key: 'start',
      header: 'STARTED',
      sortable: true,
      render: (s) => formatStart(s.startedAt, clock),
    },
    {
      key: 'duration',
      header: 'DURATION',
      render: (s) => formatDuration(secondsBetween(s.startedAt, s.endedAt ?? clock)),
    },
    {
      key: 'ticket',
      header: 'TICKET',
      render: (s) =>
        s.ticketId ? <Link to={`/tickets/${enc(s.ticketId)}`}>{s.ticketId}</Link> : '—',
    },
    { key: 'model', header: 'MODEL', render: (s) => s.model },
    {
      key: 'status',
      header: 'STATUS',
      render: (s) => {
        const { glyph, word } = SESSION_STATUS_LABEL[s.status];
        return (
          <span>
            <span aria-hidden="true">{glyph}</span> {word}
          </span>
        );
      },
    },
    {
      key: 'tokens',
      header: 'TOKENS',
      align: 'right',
      render: (s) =>
        formatTokens(s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite),
    },
    { key: 'cost', header: 'COST', align: 'right', render: (s) => formatMoney(s.costUsd) },
  ];
}

function AgentView({ page, clock }: { page: AgentPageResponse; clock: string }) {
  const navigate = useNavigate();
  const { agent, kpis } = page;
  const running = page.sessions.find((s) => s.status === 'running');
  const ticketId = agent.currentTicketId;
  return (
    <div className={styles.page}>
      <BackBar
        crumbs={[{ label: 'MISSION CONTROL', to: '/mission-control' }, { label: agent.id }]}
      />
      <header className={styles.head}>
        <h1 className={styles.id}>{agent.id}</h1>
        <div className={styles.badges}>
          <span className={styles.badge}>{KIND_LABEL[agent.kind]}</span>
          <span className={styles.badge}>
            <HealthBadge health={agent.health} /> · SEEN {formatAge(agent.lastSeenAt, clock)}
          </span>
          <span className={styles.badge}>
            {STAGE_BADGE[agent.stage]} {STAGE_LABEL[agent.stage].toUpperCase()}
          </span>
        </div>
        <div className={styles.actions}>
          {ticketId && (
            <Button onClick={() => void navigate(`/tickets/${enc(ticketId)}`)}>
              {ticketId} · open ticket
            </Button>
          )}
          {running && (
            <Button variant="primary" onClick={() => void navigate(`/sessions/${enc(running.id)}`)}>
              Open current session log
            </Button>
          )}
        </div>
      </header>
      <div className={styles.kpis}>
        <KpiTile label="Sessions · 7d" value={kpis.sessions7d} />
        <KpiTile label="Tickets done" value={kpis.ticketsDone} />
        <KpiTile label="Tool calls · today" value={kpis.toolCallsToday} />
        <KpiTile label="Cost · 7d (mock)" value={formatMoney(kpis.cost7dUsd)} href="/usage" />
      </div>
      <SaidVsDidSection agentId={agent.id} data={page.saidVsDid} />
      <section className={styles.section} aria-labelledby="agent-sessions">
        <div className={styles.sectionHead}>
          <h2 id="agent-sessions" className={styles.h2}>
            Sessions
          </h2>
          <MockTag label="MOCK DATA" />
          <span className={styles.hint}>Click a session to read its full log</span>
        </div>
        <DataTable
          caption="Sessions"
          columns={sessionColumns(clock)}
          rows={page.sessions}
          rowKey={(s) => s.id}
          sortKey="start"
          onRowClick={(s) => void navigate(`/sessions/${enc(s.id)}`)}
        />
        <p className={styles.footnote}>
          Showing {page.sessions.length} of {page.sessionsTotal} sessions · all of them in{' '}
          <Link to="/usage">Usage &amp; Cost</Link>
        </p>
      </section>
      <section className={styles.section} aria-labelledby="agent-tickets">
        <h2 id="agent-tickets" className={styles.h2}>
          Tickets
        </h2>
        <ul className={styles.tickets}>
          {page.tickets.map((t) => (
            <li key={t.id}>
              <Link to={`/tickets/${enc(t.id)}`} className={styles.ticketRow}>
                <span className={styles.ticketId}>{t.id}</span>
                <span>{t.title}</span>
                <span className={styles.ticketStatus}>{STATUS_LABEL[t.status].toUpperCase()}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function Screen() {
  const { agentId = '' } = useParams();
  const agent = useAgent(agentId);
  const sim = useSimulation();
  if (agent.error instanceof ApiError && agent.error.status === 404) {
    return <EntityNotFound kind="Agent" id={agentId} />;
  }
  if (!agent.data || !sim.data) {
    return (
      <ScreenFrame
        title={agentId}
        screen="agent"
        loading={agent.isPending || sim.isPending}
        error={agent.isError || sim.isError}
        onRetry={() => {
          void agent.refetch();
          void sim.refetch();
        }}
      />
    );
  }
  return <AgentView page={agent.data} clock={sim.data.clock} />;
}
