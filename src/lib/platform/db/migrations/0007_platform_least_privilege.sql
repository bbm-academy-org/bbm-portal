-- The privilege echelon: `core` owned by the migrating role, the application
-- role least-privileged over it, and the ledger read-only to the application
-- (issue #278, spec `docs/specs/201-universal-edit-audit.md` EARS-30, ADR-004 A1).
--
-- WHAT THIS CLOSES. `0003_universal_edit_audit.sql` says in its own header that
-- it writes no GRANT, no REVOKE and no `ALTER … OWNER TO`, because against a
-- single container superuser all three are no-ops at best. So the append-only
-- triggers of EARS-12 have been protecting the ledger from an ACCIDENT — a stray
-- UPDATE, a script's DELETE, a TRUNCATE in a reset routine — and from nothing
-- else: a superuser disables any trigger with one statement and is exempt from
-- every grant. This file is the other half, and it is deliberately a grant
-- change rather than a rewrite: `core.audit_row_change()` was written
-- `SECURITY DEFINER` with a pinned `search_path` in 0003 precisely so that
-- moving its ownership here is all that is needed.
--
-- WHY IT IS GUARDED AND CAN NO-OP. Roles are cluster objects and a non-superuser
-- cannot create them, so provisioning them is `pnpm platform:roles:ensure`
-- (`tools/platform/ensure-roles.mjs`), run once per environment as the container
-- superuser. Until it has run, an environment genuinely has ONE role, and every
-- statement below would either fail on an unknown role or grant privileges to
-- nobody. The guard makes this file a documented no-op there rather than a
-- migration that cannot be applied — and the same tool re-runs THIS FILE as its
-- second phase once the roles exist, so a database split after the fact is not
-- left behind by a migration drizzle already recorded as applied. That is also
-- why the whole body is idempotent: it is written to be run more than once.
--
-- WHY THE GROUP NAMES ARE LITERAL. A `.sql` file takes no parameters, so a grant
-- cannot be written against an environment variable. The LOGIN identities stay
-- env-driven (this estate already runs three different ones), and what is fixed
-- here is the privilege GROUP each of them is a member of —
-- `PLATFORM_APP_ROLE_GROUP` / `PLATFORM_MIGRATOR_ROLE_GROUP` in
-- `src/lib/platform/db/config.ts`.
DO $$
DECLARE
  obj record;
  me text := current_user;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_migrator')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_app') THEN
    RAISE NOTICE 'core: platform_app/platform_migrator absent — this estate still has one role; run `pnpm platform:roles:ensure` to split it (EARS-30)';
    RETURN;
  END IF;

  -- 1. Ownership. The schema goes first: a new table owner must have CREATE on
  --    the schema that holds it, and `platform_migrator` gets that by owning it.
  EXECUTE 'ALTER SCHEMA core OWNER TO platform_migrator';

  --    Sequences are skipped on purpose — an identity/serial sequence follows the
  --    ownership of its table and refuses to be re-owned on its own.
  FOR obj IN
    SELECT c.oid::regclass::text AS ident, c.relkind AS kind
    FROM pg_class c
    WHERE c.relnamespace = 'core'::regnamespace
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND c.relowner <> 'platform_migrator'::regrole
  LOOP
    IF obj.kind = 'v' THEN
      EXECUTE format('ALTER VIEW %s OWNER TO platform_migrator', obj.ident);
    ELSIF obj.kind = 'm' THEN
      EXECUTE format('ALTER MATERIALIZED VIEW %s OWNER TO platform_migrator', obj.ident);
    ELSE
      EXECUTE format('ALTER TABLE %s OWNER TO platform_migrator', obj.ident);
    END IF;
  END LOOP;

  --    The capture function and the append-only guard are the two objects whose
  --    ownership is load-bearing: a SECURITY DEFINER function executes with the
  --    privileges of its OWNER, which is what lets the trigger keep inserting
  --    into a ledger the caller may not write to.
  FOR obj IN
    SELECT p.oid::regprocedure::text AS ident
    FROM pg_proc p
    WHERE p.pronamespace = 'core'::regnamespace
      AND p.prokind = 'f'
      AND p.proowner <> 'platform_migrator'::regrole
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO platform_migrator', obj.ident);
  END LOOP;

  -- 2. What the application role may do with `core` in general: everything a
  --    module's own tables need. Least privilege here is about the LEDGER, which
  --    is the one object in this schema carrying an integrity claim; narrowing
  --    the module tables further would be a different decision, made where those
  --    modules are specified, not smuggled in on this one.
  EXECUTE 'GRANT USAGE ON SCHEMA core TO platform_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON ALL TABLES IN SCHEMA core TO platform_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core TO platform_app';

  --    …and with tables a FUTURE migration adds. Without this every new table
  --    would be invisible to the application until someone remembered a GRANT,
  --    which is the failure mode that makes people hand the app an owner role.
  --    Recorded for the group AND for whoever is running this migration, because
  --    default privileges are keyed by the role that creates the object.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA core GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLES TO platform_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA core GRANT USAGE, SELECT ON SEQUENCES TO platform_app';
  IF me <> 'platform_migrator' THEN
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA core GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON TABLES TO platform_app', me);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA core GRANT USAGE, SELECT ON SEQUENCES TO platform_app', me);
  END IF;

  -- 3. The ledger. `REVOKE ALL` then `GRANT SELECT` rather than a list of
  --    REVOKEs: the set of privileges the previous step handed out is the thing
  --    being undone, and re-listing it here is how the two drift apart.
  --    UPDATE/DELETE/TRUNCATE now fail with `permission denied` BEFORE any
  --    trigger runs, and INSERT is gone too — the SECURITY DEFINER capture
  --    function of EARS-12 is what writes. SELECT stays: the read path of
  --    EARS-23 runs as this same role.
  EXECUTE 'REVOKE ALL ON TABLE core.audit_event FROM platform_app';
  EXECUTE 'REVOKE ALL ON TABLE core.audit_event FROM PUBLIC';
  EXECUTE 'GRANT SELECT ON TABLE core.audit_event TO platform_app';

  --    drizzle's own bookkeeping is not domain data and nothing outside the
  --    migration pipeline writes it.
  IF to_regclass('core.__drizzle_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE core."__drizzle_migrations" FROM platform_app';
    EXECUTE 'GRANT SELECT ON TABLE core."__drizzle_migrations" TO platform_app';
  END IF;
END $$;
