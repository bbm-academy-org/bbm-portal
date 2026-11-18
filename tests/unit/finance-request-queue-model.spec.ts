import { describe, expect, it } from 'vitest'

import type {
  QueueDisplayAmount,
  RequestBoardItem,
} from '@/app/(platform)/p/finance/requests/request-board-contract'
import {
  DEFAULT_QUEUE_SORT,
  filterQueueRows,
  formatDisplayMoney,
  formatOriginalMoney,
  isNewInQueue,
  isNewRequest,
  newCountLabel,
  isOverdue,
  latestRequest,
  latestRequestAge,
  missingRateNote,
  parseStoredDisplayCurrency,
  QUEUE_GROUPS,
  queueGroupStages,
  queueKpis,
  queueOutcome,
  queuePayee,
  queueRowAct,
  queueRowTitle,
  rateStaleness,
  requestAge,
  requestCountLabel,
  sortQueueRows,
  sumInDisplay,
  type QueueFilters,
} from '@/app/(platform)/p/finance/requests/request-queue-model'

/**
 * The owner's payment queue as pure data (spec 339 §I, issue #550): which
 * groups a scope shows and in what order, the three sums, the row columns'
 * values, the order, the search and the filters, the row act, and the display
 * currency's arithmetic. The screen renders what these answer.
 */

const rub = (minor: string): QueueDisplayAmount => ({
  kind: 'converted',
  amount: minor,
  numerator: minor,
  denominator: '1',
  basis: 'same_currency',
  rateDate: null,
  reason: null,
})

function display(minor: string): RequestBoardItem['display'] {
  return { RUB: rub(minor), USD: rub(minor), EUR: rub(minor) }
}

function item(overrides: Partial<RequestBoardItem> = {}): RequestBoardItem {
  return {
    id: 1,
    own: false,
    status: 'submitted',
    stage: 'decide',
    hasDocument: false,
    settledBy: null,
    snapshot: null,
    occurredOn: null,
    createdAt: '2026-11-10T09:30:00.000Z',
    sourceRef: null,
    sourceUrl: null,
    sourceLabel: null,
    amount: '100000',
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
    refusalReason: null,
    operationId: null,
    purpose: { id: 21, name: 'Продакшн', categoryId: null, categoryName: null },
    project: { id: 3, name: 'Doctor.School' },
    product: null,
    account: null,
    counterparty: { id: 7, name: 'ООО «Студия-7»' },
    documents: [],
    display: display('100000'),
    ...overrides,
  }
}

const NOW = new Date('2026-11-18T12:00:00+03:00')
const NO_FILTERS: QueueFilters = { query: '', author: null, project: null, period: 'all' }

describe('the queue groups (EARS-536)', () => {
  it('EARS-536: «В работе» shows decide → pay → reimburse → drafts, drafts collapsed', () => {
    expect(queueGroupStages('active', null)).toEqual(['decide', 'pay', 'reimburse', 'draft'])
    expect(QUEUE_GROUPS.draft.collapsedByDefault).toBe(true)
    expect(QUEUE_GROUPS.decide.title).toBe('Ждёт решения')
    expect(QUEUE_GROUPS.pay.title).toBe('К оплате')
    expect(QUEUE_GROUPS.reimburse.title).toBe('Вернуть сотруднику')
    expect(QUEUE_GROUPS.draft.title).toBe('Черновики')
  })

  it('EARS-536: «Закрытые» shows Оплачено, Отклонено and Отменено', () => {
    expect(queueGroupStages('closed', null)).toEqual(['paid', 'refused', 'cancelled'])
    expect(
      ['paid', 'refused', 'cancelled'].map((stage) => QUEUE_GROUPS[stage as 'paid'].title),
    ).toEqual(['Оплачено', 'Отклонено', 'Отменено'])
  })

  it('EARS-536: «Мои» shows every group, restricted to the reader’s own requests', () => {
    expect(queueGroupStages('mine', null)).toEqual([
      'decide',
      'pay',
      'reimburse',
      'draft',
      'paid',
      'refused',
      'cancelled',
    ])
    const rows = [item({ id: 1, own: true }), item({ id: 2, own: false })]
    expect(filterQueueRows(rows, NO_FILTERS, { scope: 'mine', now: NOW }).map((r) => r.id)).toEqual(
      [1],
    )
    expect(filterQueueRows(rows, NO_FILTERS, { scope: 'active', now: NOW })).toHaveLength(2)
  })

  it('EARS-536: within a group the newest submission comes first by default', () => {
    const rows = [
      item({ id: 1, createdAt: '2026-11-01T10:00:00.000Z' }),
      item({ id: 2, createdAt: '2026-11-15T10:00:00.000Z' }),
      item({ id: 3, createdAt: '2026-11-08T10:00:00.000Z' }),
    ]
    expect(sortQueueRows(rows, DEFAULT_QUEUE_SORT, 'RUB').map((r) => r.id)).toEqual([2, 3, 1])
  })
})

describe('the three sums (EARS-537)', () => {
  it('EARS-537: sums decide / pay / reimburse over ALL requests with their counts', () => {
    const requests = [
      item({ id: 1, stage: 'decide', display: display('100000') }),
      item({ id: 2, stage: 'decide', display: display('250000') }),
      item({ id: 3, stage: 'pay', display: display('70000') }),
      item({ id: 4, stage: 'paid', display: display('999900') }),
    ]
    const kpis = queueKpis(requests, 'RUB')
    expect(kpis.map((kpi) => [kpi.stage, kpi.label, kpi.sum.count, kpi.sum.amount])).toEqual([
      ['decide', 'Ждёт решения', 2, 350000n],
      ['pay', 'К оплате', 1, 70000n],
      ['reimburse', 'Вернуть сотрудникам', 0, 0n],
    ])
  })

  it('EARS-537: a clicked sum narrows the page to its own group, whatever the scope', () => {
    expect(queueGroupStages('active', 'pay')).toEqual(['pay'])
    expect(queueGroupStages('closed', 'reimburse')).toEqual(['reimburse'])
  })
})

describe('the row columns (EARS-538)', () => {
  it('EARS-538: names the age «сегодня», «вчера», «N дн. назад» in Moscow calendar days', () => {
    expect(requestAge('2026-11-18T06:00:00.000Z', NOW)).toEqual({ days: 0, label: 'сегодня' })
    expect(requestAge('2026-11-17T06:00:00.000Z', NOW)).toEqual({ days: 1, label: 'вчера' })
    expect(requestAge('2026-11-01T06:00:00.000Z', NOW)).toEqual({ days: 17, label: '17 дн. назад' })
  })

  it('EARS-538: highlights an age over 14 days only in an active group', () => {
    expect(isOverdue('decide', 15)).toBe(true)
    expect(isOverdue('draft', 15)).toBe(true)
    expect(isOverdue('decide', 14)).toBe(false)
    expect(isOverdue('paid', 30)).toBe(false)
    expect(isOverdue('refused', 30)).toBe(false)
  })

  it('EARS-538: pays the member for a personal-funds request, else the counterparty, else the member', () => {
    expect(
      queuePayee(item({ personalFunds: true, alreadyPaid: true, memberName: 'А. Петров' })),
    ).toEqual({ name: 'А. Петров', paidSelf: true })
    expect(queuePayee(item())).toEqual({ name: 'ООО «Студия-7»', paidSelf: false })
    expect(queuePayee(item({ counterparty: null, memberName: 'А. Петров' }))).toEqual({
      name: 'А. Петров',
      paidSelf: false,
    })
    expect(queuePayee(item({ counterparty: null }))).toEqual({ name: '—', paidSelf: false })
  })
})

describe('the order (EARS-539)', () => {
  it('EARS-539: sorts «Сумма» by the displayed, converted amount, and reverses on the second click', () => {
    const rows = [
      item({ id: 1, display: { ...display('500'), USD: rub('300') } }),
      item({ id: 2, display: { ...display('100'), USD: rub('900') } }),
    ]
    expect(sortQueueRows(rows, { key: 'amount', desc: true }, 'RUB').map((r) => r.id)).toEqual([
      1, 2,
    ])
    expect(sortQueueRows(rows, { key: 'amount', desc: true }, 'USD').map((r) => r.id)).toEqual([
      2, 1,
    ])
    expect(sortQueueRows(rows, { key: 'amount', desc: false }, 'USD').map((r) => r.id)).toEqual([
      1, 2,
    ])
  })

  it('EARS-539: breaks a tie by the newest request first', () => {
    const rows = [
      item({ id: 1, createdByName: 'Б', createdAt: '2026-11-01T10:00:00.000Z' }),
      item({ id: 2, createdByName: 'Б', createdAt: '2026-11-09T10:00:00.000Z' }),
      item({ id: 3, createdByName: 'А', createdAt: '2026-11-02T10:00:00.000Z' }),
    ]
    expect(sortQueueRows(rows, { key: 'author', desc: false }, 'RUB').map((r) => r.id)).toEqual([
      3, 2, 1,
    ])
  })

  it('EARS-539: puts a row with no rate after every converted one, in either direction', () => {
    const noRate: QueueDisplayAmount = { kind: 'no_rate', currency: 'USDC', date: '2026-11-18' }
    const rows = [
      item({ id: 1, display: { ...display('500'), RUB: noRate } }),
      item({ id: 2, display: display('100') }),
    ]
    for (const desc of [true, false]) {
      expect(sortQueueRows(rows, { key: 'amount', desc }, 'RUB').map((r) => r.id)).toEqual([2, 1])
    }
  })
})

describe('search and filters (EARS-540)', () => {
  const rows = [
    item({
      id: 41,
      createdBy: 5,
      createdByName: 'М. Иванова',
      note: 'Микрофон для подкаста',
      project: { id: 3, name: 'Doctor.School' },
      createdAt: '2026-11-15T10:00:00.000Z',
    }),
    item({
      id: 141,
      createdBy: 6,
      createdByName: 'К. Смирнов',
      counterparty: { id: 8, name: 'Типография «Лист»' },
      project: { id: 4, name: 'OrthoBioSchool' },
      product: { id: 9, name: 'Курс «Колено»' },
      createdAt: '2026-08-01T10:00:00.000Z',
    }),
  ]
  const ids = (filters: Partial<QueueFilters>) =>
    filterQueueRows(rows, { ...NO_FILTERS, ...filters }, { scope: 'active', now: NOW }).map(
      (r) => r.id,
    )

  it('EARS-540: «#N» finds exactly that request, not every number containing N', () => {
    expect(ids({ query: '#41' })).toEqual([41])
    expect(ids({ query: '#141' })).toEqual([141])
  })

  it('EARS-540: searches people, payee, purpose, note, project and product, case-insensitively', () => {
    expect(ids({ query: 'смирнов' })).toEqual([141])
    expect(ids({ query: 'лист' })).toEqual([141])
    expect(ids({ query: 'МИКРОФОН' })).toEqual([41])
    expect(ids({ query: 'orthobio' })).toEqual([141])
    expect(ids({ query: 'колено' })).toEqual([141])
    expect(ids({ query: 'продакшн' })).toEqual([41, 141])
  })

  it('EARS-540: filters by submitter, project and period of submission', () => {
    expect(ids({ author: 6 })).toEqual([141])
    expect(ids({ project: 3 })).toEqual([41])
    expect(ids({ period: '7' })).toEqual([41])
    expect(ids({ period: '90' })).toEqual([41])
    expect(ids({ period: 'all' })).toEqual([41, 141])
  })

  it('EARS-540: never narrows the three sums', () => {
    const filtered = filterQueueRows(
      rows,
      { ...NO_FILTERS, project: 3 },
      { scope: 'active', now: NOW },
    )
    expect(filtered).toHaveLength(1)
    expect(queueKpis(rows, 'RUB')[0].sum.count).toBe(2)
  })
})

describe('the row act (EARS-541)', () => {
  it('EARS-541: offers each group’s primary act to the approve role only', () => {
    expect(queueRowAct('decide', true)).toBe('approve')
    expect(queueRowAct('pay', true)).toBe('mark-paid')
    expect(queueRowAct('reimburse', true)).toBe('mark-reimbursed')
    expect(queueRowAct('draft', true)).toBeNull()
    expect(queueRowAct('paid', true)).toBeNull()
    for (const stage of ['decide', 'pay', 'reimburse'] as const) {
      expect(queueRowAct(stage, false)).toBeNull()
    }
  })
})

describe('the display currency (EARS-549/551)', () => {
  it('EARS-549: defaults to ₽ and reads back only a currency the switch offers', () => {
    expect(parseStoredDisplayCurrency(null)).toBe('RUB')
    expect(parseStoredDisplayCurrency('EUR')).toBe('EUR')
    expect(parseStoredDisplayCurrency('USDT')).toBe('RUB')
  })

  it('EARS-549: adds the exact converted values and rounds ONCE, at the end', () => {
    const third: QueueDisplayAmount = {
      kind: 'converted',
      amount: '33',
      numerator: '100',
      denominator: '3',
      basis: 'cbr',
      rateDate: '2026-11-18',
      reason: 'unpaid',
    }
    const rows = [1, 2, 3].map((id) => item({ id, display: { ...display('0'), USD: third } }))
    // 3 × 33.33… = 100 — rounding each term first would say 99.
    expect(sumInDisplay(rows, 'USD')).toEqual({ amount: 100n, count: 3, missing: 0 })
  })

  it('EARS-551: leaves a no-rate request out of the sum and counts it, never as zero', () => {
    const noRate: QueueDisplayAmount = { kind: 'no_rate', currency: 'USDC', date: '2026-11-18' }
    const rows = [item({ id: 1 }), item({ id: 2, display: { ...display('0'), RUB: noRate } })]
    expect(sumInDisplay(rows, 'RUB')).toEqual({ amount: 100000n, count: 2, missing: 1 })
    expect(sumInDisplay([rows[1]!], 'RUB')).toEqual({ amount: null, count: 1, missing: 1 })
  })

  it('EARS-551: says «без N заявок» in the right Russian form', () => {
    expect(missingRateNote(0)).toBeNull()
    expect(missingRateNote(1)).toBe('без 1 заявки')
    expect(missingRateNote(2)).toBe('без 2 заявок')
    expect(missingRateNote(5)).toBe('без 5 заявок')
    expect(missingRateNote(21)).toBe('без 21 заявки')
    expect(requestCountLabel(1)).toBe('1 заявка')
    expect(requestCountLabel(3)).toBe('3 заявки')
    expect(requestCountLabel(11)).toBe('11 заявок')
  })

  it('EARS-552: calls the stored rates stale once the newest is more than three days old', () => {
    expect(rateStaleness('2026-11-15', '2026-11-18')).toBeNull()
    expect(rateStaleness('2026-11-14', '2026-11-18')).toEqual({
      kind: 'stale',
      since: '2026-11-14',
    })
    expect(rateStaleness(null, '2026-11-18')).toEqual({ kind: 'none' })
  })
})

describe('the row as the owner reads it (review of #562, UX 2–7)', () => {
  it('names a request by what its author wrote, the purpose under it, and its number', () => {
    const titled = queueRowTitle(item({ id: 63, note: 'Figma Organization на год\nоплата картой' }))
    expect(titled).toEqual({ title: 'Figma Organization на год', subtitle: '№63 · Продакшн' })
    expect(queueRowTitle(item({ id: 7, note: '  ' }))).toEqual({
      title: 'Продакшн',
      subtitle: '№7',
    })
  })

  it('sorts «На что» by the line the row shows in bold', () => {
    const rows = [
      item({ id: 1, note: 'Я последний' }),
      item({ id: 2, note: 'А первый' }),
      item({ id: 3, note: null }),
    ]
    expect(sortQueueRows(rows, { key: 'purpose', desc: false }, 'RUB').map((r) => r.id)).toEqual([
      2, 3, 1,
    ])
  })

  it('finds a request by «№63», «№ 63» and «#63» alike — the number the row shows', () => {
    const rows = [item({ id: 63 }), item({ id: 163 })]
    for (const query of ['№63', '№ 63', '#63']) {
      expect(
        filterQueueRows(rows, { ...NO_FILTERS, query }, { scope: 'active', now: NOW }).map(
          (r) => r.id,
        ),
      ).toEqual([63])
    }
  })

  it('says what closed a request: the payment date, or the refusal reason', () => {
    expect(
      queueOutcome(
        item({
          stage: 'paid',
          occurredOn: '2026-08-29',
          operation: { id: 4, occurredOn: '2026-08-30', postings: [] },
        }),
      ),
    ).toEqual({ kind: 'paid', date: '2026-08-30' })
    expect(queueOutcome(item({ stage: 'paid', occurredOn: '2026-08-29' }))).toEqual({
      kind: 'paid',
      date: '2026-08-29',
    })
    expect(queueOutcome(item({ stage: 'refused', refusalReason: 'Дубль заявки №12' }))).toEqual({
      kind: 'refused',
      reason: 'Дубль заявки №12',
    })
    expect(queueOutcome(item({ stage: 'decide' }))).toBeNull()
    expect(queueOutcome(item({ stage: 'cancelled' }))).toBeNull()
  })

  it('marks a request filed in the last 24 hours as new', () => {
    expect(isNewRequest('2026-11-18T08:00:00.000Z', NOW)).toBe(true)
    expect(isNewRequest('2026-11-17T09:00:01.000Z', NOW)).toBe(true)
    expect(isNewRequest('2026-11-17T08:59:59.000Z', NOW)).toBe(false)
    const fresh = '2026-11-18T08:00:00.000Z'
    expect(isNewInQueue(item({ stage: 'draft', createdAt: fresh }), NOW)).toBe(true)
    expect(isNewInQueue(item({ stage: 'paid', createdAt: fresh }), NOW)).toBe(false)
    expect([1, 2, 5, 21].map(newCountLabel)).toEqual(['1 новая', '2 новые', '5 новых', '21 новая'])
  })

  it('prints every display amount with its two decimals, so a column lines up', () => {
    expect(formatDisplayMoney(125000n, 'USD')).toBe('1 250,00 $')
    expect(formatDisplayMoney(4124n, 'USD')).toBe('41,24 $')
    expect(formatDisplayMoney(-340000n, 'RUB')).toBe('−3 400,00 ₽')
  })

  it('prints the original amount with the same ₽ / $ / € the converted one uses', () => {
    expect(formatOriginalMoney('340000', 'RUB', 2)).toBe('3 400,00 ₽')
    expect(formatOriginalMoney('125000', 'USD', 2)).toBe('1 250,00 $')
    expect(formatOriginalMoney('84000', 'EUR', 2)).toBe('840,00 €')
    expect(formatOriginalMoney('30000000', 'USDC', 6)).toBe('30,000000 USDC')
  })
})

describe('the owner finds the latest request (pre-acceptance UX pass, «не вижу последнюю заявку»)', () => {
  it('names the newest SUBMITTED request of any stage — never a draft — and counts the ones of the last 24 hours', () => {
    const rows = [
      item({ id: 1, stage: 'paid', createdAt: '2026-11-18T07:00:00.000Z' }),
      item({ id: 2, stage: 'draft', createdAt: '2026-11-18T08:30:00.000Z' }),
      item({ id: 3, stage: 'decide', createdAt: '2026-11-17T10:00:00.000Z' }),
      item({ id: 4, stage: 'pay', createdAt: '2026-11-10T10:00:00.000Z' }),
    ]
    const latest = latestRequest(rows, NOW)
    expect(latest?.request.id).toBe(1)
    // №1 (paid, filed today) and №3 count; the draft does not; №4 is a week old.
    expect(latest?.fresh).toBe(2)
  })

  it('is nothing when only drafts exist, and counts zero fresh ones when the newest is old', () => {
    expect(latestRequest([item({ stage: 'draft' })], NOW)).toBeNull()
    expect(latestRequest([], NOW)).toBeNull()
    expect(latestRequest([item({ id: 9, createdAt: '2026-11-01T10:00:00.000Z' })], NOW)).toEqual({
      request: expect.objectContaining({ id: 9 }),
      fresh: 0,
    })
  })

  it('says how old the latest one is in minutes and hours on its first day, then in days', () => {
    expect(latestRequestAge('2026-11-18T08:59:30.000Z', NOW)).toBe('только что')
    expect(latestRequestAge('2026-11-18T08:35:00.000Z', NOW)).toBe('25 мин назад')
    expect(latestRequestAge('2026-11-18T06:00:00.000Z', NOW)).toBe('3 ч назад')
    expect(latestRequestAge('2026-11-16T10:00:00.000Z', NOW)).toBe('2 дн. назад')
  })
})

describe('the stage groups read as tiers (pre-acceptance UX pass)', () => {
  it('decide and pay are the primary work, reimburse secondary, drafts and the closed ones archived', () => {
    expect(QUEUE_GROUPS.decide.tier).toBe('primary')
    expect(QUEUE_GROUPS.pay.tier).toBe('primary')
    expect(QUEUE_GROUPS.reimburse.tier).toBe('secondary')
    for (const stage of ['draft', 'paid', 'refused', 'cancelled'] as const) {
      expect(QUEUE_GROUPS[stage].tier).toBe('archived')
    }
  })
})
