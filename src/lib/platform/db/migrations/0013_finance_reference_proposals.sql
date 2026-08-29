CREATE TABLE "core"."finance_purpose_proposal" (
	"id" serial PRIMARY KEY NOT NULL,
	"intake_item_id" integer,
	"text" text NOT NULL,
	"proposed_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_purpose_id" integer,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "finance_purpose_proposal_resolution_shape" CHECK ("core"."finance_purpose_proposal"."resolved_at" is not null or "core"."finance_purpose_proposal"."resolved_purpose_id" is null),
	CONSTRAINT "finance_purpose_proposal_pending_request" CHECK ("core"."finance_purpose_proposal"."resolved_at" is not null or "core"."finance_purpose_proposal"."intake_item_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "core"."finance_purpose_proposal" ADD CONSTRAINT "finance_purpose_proposal_intake_item_id_finance_intake_item_id_fk" FOREIGN KEY ("intake_item_id") REFERENCES "core"."finance_intake_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_purpose_proposal" ADD CONSTRAINT "finance_purpose_proposal_resolved_purpose_id_finance_purpose_id_fk" FOREIGN KEY ("resolved_purpose_id") REFERENCES "core"."finance_purpose"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_purpose_proposal" ADD CONSTRAINT "finance_purpose_proposal_proposed_by_member_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "core"."member"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_purpose_proposal_pending_request_unique" ON "core"."finance_purpose_proposal" USING btree ("intake_item_id") WHERE "core"."finance_purpose_proposal"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "finance_purpose_proposal_proposed_by_idx" ON "core"."finance_purpose_proposal" USING btree ("proposed_by");--> statement-breakpoint
CREATE INDEX "finance_purpose_proposal_resolved_purpose_idx" ON "core"."finance_purpose_proposal" USING btree ("resolved_purpose_id");--> statement-breakpoint

-- Universal edit audit (spec 201): creation, resolution, dismissal and the
-- retained unlink from a deleted draft are one attributed history.
CREATE OR REPLACE TRIGGER "finance_purpose_proposal_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_purpose_proposal"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'intake_item_id', 'text', 'proposed_by', 'created_at',
		'resolved_purpose_id', 'resolved_at'
	);
