/**
 * The finance module's refusals (spec 338 EARS-326, EARS-330).
 *
 * Two classes, and the split is the one the caller acts on:
 *
 *  - `FinanceRefusal` — the ledger's rules said no (unbalanced, wrong currency,
 *    a product where the binding forbids one, a frozen precision, the fund row).
 *    The admin should read the message and change the input.
 *  - `FinanceAccessRefusal` — the CALLER may not do this at all (EARS-330). The
 *    admin cannot fix it by changing the input, and a surface renders it as a
 *    bare 403 rather than as a form error (spec 311 EARS-418).
 *
 * The messages are Russian sentences naming the offending value, following the
 * module convention of `src/lib/hours/core/errors.ts` and `src/lib/member`: they
 * are shown to the owner, and EARS-326 requires a readable message rather than a
 * raw constraint error. Which is also why every one of these is raised BEFORE
 * the write reaches Postgres wherever the check is expressible in the module —
 * the database constraints behind them are the accident guard, not the UX.
 */

/** The ledger refused the fact as described. */
export class FinanceRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinanceRefusal'
  }
}

/** The caller is not allowed to write to the finance module at all (EARS-330). */
export class FinanceAccessRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FinanceAccessRefusal'
  }
}
