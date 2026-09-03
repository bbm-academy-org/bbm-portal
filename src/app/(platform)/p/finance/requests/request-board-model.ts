import type { FinanceIntakeStatus } from '@/lib/finance'

export const FINANCE_REQUEST_BOARD_STATUSES = [
  'submitted',
  'approved',
  'posted',
  'refused',
] as const

export type FinanceRequestBoardStatus = (typeof FINANCE_REQUEST_BOARD_STATUSES)[number]
export type FinanceRequestBoardAct = 'approve' | 'confirm' | 'refuse'

export type RequestDropPlan =
  { type: 'act'; act: FinanceRequestBoardAct } | { type: 'refused'; message: string }

const LEGAL_DROPS: Partial<
  Record<FinanceIntakeStatus, Partial<Record<FinanceRequestBoardStatus, FinanceRequestBoardAct>>>
> = {
  submitted: { approved: 'approve', refused: 'refuse' },
  approved: { posted: 'confirm', refused: 'refuse' },
}

/** A drop opens the matching act; it never mutates a status on its own. */
export function planRequestDrop(
  from: FinanceIntakeStatus,
  to: FinanceRequestBoardStatus,
): RequestDropPlan {
  const act = LEGAL_DROPS[from]?.[to]
  if (act !== undefined) return { type: 'act', act }
  return {
    type: 'refused',
    message:
      from === 'posted' || from === 'refused'
        ? 'Этот статус терминальный: заявка остаётся на месте.'
        : 'Такой переход не входит в машину статусов: заявка остаётся на месте.',
  }
}

export function formatRequestMoney(amount: string, currency: string, precision: number): string {
  const value = BigInt(amount)
  const sign = value < 0n ? '−' : ''
  const digits = (value < 0n ? -value : value).toString().padStart(precision + 1, '0')
  const integer = precision === 0 ? digits : digits.slice(0, -precision)
  const fraction = precision === 0 ? '' : `,${digits.slice(-precision)}`
  return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction} ${currency}`
}
