import type { ReactNode } from 'react';
import { Link } from 'react-router';
import styles from './KpiTile.module.css';

export interface KpiTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Makes the tile a link (e.g. Blocked → Board). */
  href?: string;
  /** Needs-a-human tone (`--attn-ink`). */
  attn?: boolean;
  /** Sparkline bars, oldest first; the newest bar is `--live`. */
  spark?: readonly number[];
  sparkLabel?: string;
}

function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const max = Math.max(1, ...values);
  const gap = 2;
  const barW = 6;
  const height = 24;
  const width = values.length * (barW + gap) - gap;
  return (
    <svg className={styles.spark} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {values.map((v, i) => {
        const h = Math.max(1, Math.round((v / max) * height));
        const newest = i === values.length - 1;
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={height - h}
            width={barW}
            height={h}
            className={newest ? styles.sparkNewest : styles.sparkBar}
          />
        );
      })}
    </svg>
  );
}

export function KpiTile({
  label,
  value,
  sub,
  href,
  attn = false,
  spark,
  sparkLabel,
}: KpiTileProps) {
  const body = (
    <>
      <span className={`${styles.label} ${attn ? styles.attn : ''}`}>{label}</span>
      <span className={`${styles.value} ${attn ? styles.attn : ''}`}>{value}</span>
      {sub !== undefined && <span className={styles.sub}>{sub}</span>}
      {spark && <Sparkline values={spark} label={sparkLabel ?? 'Trend'} />}
    </>
  );
  return href ? (
    <Link to={href} className={`${styles.tile} ${styles.link}`}>
      {body}
    </Link>
  ) : (
    <div className={styles.tile}>{body}</div>
  );
}
