CREATE TABLE "core"."finance_document_link" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"intake_item_id" integer NOT NULL,
	"linked_by" integer NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."finance_document" (
	"id" serial PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"kind" text NOT NULL,
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_document_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "finance_document_kind_allowed" CHECK ("core"."finance_document"."kind" in ('ru_invoice', 'fiscal_receipt', 'foreign_invoice', 'payment_order', 'bank_screenshot', 'bank_statement', 'other')),
	CONSTRAINT "finance_document_mime_allowed" CHECK ("core"."finance_document"."mime" in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/heic')),
	CONSTRAINT "finance_document_size_positive" CHECK ("core"."finance_document"."size" > 0)
);
--> statement-breakpoint
ALTER TABLE "core"."finance_document_link" ADD CONSTRAINT "finance_document_link_document_id_finance_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "core"."finance_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."finance_document_link" ADD CONSTRAINT "finance_document_link_intake_item_id_finance_intake_item_id_fk" FOREIGN KEY ("intake_item_id") REFERENCES "core"."finance_intake_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_document_link_pair_unique" ON "core"."finance_document_link" USING btree ("document_id","intake_item_id");--> statement-breakpoint
CREATE INDEX "finance_document_link_intake_item_idx" ON "core"."finance_document_link" USING btree ("intake_item_id");--> statement-breakpoint
CREATE INDEX "finance_document_uploaded_by_idx" ON "core"."finance_document" USING btree ("uploaded_by");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. The cross-module foreign keys -- spec 339 Data model, ADR-004 section 6
-- ---------------------------------------------------------------------------
--
-- `finance_document.uploaded_by` and `finance_document_link.linked_by` ->
-- `core.member(id)`. Declaring them in drizzle would need the member table
-- OBJECT, i.e. an import of `schema/member/` from inside `schema/finance/` --
-- the very thing ADR-004 section 6 keeps out of a module
-- (`module-must-not-import-foreign-tables`). `0009_finance_intake_spine` is the
-- immediate precedent and nothing rests on this comment:
-- `tests/int/platform/finance-documents.int.spec.ts` exercises the constraints
-- and `audit-coverage.int.spec.ts` reads the triggers back out of pg_trigger.
--
-- ON DELETE RESTRICT, for the reason every member FK in this tree carries it:
-- an upload IS the record of who put a file into the accounting archive, and a
-- document whose uploader vanished would be an unattributed act -- which spec
-- 201 EARS-9 treats as a defect rather than a degradation.
DO $$
DECLARE
	target record;
BEGIN
	FOR target IN
		SELECT * FROM (VALUES
			('finance_document', 'uploaded_by'),
			('finance_document_link', 'linked_by')
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
-- "Audit coverage" paragraph says so in as many words, and EARS-516 requires it
-- again in its own right: "every document write is audited".
--
-- Every column is named INDIVIDUALLY: the clause grants nothing at table level,
-- and a column added later starts outside the whitelist like any other
-- (EARS-27). `filename` is whitelisted deliberately -- it is what a person
-- typed as a NAME FOR A FILE, not their contact data (the class EARS-17 keeps
-- out), and "which invoice was attached and then replaced by another one" is
-- precisely the question the archive has to answer years later.
--
-- `storage_key` is whitelisted for the same reason and is safe to record: it is
-- an opaque key inside a private location, not a URL and not a credential
-- (EARS-514). What the audit gives here is the ONE thing the immutability
-- clause needs -- an attempt to move a document to a different object would
-- appear as an old/new pair on this column, and EARS-516 says such an attempt
-- must never succeed.

CREATE OR REPLACE TRIGGER "finance_document_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_document"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'storage_key', 'filename', 'mime', 'size', 'kind', 'uploaded_by',
		'uploaded_at'
	);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "finance_document_link_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_document_link"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'document_id', 'intake_item_id', 'linked_by', 'linked_at'
	);
