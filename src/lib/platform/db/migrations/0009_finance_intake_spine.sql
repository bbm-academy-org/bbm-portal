CREATE TABLE "core"."finance_counterparty" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."finance_intake_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"occurred_on" date NOT NULL,
	"account_id" integer,
	"counter_account_id" integer,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"paid_amount" bigint,
	"paid_currency" text,
	"fee_amount" bigint,
	"fee_currency" text,
	"purpose_id" integer,
	"project_id" integer NOT NULL,
	"product_id" integer,
	"counterparty_id" integer,
	"member_id" integer,
	"note" text,
	"already_paid" boolean DEFAULT false NOT NULL,
	"personal_funds" boolean DEFAULT false NOT NULL,
	"created_by" integer NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"refusal_reason" text,
	"posted_by" integer,
	"posted_at" timestamp with time zone,
	"operation_id" integer,
	CONSTRAINT "finance_intake_item_source_allowed" CHECK ("core"."finance_intake_item"."source" in ('request', 'manual', 'backfill', 'bank_import')),
	CONSTRAINT "finance_intake_item_kind_allowed" CHECK ("core"."finance_intake_item"."kind" in ('expense', 'income', 'transfer', 'conversion')),
	CONSTRAINT "finance_intake_item_status_allowed" CHECK ("core"."finance_intake_item"."status" in ('draft', 'submitted', 'approved', 'refused', 'cancelled', 'posted')),
	CONSTRAINT "finance_intake_item_source_ref_policy" CHECK (("core"."finance_intake_item"."source" in ('bank_import', 'backfill')) = ("core"."finance_intake_item"."source_ref" is not null)),
	CONSTRAINT "finance_intake_item_personal_funds_account" CHECK ("core"."finance_intake_item"."personal_funds" = ("core"."finance_intake_item"."account_id" is null)),
	CONSTRAINT "finance_intake_item_personal_funds_already_paid" CHECK ((not "core"."finance_intake_item"."personal_funds") or "core"."finance_intake_item"."already_paid"),
	CONSTRAINT "finance_intake_item_personal_funds_member" CHECK ((not "core"."finance_intake_item"."personal_funds") or ("core"."finance_intake_item"."member_id" is not null)),
	CONSTRAINT "finance_intake_item_paid_pair" CHECK (("core"."finance_intake_item"."paid_amount" is null) = ("core"."finance_intake_item"."paid_currency" is null)),
	CONSTRAINT "finance_intake_item_fee_pair" CHECK (("core"."finance_intake_item"."fee_amount" is null) = ("core"."finance_intake_item"."fee_currency" is null)),
	CONSTRAINT "finance_intake_item_decision_pair" CHECK (("core"."finance_intake_item"."decided_by" is null) = ("core"."finance_intake_item"."decided_at" is null)),
	CONSTRAINT "finance_intake_item_refusal_reason" CHECK (("core"."finance_intake_item"."status" <> 'refused') or ("core"."finance_intake_item"."refusal_reason" is not null)),
	CONSTRAINT "finance_intake_item_posting_shape" CHECK (("core"."finance_intake_item"."status" = 'posted') = ("core"."finance_intake_item"."operation_id" is not null)),
	CONSTRAINT "finance_intake_item_posted_pair" CHECK (("core"."finance_intake_item"."posted_by" is null) = ("core"."finance_intake_item"."posted_at" is null))
);
--> statement-breakpoint
ALTER TABLE "core"."finance_intake_item" ADD CONSTRAINT "finance_intake_item_account_id_finance_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "core"."finance_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_intake_item" ADD CONSTRAINT "finance_intake_item_counter_account_id_finance_account_id_fk" FOREIGN KEY ("counter_account_id") REFERENCES "core"."finance_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_intake_item" ADD CONSTRAINT "finance_intake_item_purpose_id_finance_purpose_id_fk" FOREIGN KEY ("purpose_id") REFERENCES "core"."finance_purpose"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_intake_item" ADD CONSTRAINT "finance_intake_item_project_id_finance_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "core"."finance_project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_intake_item" ADD CONSTRAINT "finance_intake_item_product_id_finance_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "core"."finance_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_intake_item" ADD CONSTRAINT "finance_intake_item_counterparty_id_finance_counterparty_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "core"."finance_counterparty"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_intake_item" ADD CONSTRAINT "finance_intake_item_operation_id_finance_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "core"."finance_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_counterparty_name_unique" ON "core"."finance_counterparty" USING btree (lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "finance_intake_item_source_ref_unique" ON "core"."finance_intake_item" USING btree ("source","source_ref") WHERE "core"."finance_intake_item"."source_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_intake_item_operation_unique" ON "core"."finance_intake_item" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "finance_intake_item_status_idx" ON "core"."finance_intake_item" USING btree ("status");--> statement-breakpoint
CREATE INDEX "finance_intake_item_created_by_idx" ON "core"."finance_intake_item" USING btree ("created_by");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. The cross-module foreign keys -- spec 339 Data model, ADR-004 section 6
-- ---------------------------------------------------------------------------
--
-- `finance_intake_item.created_by / decided_by / posted_by / member_id` and
-- `finance_counterparty.created_by` -> `core.member(id)`. Declaring them in
-- drizzle would need the member table OBJECT, i.e. an import of `schema/member/`
-- from inside `schema/finance/` -- the very thing ADR-004 section 6 keeps out of
-- a module (`module-must-not-import-foreign-tables`). `0008_finance_ledger_core`
-- is the precedent for the finance tree and `0002_hours.sql` for the estate, and
-- nothing rests on this comment:
-- `tests/int/platform/finance-intake.int.spec.ts` reads the constraints back out
-- of `information_schema`.
--
-- ON DELETE RESTRICT throughout, for the reason the ledger's own member FK
-- carries it: the shared registry must not be able to delete a person out from
-- under a decision recorded to their name. An intake item IS the record of who
-- filed, who decided and who posted -- an item whose author vanished would be an
-- unattributed act, which spec 201 EARS-9 treats as a defect rather than a
-- degradation.
DO $$
DECLARE
	target record;
BEGIN
	FOR target IN
		SELECT * FROM (VALUES
			('finance_intake_item', 'created_by'),
			('finance_intake_item', 'decided_by'),
			('finance_intake_item', 'posted_by'),
			('finance_intake_item', 'member_id'),
			('finance_counterparty', 'created_by')
		) AS t(table_name, column_name)
	LOOP
		IF NOT EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE conname = format('%s_%s_member_id_fk', target.table_name, target.column_name)
				AND conrelid = format('core.%I', target.table_name)::regclass
		) THEN
			EXECUTE format(
				'ALTER TABLE core.%I ADD CONSTRAINT %I FOREIGN KEY (%I) '
				|| 'REFERENCES core.member(id) ON DELETE restrict ON UPDATE no action',
				target.table_name,
				format('%s_%s_member_id_fk', target.table_name, target.column_name),
				target.column_name
			);
		END IF;
	END LOOP;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. The universal edit audit -- spec 201 EARS-15/16/17, EARS-21, EARS-27
-- ---------------------------------------------------------------------------
--
-- Coverage of `core` is defined BY CONSTRUCTION (spec 201, owner decision Q6):
-- every platform domain table carries the capture trigger, and a table that
-- lands without one turns `tools/lint/audit-coverage-lint.mjs` and
-- `tests/int/platform/audit-coverage.int.spec.ts` red. Both new tables are
-- therefore attached HERE, in the migration that creates them -- spec 339's
-- "Audit coverage" paragraph says so in as many words: the build must not
-- discover the registration in CI.
--
-- Every column is named INDIVIDUALLY: the clause grants nothing at table level,
-- and a column added later starts outside the whitelist like any other
-- (EARS-27). Nothing here is a person's contact data -- the class EARS-17 keeps
-- out -- and an intake item's whole point is that who filed it, who decided and
-- what the amounts were are answerable later.
--
-- Note what the trigger does for the INTAKE specifically, where the ledger's own
-- triggers record little more than the INSERT: an intake item is EDITABLE by
-- design, so the old/new pairs here are the record of the status machine in
-- motion -- the approval, the bounce back to `submitted`, the refusal and its
-- reason. F2 adds no journal of its own on top of that (spec 201; spec 338
-- Accounting policy ruling 2).

CREATE OR REPLACE TRIGGER "finance_counterparty_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_counterparty"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'name', 'created_by', 'created_at'
	);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_intake_item_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_intake_item"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'source', 'source_ref', 'kind', 'status', 'occurred_on', 'account_id',
		'counter_account_id', 'amount', 'currency', 'paid_amount', 'paid_currency',
		'fee_amount', 'fee_currency', 'purpose_id', 'project_id', 'product_id',
		'counterparty_id', 'member_id', 'note', 'already_paid', 'personal_funds',
		'created_by', 'decided_by', 'decided_at', 'refusal_reason', 'posted_by',
		'posted_at', 'operation_id'
	);
