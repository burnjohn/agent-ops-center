import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import {
  AGENT_KINDS,
  AGENT_STAGES,
  EVENT_CATEGORIES,
  EVENT_SOURCES,
  LOG_ENTRY_TYPES,
  PRIORITIES,
  SESSION_STATUSES,
  TICKET_STATUSES,
  TOKEN_ACTIVITIES,
} from '@agent-ops/shared';

// Constraint names are part of the contract: T16 maps them to API errors. Do not rename casually.

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (col: string, values: readonly string[]): SQL =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const modelPrices = pgTable(
  'model_prices',
  {
    model: text('model').primaryKey(),
    inputPerM: numeric('input_per_m', { precision: 14, scale: 6 }).notNull(),
    outputPerM: numeric('output_per_m', { precision: 14, scale: 6 }).notNull(),
    cacheReadPerM: numeric('cache_read_per_m', { precision: 14, scale: 6 }).notNull(),
    cacheWritePerM: numeric('cache_write_per_m', { precision: 14, scale: 6 }).notNull(),
  },
  () => [
    check(
      'model_prices_prices_nonneg',
      sql`input_per_m >= 0 and output_per_m >= 0 and cache_read_per_m >= 0 and cache_write_per_m >= 0`,
    ),
  ],
);

export const tickets = pgTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    acceptanceCriteria: text('acceptance_criteria')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    priority: text('priority').notNull(),
    status: text('status').notNull(),
    assigneeId: text('assignee_id'),
    blockedQuestion: text('blocked_question'),
    answer: text('answer'),
    reviewSummary: text('review_summary'),
    resultLink: text('result_link'),
    reviewComment: text('review_comment'),
    lastUpdateText: text('last_update_text'),
    lastUpdateAt: ts('last_update_at'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'tickets_assignee_id_fk',
      columns: [t.assigneeId],
      foreignColumns: [agents.id],
    }).onDelete('restrict'),
    uniqueIndex('tickets_number_uq').on(t.number),
    uniqueIndex('tickets_assignee_active_uq')
      .on(t.assigneeId)
      .where(sql`status in ('in_progress', 'review')`),
    index('tickets_board_idx').on(t.status, t.priority, t.createdAt, t.number),
    check('tickets_id_format_ck', sql`number >= 1 and id = 'T-' || number::text`),
    check('tickets_title_nonblank_ck', sql`title ~ '\\S'`),
    check('tickets_status_ck', inList('status', TICKET_STATUSES)),
    check('tickets_priority_ck', inList('priority', PRIORITIES)),
    check(
      'tickets_blocked_in_progress_ck',
      sql`blocked_question is null or status = 'in_progress'`,
    ),
  ],
);

export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    model: text('model').notNull(),
    stage: text('stage').notNull(),
    currentTicketId: text('current_ticket_id'),
    currentSessionId: text('current_session_id'),
    currentToolName: text('current_tool_name'),
    currentToolArg: text('current_tool_arg'),
    currentToolStartedAt: ts('current_tool_started_at'),
    lastToolName: text('last_tool_name'),
    lastToolArg: text('last_tool_arg'),
    lastToolOk: boolean('last_tool_ok'),
    lastToolAt: ts('last_tool_at'),
    lastSeenAt: ts('last_seen_at').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'agents_model_fk',
      columns: [t.model],
      foreignColumns: [modelPrices.model],
    }).onDelete('restrict'),
    foreignKey({
      name: 'agents_current_ticket_id_fk',
      columns: [t.currentTicketId],
      foreignColumns: [tickets.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'agents_current_session_id_fk',
      columns: [t.currentSessionId],
      foreignColumns: [sessions.id],
    }).onDelete('restrict'),
    uniqueIndex('agents_current_ticket_id_uq').on(t.currentTicketId),
    uniqueIndex('agents_current_session_id_uq').on(t.currentSessionId),
    check('agents_id_format_ck', sql`id ~ '^[a-z0-9-]+$'`),
    check('agents_kind_ck', inList('kind', AGENT_KINDS)),
    check('agents_stage_ck', inList('stage', AGENT_STAGES)),
    check(
      'agents_current_tool_triple_ck',
      sql`(current_tool_name is null) = (current_tool_arg is null) and (current_tool_name is null) = (current_tool_started_at is null)`,
    ),
    check(
      'agents_last_tool_quad_ck',
      sql`(last_tool_name is null) = (last_tool_arg is null) and (last_tool_name is null) = (last_tool_ok is null) and (last_tool_name is null) = (last_tool_at is null)`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    number: integer('number').notNull(),
    agentId: text('agent_id').notNull(),
    ticketId: text('ticket_id'),
    model: text('model').notNull(),
    status: text('status').notNull(),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at'),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'sessions_agent_id_fk',
      columns: [t.agentId],
      foreignColumns: [agents.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sessions_ticket_id_fk',
      columns: [t.ticketId],
      foreignColumns: [tickets.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sessions_model_fk',
      columns: [t.model],
      foreignColumns: [modelPrices.model],
    }).onDelete('restrict'),
    uniqueIndex('sessions_number_uq').on(t.number),
    uniqueIndex('sessions_agent_running_uq')
      .on(t.agentId)
      .where(sql`status = 'running'`),
    index('sessions_started_at_idx').on(t.startedAt),
    index('sessions_agent_started_idx').on(t.agentId, t.startedAt.desc()),
    index('sessions_ticket_started_idx').on(t.ticketId, t.startedAt.desc()),
    index('sessions_model_started_idx').on(t.model, t.startedAt),
    check(
      'sessions_id_format_ck',
      sql`number >= 1 and id = 'S-' || case when number < 10000 then lpad(number::text, 4, '0') else number::text end`,
    ),
    check('sessions_status_ck', inList('status', SESSION_STATUSES)),
    check(
      'sessions_ended_at_ck',
      sql`((status = 'running' and ended_at is null) or (status in ('completed', 'failed') and ended_at is not null and ended_at >= started_at))`,
    ),
  ],
);

export const sessionLogEntries = pgTable(
  'session_log_entries',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: text('session_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    at: ts('at').notNull(),
    kind: text('kind').notNull(),
    text: text('text'),
    stage: text('stage'),
    toolName: text('tool_name'),
    toolArg: text('tool_arg'),
    toolOk: boolean('tool_ok'),
    toolResult: text('tool_result'),
    toolDurationSec: integer('tool_duration_sec'),
    toolOutput: text('tool_output'),
    inputTokens: bigint('input_tokens', { mode: 'number' }),
    outputTokens: bigint('output_tokens', { mode: 'number' }),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }),
    cacheWriteTokens: bigint('cache_write_tokens', { mode: 'number' }),
    tokenActivity: text('token_activity'),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'session_log_entries_session_id_fk',
      columns: [t.sessionId],
      foreignColumns: [sessions.id],
    }).onDelete('restrict'),
    uniqueIndex('session_log_entries_session_ordinal_uq').on(t.sessionId, t.ordinal),
    index('session_log_entries_session_activity_idx').on(t.sessionId, t.tokenActivity),
    check('session_log_entries_ordinal_ck', sql`ordinal >= 0`),
    check('session_log_entries_kind_ck', inList('kind', LOG_ENTRY_TYPES)),
    check(
      'session_log_entries_token_activity_ck',
      sql`token_activity is null or ${inList('token_activity', TOKEN_ACTIVITIES)}`,
    ),
    check('session_log_entries_stage_ck', sql`stage is null or ${inList('stage', AGENT_STAGES)}`),
    check(
      'session_log_entries_tool_duration_ck',
      sql`tool_duration_sec is null or tool_duration_sec >= 0`,
    ),
    check(
      'session_log_entries_tokens_all_or_none_ck',
      sql`(input_tokens is null) = (output_tokens is null) and (input_tokens is null) = (cache_read_tokens is null) and (input_tokens is null) = (cache_write_tokens is null)`,
    ),
    check(
      'session_log_entries_tokens_nonneg_ck',
      sql`(input_tokens is null) or (input_tokens >= 0 and output_tokens >= 0 and cache_read_tokens >= 0 and cache_write_tokens >= 0)`,
    ),
    check(
      'session_log_entries_tokens_kind_ck',
      sql`input_tokens is null or kind in ('agent', 'tool', 'system')`,
    ),
    check(
      'session_log_entries_activity_iff_tokens_ck',
      sql`(token_activity is null) = (input_tokens is null)`,
    ),
  ],
);

export const events = pgTable(
  'events',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: ts('at').notNull(),
    realAt: ts('real_at').notNull().defaultNow(),
    source: text('source').notNull(),
    category: text('category').notNull(),
    type: text('type').notNull(),
    agentId: text('agent_id'),
    ticketId: text('ticket_id'),
    sessionId: text('session_id'),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    warn: boolean('warn').notNull().default(false),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'events_agent_id_fk',
      columns: [t.agentId],
      foreignColumns: [agents.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'events_ticket_id_fk',
      columns: [t.ticketId],
      foreignColumns: [tickets.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'events_session_id_fk',
      columns: [t.sessionId],
      foreignColumns: [sessions.id],
    }).onDelete('restrict'),
    index('events_ticket_seq_idx').on(t.ticketId, t.seq.desc()),
    index('events_agent_seq_idx').on(t.agentId, t.seq.desc()),
    index('events_source_seq_idx').on(t.source, t.seq.desc()),
    index('events_category_seq_idx').on(t.category, t.seq.desc()),
    index('events_at_idx').on(t.at),
    check('events_source_ck', inList('source', EVENT_SOURCES)),
    check('events_category_ck', inList('category', EVENT_CATEGORIES)),
    check('events_type_format_ck', sql`type ~ '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$'`),
  ],
);

export const simulationState = pgTable(
  'simulation_state',
  {
    id: integer('id').primaryKey(),
    clockAt: ts('clock_at').notNull(),
    seed: bigint('seed', { mode: 'number' }).notNull(),
    journalFloorSeq: bigint('journal_floor_seq', { mode: 'number' }).notNull(),
    seededAt: ts('seeded_at').notNull(),
  },
  () => [check('simulation_state_singleton_ck', sql`id = 1`)],
);

export const agentSimState = pgTable(
  'agent_sim_state',
  {
    agentId: text('agent_id').primaryKey(),
    scenario: text('scenario').notNull(),
    script: jsonb('script').notNull(),
    silent: boolean('silent').notNull(),
    pendingRefusalTicketId: text('pending_refusal_ticket_id'),
    cooldownSteps: integer('cooldown_steps').notNull().default(0),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'agent_sim_state_agent_id_fk',
      columns: [t.agentId],
      foreignColumns: [agents.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'agent_sim_state_pending_refusal_ticket_id_fk',
      columns: [t.pendingRefusalTicketId],
      foreignColumns: [tickets.id],
    }).onDelete('restrict'),
    check('agent_sim_state_cooldown_ck', sql`cooldown_steps >= 0`),
  ],
);

export const idCounters = pgTable(
  'id_counters',
  {
    name: text('name').primaryKey(),
    nextValue: integer('next_value').notNull(),
  },
  () => [
    check('id_counters_name_ck', sql`name in ('ticket', 'session')`),
    check('id_counters_next_value_ck', sql`next_value >= 1`),
  ],
);
