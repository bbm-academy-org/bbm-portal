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
    if (typeof message === 'string' && message.trim()) return ownerFacingText(message)
  }
  return fallback
}

/** «(EARS-543/544, EARS-548)», «(EARS-547, Q2)», «(EARS-529, решение 34 от …)» — a spec citation in brackets. */
const CITATION = /\s*\(EARS-\d+[^()]*\)/g
/** A bare «EARS-319/328» left in running text. */
const BARE_CODE = /\s*\bEARS-\d+(?:\/\d+)*(?:,\s*EARS-\d+(?:\/\d+)*)*/g
const ISO_DAY = /\b(\d{4})-(\d{2})-(\d{2})(?!\d)/g

/**
 * A module refusal as the OWNER reads it (review of #564, UX 7). The module
 * writes its refusals for the record — they cite the spec clause and carry
 * ISO dates, and the logs and the tests keep them so. On the screen the
 * clause is noise and the date is in the register's one format: the codes go,
 * and «2026-11-10» reads «10.11.2026». The words themselves are kept.
 */
export function ownerFacingText(message: string): string {
  return message.replace(CITATION, '').replace(BARE_CODE, '').replace(ISO_DAY, '$3.$2.$1').trim()
}

export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return year && month && day ? `${day}.${month}.${year}` : iso
}

/**
 * The zone «Подана» is named in — Moscow, where the owner and the team read the
 * register (#525 review N3). The same `Europe/Moscow` the rest of the platform
 * formats its instants in (`HoursPublicationScreen`, `OkrView`, the member
 * default).
 */
const FILED_AT = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * An INSTANT as «дд.мм.гггг чч:мм» in Moscow time — «Подана» (#517).
 *
 * ONE FIXED ZONE, NOT THE READER'S. The server serializes `created_at` as an
 * ISO-Z instant, and `new Date(...).toLocaleString()` would render it in
 * whatever zone the reader's laptop is set to — so the same request would read
 * differently in Moscow, Lisbon and Tbilisi, and two people comparing a
 * register over a call would disagree about when it was filed. A finance
 * register is a shared record: every row of it must say the same thing to
 * everyone looking at it.
 *
 * MOSCOW, NOT UTC. The first cut named the instant in UTC, the zone it is
 * stored in; but the team lives in МСК, and the Mattermost client shows the
 * Higgsfield post written at 14:21:39Z as 17:21 — a register reading «14:21»
 * for the same post, with no zone on screen, was a three-hour puzzle (#525
 * review N3). It now reads «20.04.2026 17:21», matching the chat.
 *
 * Seconds are dropped rather than rounded: the minute is the resolution a human
 * asks this question at, and a truncation cannot make a request look filed
 * later than it was. A value that is not an instant comes back as it came.
 */
export function formatDateTime(iso: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return iso
  const part = Object.fromEntries(
    FILED_AT.formatToParts(instant).map(({ type, value }) => [type, value]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>
  return `${part.day}.${part.month}.${part.year} ${part.hour}:${part.minute}`
}
