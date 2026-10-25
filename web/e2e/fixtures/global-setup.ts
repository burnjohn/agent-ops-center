import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The server serves `web/dist` (SPA fallback), so the bundle must be fresh before any spec runs. */
export default function globalSetup(): void {
  const webDir = fileURLToPath(new URL('../..', import.meta.url));
  const result = spawnSync('pnpm', ['exec', 'vite', 'build'], { cwd: webDir, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('web build failed; cannot run e2e');
}
