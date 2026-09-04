/**
 * `core.finance_intake_item` — the F2 spine (spec `docs/specs/339-ledger-intake.md`,
 * Data model + EARS-503/504/524).
 *
 * **The spine idea:** every source produces an intake item; only intake items
 * post; posting calls the F1 API. A request is an intake item with a
 * submitter-facing lifecycle, not a second pipeline — which is why there is ONE
 * table here and not one per source, and why a new source (a bank API, an agent)
 * is a new PRODUCER writing this row rather than a new pipeline (EARS-525).
 *
 * The row has to express everything the backfill must reconstruct from zero
 * (decision 17): expenses, income, transfers between own accounts and
 * conversions. Hence `kind`, and hence the two-sided amount pair.
 *
 * **Two amounts, both facts** (spec's cross-currency rule). `amount`/`currency`
 * is the DOCUMENT side; `paid_amount`/`paid_currency` is the ACCOUNT side when
 * it differs — and for `kind = conversion` the target side. Neither is ever
 * computed from the other by a rate: the rate is derived from the pair at
 * posting time, so a rounding residual cannot arise by construction. That is the
 * fix for the donor form's «Сумма» / «Сумма в рублях» ambiguity.
 *
 * **What the CHECK constraints are for.** They are the accident guard, not the
 * user experience: every one of them is also a readable module refusal raised
 * before the write reaches Postgres (spec 338 EARS-326). The ones that carry a
 * clause rather than a habit:
 *
 *  - `source_ref_policy` — EARS-503's per-source semantics as a database fact:
 *    `bank_import` and `backfill` ALWAYS carry a ref, `manual` and `request`
 *    never do (a human act has no external identity to deduplicate on). Without
 *    it a backfill row could land ref-less and re-running the same history would
 *    double-post, which is exactly the failure EARS-504 exists to prevent.
 *  - `finance_intake_item_source_ref_unique` — the partial unique index that
 *    MAKES EARS-504 true. The module refuses the duplicate with the existing
 *    item in hand; this index is why a race cannot slip a second one past it.
 *  - `personal_funds_account` — EARS-513's «own funds name no company account».
 *    It used to be an EQUIVALENCE («empty exactly when `personal_funds`»); since
 *    2026-09-03 it is only the one implication, because a pre-spend request may
 *    also hold none (EARS-533) — the other direction moved to `money_facts`.
 *  - `money_facts` — EARS-533: the paying account and `occurred_on` may be empty
 *    only while an unposted pre-spend request has not been through the posting
 *    act. Without it, «nullable» would silently mean «optional everywhere», and
 *    a posted operation could carry no date at all.
 *  - `personal_funds_already_paid` — `personal_funds` is accepted only together
 *    with `already_paid` (EARS-508).
 *  - `refusal_reason` / `decision` / `posting` shapes — the status machine's
 *    terminal facts cannot be half-recorded: a `refused` item without a reason,
 *    or a `posted` item without an operation, would be a status nobody can act
 *    on (EARS-512, EARS-505).
 *
 * `created_by`, `decided_by`, `posted_by` and `member_id` are integers with **no
 * drizzle reference**: their FKs to `core.member(id)` are written by hand in the
 * migration, because declaring them here would import `schema/member/` into
 * `schema/finance/` — the import ADR-004 §6 keeps out of a module. Same shape as
 * `finance_posting.member_id` (spec 338 EARS-322).
 *
 * NOT immutable, deliberately: an intake item is editable until it posts (the
 * status machine says exactly how far), and it is the LEDGER that never moves.
 * The `posted` terminal state plus the unique `operation_id` is the seam between
 * the two.
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

import { core } from '../core'
import { financeAccount } from './finance-account'
import { financeCounterparty } from './finance-counterparty'
import { financeOperation } from './finance-operation'
import { financeProduct } from './finance-product'
import { financeProject } from './finance-project'
import { financePurpose } from './finance-purpose'

/**
 * The intake subset of the spec-338 EARS-316 provenance enum (EARS-503).
 *
 * `hours` and `reversal` are NOT intake sources and their absence is the clause,
 * not an omission: no hours event posts (EARS-507), and a reversal is the
 * ledger's own correction, never something a producer files.
 */
export const FINANCE_INTAKE_SOURCES = ['request', 'manual', 'backfill', 'bank_import'] as const
export type FinanceIntakeSource = (typeof FINANCE_INTAKE_SOURCES)[number]

/** What the item asserts moved — everything the rebuild from zero needs (decision 17). */
export const FINANCE_INTAKE_KINDS = ['expense', 'income', 'transfer', 'conversion'] as const
export type FinanceIntakeKind = (typeof FINANCE_INTAKE_KINDS)[number]

/** The states of the EARS-524 machine. The transitions live in `src/lib/finance/intake/status.ts`. */
export const FINANCE_INTAKE_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'refused',
  'cancelled',
  'posted',
] as const
export type FinanceIntakeStatus = (typeof FINANCE_INTAKE_STATUSES)[number]

export const financeIntakeItem = core.table(
  'finance_intake_item',
  {
    id: serial('id').primaryKey(),
    source: text('source').notNull(),
    /** EARS-503; unique per source WHERE SET — the partial index below. */
    sourceRef: text('source_ref'),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('draft'),
    /**
     * ALWAYS the date money moved — never the document's issue date (EARS-508).
     *
     * NULLABLE since 2026-09-03 (owner ruling, #388): a pre-spend request is an
     * INTENT, and the date money moved does not exist yet. It is written by the
     * posting act (EARS-533), and the `money_facts` CHECK below is what keeps a
     * `posted` row from ever holding a null.
     */
    occurredOn: date('occurred_on', { mode: 'string' }),
    /**
     * The money account; empty when `personal_funds` (EARS-513) — and also while
     * an unposted pre-spend request has named none (EARS-533).
     */
    accountId: integer('account_id').references(() => financeAccount.id),
    /** Transfer/conversion target; a system `liability` account only per EARS-528. */
    counterAccountId: integer('counter_account_id').references(() => financeAccount.id),
    /** The DOCUMENT side, minimal units (spec 338 EARS-310). */
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    /** The ACCOUNT side where it differs; the TARGET side for `kind = conversion`. */
    paidAmount: bigint('paid_amount', { mode: 'bigint' }),
    paidCurrency: text('paid_currency'),
    feeAmount: bigint('fee_amount', { mode: 'bigint' }),
    feeCurrency: text('fee_currency'),
    /** Expense only; the category follows the purpose (spec 338 EARS-327). */
    purposeId: integer('purpose_id').references(() => financePurpose.id),
    projectId: integer('project_id')
      .notNull()
      .references(() => financeProject.id),
    /**
     * Per the purpose's binding (spec 338 EARS-320), hence NULLABLE: a binding
     * of `forbidden` means there is no product to name, and a transfer between
     * own accounts has none either. The per-kind requirement is a module rule,
     * not a column one, because it depends on another row.
     */
    productId: integer('product_id').references(() => financeProduct.id),
    /**
     * Who is being paid (EARS-532), NULLABLE for the same structural reason: a
     * transfer between two own accounts and an own-account conversion have no
     * counterparty at all.
     */
    counterpartyId: integer('counterparty_id').references(() => financeCounterparty.id),
    /** The person the payment is attributable to (spec 338 EARS-322); FK by hand. */
    memberId: integer('member_id'),
    note: text('note'),
    alreadyPaid: boolean('already_paid').notNull().default(false),
    personalFunds: boolean('personal_funds').notNull().default(false),
    /** FK → `core.member(id)`, added as SQL in the migration. */
    createdBy: integer('created_by').notNull(),
    decidedBy: integer('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    refusalReason: text('refusal_reason'),
    postedBy: integer('posted_by'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    /** Filled at posting (EARS-505); unique — an operation has at most one item. */
    operationId: integer('operation_id').references(() => financeOperation.id),
  },
  (table) => [
    // The three enums are written out here rather than interpolated from the
    // arrays above, exactly as `finance_operation` writes its own: a CHECK is
    // migration TEXT, and a constant that silently rewrites already-applied SQL
    // is worse than a duplication a test can compare (the enum arrays and these
    // lists are asserted equal in `tests/int/platform/finance-intake.int.spec.ts`).
    check(
      'finance_intake_item_source_allowed',
      sql`${table.source} in ('request', 'manual', 'backfill', 'bank_import')`,
    ),
    check(
      'finance_intake_item_kind_allowed',
      sql`${table.kind} in ('expense', 'income', 'transfer', 'conversion')`,
    ),
    check(
      'finance_intake_item_status_allowed',
      sql`${table.status} in ('draft', 'submitted', 'approved', 'refused', 'cancelled', 'posted')`,
    ),
    // EARS-503: the ref is mandatory for the machine-fed sources and forbidden
    // for the human ones. Stated as one equivalence so neither half can drift.
    check(
      'finance_intake_item_source_ref_policy',
      sql`(${table.source} in ('bank_import', 'backfill')) = (${table.sourceRef} is not null)`,
    ),
    check(
      'finance_intake_item_personal_funds_account',
      sql`(not ${table.personalFunds}) or (${table.accountId} is null)`,
    ),
    // EARS-533's database half, and the reason the two nullable columns above
    // cannot rot into «sometimes empty». The money side may be unknown in
    // EXACTLY one place — an unposted pre-spend request (`source = 'request'`
    // with `already_paid` false) — and nowhere else: a manual line, a backfill
    // row, an «уже потрачено» request and every `posted` item name both the
    // date money moved and, unless the payer was the member's own card, the
    // account it left.
    check(
      'finance_intake_item_money_facts',
      sql`(${table.source} = 'request' and not ${table.alreadyPaid} and ${table.status} <> 'posted')
        or (${table.occurredOn} is not null
          and (${table.personalFunds} or ${table.accountId} is not null))`,
    ),
    check(
      'finance_intake_item_personal_funds_already_paid',
      sql`(not ${table.personalFunds}) or ${table.alreadyPaid}`,
    ),
    // The other half of the model row's `member` note: «required for
    // `personal_funds` and liability transfers». Only the personal-funds arm is
    // enforceable from this row alone — the liability arm turns on
    // `counter_account` naming a system `liability` account, which is a property
    // of ANOTHER row (EARS-528, #386). A debt owed to nobody cannot be read back
    // as «who does BBM owe», so it is refused at the column rather than
    // discovered by the liability view.
    check(
      'finance_intake_item_personal_funds_member',
      sql`(not ${table.personalFunds}) or (${table.memberId} is not null)`,
    ),
    check(
      'finance_intake_item_paid_pair',
      sql`(${table.paidAmount} is null) = (${table.paidCurrency} is null)`,
    ),
    check(
      'finance_intake_item_fee_pair',
      sql`(${table.feeAmount} is null) = (${table.feeCurrency} is null)`,
    ),
    check(
      'finance_intake_item_decision_pair',
      sql`(${table.decidedBy} is null) = (${table.decidedAt} is null)`,
    ),
    check(
      'finance_intake_item_refusal_reason',
      sql`(${table.status} <> 'refused') or (${table.refusalReason} is not null)`,
    ),
    check(
      'finance_intake_item_posting_shape',
      sql`(${table.status} = 'posted') = (${table.operationId} is not null)`,
    ),
    check(
      'finance_intake_item_posted_pair',
      sql`(${table.postedBy} is null) = (${table.postedAt} is null)`,
    ),
    // EARS-504's database half: a duplicate (source, source_ref) cannot exist,
    // however many producers race for it.
    uniqueIndex('finance_intake_item_source_ref_unique')
      .on(table.source, table.sourceRef)
      .where(sql`${table.sourceRef} is not null`),
    uniqueIndex('finance_intake_item_operation_unique').on(table.operationId),
    // The queue reads by status, the member's own list by author.
    index('finance_intake_item_status_idx').on(table.status),
    index('finance_intake_item_created_by_idx').on(table.createdBy),
  ],
)

export type FinanceIntakeItemRow = typeof financeIntakeItem.$inferSelect
export type FinanceIntakeItemInsert = typeof financeIntakeItem.$inferInsert
