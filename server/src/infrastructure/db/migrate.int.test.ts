import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTableName, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminDatabaseUrl, testDatabaseName } from '../../../test/int/env.js';
import { createDb, type DbHandle } from './client.js';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.js';
import * as schema from './schema.js';

// A scratch database per file so "empty database" is really empty; the shared test DB is never touched.
const SCRATCH = `${testDatabaseName()}_mig`;
const scratchUrl = adminDatabaseUrl().replace(/\/postgres$/, `/${SCRATCH}`);

let handle: DbHandle;
let tmpRoot: string;

async function admin(stmt: string): Promise<void> {
  const c = new pg.Client({ connectionString: adminDatabaseUrl() });
  await c.connect();
  try {
    await c.query(stmt);
  } finally {
    await c.end();
  }
}

async function schemaDescription(): Promise<unknown[]> {
  const q = async (text: string) => (await handle.pool.query(text)).rows;
  return [
    await q(
      `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' order by 1, 2`,
    ),
    await q(
      `select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`,
    ),
    await q(`select indexname, indexdef from pg_indexes where schemaname = 'public' order by 1`),
    await q(`select tgname from pg_trigger where not tgisinternal order by 1`),
  ];
}

const publicTables = async (): Promise<string[]> =>
  (
    await handle.pool.query(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    )
  ).rows.map((r: { table_name: string }) => r.table_name);

const migrationRows = async (): Promise<number> =>
  Number(
    (await handle.pool.query('select count(*) as n from drizzle.__drizzle_migrations')).rows[0].n,
  );

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'agent-ops-mig-'));
  await admin(`drop database if exists "${SCRATCH}" with (force)`);
  await admin(`create database "${SCRATCH}"`);
  handle = createDb(scratchUrl);
});

afterAll(async () => {
  await handle.close();
  await admin(`drop database if exists "${SCRATCH}" with (force)`);
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('migrations', () => {
  const declared = [
    schema.agentSimState,
    schema.agents,
    schema.events,
    schema.idCounters,
    schema.modelPrices,
    schema.sessionLogEntries,
    schema.sessions,
    schema.simulationState,
    schema.tickets,
  ]
    .map((t) => getTableName(t))
    .sort();
  let afterFirst: unknown[];
  let rowsAfterFirst: number;

  it('DB-AC-1: applies every migration to an empty database so all tables exist before serving', async () => {
    // contract: starting against an empty database creates every declared table
    expect(await publicTables()).toEqual([]);
    await runMigrations(handle.db);
    expect(await publicTables()).toEqual(declared);
    const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, 'utf8')) as {
      entries: unknown[];
    };
    expect(await migrationRows()).toBe(journal.entries.length);
    afterFirst = await schemaDescription();
    rowsAfterFirst = await migrationRows();
  });

  it('DB-AC-3: a second run on an up-to-date database changes nothing', async () => {
    // contract: re-applying migrations leaves schema and migration bookkeeping identical
    await runMigrations(handle.db);
    expect(await schemaDescription()).toEqual(afterFirst);
    expect(await migrationRows()).toBe(rowsAfterFirst);
  });

  it('DB-AC-4: every journal entry has a committed SQL file and the migrated schema matches the declared tables', async () => {
    // contract: all schema changes come from committed forward-only migrations; result == declared schema
    const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, 'utf8')) as {
      entries: { tag: string }[];
    };
    for (const { tag } of journal.entries) {
      expect(readFileSync(`${MIGRATIONS_FOLDER}/${tag}.sql`, 'utf8').length).toBeGreaterThan(0);
    }
    expect(await publicTables()).toEqual(declared);
    // TODO: contract unclear — a full drizzle-kit drift check (snapshot vs schema.ts) runs in CI, not here.
  });

  it('DB-AC-2: a failing migration reports its tag, keeps earlier ones applied and rolls itself back', async () => {
    // contract: error names the broken migration; earlier migrations stay; nothing of the broken one persists
    const folder = join(tmpRoot, 'broken');
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = `${folder}/meta/_journal.json`;
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
    };
    const last = journal.entries[journal.entries.length - 1]!;
    const tag = `${String(journal.entries.length).padStart(4, '0')}_deliberately_broken`;
    journal.entries.push({
      idx: journal.entries.length,
      version: last.version,
      when: last.when + 1000,
      tag,
      breakpoints: true,
    });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(
      `${folder}/${tag}.sql`,
      'CREATE TABLE "mig_probe" ("id" integer);--> statement-breakpoint\nSELECT * FROM "no_such_table_anywhere";',
    );

    const before = await migrationRows();
    await expect(runMigrations(handle.db, folder)).rejects.toThrow(new RegExp(tag));
    expect(await migrationRows()).toBe(before);
    expect(await publicTables()).not.toContain('mig_probe');
    expect(await publicTables()).toEqual(declared);
    await handle.db.execute(sql`select 1`);
  });
});
