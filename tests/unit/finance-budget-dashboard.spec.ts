/**
 * The budget dashboard read model (spec 584, issue #586) — the months, the
 * trailing averages, the runway's cases, the waterline and the three
 * breakdowns, built over the §D replay's per-item values. Asserted on
 * synthetic ledgers only (no real amount, EARS-338); every ledger is checked
 * for the sums spec 584 requires to hold exactly in `B`.
 */
import { describe, expect, it } from 'vitest'

import {
  buildBudgetDashboard,
  parseBudgetPeriod,
  type BudgetDashboard,
  type BudgetOperationMeta,
} from '@/lib/finance/budget/dashboard'
import {
  replayBudget,
  type BudgetFigure,
  type BudgetOperationFact,
  type BudgetPostingFact,
} from '@/lib/finance/budget/replay'

const FUND = 1
const DOCTOR = 2
const MEMBER = 7
const ADS = 11
const TEAM = 12

type Account = { id: number; kind: string; isSystem: boolean; currency: string }
let nextId = 1
const accounts = new Map<string, Account>()
function account(kind: string, currency: string): Account {
  const key = `${kind}:${currency}`
  let found = accounts.get(key)
  if (found === undefined) {
    found = { id: nextId++, kind, currency, isSystem: kind !== 'bank' }
    accounts.set(key, found)
  }
  return found
}
type Leg = Omit<BudgetPostingFact, 'postingId'>
function leg(
  acc: Account,
  amount: bigint,
  extra: Partial<Pick<Leg, 'projectId' | 'memberId' | 'categoryId'>> = {},
): Leg {
  return {
    accountId: acc.id,
    accountKind: acc.kind,
    isSystem: acc.isSystem,
    currency: acc.currency,
    amount,
    projectId: extra.projectId ?? null,
    memberId: extra.memberId ?? null,
    categoryId: extra.categoryId ?? null,
    conversionStepNo: null,
  }
}
let nextOperation = 1
let nextPosting = 1
function op(
  occurredOn: string,
  legs: Leg[],
  options: { intakeItemId?: number; settlesItemId?: number; reverses?: number } = {},
): BudgetOperationFact {
  return {
    operationId: nextOperation++,
    occurredOn,
    reverses: options.reverses ?? null,
    intakeItemId: options.intakeItemId ?? null,
    settlesItemId: options.settlesItemId ?? null,
    steps: [],
    postings: legs.map((posting) => ({ postingId: nextPosting++, ...posting })),
  }
}
const bank = () => account('bank', 'RUB')
function contribute(date: string, amount: bigint) {
  return op(date, [
    leg(bank(), amount),
    leg(account('equity', 'RUB'), -amount, { projectId: FUND, memberId: MEMBER }),
  ])
}
function earn(date: string, amount: bigint) {
  return op(date, [
    leg(bank(), amount),
    leg(account('income', 'RUB'), -amount, { projectId: FUND }),
  ])
}
function spend(date: string, amount: bigint, projectId: number, categoryId: number | null) {
  return op(date, [
    leg(bank(), -amount),
    leg(account('expense', 'RUB'), amount, { projectId, categoryId }),
  ])
}
function personalUsd(date: string, cents: bigint, itemId: number) {
  return op(
    date,
    [
      leg(account('liability', 'USD'), -cents, { memberId: MEMBER }),
      leg(account('expense', 'USD'), cents, { projectId: DOCTOR, categoryId: ADS }),
    ],
    { intakeItemId: itemId },
  )
}
function reimburse(date: string, cents: bigint, roubles: bigint, itemId: number, settles: number) {
  const operation = op(
    date,
    [
      leg(account('liability', 'USD'), cents, { memberId: MEMBER }),
      leg(account('conversion', 'USD'), -cents),
      leg(account('conversion', 'RUB'), roubles),
      leg(bank(), -roubles),
    ],
    { intakeItemId: itemId, settlesItemId: settles },
  )
  operation.postings[1]!.conversionStepNo = 1
  operation.postings[2]!.conversionStepNo = 1
  operation.steps = [{ stepNo: 1, fromCurrency: 'RUB', toCurrency: 'USD' }]
  return operation
}

const TODAY = '2026-06-15'

function dashboard(
  operations: BudgetOperationFact[],
  options: {
    limit?: bigint
    startsOn?: string
    period?: string
    meta?: Map<number, BudgetOperationMeta>
    today?: string
  } = {},
): BudgetDashboard {
  const reading = replayBudget({
    budget: {
      currency: 'RUB',
      limitAmount: options.limit ?? 1_000_000_00n,
      startsOn: options.startsOn ?? '2026-01-10',
    },
    operations,
    provisionalValue: (_currency, _date, quantity) => quantity * 90n,
  })
  return buildBudgetDashboard({
    reading,
    today: options.today ?? TODAY,
    period: parseBudgetPeriod(options.period),
    operations: options.meta ?? new Map(),
    names: {
      projects: new Map([
        [FUND, 'BBM'],
        [DOCTOR, 'Доктор'],
      ]),
      categories: new Map([
        [ADS, 'Реклама'],
        [TEAM, 'Команда'],
      ]),
      counterparties: new Map([[50, 'Яндекс']]),
    },
  })
}

const known = (figure: BudgetFigure): bigint => {
  if (figure.status !== 'known') throw new Error('withheld')
  return figure.amount
}
const sum = (figures: BudgetFigure[]) => figures.reduce((total, f) => total + known(f), 0n)

function expectSums(view: BudgetDashboard) {
  const spent = known(view.glass.spent)
  expect(sum(view.months.map((month) => month.gross))).toBe(spent)
  for (const grouping of Object.values(view.breakdown)) {
    expect(known(grouping.total)).toBe(
      sum(view.months.filter((m) => m.inPeriod).map((m) => m.gross)),
    )
    expect(sum(grouping.lines.map((line) => line.value))).toBe(known(grouping.total))
    for (const line of grouping.lines) {
      expect(sum(line.rows.map((row) => row.value))).toBe(known(line.value))
    }
  }
}

describe('budget dashboard (spec 584)', () => {
  it('EARS-710/711/712: buckets months that sum to spent, marks partial months and averages the last 3 complete', () => {
    const view = dashboard([
      contribute('2026-01-10', 500_000_00n),
      spend('2026-01-20', 10_000_00n, FUND, TEAM),
      spend('2026-02-05', 20_000_00n, DOCTOR, ADS),
      spend('2026-03-05', 30_000_00n, DOCTOR, ADS),
      spend('2026-04-05', 40_000_00n, FUND, TEAM),
      spend('2026-05-05', 50_000_00n, FUND, null),
      spend('2026-06-02', 7_000_00n, FUND, TEAM),
    ])
    expect(view.months.map((month) => month.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ])
    expect(view.months[0]!.partial).toBe('first')
    expect(view.months[5]!.partial).toBe('current')
    expect(view.runway.averagedMonths).toEqual(['2026-03', '2026-04', '2026-05'])
    expect(view.runway.avgGross).toEqual({ status: 'known', amount: 40_000_00n })
    // EARS-707: remaining × N ÷ Σ gross, one decimal toward zero.
    // remaining = 1 000 000 − 157 000 = 843 000; × 3 ÷ 120 000 = 21.075 → 21.0
    expect(view.runway).toMatchObject({ case: 'value', months: '21,0', n: 3 })
    expect(view.glass.shareUsed).toBe('15,7')
    expect(view.glass.state).toBe('normal')
    expectSums(view)
  })

  it('EARS-707/713: keeps the runway on gross burn when income exists, and ends the waterline at income − spent', () => {
    const view = dashboard([
      contribute('2026-01-10', 500_000_00n),
      spend('2026-03-05', 30_000_00n, FUND, TEAM),
      spend('2026-04-05', 30_000_00n, FUND, TEAM),
      spend('2026-05-05', 30_000_00n, FUND, TEAM),
      earn('2026-05-20', 9_000_00n),
    ])
    expect(view.runway.avgGross).toEqual({ status: 'known', amount: 30_000_00n })
    expect(view.runway.avgNet).toEqual({ status: 'known', amount: 27_000_00n })
    expect(view.runway.months).toBe('30,3')
    const last = view.waterline.at(-1)!
    expect(last.net).toEqual({ status: 'known', amount: 9_000_00n - 90_000_00n })
    expect(last.contributed).toEqual({ status: 'known', amount: 500_000_00n })
    expect(view.incomeNote).toBe(true)
    expect(view.money.equation).not.toBeNull()
    expectSums(view)
  })

  it('EARS-707: decides the runway cases in their stated order', () => {
    const overrun = dashboard([spend('2026-02-05', 2_000_00n, FUND, TEAM)], { limit: 1_000_00n })
    expect(overrun.runway.case).toBe('exhausted')
    expect(overrun.glass.state).toBe('overflow')
    expect(overrun.glass.remaining).toEqual({ status: 'known', amount: -1_000_00n })

    const young = dashboard([spend('2026-06-05', 1_000_00n, FUND, TEAM)], {
      startsOn: '2026-06-01',
    })
    expect(young.runway.case).toBe('needMonth')

    const idle = dashboard([spend('2026-01-15', 1_000_00n, FUND, TEAM)])
    expect(idle.runway.case).toBe('noSpend')
    expect(idle.runway.n).toBe(3)
  })

  it('EARS-716/717: groups by project, category and counterparty, with the exchange-result line last', () => {
    const meta = new Map<number, BudgetOperationMeta>()
    const operations = [
      contribute('2026-01-10', 500_000_00n),
      personalUsd('2026-03-03', 100_00n, 900),
      reimburse('2026-03-20', 100_00n, 9_500_00n, 901, 900),
      spend('2026-04-05', 40_000_00n, FUND, TEAM),
    ]
    meta.set(operations[1]!.operationId, {
      purpose: 'Реклама в сети',
      counterpartyId: 50,
      requestItemId: 900,
    })
    const view = dashboard(operations, { meta })
    const category = view.breakdown.category
    expect(category.lines.map((line) => line.name)).toEqual([
      'Команда',
      'Реклама',
      'курсовой результат',
    ])
    expect(category.lines.at(-1)!.value).toEqual({ status: 'known', amount: 500_00n })
    const counterparty = view.breakdown.counterparty
    expect(counterparty.lines.map((line) => line.name)).toEqual([
      'без контрагента',
      'Яндекс',
      'курсовой результат',
    ])
    const ads = category.lines[1]!
    expect(ads.rows[0]).toMatchObject({
      purpose: 'Реклама в сети',
      counterparty: 'Яндекс',
      project: 'Доктор',
      ownAmounts: [{ currency: 'USD', amount: 100_00n }],
      requestItemId: 900,
    })
    expect(category.lines.map((line) => line.share)).toEqual(['80,8', '18,2', '1,0'])
    expectSums(view)
  })

  it('EARS-719: marks the provisional value of an open foreign debt, and clears it on reimbursement', () => {
    const open = [contribute('2026-01-10', 500_000_00n), personalUsd('2026-03-03', 100_00n, 900)]
    const provisional = dashboard(open)
    expect(provisional.glass.provisional).toEqual({
      count: 1,
      amount: { status: 'known', amount: 9_000_00n },
    })
    expect(provisional.months.find((month) => month.month === '2026-03')!.provisional).toBe(true)
    expect(provisional.months.find((month) => month.month === '2026-02')!.provisional).toBe(false)
    expect(provisional.waterline.find((point) => point.month === '2026-04')!.provisional).toBe(true)
    expect(provisional.runway.provisional).toBe(true)
    expect(provisional.breakdown.category.lines[0]!.provisional).toBe(true)

    const settled = dashboard([...open, reimburse('2026-03-20', 100_00n, 9_500_00n, 901, 900)])
    expect(settled.glass.provisional).toBeNull()
    expect(settled.months.some((month) => month.provisional)).toBe(false)
  })

  it('EARS-715: narrows the months and the breakdown to the period, leaving the glass and runway alone', () => {
    const operations = [
      contribute('2026-01-10', 500_000_00n),
      spend('2026-03-05', 30_000_00n, FUND, TEAM),
      spend('2026-06-05', 5_000_00n, DOCTOR, ADS),
    ]
    const all = dashboard(operations)
    const month = dashboard(operations, { period: 'month' })
    expect(month.period.key).toBe('month')
    expect(month.months.filter((m) => m.inPeriod).map((m) => m.month)).toEqual(['2026-06'])
    expect(month.breakdown.project.total).toEqual({ status: 'known', amount: 5_000_00n })
    expect(month.glass).toEqual(all.glass)
    expect(month.runway).toEqual(all.runway)
    expect(parseBudgetPeriod('nonsense')).toBe('all')
    expectSums(month)
  })

  it('keeps each line on the hue slot of its lifetime rank under any period', () => {
    const operations = [
      contribute('2026-01-10', 500_000_00n),
      spend('2026-03-05', 30_000_00n, FUND, TEAM),
      spend('2026-06-05', 5_000_00n, DOCTOR, ADS),
    ]
    const slots = (view: BudgetDashboard) =>
      Object.fromEntries(view.breakdown.category.lines.map((line) => [line.name, line.slot]))
    expect(slots(dashboard(operations))).toEqual({ Команда: 0, Реклама: 1 })
    // under «Этот месяц» only Реклама is shown, and it keeps slot 1
    expect(slots(dashboard(operations, { period: 'month' }))).toEqual({ Реклама: 1 })
  })

  it('removes a reversed operation from its own month', () => {
    const original = spend('2026-03-05', 30_000_00n, FUND, TEAM)
    const reversal = op(
      '2026-05-01',
      original.postings.map(({ postingId: _postingId, ...posting }) => ({
        ...posting,
        amount: -posting.amount,
      })),
      { reverses: original.operationId },
    )
    const view = dashboard([contribute('2026-01-10', 500_000_00n), original, reversal])
    expect(view.months.find((month) => month.month === '2026-03')!.gross).toEqual({
      status: 'known',
      amount: 0n,
    })
    expect(view.empty).toBe(false)
  })

  it('EARS-705: says the window is empty while no operation counts', () => {
    const view = dashboard([], { startsOn: '2026-06-01' })
    expect(view.empty).toBe(true)
    expect(view.glass.spent).toEqual({ status: 'known', amount: 0n })
  })

  it('EARS-720: withholds a month and every waterline point from it on', () => {
    const view = dashboard([
      spend('2026-02-05', 1_000_00n, FUND, TEAM),
      op('2026-03-05', [
        leg(account('bank', 'THB'), -1_000_00n),
        leg(account('expense', 'THB'), 1_000_00n, { projectId: FUND, categoryId: TEAM }),
      ]),
    ])
    expect(view.months.find((m) => m.month === '2026-02')!.gross.status).toBe('known')
    expect(view.months.find((m) => m.month === '2026-03')!.gross).toEqual({
      status: 'withheld',
      currencies: ['THB'],
    })
    expect(view.waterline.find((p) => p.month === '2026-02')!.net.status).toBe('known')
    expect(view.waterline.find((p) => p.month === '2026-05')!.net.status).toBe('withheld')
    expect(view.runway.case).toBe('withheld')
    expect(view.breakdown.category.addsUp).toBe(false)
  })
})
