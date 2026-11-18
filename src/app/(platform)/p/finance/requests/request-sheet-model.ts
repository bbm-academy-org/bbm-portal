import { z } from 'zod'

import { formatDate, formatDateTime } from './constants'
import type {
  DisplayCurrencyCode,
  RequestBoardItem,
  RequestBoardReferences,
} from './request-board-contract'
import { currencyPrecision, documentUploadRefusal } from './request-board-model'
import { fromMinorUnits, toMinorUnits } from './request-form-model'
import {
  DISPLAY_CURRENCIES,
  formatDisplayMoney,
  formatOriginalMoney,
  QUEUE_GROUPS,
  type QueueStage,
} from './request-queue-model'

/**
 * THE DETAILS SHEET OF THE OWNER'S QUEUE — spec 339 §I EARS-542…548 and §J
 * EARS-563, issue #551 — as pure data: which acts a request offers, what «Как
 * оплатить» says, the timeline, the header's rate note, the «Курс против
 * рынка» block and the three forms (mark paid, mark reimbursed, the bulk
 * dialog). The sheet renders the answers and decides nothing.
 *
 * ONE SOURCE FOR THE STAGE. Every branch below reads `request.stage` — the
 * EARS-535 reading the module derives on the server (`deriveExpenseRequestStage`,
 * #549) and the queue groups its rows by — and never re-derives it from status
 * and flags, so the sheet, the queue and the §J block cannot disagree about
 * where a request is (lead note on #551).
 *
 * NOTHING HERE IS A BOUNDARY. An act offered here is refused by the module to
 * anyone without the role however it is reached (EARS-501), and every money
 * rule (the required refund, the write order, the snapshot) is re-checked on
 * the server, whose refusal the form shows verbatim.
 */

// ── the acts (EARS-542) ─────────────────────────────────────────────────────

/** An act the sheet can start. `approve-and-pay` opens the mark-paid form on a `decide` request. */
export type SheetAct =
  | 'approve'
  | 'approve-and-pay'
  | 'mark-paid'
  | 'mark-reimbursed'
  | 'refuse'
  | 'revoke'
  | 'submit'
  | 'cancel'
  | 'edit'

export type SheetActButton = {
  act: SheetAct
  label: string
  /** `default` is the stage's primary act — one per sheet at most. */
  variant: 'default' | 'outline' | 'destructive'
}

const PAY_ACT: SheetActButton = { act: 'mark-paid', label: 'Отметить оплату', variant: 'default' }
const REIMBURSE_ACT: SheetActButton = {
  act: 'mark-reimbursed',
  label: 'Отметить возврат',
  variant: 'default',
}

/**
 * The acts of the request's stage, in the prototype's order: the primary act,
 * then its alternatives, then the author's own acts. `Отклонить` refuses a
 * request nobody approved yet; `Отозвать` revokes an approval that has not
 * posted (both need a reason, EARS-512/542). A posted request offers no money
 * act — the ledger is immutable — and its only act is attaching the receipt,
 * which lives in the files block, not here.
 */
export function sheetActs(
  request: RequestBoardItem,
  permissions: { canApprove: boolean },
): SheetActButton[] {
  const acts: SheetActButton[] = []
  if (permissions.canApprove && request.snapshot !== null) {
    const refuse: SheetActButton | null =
      request.status === 'submitted'
        ? { act: 'refuse', label: 'Отклонить', variant: 'destructive' }
        : request.status === 'approved'
          ? { act: 'revoke', label: 'Отозвать', variant: 'destructive' }
          : null
    switch (request.stage) {
      case 'decide':
        acts.push(
          { act: 'approve', label: 'Одобрить', variant: 'default' },
          { act: 'approve-and-pay', label: 'Одобрить и отметить оплату', variant: 'outline' },
        )
        break
      case 'pay':
        acts.push(PAY_ACT)
        break
      case 'reimburse':
        acts.push(REIMBURSE_ACT)
        break
      default:
        break
    }
    if (refuse !== null && ['decide', 'pay', 'reimburse'].includes(request.stage)) acts.push(refuse)
  }
  if (request.own && request.status === 'draft') {
    acts.push({
      act: 'submit',
      label: 'Подать',
      variant: acts.length === 0 ? 'default' : 'outline',
    })
  }
  if (request.own && request.status === 'submitted') {
    acts.push({ act: 'cancel', label: 'Отменить заявку', variant: 'outline' })
  }
  if (request.own && (request.status === 'draft' || request.status === 'submitted')) {
    acts.push({ act: 'edit', label: 'Редактировать', variant: 'outline' })
  }
  return acts
}

/** Which form an act opens inside the sheet; `null` — it runs at once. */
export type SheetForm = 'mark-paid' | 'mark-reimbursed' | 'refuse' | 'revoke'

export function sheetFormOf(act: SheetAct): SheetForm | null {
  switch (act) {
    case 'approve-and-pay':
    case 'mark-paid':
      return 'mark-paid'
    case 'mark-reimbursed':
    case 'refuse':
    case 'revoke':
      return act
    default:
      return null
  }
}

/** The form the board's drag (or a queue row act) asks the sheet to open with. */
export function initialSheetForm(
  request: RequestBoardItem,
  requested: 'pay' | 'refuse' | null,
  permissions: { canApprove: boolean },
): SheetForm | null {
  if (requested === null) return null
  const acts = sheetActs(request, permissions).map((button) => button.act)
  if (requested === 'refuse') {
    if (acts.includes('refuse')) return 'refuse'
    return acts.includes('revoke') ? 'revoke' : null
  }
  if (acts.includes('mark-reimbursed')) return 'mark-reimbursed'
  return acts.includes('mark-paid') || acts.includes('approve-and-pay') ? 'mark-paid' : null
}

// ── «без чека» (EARS-546) ───────────────────────────────────────────────────

/** A posted request with no attached document — the queue row and the sheet say «без чека». */
export function lacksReceipt(request: Pick<RequestBoardItem, 'status' | 'hasDocument'>): boolean {
  return request.status === 'posted' && !request.hasDocument
}

/** Who may attach to a request: the author or an entry-role holder; after posting, approvers too (EARS-511/545). */
export function mayAttachDocument(
  request: Pick<RequestBoardItem, 'own' | 'status'>,
  permissions: { canEnter: boolean; canApprove: boolean },
): boolean {
  if (request.status === 'posted') {
    return request.own || permissions.canEnter || permissions.canApprove
  }
  if (!request.own && !permissions.canEnter) return false
  return ['draft', 'submitted', 'approved'].includes(request.status)
}

// ── «Как оплатить» (EARS-542) ───────────────────────────────────────────────

/** An `http(s)://` link or a run of 20 digits (a Russian bank account number). */
const PAYMENT_DETAILS = /https?:\/\/|\d{20}/i

export function noteHasPaymentDetails(note: string | null): boolean {
  return note !== null && PAYMENT_DETAILS.test(note)
}

export type HowToPay =
  | {
      kind: 'reimburse'
      member: string
      paidOn: string | null
      /** What is owed back, in the liability currency; `null` while the refund currency is open. */
      due: { amount: string; currency: string } | null
      /** The debt is booked (the request posted) but not yet paid back. */
      booked: boolean
    }
  | { kind: 'details'; source: 'note' | 'document' }
  | { kind: 'missing' }

/**
 * The «Как оплатить» block of an open request (EARS-542). A personal-funds
 * request is a refund to the member; any other is a payment to someone, and
 * the block says whether its details are on the request — in the note or as an
 * attached document — or warns that they are not.
 */
export function howToPay(request: RequestBoardItem): HowToPay | null {
  if (!['decide', 'pay', 'reimburse'].includes(request.stage)) return null
  if (request.personalFunds) {
    return {
      kind: 'reimburse',
      member: request.memberName ?? request.createdByName ?? '—',
      paidOn: request.occurredOn,
      due: refundDue(request),
      booked: request.status === 'posted',
    }
  }
  if (noteHasPaymentDetails(request.note)) return { kind: 'details', source: 'note' }
  if (request.hasDocument) return { kind: 'details', source: 'document' }
  return { kind: 'missing' }
}

/** The fee added to `amount` when it is recorded in the same currency (the shipped fee rule). */
function withFee(request: RequestBoardItem, amount: bigint, currency: string): bigint {
  if (request.feeAmount === null) return amount
  if (request.feeCurrency !== null && request.feeCurrency !== currency) return amount
  return amount + BigInt(request.feeAmount)
}

/**
 * EARS-544's required refund, where the request already fixes it: a booked
 * debt (posted, or a stated `paid_amount`) is refunded in its own currency for
 * `paid_amount` (else `amount`) + fee. An unbooked request refunded in its
 * document currency owes `amount` + fee; in another currency the amount is a
 * fact the act names, so there is nothing to say in advance.
 */
export function refundDue(request: RequestBoardItem): { amount: string; currency: string } | null {
  const fixed = refundCurrencyFixed(request)
  if (fixed !== null) {
    const base = request.paidAmount !== null ? BigInt(request.paidAmount) : BigInt(request.amount)
    return { amount: withFee(request, base, fixed).toString(), currency: fixed }
  }
  return {
    amount: withFee(request, BigInt(request.amount), request.currency).toString(),
    currency: request.currency,
  }
}

/** The refund currency the request fixes — a booked or stated debt — or `null` when it is open. */
export function refundCurrencyFixed(request: RequestBoardItem): string | null {
  if (request.status === 'posted') return request.paidCurrency ?? request.currency
  return request.paidCurrency
}

// ── the header (EARS-542/549/550) ───────────────────────────────────────────

const RATE_REASON: Record<string, string> = {
  unpaid: 'сегодня',
  occurred_on_missing: 'сегодня',
  occurred_on: 'дата траты',
  operation_occurred_on: 'дата оплаты',
}

export type SheetAmount = {
  /** The amount in the display currency, or the original where there is no rate. */
  main: string
  /** «заявлено 100,00 $ · курс ЦБ на 18.11.2026 (сегодня)» — `null` when nothing was converted. */
  note: string | null
}

/** The sheet's big amount and the line under it that says what it was converted from, at what. */
export function sheetAmount(
  request: RequestBoardItem,
  currency: DisplayCurrencyCode,
  references: RequestBoardReferences,
): SheetAmount {
  const original = formatOriginalMoney(
    request.amount,
    request.currency,
    currencyPrecision(references.currencies, request.currency),
  )
  const shown = request.display[currency]
  if (shown.kind === 'no_rate') {
    return { main: original, note: `нет курса ЦБ на ${formatDate(shown.date)}` }
  }
  const main = formatDisplayMoney(BigInt(shown.amount), currency)
  if (shown.basis === 'same_currency') return { main, note: null }
  const how =
    shown.basis === 'cbr'
      ? `курс ЦБ на ${formatDate(shown.rateDate ?? '')}${
          shown.reason === null ? '' : ` (${RATE_REASON[shown.reason] ?? 'сегодня'})`
        }`
      : shown.basis === 'ledger_amount'
        ? 'по сумме списания со счёта'
        : 'по курсу проводки'
  return { main, note: `заявлено ${original} · ${how}` }
}

/** «в т.ч. комиссия 50,00 ₽» — the fee in its own currency, or `null`. */
export function sheetFee(
  request: RequestBoardItem,
  references: RequestBoardReferences,
): string | null {
  if (request.feeAmount === null || BigInt(request.feeAmount) === 0n) return null
  const currency = request.feeCurrency ?? request.paidCurrency ?? request.currency
  return `в т.ч. комиссия ${formatOriginalMoney(
    request.feeAmount,
    currency,
    currencyPrecision(references.currencies, currency),
  )}`
}

// ── the timeline (EARS-542) ─────────────────────────────────────────────────

export type TimelineStep = { label: string; detail: string; done: boolean }

/** An instant as «дд.мм.гггг чч:мм» in Moscow — the register's one format (#517). */
const instant = formatDateTime

/** Подана → Решение → Оплата / Возврат сотруднику, each done or still ahead. */
export function sheetTimeline(request: RequestBoardItem): TimelineStep[] {
  const decided = request.decidedAt ?? null
  const decision: TimelineStep =
    request.status === 'refused'
      ? {
          label: 'Решение',
          detail: ['отклонена', decided === null ? null : instant(decided), request.decidedByName]
            .filter(Boolean)
            .join(' · '),
          done: true,
        }
      : request.status === 'cancelled'
        ? { label: 'Решение', detail: 'заявка отменена автором', done: true }
        : request.status === 'draft'
          ? { label: 'Решение', detail: 'черновик ещё не подан', done: false }
          : decided !== null
            ? {
                label: 'Решение',
                detail: ['одобрена', instant(decided), request.decidedByName]
                  .filter(Boolean)
                  .join(' · '),
                done: true,
              }
            : { label: 'Решение', detail: 'ждёт', done: false }

  const moneyDate = request.operation?.occurredOn ?? request.occurredOn
  let money: TimelineStep
  if (request.personalFunds) {
    money =
      request.stage === 'paid'
        ? { label: 'Возврат сотруднику', detail: 'возвращено', done: true }
        : request.status === 'posted'
          ? {
              label: 'Возврат сотруднику',
              detail: `долг записан ${formatDate(moneyDate ?? '')}, возврат ещё не проведён`,
              done: false,
            }
          : { label: 'Возврат сотруднику', detail: 'ещё нет', done: false }
  } else {
    money =
      request.status === 'posted'
        ? {
            label: 'Оплата',
            detail: [
              moneyDate === null ? 'отмечена' : `оплачено ${formatDate(moneyDate)}`,
              request.postedByName,
              lacksReceipt(request) ? 'без чека' : null,
            ]
              .filter(Boolean)
              .join(' · '),
            done: true,
          }
        : { label: 'Оплата', detail: 'ещё нет', done: false }
  }
  return [{ label: 'Подана', detail: instant(request.createdAt), done: true }, decision, money]
}

/** «Заявка №12 · К оплате» — the sheet's first line. */
export function sheetMeta(request: RequestBoardItem): string {
  return `Заявка №${request.id} · ${QUEUE_GROUPS[request.stage].title}`
}

// ── «Курс против рынка» (EARS-563) ──────────────────────────────────────────

export type MarketLine = { label: 'Рынок' | 'Факт' | 'Переплата'; value: string; note: string }

export type MarketBlockView =
  { kind: 'measured'; lines: MarketLine[]; pending: string | null } | { kind: 'note'; text: string }

function symbolOf(code: string): string {
  return DISPLAY_CURRENCIES.find((option) => option.code === code)?.symbol ?? code
}

/** A CBR quote as «92,00 ₽» — the quote's own decimals, at least two, no trailing zeros past them. */
function rubQuote(valueRub: string): string {
  const [integer, fraction = ''] = valueRub.split('.')
  let digits = fraction.slice(0, 4)
  while (digits.length > 2 && digits.endsWith('0')) digits = digits.slice(0, -1)
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${digits.padEnd(2, '0')} ₽`
}

/**
 * The §J block as text (EARS-563), from the server's figures and the request's
 * EARS-535 stage — the SAME stage the queue groups by, so «после «Отметить
 * возврат»» and «Вернуть сотруднику» are one fact read once. `null` — no block
 * (a same-currency request, or anything outside §J).
 */
export function marketBlockView(
  request: RequestBoardItem,
  currency: DisplayCurrencyCode,
  references: RequestBoardReferences,
): MarketBlockView | null {
  const block = request.market
  if (block === null) return null
  if (block.kind === 'no_rate') {
    return { kind: 'note', text: `нет курса ЦБ на ${formatDate(block.date)}` }
  }
  if (block.kind === 'not_posted') {
    if (block.statedPaidAmount === null) {
      return {
        kind: 'note',
        text: 'факт не внесён — укажите списанную сумму при отметке оплаты',
      }
    }
    return {
      kind: 'note',
      text:
        request.stage === 'reimburse'
          ? 'факт не проведён — появится после «Отметить возврат»'
          : 'факт не проведён — появится после «Отметить оплату»',
    }
  }
  const figures = block.display[currency]
  const money = (minor: string) => formatDisplayMoney(BigInt(minor), currency)
  const signed = (minor: string) => {
    const value = BigInt(minor)
    return value > 0n ? `+${money(minor)}` : money(minor)
  }
  const factOriginal = formatOriginalMoney(
    block.fact.amount,
    block.fact.currency,
    currencyPrecision(references.currencies, block.fact.currency),
  )
  const from =
    block.fact.account === null ? 'с карты сотрудника' : `со счёта «${block.fact.account}»`
  const fee =
    block.fact.fee === null
      ? null
      : `в т.ч. комиссия ${formatOriginalMoney(
          block.fact.fee.amount,
          block.fact.fee.currency,
          currencyPrecision(references.currencies, block.fact.fee.currency),
        )}`
  const rate = `курс ЦБ на ${formatDate(block.rate.rateDate)} · ${block.rate.nominal} ${block.rate.currency} = ${rubQuote(block.rate.valueRub)}`
  const noDisplay = `нет курса ${symbolOf(currency)} на ${formatDate(block.date)}`
  const lines: MarketLine[] = [
    { label: 'Рынок', value: figures === null ? '—' : money(figures.market), note: rate },
    {
      label: 'Факт',
      value: figures === null ? factOriginal : money(figures.fact),
      note: [figures === null || block.fact.currency === currency ? null : factOriginal, from, fee]
        .filter(Boolean)
        .join(' · '),
    },
    {
      label: 'Переплата',
      value: figures === null ? noDisplay : signed(figures.overpayment),
      note: block.wording,
    },
  ]
  return {
    kind: 'measured',
    lines,
    // A posted personal-funds request still owed back (stage «Вернуть
    // сотруднику»): Факт is the debt as booked, and the refund is still ahead.
    pending:
      request.stage === 'reimburse'
        ? 'Долг сотруднику записан, но ещё не возвращён — Факт равен записанному долгу; возврат делается в его валюте.'
        : null,
  }
}

// ── the mark-paid form (EARS-543) ───────────────────────────────────────────

export type MarkPaidFormValue = {
  occurredOn: string
  accountId: string
  paidAmount: string
}

function accountOf(references: RequestBoardReferences, accountId: string) {
  return references.accounts.find((account) => String(account.id) === accountId) ?? null
}

/**
 * The debited-amount field for the chosen account: the request's own amount,
 * shown and not sent, when the currencies match (one currency, one
 * authoritative amount — EARS-505); the account-side amount, asked, when they
 * differ (EARS-543 — never computed from a rate).
 */
export function debitedAmountMode(
  request: RequestBoardItem,
  references: RequestBoardReferences,
  accountId: string,
): { mode: 'none' } | { mode: 'same'; value: string } | { mode: 'asked'; currency: string } {
  const account = accountOf(references, accountId)
  if (account === null) return { mode: 'none' }
  if (account.currency === request.currency) {
    return {
      mode: 'same',
      value: formatOriginalMoney(
        request.amount,
        request.currency,
        currencyPrecision(references.currencies, request.currency),
      ),
    }
  }
  return { mode: 'asked', currency: account.currency }
}

/** Everything the request already says, pre-filled (EARS-543): the date money moved, its account, its stated debit. */
export function markPaidDefaults(
  request: RequestBoardItem,
  references: RequestBoardReferences,
  today: string,
): MarkPaidFormValue {
  const account =
    request.account !== null && references.accounts.some((row) => row.id === request.account!.id)
      ? String(request.account.id)
      : ''
  const accountCurrency = accountOf(references, account)?.currency ?? null
  const paidAmount =
    request.paidAmount !== null &&
    request.paidCurrency !== null &&
    request.paidCurrency === accountCurrency
      ? fromMinorUnits(
          request.paidAmount,
          currencyPrecision(references.currencies, request.paidCurrency),
        )
      : ''
  return {
    occurredOn: request.alreadyPaid && request.occurredOn !== null ? request.occurredOn : today,
    accountId: account,
    paidAmount,
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function createMarkPaidSchema(
  request: RequestBoardItem,
  references: RequestBoardReferences,
) {
  return z
    .object({ occurredOn: z.string(), accountId: z.string(), paidAmount: z.string() })
    .superRefine((value, context) => {
      if (!ISO_DATE.test(value.occurredOn)) {
        context.addIssue({
          code: 'custom',
          path: ['occurredOn'],
          message: 'Укажите дату, когда ушли деньги.',
        })
      }
      if (accountOf(references, value.accountId) === null) {
        context.addIssue({
          code: 'custom',
          path: ['accountId'],
          message: 'Выберите счёт, с которого ушли деньги.',
        })
        return
      }
      const mode = debitedAmountMode(request, references, value.accountId)
      if (mode.mode !== 'asked') return
      if (
        toMinorUnits(value.paidAmount, currencyPrecision(references.currencies, mode.currency)) ===
        null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['paidAmount'],
          message: `Счёт в ${mode.currency}, заявка в ${request.currency}: укажите сумму, фактически списанную со счёта, в ${mode.currency}.`,
        })
      }
    })
}

export type MarkPaidBody = {
  act: 'mark-paid'
  snapshot: string
  occurredOn: string
  accountId: number
  paidAmount?: string
  paidCurrency?: string
}

/** The validated form as the act endpoint's body — with the list row's EARS-548 token. */
export function toMarkPaidBody(
  value: MarkPaidFormValue,
  request: RequestBoardItem,
  references: RequestBoardReferences,
): MarkPaidBody {
  const account = accountOf(references, value.accountId)!
  const body: MarkPaidBody = {
    act: 'mark-paid',
    snapshot: request.snapshot ?? '',
    occurredOn: value.occurredOn,
    accountId: account.id,
  }
  if (account.currency !== request.currency) {
    body.paidAmount =
      toMinorUnits(value.paidAmount, currencyPrecision(references.currencies, account.currency)) ??
      ''
    body.paidCurrency = account.currency
  }
  return body
}

// ── the mark-reimbursed form (EARS-544) ─────────────────────────────────────

export type ReimburseFormValue = {
  occurredOn: string
  accountId: string
  amount: string
}

/** The accounts a refund may leave: any, or only those in the currency the debt already has. */
export function refundAccounts(
  request: RequestBoardItem,
  references: RequestBoardReferences,
): RequestBoardReferences['accounts'] {
  const fixed = refundCurrencyFixed(request)
  return fixed === null
    ? references.accounts
    : references.accounts.filter((account) => account.currency === fixed)
}

/**
 * The refund amount for the chosen account: prefilled with EARS-544's required
 * sum where the request fixes it (a booked or stated debt, or a refund in the
 * document currency); asked where the refund crosses currencies.
 */
export function refundPrefill(
  request: RequestBoardItem,
  references: RequestBoardReferences,
  accountId: string,
): string {
  const account = accountOf(references, accountId)
  if (account === null) return ''
  const due = refundDue(request)
  if (due === null || due.currency !== account.currency) return ''
  return fromMinorUnits(due.amount, currencyPrecision(references.currencies, due.currency))
}

export function reimburseDefaults(
  request: RequestBoardItem,
  references: RequestBoardReferences,
  today: string,
): ReimburseFormValue {
  const accounts = refundAccounts(request, references)
  const accountId = accounts.length === 1 ? String(accounts[0].id) : ''
  return { occurredOn: today, accountId, amount: refundPrefill(request, references, accountId) }
}

export function createReimburseSchema(
  request: RequestBoardItem,
  references: RequestBoardReferences,
) {
  return z
    .object({ occurredOn: z.string(), accountId: z.string(), amount: z.string() })
    .superRefine((value, context) => {
      if (!ISO_DATE.test(value.occurredOn)) {
        context.addIssue({
          code: 'custom',
          path: ['occurredOn'],
          message: 'Укажите дату возврата.',
        })
      }
      const account = refundAccounts(request, references).find(
        (row) => String(row.id) === value.accountId,
      )
      if (account === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['accountId'],
          message: 'Выберите счёт, с которого вернули деньги.',
        })
        return
      }
      if (
        toMinorUnits(value.amount, currencyPrecision(references.currencies, account.currency)) ===
        null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['amount'],
          message: `Укажите сумму возврата в ${account.currency}.`,
        })
      }
    })
}

export type ReimburseBody = {
  act: 'mark-reimbursed'
  snapshot: string
  occurredOn: string
  accountId: number
  amount: string
}

export function toReimburseBody(
  value: ReimburseFormValue,
  request: RequestBoardItem,
  references: RequestBoardReferences,
): ReimburseBody {
  const account = accountOf(references, value.accountId)!
  return {
    act: 'mark-reimbursed',
    snapshot: request.snapshot ?? '',
    occurredOn: value.occurredOn,
    accountId: account.id,
    amount:
      toMinorUnits(value.amount, currencyPrecision(references.currencies, account.currency)) ?? '',
  }
}

// ── the receipt the forms may carry (EARS-543/544: optional) ───────────────

/** Null — the chosen file may be sent; otherwise the refusal to show under the field. */
export function receiptRefusal(file: File | null): string | null {
  return file === null ? null : documentUploadRefusal(file)
}

// ── the bulk dialog (EARS-547/548) ──────────────────────────────────────────

export type BulkGroup = 'pay' | 'reimburse'

/** «Отметить все N как оплаченные…» — on «К оплате» / «Вернуть сотруднику», two rows or more, the approve role. */
export function bulkGroupOf(
  stage: QueueStage,
  rows: readonly RequestBoardItem[],
  canApprove: boolean,
): BulkGroup | null {
  if (!canApprove || rows.length < 2) return null
  if (stage !== 'pay' && stage !== 'reimburse') return null
  return rows.every((row) => row.snapshot !== null) ? stage : null
}

export function bulkLabel(count: number): string {
  return `Отметить все ${count} как оплаченные…`
}

export type BulkPreview = {
  planned: { id: number; occurredOn: string }[]
  excluded: { id: number; reason: string }[]
}

export type BulkBody = {
  group: BulkGroup
  accountId: number
  occurredOn?: string
  items: { id: number; snapshot: string }[]
  preview: boolean
}

/** The explicit rows the dialog showed, with their tokens — never «everything in the group». */
export function toBulkBody(
  group: BulkGroup,
  rows: readonly RequestBoardItem[],
  input: { accountId: number; occurredOn: string },
  preview: boolean,
): BulkBody {
  return {
    group,
    accountId: input.accountId,
    ...(ISO_DATE.test(input.occurredOn) ? { occurredOn: input.occurredOn } : {}),
    items: rows.map((row) => ({ id: row.id, snapshot: row.snapshot ?? '' })),
    preview,
  }
}

/** The planned rows in posting order (oldest first, as the server planned them), with the rows they are. */
export function bulkPlannedRows(
  preview: BulkPreview,
  rows: readonly RequestBoardItem[],
): { request: RequestBoardItem; occurredOn: string }[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  return preview.planned.flatMap(({ id, occurredOn }) => {
    const request = byId.get(id)
    return request === undefined ? [] : [{ request, occurredOn }]
  })
}

/** The toast after a confirmed batch: what posted, what was left out. */
export function bulkResultMessage(result: { posted: unknown[]; excluded: unknown[] }): string {
  const posted = result.posted.length
  const excluded = result.excluded.length
  return excluded === 0
    ? `Отмечено оплаченными: ${posted}.`
    : `Отмечено оплаченными: ${posted}, исключено: ${excluded}.`
}
