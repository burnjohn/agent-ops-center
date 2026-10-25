import type { ReactNode } from 'react';
import styles from './MockBanner.module.css';

/** Striped `MOCK DATA` strip (MOCK-01). */
export function MockBanner({ children }: { children: ReactNode }) {
  return (
    <div className={styles.banner} role="note">
      <strong className={styles.label}>MOCK DATA</strong>
      <span>{children}</span>
    </div>
  );
}

/** Dashed `MOCK` tag; `label` overrides the copy where the spec asks for `MOCK DATA` (UI-AC-108). */
export function MockTag({ label = 'MOCK' }: { label?: string }) {
  return <span className={styles.tag}>{label}</span>;
}
