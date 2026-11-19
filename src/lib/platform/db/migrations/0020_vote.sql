CREATE TABLE "core"."vote_ballot" (
	"id" serial PRIMARY KEY NOT NULL,
	"poll_id" integer NOT NULL,
	"voter_email" text NOT NULL,
	"choices" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"consent_answer" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "vote_ballot_consent_answer_allowed" CHECK ("core"."vote_ballot"."consent_answer" is null or "core"."vote_ballot"."consent_answer" in ('accept', 'accept_with_wish', 'object')),
	CONSTRAINT "vote_ballot_voter_email_normalized" CHECK ("core"."vote_ballot"."voter_email" = lower(btrim("core"."vote_ballot"."voter_email")) and "core"."vote_ballot"."voter_email" <> '')
);
--> statement-breakpoint
CREATE TABLE "core"."vote_poll" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source_poll_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "vote_poll_kind_allowed" CHECK ("core"."vote_poll"."kind" in ('rating', 'consent')),
	CONSTRAINT "vote_poll_status_allowed" CHECK ("core"."vote_poll"."status" in ('draft', 'open', 'closed')),
	CONSTRAINT "vote_poll_title_present" CHECK (btrim("core"."vote_poll"."title") <> '')
);
--> statement-breakpoint
ALTER TABLE "core"."vote_ballot" ADD CONSTRAINT "vote_ballot_poll_id_vote_poll_id_fk" FOREIGN KEY ("poll_id") REFERENCES "core"."vote_poll"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."vote_poll" ADD CONSTRAINT "vote_poll_source_poll_id_vote_poll_id_fk" FOREIGN KEY ("source_poll_id") REFERENCES "core"."vote_poll"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vote_ballot_poll_voter_unique" ON "core"."vote_ballot" USING btree ("poll_id","voter_email");--> statement-breakpoint

-- Hand-written below this line (#575). `platform:migrate:generate` diffs the
-- schema files only, so none of it is re-proposed or dropped by a later diff.
-- Expand-only: two new tables, nothing existing is altered.

-- The actor columns reference `core.member(id)` by hand, for the ADR-004 §6
-- reason `0016_audit_columns.sql` §1 states: a drizzle reference would import
-- `schema/member/` into the vote schema directory.
ALTER TABLE "core"."vote_poll" ADD CONSTRAINT "vote_poll_created_by_member_fk" FOREIGN KEY ("created_by") REFERENCES "core"."member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "core"."vote_poll" ADD CONSTRAINT "vote_poll_updated_by_member_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "core"."vote_ballot" ADD CONSTRAINT "vote_ballot_created_by_member_fk" FOREIGN KEY ("created_by") REFERENCES "core"."member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "core"."vote_ballot" ADD CONSTRAINT "vote_ballot_updated_by_member_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."member"("id") ON DELETE SET NULL;--> statement-breakpoint

-- Row audit columns are stamped by the database (ADR-004 A2, #516).
CREATE OR REPLACE TRIGGER "vote_poll_audit_columns"
	BEFORE INSERT OR UPDATE ON "core"."vote_poll"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_columns_stamp"();--> statement-breakpoint
CREATE OR REPLACE TRIGGER "vote_ballot_audit_columns"
	BEFORE INSERT OR UPDATE ON "core"."vote_ballot"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_columns_stamp"();--> statement-breakpoint

-- Universal edit audit (spec 201): every column is recorded by value. A vote
-- is non-anonymous by design, so the voter and the answer are exactly what an
-- audit of a re-vote is for.
CREATE OR REPLACE TRIGGER "vote_poll_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."vote_poll"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'title', 'kind', 'options', 'status', 'source_poll_id',
		'created_at', 'created_by'
	);--> statement-breakpoint
CREATE OR REPLACE TRIGGER "vote_ballot_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."vote_ballot"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'poll_id', 'voter_email', 'choices', 'consent_answer', 'comment',
		'created_at', 'created_by'
	);
