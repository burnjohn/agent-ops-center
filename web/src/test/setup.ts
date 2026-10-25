import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { clearBoardFilters } from '../features/board/filters';
import { resetConsoleSelection } from '../features/console/selection';
import { resetEventLogControls } from '../features/mission-control/eventLogState';
import { resetUsageControls } from '../features/usage/state';
import { FakeEventSource } from './FakeEventSource';
import { uninstallAllNetworks } from './fakeNetwork';

// Vitest runs without `globals`, so RTL's auto-cleanup is not registered: do it here, plus every
// module-level piece of state the harness can touch (ADR-0012: no leaked state between tests).
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  uninstallAllNetworks();
  FakeEventSource.uninstall();
  clearBoardFilters();
  resetConsoleSelection();
  resetEventLogControls();
  resetUsageControls();
  localStorage.clear();
});
