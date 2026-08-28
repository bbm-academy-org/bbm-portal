-- Existing rows predate the lifecycle but already have their object; new rows
-- begin pending so no object-store side effect can precede durable metadata.
ALTER TABLE "core"."finance_document" ADD COLUMN "storage_state" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."finance_document" ALTER COLUMN "storage_state" SET DEFAULT 'pending_upload';--> statement-breakpoint
ALTER TABLE "core"."finance_document" ADD CONSTRAINT "finance_document_storage_state_allowed" CHECK ("core"."finance_document"."storage_state" in ('pending_upload', 'ready', 'pending_delete'));--> statement-breakpoint

-- The lifecycle is monotone. It records intent before either external side
-- effect and never claims distributed atomicity: a failure leaves a durable,
-- audited row and storage key for a later retry.
CREATE OR REPLACE FUNCTION "core"."finance_document_retained"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, core
AS $$
BEGIN
	IF TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'core.% cannot be truncated: retained finance documents are immutable (spec 339, EARS-516).', TG_TABLE_NAME;
	END IF;

	IF TG_OP = 'UPDATE' AND (
		NEW.storage_key IS DISTINCT FROM OLD.storage_key
		OR NEW.filename IS DISTINCT FROM OLD.filename
		OR NEW.mime IS DISTINCT FROM OLD.mime
		OR NEW.size IS DISTINCT FROM OLD.size
		OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
		OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
	) THEN
		RAISE EXCEPTION 'core.finance_document bytes and provenance cannot be replaced (spec 339, EARS-516).';
	END IF;

	IF TG_OP = 'UPDATE' AND NEW.storage_state IS DISTINCT FROM OLD.storage_state AND NOT (
		(OLD.storage_state = 'pending_upload' AND NEW.storage_state IN ('ready', 'pending_delete'))
		OR (OLD.storage_state = 'ready' AND NEW.storage_state = 'pending_delete')
	) THEN
		RAISE EXCEPTION 'core.finance_document storage lifecycle is monotone (spec 339, EARS-514, EARS-516).';
	END IF;

	IF TG_OP = 'DELETE' AND OLD.storage_state <> 'pending_delete' THEN
		RAISE EXCEPTION 'core.finance_document % must record pending_delete before removal (spec 339, EARS-514, EARS-516).', OLD.id;
	END IF;

	PERFORM 1
	FROM core.finance_document_link AS link
	JOIN core.finance_intake_item AS item ON item.id = link.intake_item_id
	WHERE link.document_id = OLD.id
		AND TG_OP = 'UPDATE'
		AND (
			(
				item.status = 'posted'
				AND NOT (
					OLD.storage_state = 'pending_upload'
					AND NEW.storage_state IN ('ready', 'pending_delete')
					AND NEW.kind IS NOT DISTINCT FROM OLD.kind
				)
			)
			OR (
				OLD.storage_state = 'ready'
				AND NEW.storage_state = 'pending_delete'
				AND item.status IN ('refused', 'cancelled')
			)
		)
	FOR UPDATE OF item;
	IF FOUND THEN
		RAISE EXCEPTION 'core.finance_document % is retained by a terminal intake item (spec 339, EARS-516).', OLD.id;
	END IF;

	IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "core"."finance_document_link_retained"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, core
AS $$
DECLARE
	item_status text;
	document_state text;
BEGIN
	IF TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'core.finance_document_link cannot be truncated: retained links are immutable (spec 339, EARS-516).';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		RAISE EXCEPTION 'core.finance_document_link is never replaced; detach and attach through the module (spec 339, EARS-516).';
	END IF;

	SELECT item.status, document.storage_state
	INTO item_status, document_state
	FROM core.finance_intake_item AS item
	JOIN core.finance_document AS document ON document.id = OLD.document_id
	WHERE item.id = OLD.intake_item_id
	FOR UPDATE OF item;
	IF item_status IN ('posted', 'refused', 'cancelled')
		AND document_state <> 'pending_delete' THEN
		RAISE EXCEPTION 'core.finance_document_link % is retained by a terminal intake item (spec 339, EARS-516).', OLD.id;
	END IF;
	RETURN OLD;
END;
$$;--> statement-breakpoint

-- Terminal statuses are facts, not editable labels. The second predicate also
-- prevents a status decision from racing ahead of an unfinished storage act.
CREATE OR REPLACE FUNCTION "core"."finance_intake_document_retained"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, core
AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF OLD.status IN ('posted', 'refused', 'cancelled')
			AND NEW IS DISTINCT FROM OLD THEN
			RAISE EXCEPTION 'core.finance_intake_item % is an immutable terminal record (spec 339, EARS-516).', OLD.id;
		END IF;

		IF NEW.status IN ('posted', 'refused', 'cancelled')
			AND OLD.status NOT IN ('posted', 'refused', 'cancelled')
			AND EXISTS (
				SELECT 1
				FROM core.finance_document_link AS link
				JOIN core.finance_document AS document ON document.id = link.document_id
				WHERE link.intake_item_id = OLD.id
					AND document.storage_state <> 'ready'
			) THEN
			RAISE EXCEPTION 'core.finance_intake_item % has a pending document storage act (spec 339, EARS-514, EARS-516).', OLD.id;
		END IF;
		RETURN NEW;
	END IF;

	IF OLD.status IN ('posted', 'refused', 'cancelled')
		AND EXISTS (
			SELECT 1 FROM core.finance_document_link WHERE intake_item_id = OLD.id
		) THEN
		RAISE EXCEPTION 'core.finance_intake_item % retains documents and cannot be deleted (spec 339, EARS-516).', OLD.id;
	END IF;
	RETURN OLD;
END;
$$;--> statement-breakpoint

DROP TRIGGER "finance_intake_document_retained_delete" ON "core"."finance_intake_item";--> statement-breakpoint
CREATE TRIGGER "finance_intake_document_retained_row"
	BEFORE UPDATE OR DELETE ON "core"."finance_intake_item"
	FOR EACH ROW EXECUTE FUNCTION "core"."finance_intake_document_retained"();--> statement-breakpoint

-- `storage_state` is operational metadata, not file content. Auditing it is
-- what proves the archive recorded intent before PUT/DELETE.
CREATE OR REPLACE TRIGGER "finance_document_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_document"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'storage_key', 'filename', 'mime', 'size', 'kind', 'storage_state',
		'uploaded_by', 'uploaded_at'
	);
