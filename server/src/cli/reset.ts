import { createResetCommand } from '../container.js';
import { describeTarget, loadConfig } from '../infrastructure/config.js';
import { ServerRunningError } from '../infrastructure/fixture/reset.js';
import { loadDotEnv } from './load-env.js';

/** `pnpm --filter @agent-ops/server reset`: restores the seed fixture; refuses while the server runs. */
async function main(): Promise<number> {
  loadDotEnv();
  const config = loadConfig();
  const reset = createResetCommand(config);
  try {
    const floor = await reset.run();
    console.log(`Reset to the seed fixture (journal floor ${floor}).`);
    return 0;
  } catch (err) {
    if (err instanceof ServerRunningError) {
      console.error(err.message);
    } else if (err instanceof Error && err.name === 'DbUnavailableError') {
      console.error(err.message);
    } else {
      console.error(
        `Reset failed (${describeTarget(config.databaseUrl)}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return 1;
  } finally {
    await reset.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
