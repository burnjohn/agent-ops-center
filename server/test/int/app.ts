import { afterEach } from 'vitest';
import { testDatabaseUrl } from './env.js';

export interface TestApp {
  /** Fastify instance; use `app.inject(...)` for HTTP, or `app.listen({ port: 0 })` for SSE. */
  readonly app: {
    inject(opts: unknown): Promise<{ statusCode: number; body: string; json(): unknown }>;
    listen(opts: { port: number; host: string }): Promise<string>;
  };
  close(): Promise<void>;
}

/**
 * Real container on the test DB; no server lock, no migration (global-setup did it).
 * The container (T32) is imported lazily so this harness compiles and runs before it exists.
 * Assumes `createContainer(config)` returns `{ app, close() }`; adjust here if T32 differs.
 */
export async function buildTestApp(): Promise<TestApp> {
  const specifier = '../../src/container.js';
  const mod = (await import(/* @vite-ignore */ specifier)) as {
    createContainer(config: {
      databaseUrl: string;
      port: number;
      host: '127.0.0.1';
    }): Promise<TestApp> | TestApp;
  };
  const container = await mod.createContainer({
    databaseUrl: testDatabaseUrl(),
    port: 0,
    host: '127.0.0.1',
  });
  afterEach(() => container.close());
  return container;
}
