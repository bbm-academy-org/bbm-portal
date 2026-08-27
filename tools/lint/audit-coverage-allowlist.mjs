// The audit-coverage allowlist — data, not a guard (spec
// `docs/specs/201-universal-edit-audit.md`, EARS-22, EARS-29, EARS-33).
//
// Coverage of the universal edit audit is defined BY CONSTRUCTION: every
// platform domain table in `core` carries the capture trigger, and a table that
// lands without one turns the checks red. A table leaves the audited set only
// through an explicit entry here carrying a WRITTEN rationale, reviewed in the
// diff that adds it — and the same for a column that records no value.
//
// This file is deliberately plain ESM with no imports, so BOTH readers can use
// the one source of truth instead of re-declaring it:
//
//  * `tests/int/platform/audit-coverage.int.spec.ts` — the truth-level check of
//    EARS-21, reading `pg_trigger` against the REALLY migrated database. It runs
//    in the BLOCK `platform-int` job, so the database-state half of coverage
//    blocks from day 0.
//  * `tools/lint/audit-coverage-lint.mjs` — the migration-chain guard of
//    EARS-19/EARS-20, WARN, delivered by issue #276. It does not exist yet; this
//    file is what it reads when it does, rather than a second list that drifts.
//
// It carries no guard plumbing on purpose (it imports no `lib/guard.mjs`), so
// `guard-test-coverage` correctly does not treat it as a guard needing a spec.

/**
 * Tables of `core` that carry NO capture trigger, each with the reason.
 *
 * Both remaining entries are structural (EARS-15): the ledger would recurse into
 * itself, and drizzle's bookkeeping is not domain truth. NO product table is on
 * this list. The one that ever was — `hours_publication`, a STOP rather than an
 * exemption — left it with #275, the release EARS-33 names: its `messages`
 * column was dropped by #281 and `0006_hours_publication_audit_trigger.sql`
 * attached the trigger and deleted the entry in the same commit.
 *
 * @type {Record<string, string>}
 */
export const AUDIT_TABLE_ALLOWLIST = {
  audit_event: 'the ledger itself — a capture trigger here would recurse (EARS-15)',
  __drizzle_migrations: "drizzle's own migration bookkeeping, not domain truth (EARS-15)",
}

/**
 * Columns of an AUDITED table that record no value — `{"changed": true}` and
 * nothing else — each with the reason (EARS-16, EARS-29).
 *
 * Default-deny (EARS-27) is what makes an unnamed column SAFE; this list is what
 * makes it VISIBLE, so «no values are recorded at all because nobody updated the
 * trigger arguments» cannot pass for a working audit.
 *
 * Keyed `<table>.<column>`.
 *
 * @type {Record<string, string>}
 */
export const AUDIT_COLUMN_EXCLUSIONS = {
  'member_alias.value': 'ПДн — ст. 5 ч. 5 152-ФЗ',
  'member_alias.note': 'ПДн — ст. 5 ч. 5 152-ФЗ',
  'member.updated_at': 'row bookkeeping — dropped from the diff entirely (EARS-2)',
}

/**
 * The value whitelist as the migration attaches it, table → columns, so a
 * reader can compare intent against `pg_trigger.tgargs` without parsing SQL.
 * The MIGRATION is the source of record; this mirror is asserted equal to it by
 * the integration check, which is what keeps the mirror from becoming a lie.
 *
 * @type {Record<string, string[]>}
 */
export const AUDIT_VALUE_WHITELIST = {
  member: ['id', 'slug', 'email', 'name', 'role', 'status', 'timezone', 'created_at'],
  member_alias: ['id', 'member_id', 'kind'],
  hours_period: ['id', 'label', 'date_from', 'date_to', 'status', 'sort_key'],
  hours_participant: ['member_id', 'fork_min', 'fork_max', 'grade', 'sort_key'],
  hours_assessment: [
    'id',
    'period_id',
    'member_id',
    'hours',
    'method',
    'weekend_hours',
    'split_percent',
    'monthly_rate',
    'hourly_rate',
    'accrual',
    'cash_amount',
    'invest_amount',
    'weekday_count',
    'saved_at',
  ],
  hours_publication: ['period_id', 'status', 'started_at', 'published_at', 'preview_fingerprint'],
  hours_publication_message: ['period_id', 'position', 'email', 'text', 'delivery', 'sent_at'],
  // The finance ledger (spec `docs/specs/338-ledger-core.md`, migration `0008`).
  // Nothing here is a person's contact data — the class EARS-17 keeps out — and
  // the amounts are exactly what an audit of a ledger is for. On the two
  // IMMUTABLE tables (`finance_operation`, `finance_posting`, EARS-313) an
  // UPDATE or a DELETE can no longer succeed at all, so what the trigger records
  // in practice is the INSERT: who recorded which fact, and when.
  finance_currency: ['code', 'name', 'precision', 'retired_at'],
  finance_account: ['id', 'name', 'kind', 'currency', 'is_system', 'retired_at'],
  finance_project: ['id', 'name', 'is_fund', 'retired_at'],
  finance_product: ['id', 'project_id', 'name', 'sale_price', 'sale_price_currency', 'retired_at'],
  // `product_binding` is whitelisted ON PURPOSE: «кто и когда сменил привязку»
  // is answered by the old/new pair, which is why spec 338 ruling 2 adds no
  // binding-change journal of its own (EARS-331/332).
  finance_purpose: ['id', 'name', 'category_id', 'product_binding', 'retired_at'],
  finance_category: ['id', 'name', 'allocable', 'retired_at'],
  finance_operation: [
    'id',
    'occurred_on',
    'purpose_id',
    'source',
    'source_ref',
    'backdated',
    'reverses',
  ],
  finance_posting: [
    'id',
    'operation_id',
    'account_id',
    'amount',
    'currency',
    'project_id',
    'category_id',
    'product_id',
    'member_id',
    'conversion_step_id',
  ],
  finance_conversion_step: [
    'id',
    'operation_id',
    'step_no',
    'from_currency',
    'to_currency',
    'rate',
  ],
  // The F2 intake spine (spec 339, #381). `finance_intake_item` is the one table
  // here that is EDITABLE by design, so its old/new pairs are the record of the
  // status machine in motion — the approval, the bounce, the refusal reason.
  finance_counterparty: ['id', 'name', 'created_by', 'created_at'],
  finance_intake_item: [
    'id',
    'source',
    'source_ref',
    'kind',
    'status',
    'occurred_on',
    'account_id',
    'counter_account_id',
    'amount',
    'currency',
    'paid_amount',
    'paid_currency',
    'fee_amount',
    'fee_currency',
    'purpose_id',
    'project_id',
    'product_id',
    'counterparty_id',
    'member_id',
    'note',
    'already_paid',
    'personal_funds',
    'created_by',
    'decided_by',
    'decided_at',
    'refusal_reason',
    'posted_by',
    'posted_at',
    'operation_id',
  ],
  // Finance documents (spec 339 §D, #382). EARS-516 asks for this twice over:
  // «every document write is audited» is its own half-sentence, on top of the
  // coverage-by-construction rule. `filename` is a name a person gave a FILE,
  // not their contact data (the class EARS-17 keeps out), and `storage_key` is
  // an opaque key inside a private location — never a URL and never a
  // credential (EARS-514) — so recording it is what makes an attempt to
  // re-point a document at different bytes visible as an old/new pair.
  finance_document: [
    'id',
    'storage_key',
    'filename',
    'mime',
    'size',
    'kind',
    'uploaded_by',
    'uploaded_at',
  ],
  finance_document_link: ['id', 'document_id', 'intake_item_id', 'linked_by', 'linked_at'],
}

/** A rationale that is present but says nothing is itself a finding (EARS-19). */
export function rationaleIsBlank(rationale) {
  return typeof rationale !== 'string' || rationale.trim() === ''
}
