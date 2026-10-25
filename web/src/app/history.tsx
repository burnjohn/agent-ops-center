import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { BOARD_PATH, screenLabel } from './routeInfo';

/** In-app visit history (UI-AC-4, AC-10…12). UI state: lives in React, never in the query cache (ADR-0011). */

export const HISTORY_LIMIT = 30;

type Pending = 'push' | 'back' | 'reset';

export interface HistoryState {
  current: string;
  /** Earlier routes, oldest first; the last entry is where Back goes. */
  stack: string[];
  /** How the next location change must be recorded. */
  pending: Pending;
}

export type HistoryAction =
  | { type: 'location'; pathname: string }
  | { type: 'back'; target: string }
  | { type: 'clear'; target: string };

export const initialHistory = (pathname: string): HistoryState => ({
  current: pathname,
  stack: [],
  pending: 'push',
});

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'location': {
      if (action.pathname === state.current) return state; // equal target adds no visit (UI-AC-12)
      const stack =
        state.pending === 'push'
          ? [...state.stack, state.current].slice(-HISTORY_LIMIT)
          : state.stack;
      return { current: action.pathname, stack, pending: 'push' };
    }
    case 'back': {
      const stack = state.stack.slice(0, -1);
      return { ...state, stack, pending: action.target === state.current ? 'push' : 'back' };
    }
    case 'clear':
      return { ...state, stack: [], pending: action.target === state.current ? 'push' : 'reset' };
  }
}

export interface PreviousVisit {
  path: string;
  /** `BOARD`, `MISSION CONTROL`, `USAGE & COST` or an entity id. */
  label: string;
}

interface HistoryApi {
  previous: PreviousVisit;
  /** Opens the previous visit and removes it; `/board` when the history is empty (UI-AC-11). */
  goBack: () => void;
  /** Call on primary-nav / brand clicks: forgets every visit (UI-AC-4). */
  clear: (target: string) => void;
}

const HistoryContext = createContext<HistoryApi | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(historyReducer, pathname, initialHistory);

  useEffect(() => {
    dispatch({ type: 'location', pathname });
  }, [pathname]);

  const targetPath = state.stack.at(-1) ?? BOARD_PATH;

  const goBack = useCallback(() => {
    dispatch({ type: 'back', target: targetPath });
    void navigate(targetPath);
  }, [navigate, targetPath]);

  const clear = useCallback((target: string) => dispatch({ type: 'clear', target }), []);

  const api = useMemo<HistoryApi>(
    () => ({ previous: { path: targetPath, label: screenLabel(targetPath) }, goBack, clear }),
    [targetPath, goBack, clear],
  );

  return <HistoryContext.Provider value={api}>{children}</HistoryContext.Provider>;
}

export function useVisitHistory(): HistoryApi {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error('useVisitHistory must be used inside <HistoryProvider>');
  return ctx;
}
