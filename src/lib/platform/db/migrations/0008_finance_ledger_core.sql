CREATE TABLE "core"."finance_account" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"currency" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "finance_account_kind_allowed" CHECK ("core"."finance_account"."kind" in ('bank', 'card', 'crypto', 'cash', 'income', 'expense', 'conversion', 'fx_result', 'liability')),
	CONSTRAINT "finance_account_system_kind_agreement" CHECK ("core"."finance_account"."is_system" = ("core"."finance_account"."kind" in ('income', 'expense', 'conversion', 'fx_result', 'liability')))
);
--> statement-breakpoint
CREATE TABLE "core"."finance_category" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"allocable" boolean NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."finance_conversion_step" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_id" integer NOT NULL,
	"step_no" integer NOT NULL,
	"from_currency" text NOT NULL,
	"to_currency" text NOT NULL,
	"rate" text NOT NULL,
	CONSTRAINT "finance_conversion_step_no_positive" CHECK ("core"."finance_conversion_step"."step_no" >= 1),
	CONSTRAINT "finance_conversion_step_rate_decimal" CHECK ("core"."finance_conversion_step"."rate" ~ '^[0-9]+(\.[0-9]+)?$'),
	CONSTRAINT "finance_conversion_step_rate_nonzero" CHECK (("core"."finance_conversion_step"."rate")::numeric > 0),
	CONSTRAINT "finance_conversion_step_currencies_differ" CHECK ("core"."finance_conversion_step"."from_currency" <> "core"."finance_conversion_step"."to_currency")
);
--> statement-breakpoint
CREATE TABLE "core"."finance_currency" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"precision" integer NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "finance_currency_code_shape" CHECK ("core"."finance_currency"."code" = upper(btrim("core"."finance_currency"."code"))),
	CONSTRAINT "finance_currency_precision_range" CHECK ("core"."finance_currency"."precision" between 0 and 18)
);
--> statement-breakpoint
CREATE TABLE "core"."finance_operation" (
	"id" serial PRIMARY KEY NOT NULL,
	"occurred_on" date NOT NULL,
	"purpose_id" integer,
	"source" text NOT NULL,
	"source_ref" text,
	"backdated" boolean DEFAULT false NOT NULL,
	"reverses" integer,
	CONSTRAINT "finance_operation_source_allowed" CHECK ("core"."finance_operation"."source" in ('request', 'bank_import', 'hours', 'manual', 'backfill', 'reversal')),
	CONSTRAINT "finance_operation_reversal_shape" CHECK (("core"."finance_operation"."source" = 'reversal') = ("core"."finance_operation"."reverses" is not null)),
	CONSTRAINT "finance_operation_no_self_reversal" CHECK ("core"."finance_operation"."reverses" <> "core"."finance_operation"."id")
);
--> statement-breakpoint
CREATE TABLE "core"."finance_posting" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"project_id" integer,
	"category_id" integer,
	"product_id" integer,
	"member_id" integer,
	"conversion_step_id" integer
);
--> statement-breakpoint
CREATE TABLE "core"."finance_product" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"sale_price" bigint,
	"sale_price_currency" text,
	"retired_at" timestamp with time zone,
	CONSTRAINT "finance_product_sale_price_paired" CHECK (("core"."finance_product"."sale_price" is null) = ("core"."finance_product"."sale_price_currency" is null))
);
--> statement-breakpoint
CREATE TABLE "core"."finance_project" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_fund" boolean DEFAULT false NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."finance_purpose" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category_id" integer,
	"product_binding" text NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "finance_purpose_product_binding_allowed" CHECK ("core"."finance_purpose"."product_binding" in ('required', 'forbidden', 'optional'))
);
--> statement-breakpoint
ALTER TABLE "core"."finance_account" ADD CONSTRAINT "finance_account_currency_finance_currency_code_fk" FOREIGN KEY ("currency") REFERENCES "core"."finance_currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_conversion_step" ADD CONSTRAINT "finance_conversion_step_operation_id_finance_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "core"."finance_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_conversion_step" ADD CONSTRAINT "finance_conversion_step_from_currency_finance_currency_code_fk" FOREIGN KEY ("from_currency") REFERENCES "core"."finance_currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_conversion_step" ADD CONSTRAINT "finance_conversion_step_to_currency_finance_currency_code_fk" FOREIGN KEY ("to_currency") REFERENCES "core"."finance_currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_operation" ADD CONSTRAINT "finance_operation_purpose_id_finance_purpose_id_fk" FOREIGN KEY ("purpose_id") REFERENCES "core"."finance_purpose"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_operation" ADD CONSTRAINT "finance_operation_reverses_finance_operation_id_fk" FOREIGN KEY ("reverses") REFERENCES "core"."finance_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_posting" ADD CONSTRAINT "finance_posting_operation_id_finance_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "core"."finance_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_posting" ADD CONSTRAINT "finance_posting_account_id_finance_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "core"."finance_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_posting" ADD CONSTRAINT "finance_posting_project_id_finance_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "core"."finance_project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_posting" ADD CONSTRAINT "finance_posting_category_id_finance_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "core"."finance_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_posting" ADD CONSTRAINT "finance_posting_product_id_finance_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "core"."finance_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_posting" ADD CONSTRAINT "finance_posting_conversion_step_id_finance_conversion_step_id_fk" FOREIGN KEY ("conversion_step_id") REFERENCES "core"."finance_conversion_step"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_product" ADD CONSTRAINT "finance_product_project_id_finance_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "core"."finance_project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_product" ADD CONSTRAINT "finance_product_sale_price_currency_finance_currency_code_fk" FOREIGN KEY ("sale_price_currency") REFERENCES "core"."finance_currency"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_purpose" ADD CONSTRAINT "finance_purpose_category_id_finance_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "core"."finance_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_account_system_kind_currency_unique" ON "core"."finance_account" USING btree ("kind","currency") WHERE "core"."finance_account"."is_system";--> statement-breakpoint
CREATE UNIQUE INDEX "finance_conversion_step_operation_no_unique" ON "core"."finance_conversion_step" USING btree ("operation_id","step_no");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_operation_reverses_unique" ON "core"."finance_operation" USING btree ("reverses");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_project_single_fund" ON "core"."finance_project" USING btree ("is_fund") WHERE "core"."finance_project"."is_fund";
--> statement-breakpoint

-- ===========================================================================
-- HAND-WRITTEN from here down (spec `docs/specs/338-ledger-core.md`, issue #356)
-- ===========================================================================
--
-- Everything above this line is drizzle-kit output from
-- `src/lib/platform/db/schema/finance/`. Everything below expresses what
-- drizzle-orm 0.45 cannot: a cross-module foreign key, a data seed and two
-- trigger families. The shape is the one `0002_hours.sql` and
-- `0003_universal_edit_audit.sql` established here, and -- like them -- a
-- hand-written constraint is invisible to `platform:migrate:generate` (it diffs
-- the schema FILES against `meta/*_snapshot.json`, never the live database), so
-- it is neither dropped nor re-proposed, and it must be repeated by hand if a
-- table below is ever recreated.
--
-- Idempotent throughout (ADR-004 section 4): `IF NOT EXISTS`, `CREATE OR REPLACE
-- FUNCTION`, `CREATE OR REPLACE TRIGGER` (PG14+; this estate runs
-- postgres:17-alpine in prod, on the dev stand and as the CI service container).

-- ---------------------------------------------------------------------------
-- 1. The fund project -- EARS-304
-- ---------------------------------------------------------------------------
--
-- Exactly ONE row carries `is_fund`, and the migration is what creates it: it is
-- the project every entity-level amount lands on, so "P&L per project, and BBM
-- as a whole is their sum" (EARS-321, decision 2) needs no exception clause for
-- amounts nobody attributed. The partial unique index above is what keeps it
-- singular; the module refuses to retire or duplicate it with a readable
-- message.
--
-- This is a DATA-bearing migration, so it names its own audit source: the
-- drizzle-kit runner opens an UNMARKED connection, which `core.audit_row_change`
-- degrades to `source = 'db-direct'` -- honest, but `migration` is the truthful
-- door here (spec 201 EARS-7). It is set transaction-locally, and the insert
-- writes nothing when the row is already there, so a re-applied migration
-- neither duplicates the fund nor logs a second creation.
SELECT set_config('app.source', 'migration', true);--> statement-breakpoint

INSERT INTO "core"."finance_project" ("name", "is_fund")
	SELECT 'Фонд BBM', true
	WHERE NOT EXISTS (SELECT 1 FROM "core"."finance_project" WHERE "is_fund");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. The cross-module foreign key -- EARS-322, ADR-004 section 6
-- ---------------------------------------------------------------------------
--
-- `finance_posting.member_id` -> `core.member(id)`. Declaring it in drizzle would
-- need the member table OBJECT, i.e. an import of `schema/member/` from inside
-- `schema/finance/` -- the very thing ADR-004 section 6 keeps out of a module
-- (`module-must-not-import-foreign-tables`). The hours tables are the precedent
-- (`0002_hours.sql`), and nothing rests on this comment:
-- `tests/int/platform/finance-core.int.spec.ts` reads the constraint back out of
-- `information_schema` and asserts it with its delete rule (EARS-322).
--
-- ON DELETE RESTRICT for the same reason the hours FKs carry it: the shared
-- registry must not be able to delete a person out from under a recorded amount.
-- "What did we pay X" is a query only while X's rows survive, and a posting
-- cannot be corrected by editing it (EARS-313) -- the only correction is a
-- reversal, which needs the original to still be there.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'finance_posting_member_id_member_id_fk'
			AND conrelid = 'core.finance_posting'::regclass
	) THEN
		ALTER TABLE "core"."finance_posting"
			ADD CONSTRAINT "finance_posting_member_id_member_id_fk"
			FOREIGN KEY ("member_id") REFERENCES "core"."member"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. The fact core is immutable -- EARS-313
-- ---------------------------------------------------------------------------
--
-- The module refuses every update and delete of a recorded operation or posting
-- by having no such function at all. This is the ACCIDENT GUARD behind that --
-- the spec-201 precedent (`core.audit_event_append_only`), applied to the two
-- tables EARS-313 names: a stray UPDATE, a script's DELETE, a TRUNCATE in a
-- reset routine. It is not a defence against a superuser, who disables any
-- trigger with one statement; it is the answer to "somebody's script did it".
--
-- INSERT is deliberately untouched: recording a fact is the one thing these
-- tables are for. `finance_conversion_step` is not covered, matching EARS-313's
-- own two-table scope -- a step carries no amount, and the postings that price
-- it are covered here.
--
-- A ROW-level trigger does not fire on TRUNCATE at all, so the statement-level
-- pair is not decoration: without it the tables' most destructive operation
-- would be exactly the one the guard cannot see.

CREATE OR REPLACE FUNCTION "core"."finance_fact_immutable"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, core
AS $$
BEGIN
	RAISE EXCEPTION
		'core.% неизменяема: % отклонён (спека 338, EARS-313). Записанный факт не правят и не удаляют — единственная коррекция это сторно (EARS-314): новая операция с source = reversal, зеркалящая исходную с обратными знаками. Обе остаются видимыми, и их сумма равна нулю в любом разрезе.',
		TG_TABLE_NAME, TG_OP;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_operation_immutable_row"
	BEFORE UPDATE OR DELETE ON "core"."finance_operation"
	FOR EACH ROW EXECUTE FUNCTION "core"."finance_fact_immutable"();--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_operation_immutable_truncate"
	BEFORE TRUNCATE ON "core"."finance_operation"
	FOR EACH STATEMENT EXECUTE FUNCTION "core"."finance_fact_immutable"();--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_posting_immutable_row"
	BEFORE UPDATE OR DELETE ON "core"."finance_posting"
	FOR EACH ROW EXECUTE FUNCTION "core"."finance_fact_immutable"();--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_posting_immutable_truncate"
	BEFORE TRUNCATE ON "core"."finance_posting"
	FOR EACH STATEMENT EXECUTE FUNCTION "core"."finance_fact_immutable"();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. The universal edit audit -- spec 201 EARS-15/16/17, EARS-21, EARS-27
-- ---------------------------------------------------------------------------
--
-- Coverage of `core` is defined BY CONSTRUCTION: every platform domain table
-- carries the capture trigger, and a table that lands without one turns
-- `tests/int/platform/audit-coverage.int.spec.ts` red. All nine finance tables
-- are therefore attached here, and the mirror of these whitelists lives in
-- `tools/lint/audit-coverage-allowlist.mjs`, compared column for column against
-- `pg_trigger.tgargs` by that same check -- so this migration and that file
-- cannot drift apart without the BLOCK `platform-int` job saying so.
--
-- Every column is named INDIVIDUALLY: the clause grants nothing at table level,
-- and a column added later starts outside the whitelist like any other
-- (EARS-27). Nothing here is a person's contact data -- the class EARS-17 keeps
-- out -- and the amounts themselves are exactly what an audit of a ledger is
-- for. Note what the trigger is FOR on the two immutable tables: an UPDATE or a
-- DELETE can no longer succeed there, so what it records in practice is the
-- INSERT -- who recorded which fact, and when.

CREATE OR REPLACE TRIGGER "finance_currency_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_currency"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'code', 'name', 'precision', 'retired_at'
	);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_account_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_account"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'name', 'kind', 'currency', 'is_system', 'retired_at'
	);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_project_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_project"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'name', 'is_fund', 'retired_at'
	);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_product_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_product"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'project_id', 'name', 'sale_price', 'sale_price_currency', 'retired_at'
	);--> statement-breakpoint

-- `product_binding` is in the whitelist ON PURPOSE, and it is the reason ruling
-- 2 needs no journal of its own: "who changed the binding, and when" is answered
-- by the old/new pair this trigger writes (EARS-331/332).
CREATE OR REPLACE TRIGGER "finance_purpose_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_purpose"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'name', 'category_id', 'product_binding', 'retired_at'
	);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_category_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_category"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'name', 'allocable', 'retired_at'
	);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_operation_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_operation"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'occurred_on', 'purpose_id', 'source', 'source_ref', 'backdated', 'reverses'
	);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_posting_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_posting"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'operation_id', 'account_id', 'amount', 'currency', 'project_id',
		'category_id', 'product_id', 'member_id', 'conversion_step_id'
	);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_conversion_step_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_conversion_step"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'operation_id', 'step_no', 'from_currency', 'to_currency', 'rate'
	);
