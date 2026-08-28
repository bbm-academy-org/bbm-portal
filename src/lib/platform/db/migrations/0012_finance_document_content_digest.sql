-- Postgres cannot derive an old object's digest without reading object storage.
-- Mark existing rows explicitly instead of inventing an identity, then remove
-- the default so every new insert must provide a server-computed digest.
ALTER TABLE "core"."finance_document" ADD COLUMN "content_digest" text DEFAULT 'legacy-unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."finance_document" ALTER COLUMN "content_digest" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "core"."finance_document" ADD CONSTRAINT "finance_document_content_digest_allowed" CHECK (content_digest = 'legacy-unverified' or content_digest ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint

-- Byte identity is provenance, so it follows the same database-enforced
-- immutability as the storage key, size and uploader.
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
		OR NEW.content_digest IS DISTINCT FROM OLD.content_digest
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

CREATE OR REPLACE TRIGGER "finance_document_audit"
	AFTER INSERT OR UPDATE OR DELETE ON "core"."finance_document"
	FOR EACH ROW EXECUTE FUNCTION "core"."audit_row_change"(
		'id', 'storage_key', 'content_digest', 'filename', 'mime', 'size', 'kind',
		'storage_state', 'uploaded_by', 'uploaded_at'
	);
