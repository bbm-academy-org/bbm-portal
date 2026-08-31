-- A terminal intake item has a closed evidence set. The original EARS-516
-- trigger guarded UPDATE and DELETE only, so direct INSERT and the upload path
-- could still add a new document link after the decision.
CREATE OR REPLACE FUNCTION "core"."finance_document_link_retained"() RETURNS trigger
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog, core
AS $$
DECLARE
	item_status text;
	document_state text;
	item_id integer;
BEGIN
	IF TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'core.finance_document_link cannot be truncated: retained links are immutable (spec 339, EARS-516).';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		RAISE EXCEPTION 'core.finance_document_link is never replaced; detach and attach through the module (spec 339, EARS-516).';
	END IF;

	item_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.intake_item_id ELSE OLD.intake_item_id END;
	SELECT item.status, document.storage_state
	INTO item_status, document_state
	FROM core.finance_intake_item AS item
	JOIN core.finance_document AS document
		ON document.id = CASE WHEN TG_OP = 'INSERT' THEN NEW.document_id ELSE OLD.document_id END
	WHERE item.id = item_id
	FOR UPDATE OF item;

	IF TG_OP = 'INSERT' AND item_status IN ('posted', 'refused', 'cancelled') THEN
		RAISE EXCEPTION 'core.finance_document_link cannot extend terminal intake item % (spec 339, EARS-516).', item_id;
	END IF;
	IF TG_OP = 'DELETE'
		AND item_status IN ('posted', 'refused', 'cancelled')
		AND document_state <> 'pending_delete' THEN
		RAISE EXCEPTION 'core.finance_document_link % is retained by a terminal intake item (spec 339, EARS-516).', OLD.id;
	END IF;
	IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
	RETURN OLD;
END;
$$;--> statement-breakpoint

DROP TRIGGER "finance_document_link_retained_row" ON "core"."finance_document_link";--> statement-breakpoint
CREATE TRIGGER "finance_document_link_retained_row"
	BEFORE INSERT OR UPDATE OR DELETE ON "core"."finance_document_link"
	FOR EACH ROW EXECUTE FUNCTION "core"."finance_document_link_retained"();
