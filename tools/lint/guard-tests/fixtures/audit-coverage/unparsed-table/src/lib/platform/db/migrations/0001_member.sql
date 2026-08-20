CREATE TABLE IF NOT EXISTS "core"."member" (
	"id" serial PRIMARY KEY,
	"slug" text NOT NULL,
	"note" text
);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "member_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."member"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"('id', 'slug');
