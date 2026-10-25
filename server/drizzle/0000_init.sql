CREATE TABLE "agent_sim_state" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"scenario" text NOT NULL,
	"script" jsonb NOT NULL,
	"silent" boolean NOT NULL,
	"pending_refusal_ticket_id" text,
	"cooldown_steps" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_sim_state_cooldown_ck" CHECK (cooldown_steps >= 0)
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"stage" text NOT NULL,
	"current_ticket_id" text,
	"current_session_id" text,
	"current_tool_name" text,
	"current_tool_arg" text,
	"current_tool_started_at" timestamp with time zone,
	"last_tool_name" text,
	"last_tool_arg" text,
	"last_tool_ok" boolean,
	"last_tool_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agents_id_format_ck" CHECK (id ~ '^[a-z0-9-]+$'),
	CONSTRAINT "agents_kind_ck" CHECK (kind in ('real', 'simulated')),
	CONSTRAINT "agents_stage_ck" CHECK (stage in ('idle', 'planning', 'implementing', 'testing', 'awaiting_review')),
	CONSTRAINT "agents_current_tool_triple_ck" CHECK ((current_tool_name is null) = (current_tool_arg is null) and (current_tool_name is null) = (current_tool_started_at is null)),
	CONSTRAINT "agents_last_tool_quad_ck" CHECK ((last_tool_name is null) = (last_tool_arg is null) and (last_tool_name is null) = (last_tool_ok is null) and (last_tool_name is null) = (last_tool_at is null))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone NOT NULL,
	"real_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"agent_id" text,
	"ticket_id" text,
	"session_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warn" boolean DEFAULT false NOT NULL,
	CONSTRAINT "events_source_ck" CHECK (source in ('operator', 'agent_report', 'agent_telemetry', 'system')),
	CONSTRAINT "events_category_ck" CHECK (category in ('ticket', 'agent', 'tool')),
	CONSTRAINT "events_type_format_ck" CHECK (type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "id_counters" (
	"name" text PRIMARY KEY NOT NULL,
	"next_value" integer NOT NULL,
	CONSTRAINT "id_counters_name_ck" CHECK (name in ('ticket', 'session')),
	CONSTRAINT "id_counters_next_value_ck" CHECK (next_value >= 1)
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"model" text PRIMARY KEY NOT NULL,
	"input_per_m" numeric(14, 6) NOT NULL,
	"output_per_m" numeric(14, 6) NOT NULL,
	"cache_read_per_m" numeric(14, 6) NOT NULL,
	"cache_write_per_m" numeric(14, 6) NOT NULL,
	CONSTRAINT "model_prices_prices_nonneg" CHECK (input_per_m >= 0 and output_per_m >= 0 and cache_read_per_m >= 0 and cache_write_per_m >= 0)
);
--> statement-breakpoint
CREATE TABLE "session_log_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_log_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"stage" text,
	"tool_name" text,
	"tool_arg" text,
	"tool_ok" boolean,
	"tool_result" text,
	"tool_duration_sec" integer,
	"tool_output" text,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"cache_read_tokens" bigint,
	"cache_write_tokens" bigint,
	"token_activity" text,
	CONSTRAINT "session_log_entries_ordinal_ck" CHECK (ordinal >= 0),
	CONSTRAINT "session_log_entries_kind_ck" CHECK (kind in ('operator', 'agent', 'tool', 'stage', 'system')),
	CONSTRAINT "session_log_entries_token_activity_ck" CHECK (token_activity is null or token_activity in ('reasoning_replies', 'reading_code', 'editing_code', 'running_commands', 'agent_ops', 'session_context', 'other')),
	CONSTRAINT "session_log_entries_stage_ck" CHECK (stage is null or stage in ('idle', 'planning', 'implementing', 'testing', 'awaiting_review')),
	CONSTRAINT "session_log_entries_tool_duration_ck" CHECK (tool_duration_sec is null or tool_duration_sec >= 0),
	CONSTRAINT "session_log_entries_tokens_all_or_none_ck" CHECK ((input_tokens is null) = (output_tokens is null) and (input_tokens is null) = (cache_read_tokens is null) and (input_tokens is null) = (cache_write_tokens is null)),
	CONSTRAINT "session_log_entries_tokens_nonneg_ck" CHECK ((input_tokens is null) or (input_tokens >= 0 and output_tokens >= 0 and cache_read_tokens >= 0 and cache_write_tokens >= 0)),
	CONSTRAINT "session_log_entries_tokens_kind_ck" CHECK (input_tokens is null or kind in ('agent', 'tool', 'system')),
	CONSTRAINT "session_log_entries_activity_iff_tokens_ck" CHECK ((token_activity is null) = (input_tokens is null))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"agent_id" text NOT NULL,
	"ticket_id" text,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "sessions_id_format_ck" CHECK (number >= 1 and id = 'S-' || lpad(number::text, 4, '0')),
	CONSTRAINT "sessions_status_ck" CHECK (status in ('running', 'completed', 'failed')),
	CONSTRAINT "sessions_ended_at_ck" CHECK (((status = 'running' and ended_at is null) or (status in ('completed', 'failed') and ended_at is not null and ended_at >= started_at)))
);
--> statement-breakpoint
CREATE TABLE "simulation_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"clock_at" timestamp with time zone NOT NULL,
	"seed" bigint NOT NULL,
	"journal_floor_seq" bigint NOT NULL,
	"seeded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "simulation_state_singleton_ck" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"acceptance_criteria" text[] DEFAULT '{}'::text[] NOT NULL,
	"priority" text NOT NULL,
	"status" text NOT NULL,
	"assignee_id" text,
	"blocked_question" text,
	"answer" text,
	"review_summary" text,
	"result_link" text,
	"review_comment" text,
	"last_update_text" text,
	"last_update_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tickets_id_format_ck" CHECK (number >= 1 and id = 'T-' || number::text),
	CONSTRAINT "tickets_title_nonblank_ck" CHECK (length(btrim(title)) >= 1),
	CONSTRAINT "tickets_status_ck" CHECK (status in ('backlog', 'ready', 'in_progress', 'review', 'done')),
	CONSTRAINT "tickets_priority_ck" CHECK (priority in ('high', 'medium', 'low')),
	CONSTRAINT "tickets_blocked_in_progress_ck" CHECK (blocked_question is null or status = 'in_progress')
);
--> statement-breakpoint
ALTER TABLE "agent_sim_state" ADD CONSTRAINT "agent_sim_state_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sim_state" ADD CONSTRAINT "agent_sim_state_pending_refusal_ticket_id_fk" FOREIGN KEY ("pending_refusal_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_model_fk" FOREIGN KEY ("model") REFERENCES "public"."model_prices"("model") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_current_ticket_id_fk" FOREIGN KEY ("current_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_current_session_id_fk" FOREIGN KEY ("current_session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_log_entries" ADD CONSTRAINT "session_log_entries_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_model_fk" FOREIGN KEY ("model") REFERENCES "public"."model_prices"("model") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_current_ticket_id_uq" ON "agents" USING btree ("current_ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_current_session_id_uq" ON "agents" USING btree ("current_session_id");--> statement-breakpoint
CREATE INDEX "events_ticket_seq_idx" ON "events" USING btree ("ticket_id","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_agent_seq_idx" ON "events" USING btree ("agent_id","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_source_seq_idx" ON "events" USING btree ("source","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_category_seq_idx" ON "events" USING btree ("category","seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_at_idx" ON "events" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_log_entries_session_ordinal_uq" ON "session_log_entries" USING btree ("session_id","ordinal");--> statement-breakpoint
CREATE INDEX "session_log_entries_session_activity_idx" ON "session_log_entries" USING btree ("session_id","token_activity");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_number_uq" ON "sessions" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_agent_running_uq" ON "sessions" USING btree ("agent_id") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "sessions_started_at_idx" ON "sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "sessions_agent_started_idx" ON "sessions" USING btree ("agent_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_ticket_started_idx" ON "sessions" USING btree ("ticket_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sessions_model_started_idx" ON "sessions" USING btree ("model","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_number_uq" ON "tickets" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_assignee_active_uq" ON "tickets" USING btree ("assignee_id") WHERE status in ('in_progress', 'review');--> statement-breakpoint
CREATE INDEX "tickets_board_idx" ON "tickets" USING btree ("status","priority","created_at","number");