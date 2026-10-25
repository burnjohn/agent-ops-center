import type { ReactNode } from 'react';
import { Button } from '../ui/controls';
import styles from './ScreenFrame.module.css';

/** `LOADING…` placeholder for one data region (UI-AC-27). */
export function Loading() {
  return <p className={styles.loading}>LOADING…</p>;
}

export interface ScreenFrameProps {
  /** Page title, shown in every state. */
  title: ReactNode;
  /** Name used in the error copy: "Couldn’t load <screen> — …". */
  screen: string;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  children?: ReactNode;
}

/** Title + loading / error states every screen shares (UI-AC-27, AC-28). Never shows partial numbers. */
export function ScreenFrame({
  title,
  screen,
  loading = false,
  error = false,
  onRetry,
  children,
}: ScreenFrameProps) {
  let body: ReactNode = children;
  if (error) {
    body = (
      <div role="alert" className={styles.error}>
        <p>Couldn’t load {screen} — the server is not responding.</p>
        <Button onClick={onRetry}>Retry</Button>
      </div>
    );
  } else if (loading) {
    body = <Loading />;
  }
  return (
    <section className={styles.frame}>
      <h1 className={styles.title}>{title}</h1>
      {body}
    </section>
  );
}
