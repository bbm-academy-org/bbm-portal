import { describe, expect, it } from 'vitest'

import type {
  QueueDisplayAmount,
  RequestBoardItem,
  RequestBoardReferences,
  RequestMarketBlock,
} from '@/app/(platform)/p/finance/requests/request-board-contract'
import {
  bulkConfirmLabel,
  bulkGroupOf,
  bulkLabel,
  bulkPlannedRows,
  bulkResultMessage,
  createMarkPaidSchema,
  createReimburseSchema,
  debitedAmountMode,
  howToPay,
  initialSheetForm,
  lacksReceipt,
  linkedRequestId,
  linkedRequestNotice,
  markPaidDefaults,
  marketBlockView,
  mayAttachDocument,
  noteHasPaymentDetails,
  receiptAfterActFailed,
  refundAccounts,
  refundAmountAfterSwitch,
  refundCrossesCurrency,
  refundDue,
  refundPrefill,
  reimburseDefaults,
  sheetActs,
  sheetAmount,
  sheetFee,
  sheetMeta,
  sheetTimeline,
  toBulkBody,
  toMarkPaidBody,
  toReimburseBody,
} from '@/app/(platform)/p/finance/requests/request-sheet-model'
import { ownerFacingText } from '@/app/(platform)/p/finance/requests/constants'
import { deriveExpenseRequestStage } from '@/lib/finance/intake/request-queue'

/**
 * The details sheet of the owner's queue as pure data (spec 339 §I EARS-542…548,
 * §J EARS-563; issue #551). Every expectation is read off the spec's clauses and
 * acceptance scenarios 10–12 and 14, not off what the sheet happens to render.
 */

const same = (minor: string): QueueDisplayAmount => ({
  kind: 'converted',
  amount: minor,
  numerator: minor,
  denominator: '1',
  basis: 'same_currency',
  rateDate: null,
  reason: null,
})

const REFERENCES: RequestBoardReferences = {
  accounts: [
    { id: 1, name: 'Счёт 1', currency: 'RUB' },
    { id: 2, name: 'Счёт 2', currency: 'RUB' },
    { id: 3, name: 'Счёт USD', currency: 'USD' },
  ],
  counterparties: [],
  currencies: [
    { code: 'RUB', name: 'Рубль', precision: 2 },
    { code: 'USD', name: 'Доллар', precision: 2 },
    { code: 'EUR', name: 'Евро', precision: 2 },
  ],
  products: [],
  projects: [{ id: 12, name: 'Doctor School' }],
  purposes: [],
}

/** A request whose STAGE is the module's own derivation — the one source the sheet reads. */
function item(overrides: Partial<RequestBoardItem> = {}): RequestBoardItem {
  const base: RequestBoardItem = {
    id: 12,
    own: false,
    status: 'submitted',
    stage: 'decide',
    hasDocument: false,
    settledBy: null,
    snapshot: 'tok-12',
    display: { RUB: same('1250000'), USD: same('1250000'), EUR: same('1250000') },
    occurredOn: null,
    createdAt: '2026-11-10T09:30:00.000Z',
    sourceRef: null,
    sourceUrl: null,
    sourceLabel: null,
    amount: '1250000',
    currency: 'RUB',
    paidAmount: null,
    paidCurrency: null,
    feeAmount: null,
    feeCurrency: null,
    market: null,
    note: null,
    alreadyPaid: false,
    personalFunds: false,
    createdBy: 5,
    createdByName: 'М. Иванова',
    memberId: null,
    memberName: null,
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    postedByName: null,
    refusalReason: null,
    operationId: null,
    operation: null,
    purpose: null,
    project: { id: 12, name: 'Doctor School' },
    product: null,
    account: null,
    counterparty: { id: 4, name: 'Типография' },
    documents: [],
    proposal: null,
  }
  const merged = { ...base, ...overrides }
  return {
    ...merged,
    stage:
      overrides.stage ??
      deriveExpenseRequestStage({ ...merged, settled: merged.settledBy !== null }),
  }
}

const APPROVER = { canApprove: true }
const acts = (request: RequestBoardItem, permissions = APPROVER) =>
  sheetActs(request, permissions).map((button) => button.label)

describe('the details sheet — acts of the stage (EARS-542)', () => {
  it('EARS-542: «Ждёт решения» offers «Одобрить», «Одобрить и отметить оплату» and «Отклонить», the first as the primary', () => {
    const buttons = sheetActs(item(), APPROVER)
    expect(buttons.map((button) => button.label)).toEqual([
      'Одобрить',
      'Одобрить и отметить оплату',
      'Отклонить',
    ])
    expect(buttons.filter((button) => button.variant === 'default')).toHaveLength(1)
  })

  it('EARS-542: «К оплате» offers «Отметить оплату» and «Отозвать» for an approval that has not posted', () => {
    expect(acts(item({ status: 'approved' }))).toEqual(['Отметить оплату', 'Отозвать'])
  })

  it('EARS-542: an already-paid company-account request still submitted is «К оплате» with «Отклонить»', () => {
    const request = item({ alreadyPaid: true, occurredOn: '2026-11-01' })
    expect(request.stage).toBe('pay')
    expect(acts(request)).toEqual(['Отметить оплату', 'Отклонить'])
  })

  it('EARS-542/544: «Вернуть сотруднику» offers «Отметить возврат»; a posted, unsettled one offers nothing else', () => {
    const owed = item({ alreadyPaid: true, personalFunds: true, occurredOn: '2026-11-01' })
    expect(acts(owed)).toEqual(['Отметить возврат', 'Отклонить'])
    const booked = item({ ...owed, status: 'posted', operationId: 9 })
    expect(booked.stage).toBe('reimburse')
    expect(acts(booked)).toEqual(['Отметить возврат'])
  })

  it('EARS-542/505: a paid request offers no money act — the ledger is immutable', () => {
    const paid = item({ status: 'posted', alreadyPaid: true, operationId: 9 })
    expect(paid.stage).toBe('paid')
    expect(acts(paid)).toEqual([])
  })

  it('EARS-501/541: a reader without `finance-approve` is offered none of the money acts', () => {
    for (const request of [item(), item({ status: 'approved' })]) {
      expect(acts(request, { canApprove: false })).toEqual([])
    }
  })

  it('EARS-548: a money act needs the list row’s snapshot token — a row without one offers none', () => {
    expect(acts(item({ snapshot: null }))).toEqual(['Одобрить', 'Отклонить'])
    expect(acts(item({ snapshot: null, status: 'approved' }))).toEqual(['Отозвать'])
  })

  it('EARS-509: the author keeps their own acts beside the approver’s', () => {
    expect(acts(item({ own: true }), { canApprove: false })).toEqual([
      'Отменить заявку',
      'Редактировать',
    ])
    expect(acts(item({ own: true, status: 'draft' }), { canApprove: false })).toEqual([
      'Подать',
      'Редактировать',
    ])
  })

  it('EARS-541/542: the queue row act and the board drag open the stage’s own form', () => {
    expect(initialSheetForm(item({ status: 'approved' }), 'pay', APPROVER)).toBe('mark-paid')
    const owed = item({ alreadyPaid: true, personalFunds: true, occurredOn: '2026-11-01' })
    expect(initialSheetForm(owed, 'pay', APPROVER)).toBe('mark-reimbursed')
    expect(initialSheetForm(item(), 'refuse', APPROVER)).toBe('refuse')
    expect(initialSheetForm(item({ status: 'approved' }), 'refuse', APPROVER)).toBe('revoke')
    expect(initialSheetForm(item(), 'pay', { canApprove: false })).toBe(null)
  })

  it('EARS-542: the first line names the request and its stage', () => {
    expect(sheetMeta(item({ status: 'approved' }))).toBe('Заявка №12 · К оплате')
  })
})

describe('the details sheet — «Как оплатить» (EARS-542)', () => {
  it('EARS-542: «реквизиты есть» when the note carries an http(s) link or a run of 20 digits', () => {
    expect(noteHasPaymentDetails('Оплата по ссылке https://pay.example/inv/1')).toBe(true)
    expect(noteHasPaymentDetails('р/с 40702810900000012345, БИК 044525225')).toBe(true)
    expect(noteHasPaymentDetails('счёт 4070281090000001234')).toBe(false) // 19 digits
    expect(noteHasPaymentDetails('реквизиты в чате')).toBe(false)
    expect(howToPay(item({ note: 'https://pay.example/1' }), REFERENCES)).toEqual({
      kind: 'details',
      source: 'note',
    })
  })

  it('EARS-542: an attached document counts as the details too', () => {
    expect(howToPay(item({ hasDocument: true }), REFERENCES)).toEqual({
      kind: 'details',
      source: 'document',
    })
  })

  it('EARS-542: an approved pre-spend request with no link, no account number and no document warns', () => {
    expect(howToPay(item({ status: 'approved', note: 'Аренда студии' }), REFERENCES)).toEqual({
      kind: 'missing',
    })
  })

  it('EARS-542/544: a personal-funds request says who paid, when, and how much to return', () => {
    const personal = item({
      alreadyPaid: true,
      personalFunds: true,
      occurredOn: '2026-11-01',
      memberName: 'Мария',
      amount: '450000',
      feeAmount: '5000',
      feeCurrency: 'RUB',
    })
    const rubOnly = { ...REFERENCES, accounts: REFERENCES.accounts.slice(0, 2) }
    expect(howToPay(personal, rubOnly)).toEqual({
      kind: 'reimburse',
      member: 'Мария',
      paidOn: '2026-11-01',
      refund: { kind: 'fixed', due: { amount: '455000', currency: 'RUB' }, original: null },
      booked: false,
    })
    // With a USD account too, the refund follows the account: amount + fee
    // from a RUB one, the debited fact from any other (EARS-544).
    expect(howToPay(personal, REFERENCES)).toMatchObject({
      refund: {
        kind: 'by-account',
        same: { amount: '455000', currency: 'RUB' },
        original: { amount: '455000', currency: 'RUB' },
      },
    })
  })

  it('EARS-542/544: a USD refund is stated in the currency the refund form asks for, with the original small', () => {
    const usd = {
      alreadyPaid: true,
      personalFunds: true,
      occurredOn: '2026-11-13',
      currency: 'USD',
      amount: '10000',
    } as const
    const rubOnly = { ...REFERENCES, accounts: REFERENCES.accounts.slice(0, 2) }
    // Only RUB accounts: the form asks the roubles actually debited — no sum is invented.
    expect(howToPay(item(usd), rubOnly)).toMatchObject({
      refund: { kind: 'by-account', same: null, original: { amount: '10000', currency: 'USD' } },
    })
    // A booked RUB debt: the form asks exactly its roubles; the dollars are the original.
    expect(
      howToPay(
        item({
          ...usd,
          status: 'posted',
          operationId: 9,
          paidAmount: '901600',
          paidCurrency: 'RUB',
        }),
        REFERENCES,
      ),
    ).toMatchObject({
      booked: true,
      refund: {
        kind: 'fixed',
        due: { amount: '901600', currency: 'RUB' },
        original: { amount: '10000', currency: 'USD' },
      },
    })
  })

  it('EARS-542: an already-paid company-account request is never asked for details — it waits for its marking', () => {
    expect(
      howToPay(
        item({ status: 'approved', alreadyPaid: true, occurredOn: '2026-11-05' }),
        REFERENCES,
      ),
    ).toEqual({ kind: 'paid', paidOn: '2026-11-05' })
    expect(howToPay(item({ alreadyPaid: true, occurredOn: '2026-11-05' }), REFERENCES)).toEqual({
      kind: 'paid',
      paidOn: '2026-11-05',
    })
  })

  it('EARS-542: a closed request has nothing to pay — no block', () => {
    expect(
      howToPay(item({ status: 'posted', alreadyPaid: true, operationId: 9 }), REFERENCES),
    ).toBe(null)
    expect(howToPay(item({ status: 'refused' }), REFERENCES)).toBe(null)
  })
})

describe('the details sheet — header and timeline (EARS-542/546)', () => {
  it('EARS-542/550: a USD request in ₽ reads the converted amount with «заявлено X · курс ЦБ на <дата> (сегодня)»', () => {
    const request = item({
      currency: 'USD',
      amount: '10000',
      display: {
        RUB: {
          kind: 'converted',
          amount: '920000',
          numerator: '920000',
          denominator: '1',
          basis: 'cbr',
          rateDate: '2026-11-18',
          reason: 'unpaid',
        },
        USD: same('10000'),
        EUR: { kind: 'no_rate', currency: 'EUR', date: '2026-11-18' },
      },
    })
    expect(sheetAmount(request, 'RUB', REFERENCES)).toEqual({
      main: '9 200,00 ₽',
      note: 'заявлено 100,00 $ · курс ЦБ на 18.11.2026 (сегодня)',
    })
    expect(sheetAmount(request, 'USD', REFERENCES)).toEqual({ main: '100,00 $', note: null })
    expect(sheetAmount(request, 'EUR', REFERENCES)).toEqual({
      main: '100,00 $',
      note: 'нет курса ЦБ на 18.11.2026',
    })
  })

  it('EARS-542/550: the rate note names «дата траты» and «дата оплаты» for moved money', () => {
    const at = (reason: 'occurred_on' | 'operation_occurred_on') =>
      sheetAmount(
        item({
          currency: 'USD',
          amount: '10000',
          display: {
            RUB: {
              kind: 'converted',
              amount: '900000',
              numerator: '900000',
              denominator: '1',
              basis: 'cbr',
              rateDate: '2026-11-01',
              reason,
            },
            USD: same('10000'),
            EUR: same('10000'),
          },
        }),
        'RUB',
        REFERENCES,
      ).note
    expect(at('occurred_on')).toBe('заявлено 100,00 $ · курс ЦБ на 01.11.2026 (дата траты)')
    expect(at('operation_occurred_on')).toBe(
      'заявлено 100,00 $ · курс ЦБ на 01.11.2026 (дата оплаты)',
    )
  })

  it('EARS-542: the fee is named in its own currency', () => {
    expect(sheetFee(item({ feeAmount: '5000', feeCurrency: 'RUB' }), REFERENCES)).toBe(
      'комиссия 50,00 ₽',
    )
    expect(sheetFee(item(), REFERENCES)).toBe(null)
  })

  it('EARS-542: the timeline runs Подана → Решение → Оплата, with what is still ahead not done', () => {
    const steps = sheetTimeline(
      item({ status: 'approved', decidedAt: '2026-11-11T08:00:00.000Z', decidedByName: 'Антон' }),
    )
    expect(steps.map((step) => [step.label, step.done])).toEqual([
      ['Подана', true],
      ['Решение', true],
      ['Оплата', false],
    ])
    expect(steps[1].detail).toBe('одобрена · 11.11.2026 11:00 · Антон')
  })

  it('EARS-542/546: a paid request without a document says «без чека» on its payment step', () => {
    const paid = item({
      status: 'posted',
      alreadyPaid: true,
      occurredOn: '2026-11-12',
      operationId: 9,
      postedByName: 'Антон',
    })
    expect(lacksReceipt(paid)).toBe(true)
    expect(sheetTimeline(paid)[2]).toEqual({
      label: 'Оплата',
      detail: 'оплачено 12.11.2026 · Антон · без чека',
      done: true,
    })
    expect(lacksReceipt({ ...paid, hasDocument: true })).toBe(false)
    expect(lacksReceipt(item({ status: 'approved' }))).toBe(false)
  })

  it('EARS-542/544: a personal-funds request ends in «Возврат сотруднику», done only once settled', () => {
    const booked = item({
      status: 'posted',
      alreadyPaid: true,
      personalFunds: true,
      occurredOn: '2026-11-01',
      operationId: 9,
    })
    expect(sheetTimeline(booked)[2]).toMatchObject({ label: 'Возврат сотруднику', done: false })
    expect(sheetTimeline({ ...booked, settledBy: 77, stage: 'paid' })[2]).toEqual({
      label: 'Возврат сотруднику',
      detail: 'возвращено',
      done: true,
    })
  })

  it('EARS-545: a posted request takes a late receipt from its author and either finance role', () => {
    const posted = item({ status: 'posted', alreadyPaid: true, operationId: 9 })
    expect(mayAttachDocument(posted, { canEnter: false, canApprove: true })).toBe(true)
    expect(mayAttachDocument(posted, { canEnter: true, canApprove: false })).toBe(true)
    expect(
      mayAttachDocument({ ...posted, own: true }, { canEnter: false, canApprove: false }),
    ).toBe(true)
    expect(mayAttachDocument(posted, { canEnter: false, canApprove: false })).toBe(false)
    expect(
      mayAttachDocument(item({ status: 'refused' }), { canEnter: true, canApprove: true }),
    ).toBe(false)
  })
})

describe('the details sheet — «Курс против рынка» (EARS-563)', () => {
  const measured: RequestMarketBlock = {
    kind: 'measured',
    date: '2026-11-13',
    rate: { currency: 'USD', rateDate: '2026-11-13', nominal: 1, valueRub: '92.0000' },
    fact: {
      amount: '938400',
      currency: 'RUB',
      fee: { amount: '5000', currency: 'RUB' },
      account: 'Счёт 1',
    },
    percentTenths: '20',
    wording: 'хуже рынка на 2,0%',
    display: {
      RUB: { fact: '938400', market: '920000', overpayment: '18400' },
      USD: { fact: '10200', market: '10000', overpayment: '200' },
      EUR: null,
    },
  }
  const posted = item({
    status: 'posted',
    alreadyPaid: true,
    occurredOn: '2026-11-13',
    operationId: 9,
    currency: 'USD',
    amount: '10000',
    market: measured,
  })

  it('EARS-563: Рынок 9 200 ₽ with the CBR rate and its date, Факт 9 384 ₽ with the account and the fee, Переплата +184 ₽ «хуже рынка на 2,0%»', () => {
    expect(marketBlockView(posted, 'RUB', REFERENCES)).toEqual({
      kind: 'measured',
      lines: [
        {
          label: 'Рынок',
          value: '9 200,00 ₽',
          note: 'курс ЦБ на 13.11.2026 · 1 USD = 92,00 ₽',
        },
        {
          label: 'Факт',
          value: '9 384,00 ₽',
          note: 'со счёта «Счёт 1» · в т.ч. комиссия 50,00 ₽',
        },
        { label: 'Переплата', value: '+184,00 ₽', note: 'хуже рынка на 2,0%' },
      ],
      pending: null,
    })
  })

  it('EARS-563: switching ₽ → $ changes the amounts, not the percentage', () => {
    const view = marketBlockView(posted, 'USD', REFERENCES)
    expect(view).toMatchObject({
      kind: 'measured',
      lines: [
        { label: 'Рынок', value: '100,00 $' },
        { label: 'Факт', value: '102,00 $', note: expect.stringContaining('9 384,00 ₽') },
        { label: 'Переплата', value: '+2,00 $', note: 'хуже рынка на 2,0%' },
      ],
    })
  })

  it('EARS-563: a refund of 9 016 ₽ reads «лучше рынка на 2,0%», the sign on the amount', () => {
    const view = marketBlockView(
      {
        ...posted,
        personalFunds: true,
        settledBy: 31,
        stage: 'paid',
        market: {
          ...measured,
          fact: { amount: '901600', currency: 'RUB', fee: null, account: null },
          percentTenths: '-20',
          wording: 'лучше рынка на 2,0%',
          display: {
            ...measured.display,
            RUB: { fact: '901600', market: '920000', overpayment: '-18400' },
          },
        },
      },
      'RUB',
      REFERENCES,
    )
    expect(view).toMatchObject({
      lines: [
        { label: 'Рынок' },
        { label: 'Факт', value: '9 016,00 ₽', note: 'с карты сотрудника' },
        { label: 'Переплата', value: '−184,00 ₽', note: 'лучше рынка на 2,0%' },
      ],
      pending: null,
    })
  })

  it('EARS-563: a posted personal-funds debt not yet refunded says the refund is still ahead', () => {
    const view = marketBlockView(
      { ...posted, personalFunds: true, stage: 'reimburse' },
      'RUB',
      REFERENCES,
    )
    expect(view).toMatchObject({
      kind: 'measured',
      pending: expect.stringContaining('не возвращён'),
    })
  })

  it('EARS-563: «нет курса ЦБ на <дата>» for a payment without a rate', () => {
    expect(
      marketBlockView(
        { ...posted, market: { kind: 'no_rate', currency: 'USD', date: '2026-11-13' } },
        'RUB',
        REFERENCES,
      ),
    ).toEqual({ kind: 'note', text: 'нет курса ЦБ на 13.11.2026' })
  })

  it('EARS-563/560: «факт не внесён — укажите списанную сумму при отметке оплаты» when no debited amount is stated', () => {
    const pending = item({
      status: 'approved',
      alreadyPaid: true,
      occurredOn: '2026-11-01',
      currency: 'USD',
      amount: '10000',
      market: { kind: 'not_posted', statedPaidAmount: null },
    })
    expect(marketBlockView(pending, 'RUB', REFERENCES)).toEqual({
      kind: 'note',
      text: 'факт не внесён — укажите списанную сумму при отметке оплаты',
    })
  })

  it('EARS-563/535: in «Вернуть сотруднику» an unstated fact is named by «Отметить возврат» — its refund sum', () => {
    const personal = item({
      alreadyPaid: true,
      personalFunds: true,
      occurredOn: '2026-11-13',
      currency: 'USD',
      amount: '10000',
      market: { kind: 'not_posted', statedPaidAmount: null },
    })
    expect(personal.stage).toBe('reimburse')
    expect(marketBlockView(personal, 'RUB', REFERENCES)).toEqual({
      kind: 'note',
      text: 'факт не внесён — укажите сумму возврата при «Отметить возврат»',
    })
  })

  it('EARS-563/535: a stated amount reads «факт не проведён» — after «Отметить возврат» in «Вернуть сотруднику», after «Отметить оплату» otherwise', () => {
    const stated = { kind: 'not_posted', statedPaidAmount: '933400' } as const
    const personal = item({
      alreadyPaid: true,
      personalFunds: true,
      occurredOn: '2026-11-01',
      currency: 'USD',
      market: stated,
    })
    expect(personal.stage).toBe('reimburse')
    expect(marketBlockView(personal, 'RUB', REFERENCES)).toEqual({
      kind: 'note',
      text: 'факт не проведён — появится после «Отметить возврат»',
    })
    const company = item({
      alreadyPaid: true,
      occurredOn: '2026-11-01',
      currency: 'USD',
      market: stated,
    })
    expect(company.stage).toBe('pay')
    expect(marketBlockView(company, 'RUB', REFERENCES)).toEqual({
      kind: 'note',
      text: 'факт не проведён — появится после «Отметить оплату»',
    })
  })

  it('EARS-563: a same-currency request shows no block', () => {
    expect(marketBlockView(item(), 'RUB', REFERENCES)).toBe(null)
  })
})

describe('«Отметить оплату» form (EARS-543)', () => {
  const usd = item({ status: 'approved', currency: 'USD', amount: '10000' })
  const issues = (request: RequestBoardItem, value: Record<string, string>) => {
    const parsed = createMarkPaidSchema(request, REFERENCES).safeParse(value)
    return parsed.success
      ? {}
      : Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message]))
  }

  it('EARS-543: the date defaults to today, or to the date money moved for an already-paid request', () => {
    expect(markPaidDefaults(item({ status: 'approved' }), REFERENCES, '2026-11-18')).toEqual({
      occurredOn: '2026-11-18',
      accountId: '',
      paidAmount: '',
    })
    expect(
      markPaidDefaults(
        item({
          alreadyPaid: true,
          occurredOn: '2026-11-03',
          account: { id: 2, name: 'Счёт 2', currency: 'RUB' },
        }),
        REFERENCES,
        '2026-11-18',
      ),
    ).toEqual({ occurredOn: '2026-11-03', accountId: '2', paidAmount: '' })
  })

  it('EARS-543: the debited amount is the request’s own when the currencies match, and asked when they differ', () => {
    expect(debitedAmountMode(item(), REFERENCES, '1')).toEqual({
      mode: 'same',
      value: '12 500,00 ₽',
    })
    expect(debitedAmountMode(usd, REFERENCES, '1')).toEqual({ mode: 'asked', currency: 'RUB' })
    expect(debitedAmountMode(usd, REFERENCES, '')).toEqual({ mode: 'none' })
  })

  it('EARS-543: a USD request paid from a RUB account is refused until the debited roubles are entered', () => {
    expect(issues(usd, { occurredOn: '2026-11-18', accountId: '1', paidAmount: '' })).toEqual({
      paidAmount: 'Счёт в RUB, заявка в USD: укажите сумму, фактически списанную со счёта, в RUB.',
    })
    expect(
      issues(usd, { occurredOn: '2026-11-18', accountId: '1', paidAmount: '9 384,00' }),
    ).toEqual({})
  })

  it('EARS-543: the date and the account are required; a receipt is not', () => {
    expect(issues(item(), { occurredOn: '', accountId: '', paidAmount: '' })).toEqual({
      occurredOn: 'Укажите дату, когда ушли деньги.',
      accountId: 'Выберите счёт, с которого ушли деньги.',
    })
    expect(issues(item(), { occurredOn: '2026-11-18', accountId: '1', paidAmount: '' })).toEqual({})
  })

  it('EARS-543/548: the body carries the list row’s token and the debited amount only across currencies', () => {
    expect(
      toMarkPaidBody(
        { occurredOn: '2026-11-18', accountId: '1', paidAmount: '' },
        item(),
        REFERENCES,
      ),
    ).toEqual({ act: 'mark-paid', snapshot: 'tok-12', occurredOn: '2026-11-18', accountId: 1 })
    expect(
      toMarkPaidBody(
        { occurredOn: '2026-11-18', accountId: '1', paidAmount: '9 384,00' },
        usd,
        REFERENCES,
      ),
    ).toEqual({
      act: 'mark-paid',
      snapshot: 'tok-12',
      occurredOn: '2026-11-18',
      accountId: 1,
      paidAmount: '938400',
      paidCurrency: 'RUB',
    })
  })
})

describe('«Отметить возврат» form (EARS-544)', () => {
  const owed = item({
    alreadyPaid: true,
    personalFunds: true,
    occurredOn: '2026-11-01',
    currency: 'USD',
    amount: '10000',
  })

  it('EARS-544: a refund in the document currency is prefilled with amount + fee', () => {
    const rub = item({
      ...owed,
      currency: 'RUB',
      amount: '450000',
      feeAmount: '5000',
      feeCurrency: 'RUB',
    })
    expect(refundDue(rub)).toEqual({ amount: '455000', currency: 'RUB' })
    expect(reimburseDefaults(rub, REFERENCES, '2026-11-18')).toMatchObject({
      occurredOn: '2026-11-18',
    })
  })

  it('EARS-544: a USD request refunded from a RUB account asks for the roubles — no prefill, any account', () => {
    expect(refundAccounts(owed, REFERENCES)).toHaveLength(3)
    expect(reimburseDefaults(owed, REFERENCES, '2026-11-18')).toEqual({
      occurredOn: '2026-11-18',
      accountId: '',
      amount: '',
      agentFee: '',
    })
  })

  it('EARS-544: a stated paid amount fixes the refund currency and prefills paid_amount + fee', () => {
    const stated = item({
      ...owed,
      paidAmount: '900000',
      paidCurrency: 'RUB',
      feeAmount: '1600',
      feeCurrency: 'RUB',
    })
    expect(refundDue(stated)).toEqual({ amount: '901600', currency: 'RUB' })
    expect(refundPrefill(stated, REFERENCES, '1')).toBe('9016,00')
  })

  it('EARS-544/568: a posted debt is refunded from its booked currency for its booked sum, or from any other account for the sum that left it', () => {
    const booked = item({
      ...owed,
      status: 'posted',
      operationId: 9,
      paidAmount: '900000',
      paidCurrency: 'RUB',
    })
    expect(refundDue(booked)).toEqual({ amount: '900000', currency: 'RUB' })
    const usdDebt = item({ ...owed, status: 'posted', operationId: 9 })
    expect(refundAccounts(usdDebt, REFERENCES).map((account) => account.id)).toEqual([1, 2, 3])
    expect(refundPrefill(usdDebt, REFERENCES, '3')).toBe('100,00')
    expect(refundPrefill(usdDebt, REFERENCES, '1')).toBe('')
    expect(refundCrossesCurrency(usdDebt, REFERENCES, '1')).toBe(true)
    expect(refundCrossesCurrency(usdDebt, REFERENCES, '3')).toBe(false)
    expect(reimburseDefaults(usdDebt, REFERENCES, '2026-11-18')).toEqual({
      occurredOn: '2026-11-18',
      accountId: '3',
      amount: '100,00',
      agentFee: '',
    })
  })

  it('EARS-544: switching accounts replaces an untouched prefill and keeps a typed amount', () => {
    const usdDebt = item({ ...owed, status: 'posted', operationId: 9 })
    // From the debt's own account (prefill 100,00) to a rouble one: the prefill goes.
    expect(refundAmountAfterSwitch(usdDebt, REFERENCES, '3', '1', '100,00')).toBe('')
    // A typed sum survives the switch.
    expect(refundAmountAfterSwitch(usdDebt, REFERENCES, '3', '1', '95,00')).toBe('95,00')
    expect(refundAmountAfterSwitch(usdDebt, REFERENCES, '1', '2', '9 500')).toBe('9 500')
    // Back to the debt's own account: an empty or untouched field takes the booked sum.
    expect(refundAmountAfterSwitch(usdDebt, REFERENCES, '1', '3', '')).toBe('100,00')
    expect(refundAmountAfterSwitch(usdDebt, REFERENCES, '1', '3', '9 500')).toBe('9 500')
  })

  it('EARS-544: an unbooked request refunded in another currency is not the agent-fee case', () => {
    expect(refundCrossesCurrency(owed, REFERENCES, '1')).toBe(false)
    expect(
      toReimburseBody(
        { occurredOn: '2026-11-18', accountId: '1', amount: '9 016', agentFee: '150' },
        owed,
        REFERENCES,
      ),
    ).not.toHaveProperty('agentFeeAmount')
  })

  describe('EARS-568: the cross-currency refund of a booked debt', () => {
    const usdDebt = item({ ...owed, status: 'posted', operationId: 9 })
    const schema = createReimburseSchema(usdDebt, REFERENCES)
    const messages = (value: Record<string, string>) =>
      schema
        .safeParse({ occurredOn: '2026-11-18', accountId: '1', amount: '9 500', ...value })
        .error?.issues.map((issue) => issue.message)

    it('EARS-568: the agent fee is optional, positive and smaller than the paid sum', () => {
      expect(messages({ agentFee: '' })).toBeUndefined()
      expect(messages({ agentFee: '150' })).toBeUndefined()
      expect(messages({ agentFee: '0' })).toEqual(['Комиссия агента — положительная сумма в RUB.'])
      expect(messages({ agentFee: '9 500' })).toEqual([
        'Комиссия агента должна быть меньше суммы возврата.',
      ])
      expect(messages({ amount: '', agentFee: '150' })).toEqual([
        'Укажите сумму, ушедшую со счёта, в RUB.',
      ])
    })

    it('EARS-568: the body forwards the roubles that left the account and the agent fee', () => {
      expect(
        toReimburseBody(
          { occurredOn: '2026-11-18', accountId: '1', amount: '9 500', agentFee: '150,50' },
          usdDebt,
          REFERENCES,
        ),
      ).toEqual({
        act: 'mark-reimbursed',
        snapshot: 'tok-12',
        occurredOn: '2026-11-18',
        accountId: 1,
        amount: '950000',
        agentFeeAmount: '15050',
      })
      expect(
        toReimburseBody(
          { occurredOn: '2026-11-18', accountId: '1', amount: '9 500', agentFee: '' },
          usdDebt,
          REFERENCES,
        ),
      ).not.toHaveProperty('agentFeeAmount')
    })

    it('EARS-568: a same-currency refund of the debt ignores any fee text', () => {
      expect(messages({ accountId: '3', amount: '100', agentFee: '0' })).toBeUndefined()
      expect(
        toReimburseBody(
          { occurredOn: '2026-11-18', accountId: '3', amount: '100', agentFee: '5' },
          usdDebt,
          REFERENCES,
        ),
      ).not.toHaveProperty('agentFeeAmount')
    })
  })

  it('EARS-544: the date, the account and the amount are required', () => {
    const parsed = createReimburseSchema(owed, REFERENCES).safeParse({
      occurredOn: '',
      accountId: '',
      amount: '',
    })
    expect(parsed.success).toBe(false)
    expect(
      createReimburseSchema(owed, REFERENCES)
        .safeParse({ occurredOn: '2026-11-18', accountId: '1', amount: '' })
        .error?.issues.map((issue) => issue.message),
    ).toEqual(['Укажите сумму возврата в RUB.'])
  })

  it('EARS-544/548: the body is the refund in the account’s minor units with the token', () => {
    expect(
      toReimburseBody(
        { occurredOn: '2026-11-18', accountId: '1', amount: '9 016', agentFee: '' },
        owed,
        REFERENCES,
      ),
    ).toEqual({
      act: 'mark-reimbursed',
      snapshot: 'tok-12',
      occurredOn: '2026-11-18',
      accountId: 1,
      amount: '901600',
    })
  })
})

describe('the bulk dialog (EARS-547/548)', () => {
  const pay = [item({ id: 3, status: 'approved' }), item({ id: 4, status: 'approved' })]

  it('EARS-547: «Отметить все N как оплаченные…» on «К оплате» / «Вернуть сотруднику» with two rows or more, approve role only', () => {
    expect(bulkGroupOf('pay', pay, true)).toBe('pay')
    expect(bulkLabel(2, 'pay')).toBe('Отметить все 2 как оплаченные…')
    expect(bulkLabel(3, 'reimburse')).toBe('Отметить все 3 как возвращённые…')
    expect(bulkConfirmLabel(1, 'reimburse')).toBe('Отметить 1 как возвращённые')
    expect(bulkGroupOf('pay', pay.slice(0, 1), true)).toBe(null)
    expect(bulkGroupOf('pay', pay, false)).toBe(null)
    expect(bulkGroupOf('decide', pay, true)).toBe(null)
  })

  it('EARS-547/548: the body names the rows shown with their tokens; an empty date means each row’s own', () => {
    expect(toBulkBody('pay', pay, { accountId: 1, occurredOn: '' }, true)).toEqual({
      group: 'pay',
      accountId: 1,
      items: [
        { id: 3, snapshot: 'tok-12' },
        { id: 4, snapshot: 'tok-12' },
      ],
      preview: true,
    })
    expect(toBulkBody('pay', pay, { accountId: 1, occurredOn: '2026-09-18' }, false)).toMatchObject(
      {
        occurredOn: '2026-09-18',
        preview: false,
      },
    )
  })

  it('EARS-547: the plan is listed in the server’s posting order — oldest first', () => {
    const planned = bulkPlannedRows(
      {
        planned: [
          { id: 4, occurredOn: '2026-09-17' },
          { id: 3, occurredOn: '2026-09-18' },
        ],
        excluded: [],
      },
      pay,
    )
    expect(planned.map((row) => [row.request.id, row.occurredOn])).toEqual([
      [4, '2026-09-17'],
      [3, '2026-09-18'],
    ])
  })

  it('EARS-547: the toast counts what posted and what was left out', () => {
    expect(bulkResultMessage({ posted: [1, 2], excluded: [] }, 'pay')).toBe(
      'Отмечено оплаченными: 2.',
    )
    expect(bulkResultMessage({ posted: [1], excluded: [2] }, 'pay')).toBe(
      'Отмечено оплаченными: 1, исключено: 1.',
    )
    expect(bulkResultMessage({ posted: [1, 2], excluded: [] }, 'reimburse')).toBe(
      'Отмечено возвращёнными: 2.',
    )
  })
})

describe('the deep link ?request=<id>', () => {
  it('EARS-542: reads the id a link names, and nothing from anything else', () => {
    expect(linkedRequestId('?request=36')).toBe(36)
    expect(linkedRequestId('?scope=closed&request=7')).toBe(7)
    expect(linkedRequestId('')).toBe(null)
    expect(linkedRequestId('?request=abc')).toBe(null)
    expect(linkedRequestId('?request=0')).toBe(null)
    expect(linkedRequestId('?request=-3')).toBe(null)
  })

  it('EARS-542: a link to a request the reader cannot see is a quiet notice, never an error', () => {
    expect(linkedRequestNotice(36, [{ id: 36 }])).toBe(null)
    expect(linkedRequestNotice(null, [])).toBe(null)
    expect(linkedRequestNotice(99, [{ id: 36 }])).toBe(
      'Заявки №99 нет в списке — она удалена или недоступна вам.',
    )
  })
})

describe('a receipt that fails after its act (review of #564, S2)', () => {
  it('EARS-545: the toast says the money act stands and the receipt is attached later', () => {
    expect(receiptAfterActFailed('mark-paid', 36, 'Файл больше предела.')).toEqual({
      message: 'Оплата отмечена, но чек не приложен.',
      description: 'Заявка №36: приложите чек позже в карточке заявки. Файл больше предела.',
    })
    expect(receiptAfterActFailed('mark-reimbursed', 38, '').message).toBe(
      'Возврат отмечен, но чек не приложен.',
    )
  })
})

describe('a module refusal as the owner reads it (review of #564, UX 7)', () => {
  it('drops the spec citations and writes dates as ДД.ММ.ГГГГ, keeping the words', () => {
    expect(
      ownerFacingText(
        'Валюта списания USD ≠ RUB — валюте счёта пакета: сумма неизвестна; отметьте заявку отдельно (EARS-547, Q2).',
      ),
    ).toBe(
      'Валюта списания USD ≠ RUB — валюте счёта пакета: сумма неизвестна; отметьте заявку отдельно.',
    )
    expect(
      ownerFacingText(
        'Операция от 2026-11-01 не может быть записана после операции от 2026-11-10: FX-результат (EARS-319/328, EARS-543) — отметьте раньше.',
      ),
    ).toBe(
      'Операция от 01.11.2026 не может быть записана после операции от 10.11.2026: FX-результат — отметьте раньше.',
    )
    expect(ownerFacingText('Роль выдаёт админ (EARS-529, решение 34 от 2026-09-14).')).toBe(
      'Роль выдаёт админ.',
    )
    expect(ownerFacingText('Дата «01.11» записана не в формате ГГГГ-ММ-ДД.')).toBe(
      'Дата «01.11» записана не в формате ГГГГ-ММ-ДД.',
    )
  })
})
