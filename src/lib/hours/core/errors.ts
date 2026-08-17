/**
 * The storage layer's two error channels (spec 124 EARS-12, EARS-20).
 *
 * 1. `HoursDataError` — «данные недоступны». The database is unset, unreachable
 *    or answering something this module cannot interpret. Pages render 081 §17
 *    on it and mutations refuse loudly; nothing falls back to the JSON file
 *    (EARS-12).
 * 2. `HoursPersistRefusal` — an EXPLAINED refusal that a constraint produced.
 *    It exists as a throw rather than a return value for one structural reason:
 *    the refusal is discovered while a transaction is open, and returning a
 *    value from the transaction callback COMMITS. So the mapped sentence travels
 *    out on a throw (rolling the transaction back) and `mutateHoursDocument`
 *    turns it back into the ordinary `{ ok: false, error }` the forms already
 *    render.
 *
 * A note on the duplicated name: `src/lib/hours/store.ts` (the JSON store) also
 * declares a `HoursDataError`, and this cycle deliberately does not touch that
 * file — the cutover task (#256) deletes it, and until then it stays the exact
 * code the rollback path runs and the import tool reads through. This class is
 * the one the module's public API exports; the duplication ends with #256.
 */

/** The data behind the hours module is unreadable — say so out loud. */
export class HoursDataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HoursDataError'
  }
}

/** A constraint fired and this module knows what sentence it means (EARS-20). */
export class HoursPersistRefusal extends Error {
  constructor(
    readonly refusal: string,
    options?: { cause?: unknown },
  ) {
    super(refusal, options)
    this.name = 'HoursPersistRefusal'
  }
}

/**
 * The SQLSTATE and constraint name behind a failed drizzle query.
 *
 * drizzle wraps the pg error in a `DrizzleQueryError` and hangs the original off
 * `cause`, so reading `.code` / `.constraint` off the thrown object finds
 * `undefined` on every real violation — i.e. a mapping table keyed on them would
 * be dead code that looks alive. Unwrapped recursively here, exactly as
 * `src/lib/member/repository.ts` does for the same reason.
 */
export function pgFailure(err: unknown): { code?: string; constraint?: string } {
  const node = err as { code?: string; constraint?: string; cause?: unknown } | undefined
  if (typeof node?.code === 'string') return { code: node.code, constraint: node.constraint }
  return node?.cause ? pgFailure(node.cause) : {}
}
