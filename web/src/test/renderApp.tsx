import { QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HistoryProvider } from '../app/history';
import { AppProviders, createQueryClient } from '../app/providers';
import { AppRoutes } from '../app/routes';
import { FakeEventSource } from './FakeEventSource';
import { createFakeNetwork, type FakeNetwork } from './fakeNetwork';
import { setupUser, type TestUser } from './user';

export interface RenderedApp extends RenderResult {
  user: TestUser;
  queryClient: QueryClient;
  network: FakeNetwork;
}

export interface RenderOptions {
  /** Start location; defaults to the Board. */
  route?: string;
  /** Defaults to a seed-loaded network installed for this render. */
  network?: FakeNetwork;
  /** Skip creating a user (pass your own `setupUser({ advanceTimers })` under fake timers). */
  user?: TestUser;
  /** Do not install `EventSource` (when the caller already did). */
  skipStream?: boolean;
}

/**
 * Mounts the real app (providers, stream host, routes) at `route` with faked `fetch` and `EventSource`.
 * Cleanup: `setup.ts` uninstalls both fakes, resets module-level UI state and unmounts after each test. The server's `hello` is NOT sent
 * automatically — call `FakeEventSource.emitHello()` to move the connection to `connected`.
 */
export function renderApp({
  route = '/board',
  network,
  user,
  skipStream = false,
}: RenderOptions = {}): RenderedApp {
  const net = network ?? createFakeNetwork();
  net.install();
  if (!skipStream) FakeEventSource.install();
  const queryClient = createQueryClient();
  const view = render(
    <AppProviders client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <HistoryProvider>
          <AppRoutes />
        </HistoryProvider>
      </MemoryRouter>
    </AppProviders>,
  );
  return { ...view, user: user ?? setupUser(), queryClient, network: net };
}
