import { Fragment } from 'react';
import { Link } from 'react-router';
import { useVisitHistory } from './history';
import styles from './BackBar.module.css';

export interface Crumb {
  label: string;
  /** Omitted on the last crumb. */
  to?: string;
}

/** `BOARD / <STATUS> / T-x`; every part except the last is a link (UI-AC-13). */
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.crumbs}>
      <ol>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={`${i}-${c.label}`}>
              <li>
                {!last && c.to !== undefined ? (
                  <Link to={c.to}>{c.label}</Link>
                ) : (
                  <span aria-current={last ? 'page' : undefined}>{c.label}</span>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className={styles.sep}>
                  /
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/** `← BACK TO <previous screen>` plus breadcrumbs, for ticket, agent and session pages (UI-AC-10). */
export function BackBar({ crumbs }: { crumbs: readonly Crumb[] }) {
  const { previous, goBack } = useVisitHistory();
  return (
    <div className={styles.bar}>
      <button type="button" className={styles.back} onClick={goBack}>
        ← BACK TO {previous.label}
      </button>
      <Breadcrumbs crumbs={crumbs} />
    </div>
  );
}
