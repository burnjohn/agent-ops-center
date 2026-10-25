ALTER TABLE "sessions" DROP CONSTRAINT "sessions_id_format_ck";--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_title_nonblank_ck";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_id_format_ck" CHECK (number >= 1 and id = 'S-' || case when number < 10000 then lpad(number::text, 4, '0') else number::text end);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_title_nonblank_ck" CHECK (title ~ '\S');