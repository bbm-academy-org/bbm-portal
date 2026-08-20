-- Drop `core.hours_publication.messages` — the CONTRACT half of the
-- expand/contract cycle #274 ran (issue #281, spec
-- `docs/specs/201-universal-edit-audit.md` EARS-31 step 4).
--
-- #274 created `core.hours_publication_message`, backfilled it, and switched the
-- application onto it while STILL writing the legacy `jsonb` array. That was one
-- release doing only what `docs/runbooks/migrations-expand-contract.md` lets one
-- release do — expand — so that `pnpm deploy:prod --rollback <sha>` stayed an
-- honest button across the cutover. This file is the second release, and it is
-- the moment that stops being true: **rolling the app back past this migration
-- is no longer an app-only operation.** The previous app code selects a column
-- that will not exist, and recovery is a restore from the pre-migrate checkpoint
-- the deploy pins (`docs/runbooks/migrations-expand-contract.md`, «Payload
-- specifics»), not a button.
--
-- WHY THE BACKFILL RUNS AGAIN, FIRST. Between #274's deploy and this one an app
-- rollback was available and may have been taken. The rolled-back code writes
-- the `jsonb` array and NOTHING ELSE, in two shapes: a batch created in that
-- window has no child rows at all, and a batch that already existed records
-- every delivery as an UPDATE of `delivery`/`sent_at` at a position whose child
-- row is already there. The statement below covers both — it is
-- `ON CONFLICT … DO UPDATE` taking the array as authoritative, which is exactly
-- the property #274 built into it for this file to use (read its header for the
-- full argument, including why `DO NOTHING` would have been a silent shortfall
-- that re-sent messages real people had already received).
--
-- So the ORDER is the whole point, and it is not a stylistic one: reconcile
-- everything the array still knows, THEN destroy the array. In the other order
-- the migration would simply fail, which is the benign outcome; what the order
-- buys is that nothing is lost when it succeeds.
--
-- The statement is the one #274 ships, character for character between the same
-- two markers, and `tests/unit/hours-publication-contract-migration.spec.ts`
-- asserts that equality plus this ordering. It has to: the re-run is observable
-- only in the milliseconds between the two statements of this file, so no
-- integration test can ever reach it. Its CORRECTNESS — idempotent, reconciling,
-- ordinal-to-`position` — is proved against a real database by
-- `tests/int/platform/hours-publication-message.int.spec.ts` at 0004, where the
-- column still exists. Keep the markers, and keep the statement between them
-- self-contained.
--
-- Attribution: the migration runner connects UNMARKED, so this write is recorded
-- as `source = 'db-direct'` with a NULL actor (spec 201 EARS-8) — the honest
-- value for a migration applying a data statement.
--
-- NOT in this release: the capture trigger on `core.hours_publication` and the
-- removal of its coverage-allowlist entry. Dropping the column removes the
-- OBSTACLE EARS-33 names — frozen message texts audited by value into a ledger
-- nothing can redact — but attaching the trigger is issue #275 and its own
-- release, so `tools/lint/audit-coverage-allowlist.mjs` keeps the entry and its
-- rationale verbatim until then.

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
ON CONFLICT ("period_id", "position") DO UPDATE SET
	"email"    = EXCLUDED."email",
	"text"     = EXCLUDED."text",
	"delivery" = EXCLUDED."delivery",
	"sent_at"  = EXCLUDED."sent_at"
WHERE (
	"hours_publication_message"."email",
	"hours_publication_message"."text",
	"hours_publication_message"."delivery",
	"hours_publication_message"."sent_at"
) IS DISTINCT FROM (
	EXCLUDED."email", EXCLUDED."text", EXCLUDED."delivery", EXCLUDED."sent_at"
);
-- <<< backfill
--> statement-breakpoint

ALTER TABLE "core"."hours_publication" DROP COLUMN "messages";
