import { useConnection } from '../api/stream';
import styles from './ConnectionBanner.module.css';

/** Full-width banner below the header while the event stream is lost (UI-AC-29). */
export function ConnectionBanner() {
  const { status } = useConnection();
  if (status !== 'lost') return null;
  return (
    <div role="status" className={styles.banner}>
      Connection lost — reconnecting…
    </div>
  );
}
