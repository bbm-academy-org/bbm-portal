/**
 * `core.finance_account` — the chart of accounts (spec 338 EARS-301/305/312).
 *
 * Two populations in one table, told apart by `is_system`:
 *
 *  - the FOUR money kinds (`bank`, `card`, `crypto`, `cash`) are the owner's own
 *    accounts, created and named in the cabinet;
 *  - the FIVE system kinds (`income`, `expense`, `conversion`, `fx_result`,
 *    `liability`) are module-managed: created on first need, one per (kind,
 *    currency), never offered for creation, edit or retirement (EARS-305).
 *
 * They share a table because double entry does not distinguish them — a posting
 * names an account, and the balance of any account is the sum of its postings
 * (EARS-317). Splitting them would mean a posting with two nullable account
 * columns and a CHECK to pick one, which buys nothing.
 *
 * Every account is denominated in exactly ONE currency, and EARS-312 refuses a
 * posting whose currency differs — that is why `currency` lives here and is not
 * derived per posting.
 */
import { sql } from 'drizzle-orm'
import { boolean, check, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { core } from '../core'
import { financeCurrency } from './finance-currency'

/** The money kinds an owner may create (the cabinet's create form). */
export const FINANCE_MONEY_ACCOUNT_KINDS = ['bank', 'card', 'crypto', 'cash'] as const

/** The module-managed kinds, one account per (kind, currency) — EARS-305. */
export const FINANCE_SYSTEM_ACCOUNT_KINDS = [
  'income',
  'expense',
  'conversion',
  'fx_result',
  'liability',
] as const

export const FINANCE_ACCOUNT_KINDS = [
  ...FINANCE_MONEY_ACCOUNT_KINDS,
  ...FINANCE_SYSTEM_ACCOUNT_KINDS,
] as const

export type FinanceMoneyAccountKind = (typeof FINANCE_MONEY_ACCOUNT_KINDS)[number]
export type FinanceSystemAccountKind = (typeof FINANCE_SYSTEM_ACCOUNT_KINDS)[number]
export type FinanceAccountKind = (typeof FINANCE_ACCOUNT_KINDS)[number]

export const financeAccount = core.table(
  'finance_account',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => financeCurrency.code),
    /** Module-managed (EARS-305) — the cabinet renders these read-only. */
    isSystem: boolean('is_system').notNull().default(false),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'finance_account_kind_allowed',
      sql`${table.kind} in ('bank', 'card', 'crypto', 'cash', 'income', 'expense', 'conversion', 'fx_result', 'liability')`,
    ),
    // A system kind is ONLY ever a system account, and a money kind never is —
    // otherwise "create the expense account on demand" could pick up a
    // hand-made row and the one-per-(kind, currency) rule below would be a lie.
    check(
      'finance_account_system_kind_agreement',
      sql`${table.isSystem} = (${table.kind} in ('income', 'expense', 'conversion', 'fx_result', 'liability'))`,
    ),
    // EARS-305's "one per kind and currency", enforced by the database rather
    // than by the get-or-create being careful: two concurrent first-needs would
    // otherwise both insert.
    uniqueIndex('finance_account_system_kind_currency_unique')
      .on(table.kind, table.currency)
      .where(sql`${table.isSystem}`),
  ],
)

export type FinanceAccountRow = typeof financeAccount.$inferSelect
export type FinanceAccountInsert = typeof financeAccount.$inferInsert
