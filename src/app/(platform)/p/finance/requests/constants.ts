import type { FinanceIntakeStatus } from '@/lib/finance'

/** The one address the board reads and writes through. */
export const REQUESTS_ENDPOINT = '/p/finance/api/requests'

/** A document has exactly one address (EARS-523); the board asks for it inline. */
export function documentHref(id: number, inline: boolean): string {
  return `/p/finance/api/documents/${id}${inline ? '?disposition=inline' : ''}`
}

/** The only mime the board dares to frame in the portal's own origin. */
export function isInlineReadable(mime: string): boolean {
  return mime === 'application/pdf'
}

export const REQUEST_STATUS_LABELS: Record<FinanceIntakeStatus, string> = {
  draft: 'Черновик',
  submitted: 'Ждёт решения',
  approved: 'Одобрена',
  refused: 'Отклонена',
  cancelled: 'Отозвана',
  posted: 'Проведена',
}

export const DOCUMENT_KIND_LABELS: Record<string, string> = {
  ru_invoice: 'Счёт',
  fiscal_receipt: 'Чек',
  foreign_invoice: 'Инвойс',
  payment_order: 'Платёжное поручение',
  bank_screenshot: 'Скриншот из банка',
  bank_statement: 'Выписка',
  other: 'Документ',
}

/** The same reading of a provider refusal every screen of this surface uses. */
export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return year && month && day ? `${day}.${month}.${year}` : iso
}
