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
  if (permissions.canApprove) {
    // The money acts carry the EARS-548 token of the LIST row; a row without
    // one (a reader the list did not give it to) is offered none of them.
    const token = request.snapshot !== null
    const refuse: SheetActButton | null =
      request.status === 'submitted'
        ? { act: 'refuse', label: 'Отклонить', variant: 'destructive' }
        : request.status === 'approved'
          ? { act: 'revoke', label: 'Отозвать', variant: 'destructive' }
          : null
    switch (request.stage) {
      case 'decide':
        acts.push({ act: 'approve', label: 'Одобрить', variant: 'default' })
        if (token) {
          acts.push({
            act: 'approve-and-pay',
            label: 'Одобрить и отметить оплату',
            variant: 'outline',
          })
        }
        break
      case 'pay':
        if (token) acts.push(PAY_ACT)
        break
      case 'reimburse':
        if (token) acts.push(REIMBURSE_ACT)
        break
      default:
        break
    }
    if (refuse !== null && ['decide', 'pay', 'reimburse'].includes(request.stage)) {
      acts.push(refuse)
    }
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

type Money = { amount: string; currency: string }

/**
 * What is owed back, in the currency the «Отметить возврат» form asks for
 * (EARS-544). `fixed` — the form asks exactly this sum in this currency: a
 * booked or stated debt, or a refund whose every account is in the document
 * currency; `original` is the request's own sum when it is in another one.
 * `by-account` — the currency follows the chosen account: from an account in
 * the document currency the refund is `same`, from any other it is the amount
 * actually debited — a fact the act names, never computed from a rate.
 */
export type RefundDue =
  | { kind: 'fixed'; due: Money; original: Money | null }
  | { kind: 'by-account'; same: Money | null; original: Money }

export type HowToPay =
  | {
      kind: 'reimburse'
      member: string
      paidOn: string | null
      refund: RefundDue
      /** The debt is booked (the request posted) but not yet paid back. */
      booked: boolean
    }
  | { kind: 'details'; source: 'note' | 'document' }
  /** Money already left a company account (`already_paid`): nothing to ask the author for. */
  | { kind: 'paid'; paidOn: string | null }
  | { kind: 'missing' }

/**
 * The «Как оплатить» block of an open request (EARS-542). A personal-funds
 * request is a refund to the member. Any other is a payment to someone — but
 * only while the owner still has to pay it (`decide` / `pay`, not yet paid):
 * then the block says whether its details are on the request — in the note or
 * as an attached document — or warns that they are not. A request filed as
 * already paid is never asked for details; it only waits for its marking.
 */
export function howToPay(
  request: RequestBoardItem,
  references: RequestBoardReferences,
): HowToPay | null {
  if (!['decide', 'pay', 'reimburse'].includes(request.stage)) return null
  if (request.personalFunds) {
    return {
      kind: 'reimburse',
      member: request.memberName ?? request.createdByName ?? '—',
      paidOn: request.occurredOn,
      refund: refundOwed(request, references),
      booked: request.status === 'posted',
    }
  }
  if (request.status === 'posted' || !['decide', 'pay'].includes(request.stage)) return null
  if (request.alreadyPaid) return { kind: 'paid', paidOn: request.occurredOn }
  if (noteHasPaymentDetails(request.note)) return { kind: 'details', source: 'note' }
  if (request.hasDocument) return { kind: 'details', source: 'document' }
  return { kind: 'missing' }
}

/** EARS-544's refund as «Как оплатить» states it — see `RefundDue`. */
export function refundOwed(
  request: RequestBoardItem,
  references: RequestBoardReferences,
): RefundDue {
  const original = {
    amount: withFee(request, BigInt(request.amount), request.currency).toString(),
    currency: request.currency,
  }
  const fixed = refundCurrencyFixed(request)
  if (fixed !== null) {
    const due = refundDue(request)!
    return { kind: 'fixed', due, original: due.currency === request.currency ? null : original }
  }
  const currencies = new Set(refundAccounts(request, references).map((row) => row.currency))
  if (currencies.size === 1 && currencies.has(request.currency)) {
    return { kind: 'fixed', due: original, original: null }
  }
  return {
    kind: 'by-account',
    same: currencies.has(request.currency) ? original : null,
    original,
  }
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

/** «комиссия 50,00 ₽» — the fee recorded with the spend, in its own currency, or `null`. */
export function sheetFee(
  request: RequestBoardItem,
  references: RequestBoardReferences,
): string | null {
  if (request.feeAmount === null || BigInt(request.feeAmount) === 0n) return null
  const currency = request.feeCurrency ?? request.paidCurrency ?? request.currency
  return `комиссия ${formatOriginalMoney(
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
      // The act that will name the fact is the stage's own: in «Вернуть
      // сотруднику» it is «Отметить возврат», whose refund sum is the fact.
      return {
        kind: 'note',
        text:
          request.stage === 'reimburse'
            ? 'факт не внесён — укажите сумму возврата при «Отметить возврат»'
            : 'факт не внесён — укажите списанную сумму при отметке оплаты',
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

/** The optional receipt both payment forms carry (EARS-543/544) — checked at submit, sent after the act. */
export type ReceiptFields = { receiptKind?: string; receipt?: FileList | null }

const receiptShape = {
  receiptKind: z.string().optional(),
  receipt: z.custom<FileList | null>(() => true).optional(),
}

export type MarkPaidFormValue = ReceiptFields & {
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
    .object({
      occurredOn: z.string(),
      accountId: z.string(),
      paidAmount: z.string(),
      ...receiptShape,
    })
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

export type ReimburseFormValue = ReceiptFields & {
  occurredOn: string
  accountId: string
  amount: string
  /** EARS-568's payment-agent fee — read only on a cross-currency refund of a booked debt. */
  agentFee?: string
}

/**
 * The accounts a refund may leave: any. A booked debt is refunded from its own
 * currency for its booked sum, or from an account in another currency — the
 * roubles through a payment agent (EARS-568) — for the sum that left it.
 */
export function refundAccounts(
  _request: RequestBoardItem,
  references: RequestBoardReferences,
): RequestBoardReferences['accounts'] {
  return references.accounts
}

/**
 * EARS-568's case: the debt is already booked in one currency and the chosen
 * account holds another. Only here the agent fee is asked and forwarded; an
 * unbooked request refunded in another currency stays EARS-544's posting.
 */
export function refundCrossesCurrency(
  request: RequestBoardItem,
  references: RequestBoardReferences,
  accountId: string,
): boolean {
  const fixed = refundCurrencyFixed(request)
  const account = accountOf(references, accountId)
  return fixed !== null && account !== null && account.currency !== fixed
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
  return {
    occurredOn: today,
    accountId,
    amount: refundPrefill(request, references, accountId),
    agentFee: '',
  }
}

export function createReimburseSchema(
  request: RequestBoardItem,
  references: RequestBoardReferences,
) {
  return z
    .object({
      occurredOn: z.string(),
      accountId: z.string(),
      amount: z.string(),
      agentFee: z.string().optional(),
      ...receiptShape,
    })
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
      const precision = currencyPrecision(references.currencies, account.currency)
      const crosses = refundCrossesCurrency(request, references, value.accountId)
      const amount = toMinorUnits(value.amount, precision)
      if (amount === null) {
        context.addIssue({
          code: 'custom',
          path: ['amount'],
          message: crosses
            ? `Укажите сумму, ушедшую со счёта, в ${account.currency}.`
            : `Укажите сумму возврата в ${account.currency}.`,
        })
        return
      }
      const feeText = value.agentFee?.trim() ?? ''
      if (!crosses || feeText === '') return
      // The act's own refusals (EARS-568), said before the round-trip.
      const fee = toMinorUnits(feeText, precision)
      if (fee === null) {
        context.addIssue({
          code: 'custom',
          path: ['agentFee'],
          message: `Комиссия агента — положительная сумма в ${account.currency}.`,
        })
      } else if (BigInt(fee) >= BigInt(amount)) {
        context.addIssue({
          code: 'custom',
          path: ['agentFee'],
          message: 'Комиссия агента должна быть меньше суммы возврата.',
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
  /** EARS-568: the payment agent's itemized fee, in the paying account's minor units. */
  agentFeeAmount?: string
}

export function toReimburseBody(
  value: ReimburseFormValue,
  request: RequestBoardItem,
  references: RequestBoardReferences,
): ReimburseBody {
  const account = accountOf(references, value.accountId)!
  const precision = currencyPrecision(references.currencies, account.currency)
  const body: ReimburseBody = {
    act: 'mark-reimbursed',
    snapshot: request.snapshot ?? '',
    occurredOn: value.occurredOn,
    accountId: account.id,
    amount: toMinorUnits(value.amount, precision) ?? '',
  }
  const fee = toMinorUnits(value.agentFee?.trim() ?? '', precision)
  if (refundCrossesCurrency(request, references, value.accountId) && fee !== null) {
    body.agentFeeAmount = fee
  }
  return body
}

// ── the receipt the forms may carry (EARS-543/544: optional) ───────────────

/** Null — the chosen file may be sent; otherwise the refusal to show under the field. */
export function receiptRefusal(file: File | null): string | null {
  return file === null ? null : documentUploadRefusal(file)
}

/** The acts whose form may carry a receipt, uploaded once the act has posted. */
export type ReceiptAct = 'mark-paid' | 'mark-reimbursed'

/**
 * The toast when the receipt of a payment form fails AFTER its act posted
 * (review of #564, S2): the money act stands — say so first — and the receipt
 * is attached later in the request's sheet.
 */
export function receiptAfterActFailed(
  act: ReceiptAct,
  id: number,
  reason: string,
): { message: string; description: string } {
  const done = act === 'mark-paid' ? 'Оплата отмечена' : 'Возврат отмечен'
  return {
    message: `${done}, но чек не приложен.`,
    description: [
      `Заявка №${id}: приложите чек позже в карточке заявки.`,
      reason === '' ? null : reason,
    ]
      .filter(Boolean)
      .join(' '),
  }
}

// ── the bulk dialog (EARS-547/548) ──────────────────────────────────────────

export type BulkGroup = 'pay' | 'reimburse'

/** The bulk act on «К оплате» / «Вернуть сотруднику» — two rows or more, the approve role. */
export function bulkGroupOf(
  stage: QueueStage,
  rows: readonly RequestBoardItem[],
  canApprove: boolean,
): BulkGroup | null {
  if (!canApprove || rows.length < 2) return null
  if (stage !== 'pay' && stage !== 'reimburse') return null
  return rows.every((row) => row.snapshot !== null) ? stage : null
}

/** «как оплаченные» on «К оплате», «как возвращённые» on «Вернуть сотруднику» (EARS-547). */
const BULK_DONE: Record<BulkGroup, { label: string; result: string }> = {
  pay: { label: 'как оплаченные', result: 'Отмечено оплаченными' },
  reimburse: { label: 'как возвращённые', result: 'Отмечено возвращёнными' },
}

/** «Отметить все N как оплаченные» / «…как возвращённые» — the dialog's heading. */
export function bulkTitle(count: number, group: BulkGroup): string {
  return `Отметить все ${count} ${BULK_DONE[group].label}`
}

/** The group header's act: the heading with «…», for it opens a dialog. */
export function bulkLabel(count: number, group: BulkGroup): string {
  return `${bulkTitle(count, group)}…`
}

/** «Отметить N как оплаченные» / «…как возвращённые» — the dialog's confirm. */
export function bulkConfirmLabel(count: number, group: BulkGroup): string {
  return `Отметить ${count} ${BULK_DONE[group].label}`
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
export function bulkResultMessage(
  result: { posted: unknown[]; excluded: unknown[] },
  group: BulkGroup,
): string {
  const posted = result.posted.length
  const excluded = result.excluded.length
  const done = BULK_DONE[group].result
  return excluded === 0 ? `${done}: ${posted}.` : `${done}: ${posted}, исключено: ${excluded}.`
}

// ── the deep link `?request=<id>` (lead addition on #551; the §J report links here) ──

/** The request id a `?request=<id>` link names, or `null` when it names none. */
export function linkedRequestId(search: string): number | null {
  const raw = new URLSearchParams(search).get('request')
  if (raw === null || !/^\d+$/.test(raw.trim())) return null
  const id = Number(raw.trim())
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** The quiet notice for a link to a request this reader cannot see — or `null`. */
export function linkedRequestNotice(
  linked: number | null,
  requests: readonly Pick<RequestBoardItem, 'id'>[],
): string | null {
  if (linked === null || requests.some((request) => request.id === linked)) return null
  return `Заявки №${linked} нет в списке — она удалена или недоступна вам.`
}
