import type { FinanceIntakeStatus } from '@/lib/finance'

/** The one address the board reads and writes through. */
export const REQUESTS_ENDPOINT = '/p/finance/api/requests'

/**
 * The Refine RESOURCE the requests register is read as (#388 wave 3).
 *
 * Adopting the whitelist's List block means the rows arrive through the data
 * provider's `getList`, not through a bare snapshot read: `useTable` owns the
 * page, the order and the scope filter, and the block owns the head, the rows,
 * the skeleton, the empty state, the pager and — since #388 — the totals row.
 */
export const REQUESTS_RESOURCE = 'finance-requests'

/** «Кому BBM должен» (EARS-527) read as its own register through the block. */
export const LIABILITIES_RESOURCE = 'finance-liabilities'

/** Where a confirming document is created (EARS-514): multipart, one POST. */
export const DOCUMENTS_ENDPOINT = '/p/finance/api/documents'

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

/**
 * THE STATUS COLOUR MAP (#388, owner acceptance 2026-09-15: «each status gets
 * its own badge variant, so status is readable without reading»).
 *
 * FOUR STOCK VARIANTS, NO FIFTH (owner go, Антон, 2026-09-15): the kit's
 * `badge` publishes `default` / `secondary` / `destructive` / `outline`, and a
 * new variant would be a bespoke element class the whitelist has not settled.
 * Six statuses therefore map onto four CLASSES OF MEANING, not onto six
 * colours — and the classes are the questions a reader of this register asks:
 *
 * | variant       | what it says                                      |
 * | ------------- | ------------------------------------------------- |
 * | `default`     | a decision is owed HERE and now — `submitted`     |
 * | `secondary`   | authorised, waiting on a document — `approved`    |
 * | `destructive` | refused, and the reason is on the row — `refused` |
 * | `outline`     | nothing is owed: `posted`, `draft`, `cancelled`   |
 *
 * `posted` shares `outline` with the two inert states on purpose: a posted
 * request is settled, and the loudest treatment on a register belongs to the
 * rows that still want something from the reader.
 */
export const REQUEST_STATUS_BADGE_VARIANT: Record<FinanceIntakeStatus, RequestStatusBadgeVariant> =
  {
    draft: 'outline',
    submitted: 'default',
    approved: 'secondary',
    refused: 'destructive',
    cancelled: 'outline',
    posted: 'outline',
  }

/** The stock `badge` variants this surface is allowed to reach for. */
export type RequestStatusBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

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
