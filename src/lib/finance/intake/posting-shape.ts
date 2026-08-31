import type { FinanceIntakeKind } from '@/lib/platform/db/schema/finance/finance-intake-item'

import { FinanceRefusal } from '../core/errors'

export type FinancePostingShape = {
  kind: FinanceIntakeKind
  amount: bigint
  currency: string
  accountId: number | null
  counterAccountId: number | null
  paidAmount: bigint | null
  paidCurrency: string | null
  feeAmount: bigint | null
  feeCurrency: string | null
  purposeId: number | null
  memberId: number | null
  alreadyPaid: boolean
  personalFunds: boolean
}

/** Pure refusals known before account/reference rows are loaded. */
export function financePostingShapeRefusals(item: FinancePostingShape): string[] {
  const reasons: string[] = []
  if (item.amount <= 0n || (item.paidAmount !== null && item.paidAmount <= 0n)) {
    reasons.push('Проводимые суммы должны быть положительными.')
  }
  if (item.feeAmount !== null && item.feeAmount <= 0n) {
    reasons.push('Комиссия должна быть положительной суммой расхода.')
  }
  if ((item.paidAmount === null) !== (item.paidCurrency === null)) {
    reasons.push('Вторая сумма и её валюта должны быть указаны вместе.')
  }
  if ((item.feeAmount === null) !== (item.feeCurrency === null)) {
    reasons.push('Сумма комиссии и её валюта должны быть указаны вместе.')
  }
  const personalFundsExpense = item.kind === 'expense' && item.personalFunds
  if (item.personalFunds && item.kind !== 'expense') {
    reasons.push('personal_funds поддерживается только для расхода.')
  }
  if (personalFundsExpense && !item.alreadyPaid) {
    reasons.push('Расход personal_funds требует alreadyPaid.')
  }
  if (personalFundsExpense && item.accountId !== null) {
    reasons.push('Расход personal_funds не называет счёт компании.')
  }
  if (personalFundsExpense && item.memberId === null) {
    reasons.push('Расход personal_funds обязан назвать участника.')
  }
  if (!personalFundsExpense && item.accountId === null) {
    reasons.push('Операция обязана назвать денежный счёт; исключение — расход personal_funds.')
  }

  const paidCurrency = item.paidCurrency ?? item.currency
  switch (item.kind) {
    case 'expense':
      if (item.purposeId === null) reasons.push('Расход без назначения не проводится.')
      if (
        item.paidAmount !== null &&
        paidCurrency === item.currency &&
        item.paidAmount !== item.amount
      ) {
        reasons.push('Вторая сумма нужна только для другой валюты.')
      }
      if (item.feeCurrency !== null && item.feeCurrency !== paidCurrency) {
        reasons.push('Валюта комиссии должна совпадать с валютой счёта списания.')
      }
      break
    case 'income':
      if (item.purposeId !== null) reasons.push('Назначение указывается только у расхода.')
      if (item.personalFunds) reasons.push('Доход не может быть оплачен из personal_funds.')
      if (paidCurrency !== item.currency) {
        reasons.push('Межвалютный доход через intake не поддерживается.')
      } else if (item.paidAmount !== null && item.paidAmount !== item.amount) {
        reasons.push('Вторая сумма нужна только для другой валюты.')
      }
      if (item.feeCurrency !== null && item.feeCurrency !== paidCurrency) {
        reasons.push('Валюта комиссии должна совпадать с валютой счёта зачисления.')
      }
      break
    case 'transfer':
      if (item.purposeId !== null) reasons.push('Назначение указывается только у расхода.')
      if (item.counterAccountId === null) {
        reasons.push('Перевод обязан назвать счёт зачисления.')
      }
      if (item.paidAmount !== null || item.paidCurrency !== null) {
        reasons.push('Межвалютный перевод записывается как kind = conversion.')
      }
      if (item.feeCurrency !== null && item.feeCurrency !== item.currency) {
        reasons.push('Валюта комиссии должна совпадать с валютой счёта списания.')
      }
      break
    case 'conversion':
      if (item.purposeId !== null) reasons.push('Назначение указывается только у расхода.')
      if (item.counterAccountId === null) {
        reasons.push('kind = conversion обязан назвать счёт зачисления.')
      }
      if (item.paidAmount === null || item.paidCurrency === null) {
        reasons.push('kind = conversion обязан назвать две фактические суммы.')
      }
      if (item.paidCurrency === item.currency) {
        reasons.push(
          'kind = conversion требует две разные валюты; движение в одной валюте записывается как kind = transfer.',
        )
      }
      if (
        item.feeCurrency !== null &&
        item.feeCurrency !== item.currency &&
        item.feeCurrency !== item.paidCurrency
      ) {
        reasons.push('Комиссия конверсии должна быть в валюте одного из двух денежных счетов.')
      }
      break
  }
  return [...new Set(reasons)]
}

export function assertFinancePostingShape(item: FinancePostingShape): void {
  const [reason] = financePostingShapeRefusals(item)
  if (reason !== undefined) throw new FinanceRefusal(reason)
}
