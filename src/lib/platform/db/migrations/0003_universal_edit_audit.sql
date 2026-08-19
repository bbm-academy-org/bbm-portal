-- Universal edit audit for `core` tables (issue #273, spec
-- `docs/specs/201-universal-edit-audit.md`: EARS-1..EARS-12, EARS-15..EARS-17,
-- EARS-24..EARS-27, EARS-33).
--
-- HAND-WRITTEN, not generated. drizzle-orm 0.45 can express neither a PL/pgSQL
-- function nor a trigger, so this migration is pure SQL — the shape ADR-004 §6
-- and `0002_hours.sql` already established here. There is deliberately NO
-- drizzle table file for `core.audit_event`: drizzle-kit diffs the TS schema
-- against its OWN snapshot, so an object that never entered a snapshot is
-- invisible to it and is never dropped. A `pgTable('audit_event')` stub would
-- make drizzle believe it owns a table whose protections (the two append-only
-- triggers below, the ownership split EARS-30's follow-up will add) it cannot
-- describe. Reads therefore go through the `sql` template, and the objects here
-- are asserted by `tests/int/platform/audit-*.int.spec.ts` rather than trusted.
--
-- Idempotent throughout (ADR-004 §4): `CREATE TABLE IF NOT EXISTS`,
-- `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
-- `CREATE OR REPLACE TRIGGER` (PG14+; this estate runs postgres:17-alpine in
-- prod, on the dev stand and as the CI service container).
--
-- Order (spec §«Order inside the migration»): ledger + indexes → functions →
-- the ledger's own guard triggers → the per-table attach lines LAST.
-- `core.hours_publication` is NOT among them (EARS-33: its `messages` column
-- must be normalised away by #274 first); no `GRANT`, `REVOKE`, `CREATE ROLE`
-- or `ALTER … OWNER TO` appears at all — this estate provisions ONE Postgres
-- role today, so all three would be no-ops at best (EARS-12, EARS-30).
-- Nothing is retro-backfilled: the trail starts at the attach, and this
-- migration itself therefore produces no ledger rows.

-- ---------------------------------------------------------------------------
-- 1. The ledger (EARS-11)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "core"."audit_event" (
	"id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"event_type" text NOT NULL,
	"table_name" text NOT NULL,
	"actor_email" text,
	"source" text NOT NULL,
	"pk" jsonb NOT NULL,
	"diff" jsonb NOT NULL,
	"txid" text NOT NULL
);
--> statement-breakpoint
-- BRIN on the monotonically growing timestamp; BTREE on the three questions the
-- read path of EARS-23 actually asks: «что менялось в этой таблице», «что делал
-- этот человек», «вся история вот этой строки».
CREATE INDEX IF NOT EXISTS "audit_event_created_at_brin" ON "core"."audit_event" USING brin ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_event_table_created_at" ON "core"."audit_event" USING btree ("table_name", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_event_actor_created_at" ON "core"."audit_event" USING btree ("actor_email", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_event_table_pk" ON "core"."audit_event" USING btree ("table_name", "pk");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. The capture function (EARS-1..EARS-8, EARS-16, EARS-26, EARS-27)
-- ---------------------------------------------------------------------------
--
-- ONE generic row-level AFTER trigger function for every audited table:
-- table-agnostic (`TG_TABLE_NAME`, `TG_RELID`, `to_jsonb(OLD/NEW)`), so covering
-- a new table costs exactly one CREATE TRIGGER line and no per-table code.
--
-- `SECURITY DEFINER` with a pinned `search_path` — the pinned path is what
-- closes the search-path hijack `SECURITY DEFINER` otherwise opens. Under
-- today's single superuser role it changes nothing; it is written now so that
-- EARS-30's least-privilege follow-up is a grant change and not a rewrite.
--
-- The per-column VALUE WHITELIST arrives in `TG_ARGV` (EARS-16) and is
-- DEFAULT-DENY (EARS-27): a column the trigger's arguments do not name is
-- recorded as `{"changed": true}` — no `old`, no `new`, no mask, no hash.

CREATE OR REPLACE FUNCTION "core"."audit_row_change"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, core
AS $$
DECLARE
	whitelist   text[] := TG_ARGV;
	old_row     jsonb;
	new_row     jsonb;
	row_diff    jsonb := '{}'::jsonb;
	column_name text;
	old_value   jsonb;
	new_value   jsonb;
	pk_value    jsonb;
	actor       text;
	src         text;
	app_marked  boolean;
BEGIN
	-- --- attribution (EARS-6, EARS-7, EARS-8, EARS-26) ---------------------
	--
	-- `current_setting(name, true)` — the TWO-argument form, which returns NULL
	-- for an unset GUC instead of erroring, so the refusal below is OUR message
	-- and not Postgres's «unrecognized configuration parameter».
	actor      := nullif(current_setting('app.actor_email', true), '');
	src        := nullif(current_setting('app.source', true), '');
	app_marked := nullif(current_setting('app.connection', true), '') = 'app';

	IF src IS NULL THEN
		-- No context. WHOSE connection is it? The application's pool marks every
		-- socket it opens (`-c app.connection=app`, src/lib/platform/db/client.ts);
		-- a psql session, the drizzle-kit migration runner and a restore do not.
		IF app_marked THEN
			RAISE EXCEPTION
				'audit: actor context not set for %.% — an application write must run through platformTransaction(ctx, …), which issues set_config(''app.actor_email'', …, true) and set_config(''app.source'', …, true) inside the transaction (spec 201 EARS-24, EARS-26)',
				TG_TABLE_SCHEMA, TG_TABLE_NAME;
		END IF;
		-- Unmarked connection: somebody worked on the database directly. Append
		-- the row, degrade the attribution, never fabricate an actor (EARS-8).
		src   := 'db-direct';
		actor := NULL;
	ELSE
		-- The closed set of EARS-7. `db-direct` is the trigger's OWN fallback and
		-- is not a value any caller may set — letting an app write borrow it would
		-- make the ledger lie about the door the change came through.
		IF src !~ '^(portal|migration|manual-dba|system:[a-z0-9][a-z0-9._-]*|cli:[a-z0-9][a-z0-9._-]*)$' THEN
			RAISE EXCEPTION
				'audit: app.source «%» is not in the closed set portal | system:<job> | cli:<name> | migration | manual-dba (spec 201 EARS-7); db-direct is the trigger''s own fallback and cannot be set by a caller',
				src;
		END IF;
		-- The actor is required only where a human exists (EARS-7, EARS-9).
		IF src = 'portal' AND actor IS NULL THEN
			RAISE EXCEPTION
				'audit: app.source = ''portal'' means an authenticated request, so app.actor_email must be set (spec 201 EARS-7, EARS-9)';
		END IF;
	END IF;

	-- --- the diff (EARS-2, EARS-3, EARS-16, EARS-27) -----------------------
	IF TG_OP = 'INSERT' THEN
		new_row := to_jsonb(NEW);
	ELSIF TG_OP = 'DELETE' THEN
		old_row := to_jsonb(OLD);
	ELSE
		old_row := to_jsonb(OLD);
		new_row := to_jsonb(NEW);
	END IF;

	FOR column_name IN
		SELECT jsonb_object_keys(coalesce(new_row, old_row))
	LOOP
		-- `updated_at` is bookkeeping, not a change (EARS-2). Today only
		-- `core.member` carries one; the rule is a standing convention for the
		-- tables that will.
		CONTINUE WHEN column_name = 'updated_at';

		old_value := old_row -> column_name;
		new_value := new_row -> column_name;

		-- An UPDATE records only what actually changed; a touch is not a change.
		CONTINUE WHEN TG_OP = 'UPDATE' AND old_value IS NOT DISTINCT FROM new_value;

		IF column_name = ANY (whitelist) THEN
			IF TG_OP = 'INSERT' THEN
				row_diff := row_diff || jsonb_build_object(column_name, jsonb_build_object('new', new_value));
			ELSIF TG_OP = 'DELETE' THEN
				row_diff := row_diff || jsonb_build_object(column_name, jsonb_build_object('old', old_value));
			ELSE
				row_diff := row_diff || jsonb_build_object(column_name, jsonb_build_object('old', old_value, 'new', new_value));
			END IF;
		ELSE
			-- Default-deny: the FACT of the change is in the ledger, the value
			-- never is — on INSERT, UPDATE and DELETE alike (EARS-2, EARS-27).
			row_diff := row_diff || jsonb_build_object(column_name, jsonb_build_object('changed', true));
		END IF;
	END LOOP;

	-- Nothing changed after those rules: write NO row. The trail records
	-- changes, not touches (EARS-3).
	IF TG_OP = 'UPDATE' AND row_diff = '{}'::jsonb THEN
		RETURN NULL;
	END IF;

	-- --- the primary key, from the catalog (EARS-4) -------------------------
	--
	-- Read from `pg_index`/`pg_attribute` on TG_RELID rather than from a
	-- per-table list, so a COMPOSITE primary key is carried with no per-table
	-- code — for tables that do not exist yet as much as for the six that do.
	SELECT jsonb_object_agg(att.attname, coalesce(new_row, old_row) -> att.attname)
	INTO pk_value
	FROM pg_index idx
	JOIN pg_attribute att
		ON att.attrelid = idx.indrelid
		AND att.attnum = ANY (idx.indkey)
	WHERE idx.indrelid = TG_RELID
		AND idx.indisprimary;

	INSERT INTO core.audit_event
		(event_type, table_name, actor_email, source, pk, diff, txid)
	VALUES (
		'data.' || TG_TABLE_NAME || '.' || lower(TG_OP),
		TG_TABLE_NAME,
		actor,
		src,
		coalesce(pk_value, '{}'::jsonb),
		row_diff,
		-- `pg_current_xact_id()`, not the wrapping 32-bit `txid_current()`: this
		-- column is a GROUPING key, so every row written by one save is grouped.
		pg_current_xact_id()::text
	);

	-- AFTER trigger: the return value is ignored, and NULL says so.
	RETURN NULL;
END;
$$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. The ledger's own append-only guard (EARS-12)
-- ---------------------------------------------------------------------------
--
-- What this guard does and does not cover, stated rather than implied: this
-- estate provisions exactly ONE Postgres role (the container superuser shared
-- by Payload, Zitadel and the platform), and a superuser disables any trigger
-- with one statement. The guard therefore protects against an ACCIDENTAL write
-- — a stray UPDATE, a script's DELETE, a TRUNCATE in a reset routine — and not
-- against a hostile superuser. EARS-30's follow-up files the privilege
-- arrangement that would; until it lands, this is the whole of the enforcement.

CREATE OR REPLACE FUNCTION "core"."audit_event_append_only"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, core
AS $$
BEGIN
	RAISE EXCEPTION
		'core.audit_event is append-only: % is refused (spec 201 EARS-12) — a correction to the audit ledger is a compensating record, never an edit',
		TG_OP;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE TRIGGER "audit_event_append_only_row"
	BEFORE UPDATE OR DELETE ON "core"."audit_event"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_event_append_only"();--> statement-breakpoint

-- Not decoration: a ROW-level trigger does not fire on TRUNCATE at all, so
-- without this statement-level one the table's most destructive operation would
-- be precisely the one the guard cannot see.
CREATE OR REPLACE TRIGGER "audit_event_append_only_truncate"
	BEFORE TRUNCATE ON "core"."audit_event"
	FOR EACH STATEMENT EXECUTE FUNCTION "core"."audit_event_append_only"();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. The attach lines, with their value whitelists (EARS-15, EARS-17, EARS-33)
-- ---------------------------------------------------------------------------
--
-- The whitelist is PART OF THE VERSIONED SCHEMA — the trigger's arguments in
-- this migration — and never a registry table: a column policy living in data
-- is state outside the migration chain and one DELETE away from being emptied.
--
-- No trigger is attached to `core.audit_event` itself (recursion) nor to
-- `core.__drizzle_migrations` (drizzle's own bookkeeping, not domain truth) —
-- EARS-15. And none to `core.hours_publication`: its `messages` column is a
-- jsonb array rewritten WHOLE on every delivery step, holding frozen message
-- texts and per-member delivery data, so while the column exists an attached
-- trigger would put exactly that content into a ledger nothing can redact.
-- It is normalised away by #274 first (EARS-31), and until then the table is an
-- ALLOWLISTED absence carrying its rationale
-- (`tools/lint/audit-coverage-allowlist.mjs`), visible rather than silent
-- (EARS-22, EARS-33).

-- `member` — corporate identity AND service data, every column by value
-- (EARS-17, owner's Q2 matrix). `updated_at` is the one column absent, and not
-- as a policy choice: EARS-2 drops it from the diff entirely, so naming it here
-- would grant a value that can never be written. Each column is still listed
-- INDIVIDUALLY — the clause grants nothing at table level, and a column added
-- later starts outside the whitelist like any other (EARS-27).
CREATE OR REPLACE TRIGGER "member_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."member"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'slug', 'email', 'name', 'role', 'status', 'timezone', 'created_at'
	);--> statement-breakpoint

-- `member_alias` — every column EXCEPT `value` and `note`. Those two are a
-- person's phone, personal email, Telegram/Instagram handle and the free-text
-- context around them: the one class that must not enter an append-only ledger
-- (EARS-16, EARS-17, EARS-27; ст. 5 ч. 5 152-ФЗ), recorded as
-- `{"changed": true}` and nothing else. `kind` says WHICH channel changed
-- without saying what it is, which is the service half of the same row.
CREATE OR REPLACE TRIGGER "member_alias_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."member_alias"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"('id', 'member_id', 'kind');--> statement-breakpoint

-- The hours tables — the work data, every column named INDIVIDUALLY (EARS-17):
-- the clause grants nothing at table level, and a column added later starts
-- outside the whitelist exactly like any other.
CREATE OR REPLACE TRIGGER "hours_period_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."hours_period"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'label', 'date_from', 'date_to', 'status', 'sort_key'
	);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "hours_participant_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."hours_participant"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'member_id', 'fork_min', 'fork_max', 'grade', 'sort_key'
	);--> statement-breakpoint

CREATE OR REPLACE TRIGGER "hours_assessment_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."hours_assessment"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'period_id', 'member_id', 'hours', 'method', 'weekend_hours',
		'split_percent', 'monthly_rate', 'hourly_rate', 'accrual', 'cash_amount',
		'invest_amount', 'weekday_count', 'saved_at'
	);
