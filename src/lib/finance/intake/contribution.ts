/**
 * The contribution intake item — spec 339 §K EARS-567.
 *
 * A contribution is the funding inflow of spec 338 EARS-336: money landing on a
 * company money account, posted against the system `equity` account the module
 * picks itself (so EARS-528 stays the only place an intake item names a system
 * account). It is filed by `finance-entry` through direct entry or the one-time
 * reconstruction, posts only by a `finance-approve` act with its confirming
 * document attached (EARS-506 — the documentless mark-paid exception covers
 * expense requests only), and is never income.
 *
 * Pure, so filing (`items.ts`) and the posting writer (`posting.ts`) run the
 * same sentence; the fund-project rule needs the fund row and is checked by the
 * writer.
 */

export type ContributionItemState = {
  source: string
  kind: string
  accountId: number | null
  counterAccountId: number | null
  paidAmount: bigint | null
  paidCurrency: string | null
  feeAmount: bigint | null
  purposeId: number | null
  productId: number | null
  personalFunds: boolean
  memberId: number | null
  counterpartyId: number | null
  settlesItemId: number | null
}

/** Null when a `kind = contribution` row has EARS-567's shape (or is not one); otherwise why. */
export function contributionItemRefusal(state: ContributionItemState): string | null {
  if (state.kind !== 'contribution') return null
  const problems: string[] = []
  if (state.source !== 'manual' && state.source !== 'backfill') {
    problems.push('взнос вносится только прямым вводом или реконструкцией истории, не заявкой')
  }
  if (state.personalFunds) problems.push('взнос не бывает «оплачено своими средствами»')
  if (state.accountId === null)
    problems.push('взнос называет денежный счёт компании, на который пришли деньги')
  if (state.counterAccountId !== null) {
    problems.push('встречный счёт взноса модуль выбирает сам (системный equity), его не называют')
  }
  if (state.paidAmount !== null || state.paidCurrency !== null) {
    problems.push('у взноса одна сумма — в валюте счёта, на который он пришёл (EARS-312)')
  }
  if (state.feeAmount !== null) {
    problems.push('комиссия банка на поступление — отдельный расход фонда, не часть взноса')
  }
  if (state.purposeId !== null) problems.push('у взноса нет назначения')
  if (state.productId !== null) problems.push('у взноса нет продукта')
  if (state.settlesItemId !== null) problems.push('взнос ничего не возмещает')
  if (state.memberId === null && state.counterpartyId === null) {
    problems.push('назовите вкладчика: участника платформы или контрагента')
  }
  if (problems.length === 0) return null
  return `Взнос (kind = contribution) принят быть не может: ${problems.join('; ')} (EARS-567).`
}
