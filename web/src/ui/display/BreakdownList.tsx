import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { formatMoney, formatPercent } from '../../lib/format';
import styles from './BreakdownList.module.css';

export interface BreakdownItem {
  key: string;
  name: ReactNode;
  costUsd: number;
  /** Row is a link (agent, ticket) or a button action (model filter); neither = plain row. */
  href?: string;
  onSelect?: () => void;
}

export interface BreakdownListProps {
  title: string;
  items: readonly BreakdownItem[];
}

/** UI-AC-116: name · $cost · N% with a 3 px share bar; sorted by cost descending. */
export function BreakdownList({ title, items }: BreakdownListProps) {
  const sorted = [...items].sort((a, b) => b.costUsd - a.costUsd);
  const total = sorted.reduce((sum, i) => sum + i.costUsd, 0);
  return (
    <section className={styles.section} aria-label={title}>
      <h3 className={styles.title}>
        <span>{title}</span>
        <span className={styles.note}>Cost · share</span>
      </h3>
      <ul className={styles.list}>
        {sorted.map((item) => {
          const share = total > 0 ? (item.costUsd / total) * 100 : 0;
          const content = (
            <>
              <span className={styles.name}>{item.name}</span>
              <span className={styles.cost}>{formatMoney(item.costUsd)}</span>
              <span className={styles.pct}>{formatPercent(item.costUsd, total)}</span>
              <span className={styles.track} aria-hidden="true">
                <span className={styles.fill} style={{ width: `${share}%` }} />
              </span>
            </>
          );
          return (
            <li key={item.key}>
              {item.href ? (
                <Link to={item.href} className={styles.row}>
                  {content}
                </Link>
              ) : item.onSelect ? (
                <button type="button" className={styles.row} onClick={item.onSelect}>
                  {content}
                </button>
              ) : (
                <div className={styles.row}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
