import { useId, useState } from 'react';
import styles from './BarChart.module.css';

export interface Bar {
  key: string;
  /** Tooltip text, e.g. `Oct 4 · $12.30`. */
  tooltip: string;
  value: number;
  /** In the selected period → ink, otherwise line. */
  inPeriod: boolean;
  /** Gets a `--live` top edge. */
  today?: boolean;
}

export interface BarChartProps {
  bars: readonly Bar[];
  /** Axis tick labels, top to bottom (4 steps). */
  axis: readonly string[];
  /** x labels placed under the bar at `index`. */
  xLabels: readonly { index: number; text: string }[];
  /** Accessible description of the whole chart. */
  description: string;
}

const H = 100;
const SLOT = 10;
const GRID = [0, 1 / 3, 2 / 3] as const;

/** Hand-built SVG bar chart (no chart library). */
export function BarChart({ bars, axis, xLabels, description }: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const descId = useId();
  const max = Math.max(...bars.map((b) => b.value), 0);
  const width = bars.length * SLOT;
  const active = hover === null ? null : bars[hover];
  return (
    <figure className={styles.figure}>
      <div className={styles.plot}>
        <ol className={styles.axis} aria-hidden="true">
          {axis.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
        <div className={styles.canvas} onMouseLeave={() => setHover(null)}>
          <svg
            className={styles.svg}
            viewBox={`0 0 ${width} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-labelledby={descId}
          >
            <title id={descId}>{description}</title>
            {GRID.map((g) => (
              <line key={g} x1={0} x2={width} y1={g * H} y2={g * H} className={styles.grid} />
            ))}
            {bars.map((b, i) => {
              const h = max > 0 ? Math.max(b.value > 0 ? 1 : 0, (b.value / max) * H) : 0;
              return (
                <g key={b.key} onMouseEnter={() => setHover(i)}>
                  <rect x={i * SLOT} y={0} width={SLOT} height={H} className={styles.hit} />
                  <rect
                    x={i * SLOT + 1}
                    y={H - h}
                    width={SLOT - 2}
                    height={h}
                    className={b.inPeriod ? styles.barOn : styles.barOff}
                  />
                  {b.today && h > 0 && (
                    <rect
                      x={i * SLOT + 1}
                      y={H - h}
                      width={SLOT - 2}
                      height={2}
                      className={styles.today}
                    />
                  )}
                </g>
              );
            })}
          </svg>
          {active && hover !== null && (
            <div
              className={styles.tip}
              style={{ left: `${((hover + 0.5) / bars.length) * 100}%` }}
              aria-hidden="true"
            >
              {active.tooltip}
            </div>
          )}
        </div>
      </div>
      <div className={styles.xlabels} aria-hidden="true">
        {xLabels.map((l) => (
          <span key={l.index} style={{ left: `${((l.index + 0.5) / bars.length) * 100}%` }}>
            {l.text}
          </span>
        ))}
      </div>
    </figure>
  );
}
