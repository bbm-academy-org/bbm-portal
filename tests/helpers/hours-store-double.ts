import type { AuditContext, HoursDocument, MutationResult } from '@/lib/hours'

/**
 * The in-memory stand-in for the hours module's STORAGE, for the unit tier.
 *
 * Since spec 124 (#255) `@/lib/hours` serves the store that lives on the `core`
 * schema, and the module has no JSON fallback of any kind (EARS-12) — so a unit
 * spec can no longer seed a document by writing a temp file. It should not want
 * to: these suites test the WIRING (each Server Action calling `auth()` and its
 * own gates; the page assembling itself from a document), and the document is
 * their fixture, not their subject. The tables, the transaction, the advisory lock
 * and the constraint→sentence mapping are covered where they actually live, in
 * `tests/int/platform/hours-core*.int.spec.ts`.
 *
 * The double honours the two properties the suites depend on:
 *  - a mutator sees a COPY, so a refused mutation cannot leave a half-mutated
 *    document behind (the real store rolls its transaction back);
 *  - an unreadable store throws, so the «данные недоступны» path (081 §17,
 *    EARS-12) is exercised by assigning an error to `state.doc`.
 *  - `mutateHoursDocument` takes the audit context first (spec 201 EARS-25), and
 *    the double RECORDS it: «каждая мутация несёт автора» is a property of the
 *    Server Actions these suites test, so it has to be assertable here rather
 *    than only in the integration tier.
 */
export type HoursStoreState = {
  /** The current document, or an `Error` the store should throw on any access. */
  doc: unknown
  /** How many mutations were persisted — «ничего не записано» as a number. */
  writes: number
  /** The audit context of every mutation attempt, in order (spec 201 EARS-25). */
  contexts?: AuditContext[]
}

/** The two store exports of `@/lib/hours`, backed by `state`. */
export function hoursStoreDouble(state: HoursStoreState) {
  const current = (): HoursDocument => {
    if (state.doc instanceof Error) throw state.doc
    return structuredClone(state.doc) as HoursDocument
  }

  return {
    readHoursDocument: async (): Promise<HoursDocument> => current(),
    mutateHoursDocument: async <T>(
      ctx: AuditContext,
      mutator: (doc: HoursDocument) => MutationResult<T>,
    ): Promise<MutationResult<T>> => {
      state.contexts = [...(state.contexts ?? []), ctx]
      const result = mutator(current())
      if (result.ok) {
        state.doc = result.doc
        state.writes += 1
      }
      return result
    },
  }
}
