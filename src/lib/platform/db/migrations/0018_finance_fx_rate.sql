CREATE TABLE "core"."finance_fx_rate" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"currency" text NOT NULL,
	"rate_date" date NOT NULL,
	"nominal" integer NOT NULL,
	"value_rub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	CONSTRAINT "finance_fx_rate_source_known" CHECK ("core"."finance_fx_rate"."source" in ('cbr')),
	CONSTRAINT "finance_fx_rate_currency_shape" CHECK ("core"."finance_fx_rate"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "finance_fx_rate_nominal_positive" CHECK ("core"."finance_fx_rate"."nominal" > 0),
	CONSTRAINT "finance_fx_rate_value_decimal" CHECK ("core"."finance_fx_rate"."value_rub" ~ '^[0-9]+(\.[0-9]+)?$'),
	CONSTRAINT "finance_fx_rate_value_positive" CHECK (("core"."finance_fx_rate"."value_rub")::numeric > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_fx_rate_source_currency_date_unique" ON "core"."finance_fx_rate" USING btree ("source","currency","rate_date");--> statement-breakpoint

-- Hand-written below this line (#548). `platform:migrate:generate` diffs the
-- schema files only, so none of it is re-proposed or dropped by a later diff.

-- The actor columns reference `core.member(id)` by hand, for the ADR-004 §6
-- reason `0016_audit_columns.sql` §1 states: a drizzle reference would import
-- `schema/member/` into the finance schema directory.
ALTER TABLE "core"."finance_fx_rate" ADD CONSTRAINT "finance_fx_rate_created_by_member_fk" FOREIGN KEY ("created_by") REFERENCES "core"."member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "core"."finance_fx_rate" ADD CONSTRAINT "finance_fx_rate_updated_by_member_fk" FOREIGN KEY ("updated_by") REFERENCES "core"."member"("id") ON DELETE SET NULL;--> statement-breakpoint

-- Row audit columns are stamped by the database (ADR-004 A2, #516).
CREATE OR REPLACE TRIGGER "finance_fx_rate_audit_columns"
	BEFORE INSERT OR UPDATE ON "core"."finance_fx_rate"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_columns_stamp"();--> statement-breakpoint

-- Universal edit audit (spec 201): every column is public reference data, so
-- all of them are recorded by value. In practice the trigger records INSERTs by
-- `system:finance-fx-sync` — the sync never updates a row.
CREATE OR REPLACE TRIGGER "finance_fx_rate_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_fx_rate"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'source', 'currency', 'rate_date', 'nominal', 'value_rub',
		'created_at', 'created_by'
	);
