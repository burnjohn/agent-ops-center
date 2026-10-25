import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));

function journalTags(folder: string): string[] {
  try {
    const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, 'utf8')) as {
      entries: { tag: string }[];
    };
    return journal.entries.map((e) => e.tag);
  } catch {
    return [];
  }
}

async function appliedCount(db: Db): Promise<number> {
  try {
    const res = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from drizzle.__drizzle_migrations`,
    );
    return Number(res.rows[0]?.n ?? 0);
  } catch {
    return 0; // migrations table not created yet
  }
}

/** Applies pending migrations; on failure throws naming the migration that failed. */
export async function runMigrations(db: Db, folder: string = MIGRATIONS_FOLDER): Promise<void> {
  const before = await appliedCount(db);
  try {
    await migrate(db, { migrationsFolder: folder });
  } catch (err) {
    const name = journalTags(folder)[before] ?? 'unknown';
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Migration ${name} failed: ${reason}`, { cause: err });
  }
}
