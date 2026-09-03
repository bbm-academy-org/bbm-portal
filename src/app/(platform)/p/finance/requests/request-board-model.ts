import type { FinanceIntakeStatus } from '@/lib/finance'

import type { RequestBoardItem, RequestBoardReferences } from './request-board-contract'

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

/**
 * The board's four columns — the picked layout D of
 * `design-source/finance/RequestBoard.html`, which is `fidelity: wireframe`:
 * it fixes THIS composition (four columns = the four states of the status
 * machine a reader can act on) and no visual language. The look is the stock
 * shadcn/Refine theme, `design-source/README.md`'s `system:` row.
 *
 * `draft` and `cancelled` are real statuses and are deliberately NOT columns:
 * a draft belongs to its author alone and an approver has nothing to do with
 * it, so both live in the «Мои заявки» view instead. Putting them on the board
 * would give the approver two columns they can never act on.
 */
export type RequestBoardColumn = {
  status: FinanceRequestBoardStatus
  title: string
  hint: string
}

export const REQUEST_BOARD_COLUMNS: readonly RequestBoardColumn[] = [
  { status: 'submitted', title: 'Ждут', hint: 'Поданы и ждут решения одобряющего.' },
  {
    status: 'approved',
    title: 'Одобрены — ждут документа',
    hint: 'Трата разрешена; проводки нет, пока не приложен подтверждающий документ.',
  },
  { status: 'posted', title: 'Проведены', hint: 'Операция в леджере — статус терминальный.' },
  { status: 'refused', title: 'Отклонены', hint: 'Проводки нет; причина и документы остаются.' },
]

export type RequestBoardGroups = Record<FinanceRequestBoardStatus, RequestBoardItem[]>

/**
 * Files each request under its column, newest money movement first (EARS-509).
 * An item whose status is not a column — a draft, a cancelled request — is
 * dropped here and picked up by `ownRequests`.
 */
export function groupRequestsByStatus(requests: readonly RequestBoardItem[]): RequestBoardGroups {
  const groups = Object.fromEntries(
    FINANCE_REQUEST_BOARD_STATUSES.map((status) => [status, [] as RequestBoardItem[]]),
  ) as RequestBoardGroups
  for (const request of requests) {
    const column = groups[request.status as FinanceRequestBoardStatus]
    if (column !== undefined) column.push(request)
  }
  for (const status of FINANCE_REQUEST_BOARD_STATUSES) {
    groups[status].sort(
      (left, right) => right.occurredOn.localeCompare(left.occurredOn) || right.id - left.id,
    )
  }
  return groups
}

export function boardColumnCounts(groups: RequestBoardGroups): Record<string, number> {
  return Object.fromEntries(
    FINANCE_REQUEST_BOARD_STATUSES.map((status) => [status, groups[status].length]),
  )
}

/**
 * Who may start a drag. Only the approve role acts on the board (EARS-501/502),
 * and a terminal card has no legal target at all (EARS-524) — so it is not
 * draggable rather than draggable-and-then-refused: an affordance that always
 * fails is a defect, not a guard.
 */
export function canDragRequest(request: RequestBoardItem, canApprove: boolean): boolean {
  if (!canApprove) return false
  return request.status === 'submitted' || request.status === 'approved'
}

export type RequestCardFlag = { id: string; label: string; tone: 'warning' | 'neutral' }

/** What the reader has to know about a card BEFORE opening it. */
export function requestCardFlags(request: RequestBoardItem): RequestCardFlag[] {
  const flags: RequestCardFlag[] = []
  if (request.alreadyPaid) {
    flags.push({ id: 'already-paid', label: 'уже потрачено', tone: 'warning' })
  }
  if (request.personalFunds) {
    flags.push({ id: 'personal-funds', label: 'свои деньги', tone: 'warning' })
  }
  if (request.status === 'approved' && request.documents.length === 0) {
    flags.push({ id: 'no-document', label: 'нет документа', tone: 'warning' })
  }
  if (request.documents.length > 0) {
    flags.push({ id: 'document', label: 'документ приложен', tone: 'neutral' })
  }
  if (request.proposal) {
    flags.push({ id: 'proposal', label: 'назначение предложено', tone: 'warning' })
  }
  return flags
}

/** «Мои заявки»: everything the reader filed, drafts and cancellations included. */
export function ownRequests(requests: readonly RequestBoardItem[]): RequestBoardItem[] {
  return requests.filter((request) => request.own)
}

/** The precision the currency reference declares; two places for an unknown code. */
export function currencyPrecision(
  currencies: RequestBoardReferences['currencies'],
  code: string,
): number {
  return currencies.find((currency) => currency.code === code)?.precision ?? 2
}

/**
 * ATTACHING THE CONFIRMING DOCUMENT — the client half of EARS-506/511.
 *
 * The gate is the SERVER's and stays there: `POST /p/finance/api/documents`
 * bounds the stream, sniffs the bytes against the declared type and refuses a
 * kind outside the spec's set (EARS-514/515). What lives here is only the
 * AFFORDANCE — who is offered the control, and the two refusals worth spending
 * no upload at all on. The numbers mirror the server's
 * `FINANCE_DOCUMENT_MAX_BYTES` / `FINANCE_DOCUMENT_MIME_TYPES`; they are
 * restated rather than imported because those live behind `@/lib/finance`,
 * whose index reaches the database, and this module ships to the browser.
 */
export const DOCUMENT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024

/** «PDF and images» (EARS-514) as the file input's `accept`. */
export const DOCUMENT_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/heic',
] as const

export const DOCUMENT_UPLOAD_ACCEPT = DOCUMENT_UPLOAD_MIME_TYPES.join(',')

/**
 * Who may attach, and to what. EARS-511 names the two: «the submitter or an
 * entry-role holder» (EARS-502). An item the ledger has already swallowed or a
 * decision has already closed takes nothing more (EARS-505/512), so it is
 * offered no control at all rather than one the server would refuse.
 */
export function canAttachDocument(request: RequestBoardItem, canEnter: boolean): boolean {
  if (!request.own && !canEnter) return false
  return (
    request.status === 'draft' || request.status === 'submitted' || request.status === 'approved'
  )
}

/** The two refusals worth making before the bytes leave. Null means «send it». */
export function documentUploadRefusal(file: {
  name: string
  size: number
  type: string
}): string | null {
  if (!(DOCUMENT_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `«${file.name}» не принимается: подтверждающий документ это PDF или изображение (EARS-514).`
  }
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) {
    return `«${file.name}» больше предела в 25 МБ (EARS-514).`
  }
  return null
}
