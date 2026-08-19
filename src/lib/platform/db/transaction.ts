/**
 * The ONE way application code opens a transaction against `platform`
 * (spec `docs/specs/201-universal-edit-audit.md`, EARS-6, EARS-7, EARS-24).
 *
 * `core.audit_row_change()` refuses any write on an app-marked connection that
 * carries no audit context (EARS-26 — the mark itself is
 * `PLATFORM_CONNECTION_MARK` in `./client.ts`). This helper is what supplies it:
 * BEGIN → advisory lock (when the caller names one) → audit context → the
 * caller's work.
 *
 * **Why the lock keeps the first position.** Spec 124 EARS-10 requires the hours
 * module's `pg_advisory_xact_lock` to be the transaction's FIRST statement, and
 * it stays there: both it and `set_config(…, true)` are transaction-scoped, so
 * their relative order changes nothing in either guarantee, and the tie is
 * broken in favour of the lock because «first» is load-bearing there (no read
 * may precede mutual exclusion) while the context only has to precede the first
 * audited write.
 *
 * **Why `set_config(…, true)` and not `SET LOCAL`.** `SET LOCAL` accepts no bind
 * parameter, and a value interpolated into SQL text is how an actor's email
 * becomes an injection surface. `set_config` is the transaction-local,
 * parameterizable form. A session-level `SET` is forbidden outright: it would
 * outlive the transaction and stamp the next borrower of that pooled connection
 * with the previous actor.
 *
 * Three mechanisms keep this the only door, because a required argument alone
 * binds only the callers who already chose the helper:
 *  1. `getPlatformDb()` hands out a type with no `.transaction(…)` on it
 *     (`./client.ts`) — a compile error, not a style violation;
 *  2. an eslint `no-restricted-syntax` rule forbids `.transaction(` and a
 *     hand-written `app.*` GUC write outside this directory (`eslint.config.mjs`,
 *     registered in `docs/ci-guardrails.md` §5);
 *  3. the trigger itself, which is the load-bearing one — it refuses the write.
 */
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { openPlatformDb, type PlatformDb } from './client'

/**
 * The closed set of `app.source` (EARS-7), mirrored by a regex inside the
 * trigger — a value outside it is refused by the database, not merely untyped.
 *
 *  - `portal` — any authenticated application request (a human is behind it);
 *  - `system:<job>` — a write the application itself initiates with NO user
 *    (an outbox drain, a scheduled job);
 *  - `cli:<name>` — a repo-owned script (e.g. `cli:member-seed`);
 *  - `migration` — a data-bearing migration;
 *  - `manual-dba` — an announced operator session that sets it by hand.
 *
 * `db-direct` is deliberately absent: it is the trigger's OWN fallback for an
 * unmarked connection, and letting an app write borrow it would make the ledger
 * lie about the door the change came through.
 */
export type AuditSource =
  'portal' | 'migration' | 'manual-dba' | `system:${string}` | `cli:${string}`

/**
 * Who is writing, and through which door.
 *
 * `actorEmail` is REQUIRED to be non-null for `portal` (checked below, and again
 * by the trigger): a ledger row originating from an authenticated request with a
 * NULL actor is a defect, not a degradation. It is legitimately null for
 * `system:<job>`, `cli:<name>`, `migration` and `manual-dba` — those are the
 * sources with no human behind them.
 */
export type AuditContext = {
  actorEmail: string | null
  source: AuditSource
}

/** What a caller's callback receives: a transaction handle, builders and all. */
export type PlatformTx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0]

export type PlatformTransactionOptions = {
  /**
   * A `pg_advisory_xact_lock` key, taken as the transaction's first statement.
   * Keys are allocated in the open — see `src/lib/hours/core/lock.ts` for the
   * register and why a hashed-at-call-time key would be an invisible
   * cross-module mutex.
   */
  lockKey?: number
}

/** Options of a READ-only transaction — no audit context, because no write. */
export type PlatformReadOptions = {
  isolationLevel?: 'read committed' | 'repeatable read' | 'serializable'
}

/**
 * `core.member.email` is stored normalized (`lower(btrim(…))`, DB-enforced by a
 * CHECK — spec 124 EARS-2), so the actor is an email in that same form and joins
 * to `member` by equality. Normalized here as well as at the session gate, so a
 * caller that hand-builds a context cannot write an actor that matches nothing.
 */
function normalizeActor(email: string | null): string | null {
  if (email === null) return null
  const normalized = email.trim().toLowerCase()
  return normalized === '' ? null : normalized
}

/**
 * Open a WRITE transaction carrying the audit context (EARS-24).
 *
 * The context is the required FIRST argument on purpose: there is no overload
 * that omits it, so «I forgot to attribute this write» is not a shape this
 * function has.
 */
export async function platformTransaction<T>(
  ctx: AuditContext,
  fn: (tx: PlatformTx) => Promise<T>,
  options?: PlatformTransactionOptions,
): Promise<T> {
  const actorEmail = normalizeActor(ctx.actorEmail)
  if (ctx.source === 'portal' && actorEmail === null) {
    throw new Error(
      "platformTransaction: source 'portal' means an authenticated request, so actorEmail is " +
        'required (spec 201 EARS-7, EARS-9). Pass sessionEmail(session), or name the ' +
        'actor-less source this write really is (system:<job> | cli:<name> | migration).',
    )
  }

  const db = openPlatformDb()
  return db.transaction(async (tx) => {
    // The lock first (spec 124 EARS-10), then the context, then the caller.
    if (options?.lockKey !== undefined) {
      await tx.execute(sql`select pg_advisory_xact_lock(${options.lockKey}::bigint)`)
    }
    await tx.execute(
      sql`select set_config('app.actor_email', ${actorEmail ?? ''}, true),
                 set_config('app.source', ${ctx.source}, true)`,
    )
    return fn(tx)
  })
}

/**
 * Open a READ-ONLY transaction. No audit context, deliberately.
 *
 * `access mode read only` is enforced by Postgres, so no audited table can be
 * mutated inside it and no capture trigger can fire — there is nothing to
 * attribute. Making a reader invent an actor would be the opposite of EARS-9:
 * `readHoursDocument()` runs with no session at all, and a fabricated context is
 * exactly what the fail-closed rule exists to prevent.
 *
 * It lives in this directory, so the eslint rule of EARS-24 is satisfied by
 * construction: callers outside it still cannot reach `.transaction(…)`.
 */
export async function platformReadTransaction<T>(
  fn: (tx: PlatformTx) => Promise<T>,
  options?: PlatformReadOptions,
): Promise<T> {
  const db = openPlatformDb()
  return db.transaction(async (tx) => fn(tx), {
    isolationLevel: options?.isolationLevel ?? 'repeatable read',
    accessMode: 'read only',
  })
}

export type { PlatformDb }
