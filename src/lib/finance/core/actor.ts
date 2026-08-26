/**
 * Who is writing to the ledger, and whether they may (spec 338 EARS-330).
 *
 * EARS-330 puts the write gate in the MODULE, not on the route: «however the URL
 * or API was reached». A surface that forgets `resolveClaimGate` is a bug, but it
 * is not a hole — the module refuses the write anyway, and the two enforcements
 * agree because this file asks the same question through the same function
 * (`hasClaim` in `src/lib/platform/authGate.ts`), rather than re-implementing the
 * role implication of spec 311 EARS-417 a second time.
 *
 * The actor is also what makes the write attributable: `financeAuditContext()`
 * turns it into the spec-201 `AuditContext` that `platformTransaction` demands,
 * so every reference edit lands in `core.audit_event` with a name on it and the
 * module needs no journal of its own (spec 338, Accounting policy ruling 2).
 */
import type { AuditContext } from '@/lib/platform/db/transaction'
import { hasClaim, PLATFORM_ADMIN_ROLE } from '@/lib/platform/authGate'

import { FinanceAccessRefusal } from './errors'

/**
 * A signed-in platform member as the finance module needs them: the email that
 * goes into the audit ledger, and the roles their session carries.
 *
 * Deliberately NOT the Auth.js session object: the module takes the two facts it
 * uses, so a caller may be a route handler, a CLI or a test without inventing a
 * session shape — and so nothing in `src/lib/finance` depends on Auth.js.
 */
export type FinanceActor = {
  /** Normalized by `platformTransaction`; joins to `core.member.email`. */
  email: string
  /** `session.user.roles` (src/auth.ts), or the equivalent for a non-web caller. */
  roles: readonly string[]
}

/**
 * The write gate (EARS-330). Read access is EARS-325's and is deliberately
 * wider — nothing here is consulted on a read.
 */
export function assertFinanceWriteAccess(actor: FinanceActor): void {
  if (typeof actor.email !== 'string' || actor.email.trim() === '') {
    throw new FinanceAccessRefusal(
      'Запись в финансовый модуль требует известного автора: у сессии нет email, ' +
        'а неатрибутированная запись в core.audit_event — дефект, а не деградация (спека 201, EARS-9).',
    )
  }
  if (!hasClaim({ user: { roles: [...actor.roles] } }, PLATFORM_ADMIN_ROLE)) {
    throw new FinanceAccessRefusal(
      `Запись в финансовый модуль доступна только роли «${PLATFORM_ADMIN_ROLE}» (EARS-330). ` +
        `У ${actor.email} её нет. Чтение /p/finance открыто каждому участнику платформы — ` +
        'сужена именно запись, до ролевой модели F2.',
    )
  }
}

/**
 * The spec-201 audit context for a finance write.
 *
 * `source: 'portal'` in every case, because every finance write in F1 comes from
 * an authenticated human: the intakes that will write with `source: 'hours'` or
 * `bank_import` are F2's, and when they arrive they name their own AUDIT source
 * as well — the operation's `source` column and `app.source` answer two different
 * questions (what kind of fact this is vs. which door the write came through).
 */
export function financeAuditContext(actor: FinanceActor): AuditContext {
  return { actorEmail: actor.email, source: 'portal' }
}
