-- Attach the capture trigger to `core.hours_publication` — the release EARS-33
-- names (issue #275, spec `docs/specs/201-universal-edit-audit.md` EARS-33, with
-- EARS-16/EARS-17 for the whitelist and EARS-21/EARS-22 for coverage).
--
-- WHY THIS IS A RELEASE OF ITS OWN. `0003_universal_edit_audit.sql` attached the
-- trigger to every other audited `core` table and deliberately skipped this one:
-- its `messages` column was a jsonb array rewritten WHOLE on every delivery
-- step, holding frozen message texts and per-member delivery data. A column of
-- an audited table is audited BY VALUE (EARS-17 whitelists the hours tables'
-- columns), so an attached trigger would have written exactly that content into
-- a ledger EARS-28 says nothing can redact. That was an ordering requirement,
-- not a preference, and until it was met the table sat on the coverage allowlist
-- with a WRITTEN rationale — visible in the guard's output rather than silent
-- (EARS-22).
--
-- The obstacle is gone: `0005_hours_publication_drop_messages.sql` (#281,
-- EARS-31 step 4) dropped the column after reconciling everything it held into
-- `core.hours_publication_message`, which lands audited in its own right at
-- 0004. Removing the obstacle is not the same act as attaching the trigger,
-- which is why #281 kept the allowlist entry verbatim and this file is what
-- deletes it — together with the trigger, in one release, so the table is never
-- both unaudited and unlisted.
--
-- THE OTHER HALF OF THIS RELEASE IS NOT SQL. `tools/lint/audit-coverage-allowlist.mjs`
-- loses its `hours_publication` entry and gains the table's value whitelist in
-- the same commit. That file is data read by both coverage readers, and
-- `tests/int/platform/audit-coverage.int.spec.ts` compares the mirror against
-- `pg_trigger.tgargs` column for column — so this migration and that edit cannot
-- drift apart without the BLOCK `platform-int` job saying so.
--
-- Nothing else changes. No table, no column, no data statement, and no change to
-- `core.audit_row_change()` or to the ledger: drizzle-kit generates nothing for
-- a trigger (drizzle-orm 0.45 cannot express one), so this whole file is
-- HAND-WRITTEN in the shape `0003_universal_edit_audit.sql` established, and its
-- snapshot carries the 0005 schema forward unchanged.

-- Every remaining column by VALUE, named INDIVIDUALLY — the clause grants
-- nothing at table level, and a column added later starts outside the whitelist
-- like any other (EARS-27). All five are batch state, not a person's data:
-- `period_id` is the PK and the FK to `core.hours_period`, `status` is
-- `sending | published | incomplete`, `started_at` / `published_at` are the
-- ISO-8601 stamps of the run, and `preview_fingerprint` is a hash of what the
-- owner approved. The personal-contact class EARS-17 keeps out
-- (`member_alias.value` / `note`) has no member here, and the message texts that
-- once did are gone with the column.
--
-- `CREATE OR REPLACE` for the same reason every other attach line uses it: a
-- re-applied migration must be a no-op, not a duplicate-name failure.
CREATE OR REPLACE TRIGGER "hours_publication_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."hours_publication"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'period_id', 'status', 'started_at', 'published_at', 'preview_fingerprint'
	);
