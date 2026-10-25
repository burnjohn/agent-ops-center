import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { ConstraintRace } from '../../application/ports/errors.js';
import { classifyConstraintError, toConstraintRace } from './constraint-errors.js';
import * as schema from './schema.js';

const pgError = (code: string, constraint?: string) =>
  Object.assign(new Error('pg'), { code, constraint });

describe('classifyConstraintError', () => {
  it.each([
    ['23505', 'tickets_assignee_active_uq', 'agent_busy'],
    ['23505', 'sessions_agent_running_uq', 'agent_busy'],
    ['23505', 'tickets_number_uq', 'counter_collision'],
    ['23505', 'sessions_number_uq', 'counter_collision'],
    ['23505', 'tickets_pkey', 'counter_collision'],
    ['23514', 'tickets_title_nonblank_ck', 'empty_title'],
    ['23514', 'tickets_status_ck', 'internal'],
    ['23514', 'session_log_entries_token_activity_ck', 'internal'],
    ['23503', 'events_ticket_id_fk', 'internal'],
    ['23502', undefined, 'internal'],
    ['P0001', undefined, 'internal'],
    ['40001', undefined, 'stale_state'],
    ['40P01', undefined, 'stale_state'],
    ['55P03', undefined, 'stale_state'],
    ['57014', undefined, 'stale_state'],
  ] as const)('%s %s -> %s', (code, constraint, kind) => {
    expect(classifyConstraintError(pgError(code, constraint))).toBe(kind);
  });

  it('unwraps drizzle query errors via cause', () => {
    const wrapped = new Error('Failed query', {
      cause: pgError('23505', 'sessions_agent_running_uq'),
    });
    expect(classifyConstraintError(wrapped)).toBe('agent_busy');
  });

  it('ignores non-database errors and connection errors', () => {
    expect(classifyConstraintError(new Error('boom'))).toBeNull();
    expect(classifyConstraintError(pgError('08006'))).toBeNull();
    expect(
      classifyConstraintError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })),
    ).toBeNull();
  });

  it('maps every named constraint of the schema to a defined outcome', () => {
    const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
    let checked = 0;
    for (const table of tables) {
      const cfg = getTableConfig(table);
      for (const c of cfg.checks) {
        expect(classifyConstraintError(pgError('23514', c.name))).not.toBeNull();
        checked += 1;
      }
      for (const fk of cfg.foreignKeys) {
        expect(classifyConstraintError(pgError('23503', fk.getName()))).toBe('internal');
        checked += 1;
      }
      for (const i of cfg.indexes.filter((x) => x.config.unique)) {
        const name = i.config.name;
        const kind = classifyConstraintError(pgError('23505', name));
        expect(['agent_busy', 'counter_collision', 'internal']).toContain(kind);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe('toConstraintRace', () => {
  it('wraps with the cause', () => {
    const cause = pgError('23514', 'tickets_title_nonblank_ck');
    const race = toConstraintRace(cause);
    expect(race).toBeInstanceOf(ConstraintRace);
    expect(race?.kind).toBe('empty_title');
    expect(race?.cause).toBe(cause);
  });
  it('passes an existing race through and returns null for other errors', () => {
    const r = new ConstraintRace('internal');
    expect(toConstraintRace(r)).toBe(r);
    expect(toConstraintRace(new Error('x'))).toBeNull();
  });
});
