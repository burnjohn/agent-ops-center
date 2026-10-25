import { usePause, usePlay, useStepAll } from '../../api/commands';
import { useSimulation } from '../../api/queries';
import { useGatedReason } from '../../app/ActionGate';
import { Button } from '../../ui/controls';
import { formatClock } from '../../lib/format';
import styles from './SimulationPanel.module.css';

const NO_CLOCK = '--:--:--';

/**
 * Header Simulation panel (UI-AC-6…8). State comes only from server data (cache patched by the stream);
 * commands never update the panel optimistically (ADR-0008, U-16).
 */
export function SimulationPanel() {
  const { data } = useSimulation();
  const play = usePlay();
  const pause = usePause();
  const step = useStepAll();

  const playing = data?.playing ?? false;
  const playReason = useGatedReason();
  const stepReason = useGatedReason(playing ? 'Pause to step manually' : undefined);
  const busy = play.isPending || pause.isPending;
  const clock = data ? formatClock(data.clock) : NO_CLOCK;

  return (
    <div className={styles.panel} role="group" aria-label="Simulation">
      <span className={styles.label}>Simulation</span>
      <Button
        size="sm"
        aria-pressed={playing}
        disabled={busy}
        disabledReason={playReason}
        onClick={() => (playing ? pause.mutate() : play.mutate())}
      >
        {playing ? 'Ⅱ PAUSE' : '▶ PLAY'}
      </Button>
      <Button
        size="sm"
        disabled={step.isPending}
        disabledReason={stepReason}
        onClick={() => step.mutate()}
      >
        STEP
      </Button>
      <span className={styles.clock}>
        <span className={playing ? styles.dotLive : styles.dot} aria-hidden="true" />
        <time dateTime={data?.clock}>{clock}</time>
      </span>
    </div>
  );
}
