CREATE TABLE "core"."hours_assessment" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_id" text NOT NULL,
	"member_id" integer NOT NULL,
	"hours" double precision NOT NULL,
	"method" text NOT NULL,
	"weekend_hours" double precision NOT NULL,
	"split_percent" double precision NOT NULL,
	"monthly_rate" integer,
	"hourly_rate" double precision,
	"accrual" integer NOT NULL,
	"cash_amount" integer NOT NULL,
	"invest_amount" integer NOT NULL,
	"weekday_count" integer NOT NULL,
	"saved_at" text NOT NULL,
	CONSTRAINT "hours_assessment_method_allowed" CHECK ("core"."hours_assessment"."method" in ('period', 'week', 'day'))
);
--> statement-breakpoint
CREATE TABLE "core"."hours_participant" (
	"member_id" integer PRIMARY KEY NOT NULL,
	"fork_min" integer,
	"fork_max" integer,
	"grade" text,
	"sort_key" integer NOT NULL,
	CONSTRAINT "hours_participant_grade_allowed" CHECK ("core"."hours_participant"."grade" in ('I', 'II', 'III'))
);
--> statement-breakpoint
CREATE TABLE "core"."hours_period" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"date_from" text NOT NULL,
	"date_to" text NOT NULL,
	"status" text NOT NULL,
	"sort_key" integer NOT NULL,
	CONSTRAINT "hours_period_status_allowed" CHECK ("core"."hours_period"."status" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "core"."hours_publication" (
	"period_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"published_at" text,
	"preview_fingerprint" text NOT NULL,
	"messages" jsonb NOT NULL,
	CONSTRAINT "hours_publication_status_allowed" CHECK ("core"."hours_publication"."status" in ('sending', 'published', 'incomplete'))
);
--> statement-breakpoint
ALTER TABLE "core"."hours_assessment" ADD CONSTRAINT "hours_assessment_period_id_hours_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "core"."hours_period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."hours_publication" ADD CONSTRAINT "hours_publication_period_id_hours_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "core"."hours_period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hours_assessment_period_member_unique" ON "core"."hours_assessment" USING btree ("period_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hours_period_single_open" ON "core"."hours_period" USING btree ("status") WHERE "core"."hours_period"."status" = 'open';
--> statement-breakpoint
-- HAND-WRITTEN, not generated: the two foreign keys to `core.member`.
--
-- Declaring them in drizzle would mean importing `../member/member` into the
-- hours table directory — a module holding a typed handle on another module's
-- table, which ADR-004 §6 forbids (`module-must-not-import-foreign-tables`).
-- Nothing about the constraints rests on this comment:
-- `tests/int/platform/hours-core.int.spec.ts` (EARS-1) reads them back out of
-- information_schema and asserts both, with their delete rule.
--
-- ON DELETE RESTRICT is deliberate: the shared registry must not be able to
-- delete a person out from under their saved assessments — history is the
-- product (spec 081 §16, spec 124 EARS-3/EARS-4).
ALTER TABLE "core"."hours_participant" ADD CONSTRAINT "hours_participant_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "core"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."hours_assessment" ADD CONSTRAINT "hours_assessment_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "core"."member"("id") ON DELETE restrict ON UPDATE no action;