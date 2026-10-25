import { useAgents, useOverview, useSimulation, useTickets } from '../../api/queries';
import { ScreenFrame } from '../../app/ScreenFrame';
import { KpiTile } from '../../ui/display';
import { AgentCard } from './AgentCard';
import { EventLog } from './EventLog';
import { healthLegend, sortAgents } from './model';
import styles from './MissionControl.module.css';

export default function Screen() {
  const overview = useOverview();
  const agents = useAgents();
  const tickets = useTickets();
  const sim = useSimulation();
  const queries = [overview, agents, tickets, sim];

  if (!overview.data || !agents.data || !tickets.data || !sim.data) {
    return (
      <ScreenFrame
        title="Mission Control"
        screen="Mission Control"
        loading={queries.some((q) => q.isPending)}
        error={queries.some((q) => q.isError)}
        onRetry={() => queries.forEach((q) => void q.refetch())}
      />
    );
  }

  const o = overview.data;
  const perMinute = o.eventsPerMinute;
  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <h1 className={styles.title}>Mission Control</h1>
        <div className={styles.kpis}>
          <KpiTile label="■ Agents online" value={`${o.agentsOnline}/${o.agentsTotal}`} />
          <KpiTile label="■ Blocked →" value={o.blockedTickets} href="/board" attn />
          <KpiTile label="In review →" value={o.reviewTickets} href="/board" />
          <KpiTile
            label="Events / min"
            value={perMinute[perMinute.length - 1] ?? 0}
            spark={perMinute}
            sparkLabel="Events per minute, last 12 minutes"
          />
        </div>
      </div>
      <p className={styles.legend}>{healthLegend(sim.data.healthThresholds)}</p>
      <div className={styles.body}>
        <div className={styles.main}>
          <div className={styles.grid}>
            {sortAgents(agents.data).map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                tickets={tickets.data}
                clock={sim.data.clock}
                playing={sim.data.playing}
              />
            ))}
          </div>
        </div>
        <EventLog />
      </div>
    </div>
  );
}
