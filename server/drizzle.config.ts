import { defineConfig } from 'drizzle-kit';

// Migrations are generated only (never `drizzle-kit push`, ADR-0009). The URL is only needed by
// commands that connect (migrate/studio); `generate` and `check` work offline.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/db/schema.ts',
  out: './drizzle',
  ...(process.env['DATABASE_URL'] ? { dbCredentials: { url: process.env['DATABASE_URL'] } } : {}),
});
