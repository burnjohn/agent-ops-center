import { Link } from 'react-router';
import { BOARD_PATH, MISSION_CONTROL_PATH } from './routeInfo';
import styles from './ScreenFrame.module.css';

export type EntityKind = 'Ticket' | 'Agent' | 'Session';

/** Unknown ticket / agent / session id (UI-AC-17). */
export function EntityNotFound({ kind, id }: { kind: EntityKind; id: string }) {
  const toBoard = kind === 'Ticket';
  return (
    <section className={styles.frame}>
      <h1 className={styles.title}>
        {kind} {id} doesn't exist.
      </h1>
      <Link to={toBoard ? BOARD_PATH : MISSION_CONTROL_PATH}>
        {toBoard ? '← BACK TO BOARD' : '← BACK TO MISSION CONTROL'}
      </Link>
    </section>
  );
}

/** Unknown path (UI-AC-16). */
export function PageNotFound() {
  return (
    <section className={styles.frame}>
      <h1 className={styles.title}>Page not found.</h1>
      <Link to={BOARD_PATH}>Go to Board</Link>
    </section>
  );
}
