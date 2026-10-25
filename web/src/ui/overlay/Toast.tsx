import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styles from './Toast.module.css';

export const TOAST_DURATION_MS = 3400;

interface ToastApi {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Hosts the single live region; a newer toast replaces an older one (AC-18). */
export function ToastRegion({ children }: { children?: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const counter = useRef(0);

  const showToast = useCallback((message: string) => {
    clearTimeout(timer.current);
    counter.current += 1;
    setToast({ id: counter.current, message });
    timer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo<ToastApi>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} aria-live="polite" role="status">
        {toast && (
          <div key={toast.id} className={styles.toast}>
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastRegion>');
  return ctx;
}
