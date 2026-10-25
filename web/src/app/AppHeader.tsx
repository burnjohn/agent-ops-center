import { Link, useLocation } from 'react-router';
import { useTickets } from '../api/queries';
import { SimulationPanel } from '../features/simulation';
import { Button } from '../ui/controls';
import { MockTag } from '../ui/display';
import styles from './AppHeader.module.css';
import { useVisitHistory } from './history';
import {
  BOARD_PATH,
  MISSION_CONTROL_PATH,
  USAGE_PATH,
  navSection,
  type NavSection,
} from './routeInfo';
import { useTheme } from './theme';

const NAV: { section: NavSection; path: string; label: string; mock?: boolean }[] = [
  { section: 'board', path: BOARD_PATH, label: '01 Board' },
  { section: 'mission-control', path: MISSION_CONTROL_PATH, label: '02 Mission Control' },
  { section: 'usage', path: USAGE_PATH, label: '03 Usage & Cost', mock: true },
];

/** `In Progress` + `Blocked` tickets (UI-AC-3). */
export function useBlockedCount(): number {
  const { data } = useTickets();
  return data?.filter((t) => t.status === 'in_progress' && t.blockedQuestion !== null).length ?? 0;
}

export function PrimaryNav() {
  const { pathname } = useLocation();
  const { clear } = useVisitHistory();
  const active = navSection(pathname);
  const blocked = useBlockedCount();
  return (
    <nav aria-label="Primary" className={styles.nav}>
      {NAV.map(({ section, path, label, mock }) => (
        <Link
          key={section}
          to={path}
          className={styles.navItem}
          aria-current={active === section ? 'page' : undefined}
          onClick={() => clear(path)}
        >
          {label}
          {mock && <MockTag />}
          {section === 'board' && blocked > 0 && (
            <span className={styles.badge}>{blocked} BLOCKED</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  // The accessible name starts with the visible label (WCAG 2.5.3 label-in-name).
  const label = theme === 'dark' ? '☀ LIGHT' : '◐ DARK';
  return (
    <Button size="sm" aria-label={`${label} — toggle dark mode`} onClick={toggle}>
      {label}
    </Button>
  );
}

export function AppHeader() {
  const { clear } = useVisitHistory();
  return (
    <header className={styles.header}>
      <Link to={BOARD_PATH} className={styles.brand} onClick={() => clear(BOARD_PATH)}>
        <span className={styles.mark} aria-hidden="true">
          <i />
          <i />
          <i />
          <i className={styles.markAttn} />
        </span>
        AGENT OPS
      </Link>
      <PrimaryNav />
      <div className={styles.right}>
        <SimulationPanel />
        <ThemeToggle />
        <span className={styles.local}>LOCAL · NO AUTH</span>
      </div>
    </header>
  );
}
