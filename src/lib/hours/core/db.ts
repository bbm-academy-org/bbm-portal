/**
 * The executor shapes the core-backed hours store passes around (spec 124
 * EARS-10, EARS-12).
 *
 * `HoursTx` is structural, not `NodePgDatabase`, for the same reason the member
 * module's `MemberDb` is: a transaction handle carries the query builders but not
 * the pool-bound extras, and EVERY hours read and write happens on a transaction
 * — the mutation because it holds the module advisory lock, the read because four
 * separate `SELECT`s outside one snapshot could observe half of somebody else's
 * mutation.
 *
 * `HoursTx` is also exactly what the member module accepts as `{ db }`, which is
 * what lets an hours save create a member INSIDE its own transaction (EARS-9): a
 * rolled-back save must not leave a member behind.
 */
import { getPlatformDb } from '@/lib/platform/db/client'

import { HoursDataError } from './errors'

type PlatformDb = ReturnType<typeof getPlatformDb>

/** What a load or a persist needs of a handle: the builders plus raw `execute`. */
export type HoursTx = Pick<PlatformDb, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

/**
 * The platform handle, or `HoursDataError`.
 *
 * `getPlatformDb()` throws a plain `Error` naming `PLATFORM_DATABASE_URL` when the
 * variable is unset (ADR-004 §3: no fallback to Payload's `DATABASE_URL`). That
 * is the right failure, but the WRONG type for this module: the surfaces catch
 * `HoursDataError` to say «данные недоступны» (081 §17, EARS-12), so an unset
 * variable would otherwise reach a page as a 500 instead of a sentence.
 */
export function hoursDb(): PlatformDb {
  try {
    return getPlatformDb()
  } catch (cause) {
    throw new HoursDataError(
      'Платформенная база модуля часов не настроена — позови администратора.',
      { cause },
    )
  }
}
