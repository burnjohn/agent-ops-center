import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEventStream } from '../api/stream';
import { ToastRegion } from '../ui/overlay';
import { ActionGateProvider } from './ActionGate';
import { ThemeProvider } from './theme';

/** The stream patches the cache, so reads never go stale by time or focus (ADR-0004, UI-AC-24). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}

/** Opens the tab's single event stream exactly once. */
function StreamHost({ children }: { children: ReactNode }) {
  useEventStream();
  return children;
}

/** Query client, stream, theme, toasts and the action gate. Router-dependent state lives in `HistoryProvider`. */
export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [defaultClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client ?? defaultClient}>
      <ThemeProvider>
        <ToastRegion>
          <StreamHost>
            <ActionGateProvider>{children}</ActionGateProvider>
          </StreamHost>
        </ToastRegion>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
