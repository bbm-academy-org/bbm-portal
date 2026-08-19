-- Normalise `core.hours_publication.messages` into a child table — the EXPAND
-- and the BACKFILL (issue #274, spec `docs/specs/201-universal-edit-audit.md`
-- EARS-31 steps 1–2; adjacent: spec 100 req. 2/10/12/15, spec 124 EARS-21).
--
-- WHY the shape changes at all. `messages` is a jsonb array rewritten WHOLE on
-- every delivery step. Under the audit ledger of #273 an audited diff of that
-- column would say «everything changed» once per message and say nothing useful
-- — and the value it would carry is frozen message texts plus per-member
-- delivery data, exactly the content the owner's Q2 answer keeps out of an
-- append-only ledger nothing can redact. So `core.hours_publication` is the one
-- product table still on the coverage allowlist (EARS-33,
-- `tools/lint/audit-coverage-allowlist.mjs`), and it stays there until the
-- CONTRACT step drops the column. Normalised, a delivery step updates ONE row
-- and the audit records one small diff.
--
-- EXPAND ONLY (`docs/runbooks/migrations-expand-contract.md`). This release adds
-- the table and fills it; `core.hours_publication.messages` is left in place and
-- is still written by the application (dual-write, `src/lib/hours/core/persist.ts`),
-- so `pnpm deploy:prod --rollback <sha>` stays an honest button across the
-- cutover: the previous app code finds everything it reads. The
-- `ALTER TABLE core.hours_publication DROP COLUMN messages` is a LATER release
-- and its own issue (#281), which re-runs the backfill below before dropping —
-- an app rollback between the two releases can write the old representation
-- only, and the contract step must not be the moment that is discovered.
--
-- The head of this file is drizzle-generated from
-- `src/lib/platform/db/schema/hours/hours-publication-message.ts`; everything
-- below the marker is HAND-WRITTEN, the shape `0002_hours.sql` and
-- `0003_universal_edit_audit.sql` already established here (drizzle-orm 0.45 can
-- express neither a data statement nor a trigger). Nothing rests on this
-- comment: `tests/int/platform/hours-publication-message.int.spec.ts` runs the
-- backfill statement extracted FROM THIS FILE against a seeded legacy row, and
-- `tests/int/platform/audit-coverage.int.spec.ts` reads the trigger back out of
-- `pg_trigger`.

CREATE TABLE "core"."hours_publication_message" (
	"period_id" text NOT NULL,
	"position" integer NOT NULL,
	"email" text NOT NULL,
	"text" text NOT NULL,
	"delivery" text NOT NULL,
	"sent_at" text,
	CONSTRAINT "hours_publication_message_period_position_pk" PRIMARY KEY("period_id","position"),
	CONSTRAINT "hours_publication_message_delivery_allowed" CHECK ("core"."hours_publication_message"."delivery" in ('pending', 'sent', 'failed', 'unknown')),
	CONSTRAINT "hours_publication_message_position_non_negative" CHECK ("core"."hours_publication_message"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "core"."hours_publication_message" ADD CONSTRAINT "hours_publication_message_period_id_hours_publication_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "core"."hours_publication"("period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- HAND-WRITTEN from here. Backfill (EARS-31 step 2), then the capture trigger.
-- ---------------------------------------------------------------------------
--
-- Element-by-element, WITH ORDINALITY, so the array ordinal becomes the explicit
-- `position` — the index spec 100 req. 2/10 and spec 124 EARS-21 already relied
-- on, minus one because `WITH ORDINALITY` counts from 1 and `position` is
-- 0-based like the array index it replaces.
--
-- Per-message `delivery` and `sent_at` are carried across VERBATIM, and that is
-- the point rather than a detail: an IN-FLIGHT `sending` batch is partially
-- delivered, it blocks period mutations (spec 100 req. 12/15), and a cutover
-- that lost the per-message flags would either re-send delivered messages or
-- strand the batch. `->>` yields SQL NULL for a JSON `null`, which is exactly
-- what an unsent message's `sent_at` must become.
--
-- `ON CONFLICT DO NOTHING` makes the statement RE-RUNNABLE: it is the same
-- statement the contract release (#281) runs again to sweep up anything an app
-- rollback wrote into the old representation in between, and it is what the
-- integration test executes twice to assert idempotency.
--
-- The two markers below are read by
-- `tests/int/platform/hours-publication-message.int.spec.ts`, which runs THIS
-- statement rather than a re-typed copy — a copy would prove a second
-- implementation correct and say nothing about the shipped one. Do not remove
-- them, and keep the statement between them self-contained.
--
-- Attribution: the migration runner connects UNMARKED, so this write is recorded
-- as `source = 'db-direct'` with a NULL actor (spec 201 EARS-8) — the honest
-- value for a migration applying a data statement, and no context is required
-- for it to succeed.

-- >>> backfill
INSERT INTO "core"."hours_publication_message"
	("period_id", "position", "email", "text", "delivery", "sent_at")
SELECT
	publication."period_id",
	(element."ordinality" - 1)::integer,
	element."value" ->> 'email',
	element."value" ->> 'text',
	element."value" ->> 'delivery',
	element."value" ->> 'sent_at'
FROM "core"."hours_publication" AS publication
CROSS JOIN LATERAL jsonb_array_elements(publication."messages")
	WITH ORDINALITY AS element("value", "ordinality")
ON CONFLICT ("period_id", "position") DO NOTHING;
-- <<< backfill
--> statement-breakpoint

-- The capture trigger, WITH the table's value whitelist (spec 201 EARS-1,
-- EARS-16, EARS-17, EARS-22, EARS-27). A new `core` table lands WITH its trigger
-- or coverage-by-construction turns red — `pnpm lint:audit-coverage` and the
-- BLOCK `platform-int` assertion of EARS-21 both refuse a `core` table that
-- carries neither a trigger nor an allowlisted rationale.
--
-- Every column by VALUE, named individually (the clause grants nothing at table
-- level, and a column added later starts outside the whitelist like any other —
-- EARS-27). `email` and `text` are work data, not a person's contacts: the
-- address is the corporate `core.member.email` the ledger already carries as its
-- own actor column, and the text is the frozen verification message the whole
-- batch exists to publish. What EARS-17 keeps out is the personal-contact class
-- of `member_alias.value`/`note`, and nothing here is in it.
--
-- The row's `pk` is `{"period_id": …, "position": …}`: the capture function
-- reads the primary key from the catalog (EARS-4), and this is the first `core`
-- table with a COMPOSITE one, i.e. the first that exercises that clause. A
-- delivery step is therefore one ledger row naming one message.
CREATE OR REPLACE TRIGGER "hours_publication_message_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."hours_publication_message"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'period_id', 'position', 'email', 'text', 'delivery', 'sent_at'
	);
