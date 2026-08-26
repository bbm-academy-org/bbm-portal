/**
 * The fact core's invariants as PURE functions (spec 338 EARS-311, EARS-312,
 * EARS-320, EARS-321, EARS-327, EARS-331).
 *
 * They are pure so the module can refuse with the readable message EARS-326 asks
 * for BEFORE it opens a transaction, and so every one of them is testable
 * without a database. None of them is expressible as a per-row constraint —
 * balance is a property of a SET of postings, and an account's currency and
 * kind live in another row — which is precisely why they live here rather than
 * in the migration.
 */
import type { FinanceAccountKind } from '@/lib/platform/db/schema/finance/finance-account'
import type { FinanceProductBinding } from '@/lib/platform/db/schema/finance/finance-purpose'

import { FinanceRefusal } from './errors'

/** One posting as the caller offers it, before the module assigns it an id. */
export type PostingDraft = {
  accountId: number
  /** Signed minimal units: debit > 0, credit < 0 (EARS-310). */
  amount: bigint
  currency: string
  projectId?: number | null
  categoryId?: number | null
  productId?: number | null
  memberId?: number | null
  /** 1-based step of the conversion this leg belongs to, if any (EARS-318). */
  conversionStepNo?: number | null
  /**
   * The step's id, when the caller already holds it.
   *
   * A reversal is the case that needs it: it mirrors postings whose steps exist
   * already, so it names them by id rather than by position in a chain it is not
   * building. Carrying it on the DRAFT is what lets the mirror rows be INSERTed
   * complete — a posting is never patched after the fact (EARS-313).
   */
  conversionStepId?: number | null
}

/** What the module needs to know about an account to validate a posting. */
export type AccountFacts = {
  id: number
  currency: string
  kind: FinanceAccountKind
  isSystem: boolean
  retiredAt: Date | null
}

/**
 * The two system kinds that carry the P&L: a posting on either of them is a
 * RESULT posting and must name a project (EARS-321). `conversion`, `fx_result`
 * and `liability` are balance-sheet-shaped and deliberately are not on this
 * list — a conversion leg belongs to no project, and forcing one on it would
 * invent a cost object out of a currency exchange.
 */
const RESULT_ACCOUNT_KINDS: readonly FinanceAccountKind[] = ['income', 'expense']

/** EARS-311 — the postings of one operation sum to zero in EVERY currency. */
export function assertBalancedPerCurrency(postings: readonly PostingDraft[]): void {
  if (postings.length === 0) {
    throw new FinanceRefusal(
      'Операция без проводок — это не факт движения денег. Операция записывается проводками (EARS-310).',
    )
  }
  const residuals = new Map<string, bigint>()
  for (const posting of postings) {
    residuals.set(posting.currency, (residuals.get(posting.currency) ?? 0n) + posting.amount)
  }
  const unbalanced = [...residuals].filter(([, residual]) => residual !== 0n)
  if (unbalanced.length > 0) {
    const detail = unbalanced.map(([currency, residual]) => `${currency}: ${residual}`).join(', ')
    throw new FinanceRefusal(
      `Проводки операции не сходятся в ноль по каждой валюте (EARS-311). Остаток — ${detail} ` +
        '(в минимальных единицах). Баланс проверяется ПО КАЖДОЙ валюте отдельно: суммы в разных ' +
        'валютах не гасят друг друга, для этого есть конвертация со своим курсом (EARS-318).',
    )
  }
}

/** EARS-312 — a posting is denominated in its account's currency, or not at all. */
export function assertPostingCurrencyMatchesAccount(
  postings: readonly PostingDraft[],
  accounts: ReadonlyMap<number, AccountFacts>,
): void {
  for (const posting of postings) {
    const account = accounts.get(posting.accountId)
    if (account === undefined) {
      throw new FinanceRefusal(
        `Проводка ссылается на счёт #${posting.accountId}, которого нет в плане счетов.`,
      )
    }
    if (account.currency !== posting.currency) {
      throw new FinanceRefusal(
        `Проводка в ${posting.currency} на счёт «${account.id}» невозможна: счёт ведётся в ` +
          `${account.currency} (EARS-312). Сумма всегда хранит ту валюту, в которой она случилась.`,
      )
    }
  }
}

/** EARS-321 — every income/expense posting names a project (the fund counts). */
export function assertProjectOnResultPostings(
  postings: readonly PostingDraft[],
  accounts: ReadonlyMap<number, AccountFacts>,
): void {
  for (const posting of postings) {
    const account = accounts.get(posting.accountId)
    if (account === undefined || !RESULT_ACCOUNT_KINDS.includes(account.kind)) continue
    if (posting.projectId === null || posting.projectId === undefined) {
      throw new FinanceRefusal(
        `Проводка на системный счёт «${account.kind}» обязана называть проект (EARS-321): ` +
          'P&L считается по проектам, а BBM целиком — это их сумма. Если проект не назван, ' +
          'это фонд «Фонд BBM», и его нужно назвать явно.',
      )
    }
  }
}

/**
 * EARS-320 / EARS-331 — the purpose's binding decides, the operator supplies the
 * value.
 *
 * `binding` is ALWAYS the value stored on the purpose row. There is deliberately
 * no parameter by which a caller could supply one: attributability is declared
 * once, by whoever defined the purpose (Accounting policy, ruling 2), and
 * changing it is an edit of the purpose.
 */
export function assertProductBinding(
  binding: FinanceProductBinding,
  productId: number | null | undefined,
  purposeName: string,
): void {
  const named = productId !== null && productId !== undefined
  if (binding === 'required' && !named) {
    throw new FinanceRefusal(
      `Назначение «${purposeName}» требует продукт: его product_binding = required (EARS-320). ` +
        'Если этот расход на самом деле общий — это другое назначение, а не операция без продукта.',
    )
  }
  if (binding === 'forbidden' && named) {
    throw new FinanceRefusal(
      `Назначение «${purposeName}» не принимает продукт: его product_binding = forbidden (EARS-320). ` +
        'Привязка — это мастер-данные назначения (EARS-331), а не решение по операции: ' +
        'если она неверна, правится назначение, и только ролью platform-admin.',
    )
  }
}

/**
 * EARS-327 — a purpose and its category never disagree on a posting.
 *
 * The module SETS the purpose's category on the expense-side postings itself and
 * refuses a differing one; a purpose with no category link (the state every
 * purpose is in until F2 derives the list, EARS-307) leaves the caller free.
 */
export function resolvePostingCategory(
  purposeCategoryId: number | null,
  requestedCategoryId: number | null | undefined,
  purposeName: string,
): number | null {
  if (purposeCategoryId === null) return requestedCategoryId ?? null
  if (
    requestedCategoryId !== null &&
    requestedCategoryId !== undefined &&
    requestedCategoryId !== purposeCategoryId
  ) {
    throw new FinanceRefusal(
      `Назначение «${purposeName}» привязано к статье #${purposeCategoryId}, а в операции указана ` +
        `#${requestedCategoryId} (EARS-327). Назначение и его статья не могут расходиться на проводке: ` +
        'статью меняют у назначения.',
    )
  }
  return purposeCategoryId
}
