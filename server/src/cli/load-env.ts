import { existsSync } from 'node:fs';

/** Loads `.env` from the working directory or the repo root when present (local development); real env wins. */
export function loadDotEnv(): void {
  for (const path of ['.env', '../.env']) {
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return;
    }
  }
}
