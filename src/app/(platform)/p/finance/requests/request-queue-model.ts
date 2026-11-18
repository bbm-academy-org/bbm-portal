import { roundExact } from '@/lib/finance/fx/rates'

import type {
  DisplayCurrencyCode,
  QueueDisplayAmount,
  RequestBoardItem,
} from './request-board-contract'
import { requestPurposeLabel } from './request-board-model'

/**
 * THE OWNER'S PAYMENT QUEUE — the default view of `/p/finance/requests` since
 * spec 339 §I (issue #550; layout `design-source/finance/RequestPaymentQueue.html`,
 * owner «Го» on BBMP-281, Антон, 2026-11-17).
 *
 * Everything here is pure: which groups a scope shows and in which order, what
 * the three sums add up, what each column of a row says, how rows sort, what a
 * search and the filters keep, which act a row offers and how amounts in the
 * chosen display currency add up. The screen renders the answers.
 *
 * The STAGE itself is not derived here: it arrives on every row from the
 * module's read model (EARS-535, #549), so the screen and the bulk act can
 * never disagree about which group a request is in.
 *
 * NOTHING HERE IS A BOUNDARY. Reading is open to every member (EARS-530/534);
 * the acts are re-refused by the module however they are reached (EARS-501).
 */

export type QueueStage = RequestBoardItem['stage']

export type QueueScope = 'active' | 'closed' | 'mine'

/** «В работе» — the owner opens the page to see what is still to be done. */
export const DEFAULT_QUEUE_SCOPE: QueueScope = 'active'

export const QUEUE_SCOPES: readonly { value: QueueScope; label: string }[] = [
  { value: 'active', label: 'В работе' },
  { value: 'closed', label: 'Закрытые' },
  { value: 'mine', label: 'Мои' },
]

/** The row act of a group (EARS-541) — the act's own name, as the API spells it. */
export type QueueAct = 'approve' | 'mark-paid' | 'mark-reimbursed'

export type QueueGroup = {
  stage: QueueStage
  title: string
  /** What the group means, in the owner's words — the prototype's group hint. */
  hint: string
  act: QueueAct | null
  collapsedByDefault: boolean
}

export const QUEUE_GROUPS: Record<QueueStage, QueueGroup> = {
  decide: {
    stage: 'decide',
    title: 'Ждёт решения',
    hint: 'одобрить или отклонить; после одобрения уходит в «К оплате»',
    act: 'approve',
    collapsedByDefault: false,
  },
  pay: {
    stage: 'pay',
    title: 'К оплате',
    hint: 'одобрено или уже оплачено с карты компании — осталось отметить оплату',
    act: 'mark-paid',
    collapsedByDefault: false,
  },
  reimburse: {
    stage: 'reimburse',
    title: 'Вернуть сотруднику',
    hint: 'человек заплатил сам; компания ему должна',
    act: 'mark-reimbursed',
    collapsedByDefault: false,
  },
  draft: {
    stage: 'draft',
    title: 'Черновики',
    hint: 'автор ещё не отправил',
    act: null,
    collapsedByDefault: true,
  },
  paid: { stage: 'paid', title: 'Оплачено', hint: '', act: null, collapsedByDefault: false },
  refused: { stage: 'refused', title: 'Отклонено', hint: '', act: null, collapsedByDefault: false },
  cancelled: {
    stage: 'cancelled',
    title: 'Отменено',
    hint: '',
    act: null,
    collapsedByDefault: false,
  },
}

export const ACTIVE_STAGES: readonly QueueStage[] = ['decide', 'pay', 'reimburse', 'draft']
export const CLOSED_STAGES: readonly QueueStage[] = ['paid', 'refused', 'cancelled']

/** The three sums above the groups (EARS-537), in the order the prototype puts them. */
export const QUEUE_KPIS: readonly { stage: QueueStage; label: string }[] = [
  { stage: 'decide', label: 'Ждёт решения' },
  { stage: 'pay', label: 'К оплате' },
  { stage: 'reimburse', label: 'Вернуть сотрудникам' },
]

/**
 * The groups the page shows, in order (EARS-536). A clicked sum narrows the
 * page to its own group whatever the scope (EARS-537) — the sums are computed
 * over every request, so the group they name is always the one shown.
 */
export function queueGroupStages(scope: QueueScope, kpi: QueueStage | null): QueueStage[] {
  if (kpi !== null) return [kpi]
  if (scope === 'active') return [...ACTIVE_STAGES]
  if (scope === 'closed') return [...CLOSED_STAGES]
  return [...ACTIVE_STAGES, ...CLOSED_STAGES]
}

// ── the display currency (EARS-549/551) ─────────────────────────────────────

export const DISPLAY_CURRENCIES: readonly { code: DisplayCurrencyCode; symbol: string }[] = [
  { code: 'RUB', symbol: '₽' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
]

/** ₽ by default (EARS-549). */
export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrencyCode = 'RUB'

/** Where this browser remembers the viewer's choice — per viewer, nothing else. */
export const DISPLAY_CURRENCY_STORAGE_KEY = 'bbm.finance.requests.displayCurrency'

/** A stored value the switch does not offer is not a choice the viewer made. */
export function parseStoredDisplayCurrency(stored: string | null): DisplayCurrencyCode {
  return (
    DISPLAY_CURRENCIES.find((option) => option.code === stored)?.code ?? DEFAULT_DISPLAY_CURRENCY
  )
}

export function displaySymbol(code: DisplayCurrencyCode): string {
  return DISPLAY_CURRENCIES.find((option) => option.code === code)?.symbol ?? code
}

/** A sum in the display currency: rounded once, plus how many rows had no rate. */
export type QueueSum = {
  /** Minor units of the display currency; `null` when NO row could be converted. */
  amount: bigint | null
  count: number
  /** Rows left out for want of a rate (EARS-551) — never counted as zero. */
  missing: number
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

/**
 * EARS-549: sums add the EXACT converted values and round once, at display.
 * Each row's `numerator / denominator` is the unrounded value; the fraction is
 * reduced after each addition so a long group does not grow its denominator.
 */
export function sumInDisplay(
  rows: readonly RequestBoardItem[],
  currency: DisplayCurrencyCode,
): QueueSum {
  let numerator = 0n
  let denominator = 1n
  let converted = 0
  let missing = 0
  for (const row of rows) {
    const shown = row.display[currency]
    if (shown.kind !== 'converted') {
      missing += 1
      continue
    }
    const n = BigInt(shown.numerator)
    const d = BigInt(shown.denominator)
    numerator = numerator * d + n * denominator
    denominator *= d
    const divisor = gcd(numerator, denominator)
    if (divisor > 1n) {
      numerator /= divisor
      denominator /= divisor
    }
    converted += 1
  }
  return {
    amount: converted === 0 && missing > 0 ? null : roundExact({ numerator, denominator }),
    count: rows.length,
    missing,
  }
}

/** The three sums (EARS-537) — over EVERY request, never the searched or filtered rows. */
export function queueKpis(
  requests: readonly RequestBoardItem[],
  currency: DisplayCurrencyCode,
): { stage: QueueStage; label: string; sum: QueueSum }[] {
  return QUEUE_KPIS.map(({ stage, label }) => ({
    stage,
    label,
    sum: sumInDisplay(
      requests.filter((request) => request.stage === stage),
      currency,
    ),
  }))
}

function russianPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** «1 заявка», «3 заявки», «11 заявок». */
export function requestCountLabel(count: number): string {
  return `${count} ${russianPlural(count, 'заявка', 'заявки', 'заявок')}`
}

/** EARS-551: «без 1 заявки», «без 2 заявок»; nothing when nothing was left out. */
export function missingRateNote(missing: number): string | null {
  if (missing === 0) return null
  return `без ${missing} ${russianPlural(missing, 'заявки', 'заявок', 'заявок')}`
}

function groupedMoney(minor: bigint, precision: number): string {
  const negative = minor < 0n
  const digits = (negative ? -minor : minor).toString().padStart(precision + 1, '0')
  const integer = precision === 0 ? digits : digits.slice(0, digits.length - precision)
  const fraction = precision === 0 ? '' : `,${digits.slice(digits.length - precision)}`
  return `${negative ? '−' : ''}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction}`
}

/**
 * A display amount as text: «12 500,00 ₽», «41,24 $». ONE RULE for every amount
 * and every sum on the page — always the currency's two decimals — so the
 * digits of a column stand under each other (review of #562, UX 6).
 */
export function formatDisplayMoney(
  minor: bigint,
  currency: DisplayCurrencyCode,
  precision = 2,
): string {
  return `${groupedMoney(minor, precision)} ${displaySymbol(currency)}`
}

/**
 * The request's ORIGINAL amount, under the converted one: the same ₽ / $ / €
 * the converted amount uses for the three switch currencies, the code for any
 * other («30,000000 USDC») — never «RUB» next to «₽» (review of #562, UX 7).
 */
export function formatOriginalMoney(amount: string, currency: string, precision: number): string {
  const symbol = DISPLAY_CURRENCIES.find((option) => option.code === currency)?.symbol ?? currency
  return `${groupedMoney(BigInt(amount), precision)} ${symbol}`
}

/**
 * EARS-552: the stored rates are stale once the newest is more than three days
 * older than today; with none stored at all the page says so too.
 */
export function rateStaleness(
  latest: string | null,
  today: string,
): { kind: 'stale'; since: string } | { kind: 'none' } | null {
  if (latest === null) return { kind: 'none' }
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / 86_400_000
  return age > 3 ? { kind: 'stale', since: latest } : null
}

// ── the row (EARS-538) ──────────────────────────────────────────────────────

const MOSCOW_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function moscowDay(instant: Date): number {
  return Date.parse(`${MOSCOW_DATE.format(instant)}T00:00:00Z`) / 86_400_000
}

/** How long ago a request was filed, in Moscow calendar days (EARS-538). */
export function requestAge(createdAt: string, now: Date): { days: number; label: string } {
  const days = Math.max(0, moscowDay(now) - moscowDay(new Date(createdAt)))
  if (days === 0) return { days, label: 'сегодня' }
  if (days === 1) return { days, label: 'вчера' }
  return { days, label: `${days} дн. назад` }
}

/** Older than two weeks in an active group — the corpus's «потерялась в канале». */
export const QUEUE_OVERDUE_DAYS = 14

export function isOverdue(stage: QueueStage, days: number): boolean {
  return days > QUEUE_OVERDUE_DAYS && ACTIVE_STAGES.includes(stage)
}

/**
 * «Кому платим» (EARS-538): the member a `personal_funds` request is owed to,
 * otherwise the counterparty, otherwise the member, otherwise «—» — with
 * «заплатил(а) сам(а)» under a member who paid.
 */
export function queuePayee(request: RequestBoardItem): { name: string; paidSelf: boolean } {
  if (request.personalFunds) {
    return { name: request.memberName ?? request.createdByName ?? '—', paidSelf: true }
  }
  return {
    name: request.counterparty?.name ?? request.memberName ?? '—',
    paidSelf: false,
  }
}

/** The row's primary act (EARS-541) — for the approve role only. */
export function queueRowAct(stage: QueueStage, canApprove: boolean): QueueAct | null {
  if (!canApprove) return null
  return QUEUE_GROUPS[stage].act
}

/**
 * What the row is called (review of #562, UX 2–3). The bold line is what the
 * AUTHOR wrote — the first line of the note, the thing a reader recognises a
 * request by — because the purpose is nearly always the same few names and
 * leaves the rows indistinguishable; without a note the purpose stands in. The
 * muted line under it carries the request's number, the «№N» the toasts and
 * the search use, and the purpose when the note took the bold line.
 */
export function queueRowTitle(request: RequestBoardItem): { title: string; subtitle: string } {
  const purpose = requestPurposeLabel(request)
  const written = request.note
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '')
  const number = `№${request.id}`
  if (written === undefined) return { title: purpose, subtitle: number }
  return { title: written, subtitle: purpose === '—' ? number : `${number} · ${purpose}` }
}

/**
 * What closed a request — what an archive row is read for (review of #562,
 * UX 5): the day the money moved for «Оплачено» (the posting's date, else the
 * request's own), the reason for «Отклонено». Nothing for any other stage.
 */
export type QueueOutcome = { kind: 'paid'; date: string } | { kind: 'refused'; reason: string }

export function queueOutcome(request: RequestBoardItem): QueueOutcome | null {
  if (request.stage === 'paid') {
    const date = request.operation?.occurredOn ?? request.occurredOn
    return date === null ? null : { kind: 'paid', date }
  }
  if (request.stage === 'refused' && request.refusalReason !== null) {
    return { kind: 'refused', reason: request.refusalReason }
  }
  return null
}

/** «новая»: filed in the last 24 hours, so the newest submission is found at a glance. */
export const QUEUE_NEW_HOURS = 24

export function isNewRequest(createdAt: string, now: Date): boolean {
  const age = now.getTime() - Date.parse(createdAt)
  return age >= 0 && age <= QUEUE_NEW_HOURS * 3_600_000
}

/** The «новая» mark is for the work still to do — a closed request filed today is not news. */
export function isNewInQueue(request: RequestBoardItem, now: Date): boolean {
  return ACTIVE_STAGES.includes(request.stage) && isNewRequest(request.createdAt, now)
}

/** A group heading's «1 новая», «2 новые», «5 новых» — for a group whose rows are folded away. */
export function newCountLabel(count: number): string {
  return `${count} ${russianPlural(count, 'новая', 'новые', 'новых')}`
}

// ── search and filters (EARS-540) ───────────────────────────────────────────

export type QueuePeriod = 'all' | '7' | '30' | '90'

export const QUEUE_PERIODS: readonly { value: QueuePeriod; label: string }[] = [
  { value: 'all', label: 'За всё время' },
  { value: '7', label: 'За 7 дней' },
  { value: '30', label: 'За 30 дней' },
  { value: '90', label: 'За 90 дней' },
]

export type QueueFilters = {
  query: string
  /** The submitter's member id, or null for everyone. */
  author: number | null
  project: number | null
  period: QueuePeriod
}

export const EMPTY_QUEUE_FILTERS: QueueFilters = {
  query: '',
  author: null,
  project: null,
  period: 'all',
}

/**
 * The search of EARS-540: «№N» (or «#N») is the request NUMBER, exactly — the
 * number the row shows; any other text is a case-insensitive substring of the
 * submitter, the payee, the member, the purpose, the note, the project and the
 * product.
 */
export function matchesQueueSearch(request: RequestBoardItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('ru-RU')
  if (needle === '') return true
  const number = /^[#№]\s*(\d+)$/.exec(needle)
  if (number !== null) return request.id === Number(number[1])
  const haystack = [
    `#${request.id}`,
    `№${request.id}`,
    request.createdByName,
    request.counterparty?.name,
    request.memberName,
    requestPurposeLabel(request),
    request.note,
    request.project.name,
    request.product?.name,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join('\n')
    .toLocaleLowerCase('ru-RU')
  return haystack.includes(needle)
}

/** The rows a scope and the filters keep (EARS-536 «Мои», EARS-540). */
export function filterQueueRows(
  rows: readonly RequestBoardItem[],
  filters: QueueFilters,
  { scope, now }: { scope: QueueScope; now: Date },
): RequestBoardItem[] {
  const since =
    filters.period === 'all' ? null : now.getTime() - Number(filters.period) * 86_400_000
  return rows.filter(
    (request) =>
      (scope !== 'mine' || request.own) &&
      (filters.author === null || request.createdBy === filters.author) &&
      (filters.project === null || request.project.id === filters.project) &&
      (since === null || Date.parse(request.createdAt) >= since) &&
      matchesQueueSearch(request, filters.query),
  )
}

// ── the order (EARS-539) ────────────────────────────────────────────────────

export type QueueSortKey = 'filed' | 'author' | 'payee' | 'purpose' | 'amount'
export type QueueSort = { key: QueueSortKey; desc: boolean }

/** Newest submission first (EARS-536). */
export const DEFAULT_QUEUE_SORT: QueueSort = { key: 'filed', desc: true }

const COLLATOR = new Intl.Collator('ru-RU', { sensitivity: 'base', numeric: true })

type ConvertedDisplay = Extract<QueueDisplayAmount, { kind: 'converted' }>

/** The displayed amount as an exact value, or null when it has no rate. */
function displayedValue(
  request: RequestBoardItem,
  currency: DisplayCurrencyCode,
): ConvertedDisplay | null {
  const shown = request.display[currency]
  return shown.kind === 'converted' ? shown : null
}

function compareExact(left: ConvertedDisplay, right: ConvertedDisplay): number {
  const difference =
    BigInt(left.numerator) * BigInt(right.denominator) -
    BigInt(right.numerator) * BigInt(left.denominator)
  return difference === 0n ? 0 : difference < 0n ? -1 : 1
}

/** Newest request first — every tie breaks this way (EARS-539). */
function newestFirst(left: RequestBoardItem, right: RequestBoardItem): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id - left.id
}

/**
 * EARS-539: one order for every group. «Сумма» sorts by the DISPLAYED,
 * converted amount; a row with no rate has no displayed amount and goes after
 * every converted one in both directions — there is no value to place it by.
 */
export function sortQueueRows(
  rows: readonly RequestBoardItem[],
  sort: QueueSort,
  currency: DisplayCurrencyCode,
): RequestBoardItem[] {
  const direction = sort.desc ? -1 : 1
  return rows.slice().sort((left, right) => {
    let order = 0
    switch (sort.key) {
      case 'filed':
        order = direction * left.createdAt.localeCompare(right.createdAt)
        break
      case 'author':
        order = direction * COLLATOR.compare(left.createdByName ?? '', right.createdByName ?? '')
        break
      case 'payee':
        order = direction * COLLATOR.compare(queuePayee(left).name, queuePayee(right).name)
        break
      case 'purpose':
        order = direction * COLLATOR.compare(queueRowTitle(left).title, queueRowTitle(right).title)
        break
      case 'amount': {
        const a = displayedValue(left, currency)
        const b = displayedValue(right, currency)
        if (a === null || b === null) {
          order = a === null && b === null ? 0 : a === null ? 1 : -1
        } else {
          order = direction * compareExact(a, b)
        }
        break
      }
    }
    return order || newestFirst(left, right)
  })
}

/** The rows of one group, in the page's order. */
export function queueGroupRows(
  rows: readonly RequestBoardItem[],
  stage: QueueStage,
  sort: QueueSort,
  currency: DisplayCurrencyCode,
): RequestBoardItem[] {
  return sortQueueRows(
    rows.filter((request) => request.stage === stage),
    sort,
    currency,
  )
}

/** The submitters the author filter offers — everyone who filed a request, by name. */
export function queueAuthors(
  requests: readonly RequestBoardItem[],
): { id: number; name: string }[] {
  const byId = new Map<number, string>()
  for (const request of requests) {
    if (request.createdBy !== undefined) {
      byId.set(request.createdBy, request.createdByName ?? `Участник #${request.createdBy}`)
    }
  }
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => COLLATOR.compare(left.name, right.name))
}
