import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useConnection } from '../api/stream';

export const ACTIONS_PAUSED_REASON = 'Reconnecting — actions are paused';

interface ActionGateValue {
  /** True while the stream is lost: every data-changing control must be refused (UI-AC-30). */
  paused: boolean;
  /** `ACTIONS_PAUSED_REASON` while paused, otherwise undefined. */
  reason: string | undefined;
}

const OPEN: ActionGateValue = { paused: false, reason: undefined };
const PAUSED: ActionGateValue = { paused: true, reason: ACTIONS_PAUSED_REASON };

const ActionGateContext = createContext<ActionGateValue>(OPEN);

export function ActionGateProvider({ children }: { children: ReactNode }) {
  const { status } = useConnection();
  const value = useMemo(() => (status === 'lost' ? PAUSED : OPEN), [status]);
  return <ActionGateContext.Provider value={value}>{children}</ActionGateContext.Provider>;
}

/** For tests and stories that need a fixed gate without a stream. */
export function StaticActionGate({ paused, children }: { paused: boolean; children: ReactNode }) {
  return (
    <ActionGateContext.Provider value={paused ? PAUSED : OPEN}>
      {children}
    </ActionGateContext.Provider>
  );
}

export function useActionGate(): ActionGateValue {
  return useContext(ActionGateContext);
}

/**
 * `disabledReason` for a data-changing Button: the paused reason wins over the control's own reason.
 * Usage: `<Button disabledReason={useGatedReason(ownReason)} />`.
 */
export function useGatedReason(ownReason?: string): string | undefined {
  const { reason } = useActionGate();
  return reason ?? ownReason;
}
