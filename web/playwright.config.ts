import { defineConfig, devices } from '@playwright/test';

// Real server + real Postgres (ADR-0012). The server fixture (e2e/fixtures/server.ts) starts one server per
// worker on a free port and exposes it as `baseURL`; one worker keeps the single-DB state deterministic.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/fixtures/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
