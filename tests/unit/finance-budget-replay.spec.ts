/**
 * The budget cost-basis replay (spec 338 §D EARS-340…345), asserted on the
 * «§D fixtures» list of the spec — only the read model's public output, and on
 * every numeric fixture the EARS-344 identity
 * contributed + income = spent + cash at cost − owed.
 *
 * The operations are built as the ledger writes them (`operations.ts`,
 * `conversions.ts`, `intake/posting.ts`): money legs, step-linked legs on the
 * system `conversion` account, a fee as the step's own expense posting, and —
 * where fixture 2 needs it — the EARS-328 `fx_result` legs the replay ignores.
 * Amounts are synthetic minor units (EARS-338: no real figure in the repo).
 */
import { describe, expect, it } from 'vitest'

import {
  replayBudget,
  type BudgetFigure,
  type BudgetOperationFact,
  type BudgetPostingFact,
  type BudgetReading,
} from '@/lib/finance/budget/replay'

const FUND = 1
const P = 2
const MEMBER = 7
const START = '2026-01-01'

type Account = { id: number; kind: string; isSystem: boolean; currency: string }
const accounts = new Map<string, Account>()
let nextAccountId = 100
function account(kind: string, currency: string, name = kind): Account {
  const key = `${name}:${kind}:${currency}`
  let found = accounts.get(key)
  if (found === undefined) {
    found = {
      id: nextAccountId++,
      kind,
      currency,
      isSystem: !['bank', 'card', 'crypto', 'cash'].includes(kind),
    }
    accounts.set(key, found)
  }
  return found
}
const bank = (currency: string) => account('bank', currency, 'bank')
const sys = (kind: string, currency: string) => account(kind, currency)

let nextPostingId = 1
let nextOperationId = 1

type Leg = Omit<BudgetPostingFact, 'postingId'>
function leg(
  acc: Account,
  amount: bigint,
  extra: Partial<Pick<Leg, 'projectId' | 'memberId' | 'conversionStepNo'>> = {},
): Leg {
  return {
    accountId: acc.id,
    accountKind: acc.kind,
    isSystem: acc.isSystem,
    currency: acc.currency,
    amount,
    projectId: extra.projectId ?? null,
    memberId: extra.memberId ?? null,
    conversionStepNo: extra.conversionStepNo ?? null,
  }
}

function op(
  occurredOn: string,
  legs: Leg[],
  options: {
    steps?: { fromCurrency: string; toCurrency: string }[]
    intakeItemId?: number | null
    settlesItemId?: number | null
    reverses?: number | null
  } = {},
): BudgetOperationFact {
  return {
    operationId: nextOperationId++,
    occurredOn,
    reverses: options.reverses ?? null,
    intakeItemId: options.intakeItemId ?? null,
    settlesItemId: options.settlesItemId ?? null,
    steps: (options.steps ?? []).map((step, index) => ({ stepNo: index + 1, ...step })),
    postings: legs.map((posting) => ({ postingId: nextPostingId++, ...posting })),
  }
}

/** A contribution (EARS-336): money debit, equity credit on the fund. */
function contribute(date: string, currency: string, amount: bigint, onto = bank(currency)) {
  return op(date, [
    leg(onto, amount),
    leg(sys('equity', currency), -amount, { projectId: FUND, memberId: MEMBER }),
  ])
}

/** A plain expense paid from a money account in its own currency. */
function expense(date: string, from: Account, amount: bigint, projectId: number) {
  return op(date, [leg(from, -amount), leg(sys('expense', from.currency), amount, { projectId })])
}

/** A one-step conversion between two money accounts (`recordConversion`'s legs). */
function convert(
  date: string,
  from: { account: Account; amount: bigint },
  to: { account: Account; amount: bigint },
  extraLegs: Leg[] = [],
) {
  return op(
    date,
    [
      leg(from.account, -from.amount),
      leg(to.account, to.amount),
      leg(sys('conversion', from.account.currency), from.amount, { conversionStepNo: 1 }),
      leg(sys('conversion', to.account.currency), -to.amount, { conversionStepNo: 1 }),
      ...extraLegs,
    ],
    { steps: [{ fromCurrency: from.account.currency, toCurrency: to.account.currency }] },
  )
}

/** A member's personal-card expense (spec 339 EARS-513): liability credit(s), expense debit(s). */
function personalExpense(
  date: string,
  currency: string,
  amount: bigint,
  projectId: number,
  itemId: number,
  fee?: bigint,
) {
  const legs = [
    leg(sys('liability', currency), -amount, { memberId: MEMBER }),
    leg(sys('expense', currency), amount, { projectId }),
  ]
  if (fee !== undefined) {
    legs.push(leg(sys('liability', currency), -fee, { memberId: MEMBER }))
    legs.push(leg(sys('expense', currency), fee, { projectId }))
  }
  return op(date, legs, { intakeItemId: itemId })
}

const NO_RATE = () => null
/** A reading date after every fixture's operations, so none is skipped as planned. */
const AS_OF = '2099-12-31'

function read(
  operations: BudgetOperationFact[],
  options: {
    limit?: bigint
    startsOn?: string
    provisional?: (currency: string, date: string, quantity: bigint) => bigint | null
  } = {},
): BudgetReading {
  return replayBudget({
    budget: {
      currency: 'RUB',
      limitAmount: options.limit ?? 1_000_000n,
      startsOn: options.startsOn ?? START,
    },
    operations,
    provisionalValue: options.provisional ?? NO_RATE,
    asOf: AS_OF,
  })
}

function known(figure: BudgetFigure): bigint {
  if (figure.status !== 'known') throw new Error(`withheld: ${figure.currencies.join(',')}`)
  return figure.amount
}

function project(reading: BudgetReading, projectId: number): bigint {
  const line = reading.breakdown.projects.find((row) => row.projectId === projectId)
  return line === undefined ? 0n : known(line.spent)
}

/** EARS-344 — contributed + income = spent + cash at cost − owed, exactly. */
function expectIdentity(reading: BudgetReading): void {
  expect(known(reading.contributed) + known(reading.income)).toBe(
    known(reading.spent) + known(reading.cashAtCost) - known(reading.owed),
  )
}

/** EARS-345 — the lines sum exactly to «spent». */
function expectBreakdownSums(reading: BudgetReading): void {
  const lines = reading.breakdown.projects.reduce((sum, row) => sum + known(row.spent), 0n)
  expect(lines + known(reading.breakdown.exchangeResult)).toBe(known(reading.spent))
}

describe('budget cost-basis replay — spec 338 §D fixtures', () => {
  it('EARS-341: fixture 1 — the plain path; a personal-card expense counts on its spend date and its reimbursement is not spent again', () => {
    const member = personalExpense('2026-02-03', 'RUB', 5_000n, FUND, 501)
    const ops = [
      contribute('2026-02-01', 'RUB', 100_000n),
      expense('2026-02-02', bank('RUB'), 30_000n, P),
      member,
      // The approved, unposted 10_000 request of «P» is not an operation at all.
    ]
    const before = read(ops)
    expect(known(before.spent)).toBe(35_000n)
    expect(project(before, P)).toBe(30_000n)
    expect(project(before, FUND)).toBe(5_000n)
    expect(known(before.breakdown.exchangeResult)).toBe(0n)
    expect(known(before.contributed)).toBe(100_000n)
    expect(known(before.owed)).toBe(5_000n)
    expect(known(before.cashAtCost)).toBe(70_000n)
    expectIdentity(before)
    expectBreakdownSums(before)

    const reimbursement = op(
      '2026-02-10',
      [leg(bank('RUB'), -5_000n), leg(sys('liability', 'RUB'), 5_000n, { memberId: MEMBER })],
      { intakeItemId: 502, settlesItemId: 501 },
    )
    const after = read([...ops, reimbursement])
    expect(known(after.spent)).toBe(35_000n)
    expect(known(after.owed)).toBe(0n)
    expect(known(after.cashAtCost)).toBe(65_000n)
    expectIdentity(after)
  })

  it('EARS-336: fixture 1 — a contribution is never income and raises neither «spent» nor the limit', () => {
    const reading = read([contribute('2026-02-01', 'RUB', 100_000n)], { limit: 50_000n })
    expect(known(reading.income)).toBe(0n)
    expect(known(reading.contributed)).toBe(100_000n)
    expect(known(reading.spent)).toBe(0n)
    expect(known(reading.remaining)).toBe(50_000n)
  })

  it('EARS-340: fixture 2 — a spend depletes the cost basis; the ledger fx_result legs are ignored', () => {
    const thb = bank('THB')
    const rub = bank('RUB')
    const reading = read([
      contribute('2026-03-01', 'RUB', 160_000n),
      convert('2026-03-02', { account: rub, amount: 100_000n }, { account: thb, amount: 10_000n }),
      expense('2026-03-03', thb, 5_000n, P),
      convert('2026-03-04', { account: rub, amount: 60_000n }, { account: thb, amount: 5_000n }),
      // The EARS-328 pool posts a 3_333 gain here; the replay must not read it.
      convert('2026-03-05', { account: thb, amount: 10_000n }, { account: rub, amount: 110_000n }, [
        leg(sys('fx_result', 'RUB'), -3_333n, { projectId: FUND }),
        leg(sys('conversion', 'RUB'), 3_333n),
      ]),
    ])
    expect(known(reading.spent)).toBe(50_000n)
    expect(known(reading.breakdown.exchangeResult)).toBe(0n)
    expect(known(reading.cashAtCost)).toBe(110_000n)
    expect(known(reading.contributed)).toBe(160_000n)
    expectIdentity(reading)
  })

  it('EARS-341: fixture 3 — a loss on a round trip is spent, on the projectless exchange line', () => {
    const thb = bank('THB')
    const rub = bank('RUB')
    const reading = read([
      contribute('2026-03-01', 'RUB', 100_000n),
      convert('2026-03-02', { account: rub, amount: 100_000n }, { account: thb, amount: 10_000n }),
      expense('2026-03-03', thb, 5_000n, P),
      convert('2026-03-04', { account: thb, amount: 5_000n }, { account: rub, amount: 45_000n }),
    ])
    expect(known(reading.spent)).toBe(55_000n)
    expect(project(reading, P)).toBe(50_000n)
    expect(known(reading.breakdown.exchangeResult)).toBe(5_000n)
    expect(known(reading.cashAtCost)).toBe(45_000n)
    expectIdentity(reading)
    expectBreakdownSums(reading)
  })

  it('EARS-340: fixture 4 — a multi-hop chain carries its cost to the last currency', () => {
    const thb = bank('THB')
    const rub = bank('RUB')
    const chain = op(
      '2026-04-02',
      [
        leg(rub, -100_000n),
        leg(thb, 30_000n),
        leg(sys('conversion', 'RUB'), 100_000n, { conversionStepNo: 1 }),
        leg(sys('conversion', 'USDT'), -1_000n, { conversionStepNo: 1 }),
        leg(sys('conversion', 'USDT'), 1_000n, { conversionStepNo: 2 }),
        leg(sys('conversion', 'THB'), -30_000n, { conversionStepNo: 2 }),
      ],
      {
        steps: [
          { fromCurrency: 'RUB', toCurrency: 'USDT' },
          { fromCurrency: 'USDT', toCurrency: 'THB' },
        ],
      },
    )
    const ops = [contribute('2026-04-01', 'RUB', 100_000n), chain]
    expect(known(read(ops).cashAtCost)).toBe(100_000n)
    const reading = read([
      ...ops,
      convert('2026-04-03', { account: thb, amount: 30_000n }, { account: rub, amount: 90_000n }),
    ])
    expect(known(reading.breakdown.exchangeResult)).toBe(10_000n)
    expect(known(reading.spent)).toBe(10_000n)
    expect(known(reading.cashAtCost)).toBe(90_000n)
    expectIdentity(reading)
  })

  it("EARS-340: fixture 5 — a cross-currency payment costs what the paying side gave up; a step's fee is its own expense", () => {
    const rub = bank('RUB')
    const usd = bank('USD')
    const invoice = op(
      '2026-05-02',
      [
        leg(rub, -8_750n),
        leg(sys('conversion', 'RUB'), 8_750n, { conversionStepNo: 1 }),
        leg(sys('conversion', 'THB'), -3_500n, { conversionStepNo: 1 }),
        leg(sys('expense', 'THB'), 3_500n, { projectId: P }),
      ],
      { steps: [{ fromCurrency: 'RUB', toCurrency: 'THB' }] },
    )
    const base = [contribute('2026-05-01', 'RUB', 100_000n), invoice]
    expect(known(read(base).spent)).toBe(8_750n)
    const reading = read([
      ...base,
      convert('2026-05-03', { account: rub, amount: 10_000n }, { account: usd, amount: 10_000n }, [
        leg(sys('expense', 'USD'), 5_000n, { projectId: FUND, conversionStepNo: 1 }),
        leg(usd, -5_000n, { conversionStepNo: 1 }),
      ]),
    ])
    expect(known(reading.spent)).toBe(8_750n + 5_000n)
    expect(project(reading, FUND)).toBe(5_000n)
    // 100_000 − 8_750 − 10_000 in RUB, plus the 5_000 USD held at 5_000.
    expect(known(reading.cashAtCost)).toBe(81_250n + 5_000n)
    expectIdentity(reading)
  })

  it('EARS-341: fixture 6 — a rouble expense paid out of a foreign holding is counted once', () => {
    const thb = bank('THB')
    const rub = bank('RUB')
    const pay = op(
      '2026-06-03',
      [
        leg(thb, -1_000n),
        leg(sys('conversion', 'THB'), 1_000n, { conversionStepNo: 1 }),
        leg(sys('conversion', 'RUB'), -9_000n, { conversionStepNo: 1 }),
        leg(sys('expense', 'RUB'), 9_000n, { projectId: P }),
      ],
      { steps: [{ fromCurrency: 'THB', toCurrency: 'RUB' }] },
    )
    const reading = read([
      contribute('2026-06-01', 'RUB', 100_000n),
      convert('2026-06-02', { account: rub, amount: 100_000n }, { account: thb, amount: 10_000n }),
      pay,
    ])
    expect(known(reading.spent)).toBe(10_000n)
    expect(project(reading, P)).toBe(9_000n)
    expect(known(reading.breakdown.exchangeResult)).toBe(1_000n)
    expect(known(reading.cashAtCost)).toBe(90_000n)
    expectIdentity(reading)
    expectBreakdownSums(reading)
  })

  it('EARS-340: fixture 7 — a chain through the budget currency carries cost, not a result', () => {
    const thb = bank('THB')
    const rub = bank('RUB')
    const usd = bank('USD')
    const chain = op(
      '2026-07-03',
      [
        leg(thb, -10_000n),
        leg(usd, 1_000n),
        leg(sys('conversion', 'THB'), 10_000n, { conversionStepNo: 1 }),
        leg(sys('conversion', 'RUB'), -90_000n, { conversionStepNo: 1 }),
        leg(sys('conversion', 'RUB'), 90_000n, { conversionStepNo: 2 }),
        leg(sys('conversion', 'USD'), -1_000n, { conversionStepNo: 2 }),
      ],
      {
        steps: [
          { fromCurrency: 'THB', toCurrency: 'RUB' },
          { fromCurrency: 'RUB', toCurrency: 'USD' },
        ],
      },
    )
    const base = [
      contribute('2026-07-01', 'RUB', 100_000n),
      convert('2026-07-02', { account: rub, amount: 100_000n }, { account: thb, amount: 10_000n }),
    ]
    const reading = read([...base, chain])
    expect(known(reading.breakdown.exchangeResult)).toBe(0n)
    expect(known(reading.spent)).toBe(0n)
    expect(known(reading.cashAtCost)).toBe(100_000n)
    expectIdentity(reading)
  })

  it('EARS-345: fixture 8 — rounding that does not divide evenly; the last use takes the remainder', () => {
    const thb = bank('THB')
    const rub = bank('RUB')
    const twoExpenses = op('2026-08-04', [
      leg(thb, -2n),
      leg(sys('expense', 'THB'), 1n, { projectId: FUND }),
      leg(sys('expense', 'THB'), 1n, { projectId: P }),
    ])
    const reading = read([
      contribute('2026-08-01', 'RUB', 10n),
      convert('2026-08-02', { account: rub, amount: 10n }, { account: thb, amount: 3n }),
      expense('2026-08-03', thb, 1n, P),
      twoExpenses,
    ])
    expect(known(reading.spent)).toBe(10n)
    expect(project(reading, P)).toBe(6n)
    expect(project(reading, FUND)).toBe(4n)
    expect(known(reading.cashAtCost)).toBe(0n)
    expect(known(reading.contributed)).toBe(10n)
    expectIdentity(reading)
    expectBreakdownSums(reading)
  })

  it('EARS-340: fixture 9 — no recorded cost, no number; only «cash at cost» recovers', () => {
    const usdt = account('crypto', 'USDT', 'wallet')
    const contribution = contribute('2026-09-01', 'USDT', 1_000n, usdt)
    const first = read([contribution])
    expect(first.contributed).toEqual({ status: 'withheld', currencies: ['USDT'] })
    expect(first.cashAtCost).toEqual({ status: 'withheld', currencies: ['USDT'] })

    const spend = expense('2026-09-02', usdt, 100n, P)
    const second = read([contribution, spend])
    expect(second.spent).toEqual({ status: 'withheld', currencies: ['USDT'] })
    expect(second.remaining).toEqual({ status: 'withheld', currencies: ['USDT'] })

    const third = read([contribution, spend, expense('2026-09-03', usdt, 900n, P)])
    expect(known(third.cashAtCost)).toBe(0n)
    expect(third.spent.status).toBe('withheld')
    expect(third.remaining.status).toBe('withheld')
    expect(third.contributed.status).toBe('withheld')
  })

  it('EARS-340: fixture 9 — a personal-card debt with no Bank of Russia rate for its day is withheld, its currency named', () => {
    const reading = read([
      contribute('2026-09-01', 'RUB', 100_000n),
      personalExpense('2026-09-02', 'THB', 10_000n, P, 601),
    ])
    expect(reading.spent).toEqual({ status: 'withheld', currencies: ['THB'] })
    expect(reading.owed).toEqual({ status: 'withheld', currencies: ['THB'] })
    expect(known(reading.cashAtCost)).toBe(100_000n)
  })

  it('EARS-342: fixture 10 — a reversed pair leaves «spent» unchanged; the window and the sign', () => {
    const paid = expense('2026-10-05', bank('RUB'), 10_000n, P)
    const reversal = op(
      '2025-12-01',
      paid.postings.map(({ postingId: _postingId, ...posting }) => ({
        ...posting,
        amount: -posting.amount,
      })),
      { reverses: paid.operationId },
    )
    const ops = [
      contribute('2025-12-01', 'RUB', 100_000n),
      expense('2025-12-31', bank('RUB'), 7_000n, P), // the day before starts_on
      paid,
      reversal,
      expense('2026-01-02', bank('RUB'), 25_000n, P),
    ]
    const reading = read(ops, { limit: 20_000n })
    expect(known(reading.spent)).toBe(25_000n)
    expect(known(reading.remaining)).toBe(-5_000n)
    // starts_on is after BBM's first operation, so the four figures do not reconcile on screen.
    expect(reading.reconciles).toBe(false)
  })

  it('EARS-344: fixture 11 — every figure stays in the budget currency; the reading takes no reporting currency', () => {
    const reading = read([contribute('2026-02-01', 'RUB', 100_000n)])
    expect(reading.currency).toBe('RUB')
    expect(reading.reconciles).toBe(true)
    expect(replayBudget.length).toBe(1)
  })

  it('EARS-343: fixture 12 — a foreign-card debt valued provisionally, then reimbursed in roubles through a payment agent', () => {
    // 2.5 RUB per THB on the spend day: 10_000 THB minor units → 25_000 RUB minor units.
    const provisional = (currency: string, _date: string, quantity: bigint) =>
      currency === 'THB' ? (quantity * 5n) / 2n : null
    const debt = personalExpense('2026-11-02', 'THB', 10_000n, P, 701)
    const ops = [contribute('2026-11-01', 'RUB', 100_000n), debt]
    const open = read(ops, { provisional })
    expect(known(open.spent)).toBe(25_000n)
    expect(project(open, P)).toBe(25_000n)
    expect(known(open.owed)).toBe(25_000n)
    expect(open.owedProvisional).toBe(true)
    expect(known(open.cashAtCost)).toBe(100_000n)
    expectIdentity(open)

    const reimbursement = (fee: bigint | null) =>
      op(
        '2026-11-20',
        [
          leg(bank('RUB'), -(27_000n - (fee ?? 0n))),
          leg(sys('conversion', 'RUB'), 27_000n - (fee ?? 0n), { conversionStepNo: 1 }),
          leg(sys('conversion', 'THB'), -10_000n, { conversionStepNo: 1 }),
          leg(sys('liability', 'THB'), 10_000n, { memberId: MEMBER }),
          ...(fee === null
            ? []
            : [
                leg(sys('expense', 'RUB'), fee, { projectId: FUND, conversionStepNo: 1 }),
                leg(bank('RUB'), -fee, { conversionStepNo: 1 }),
              ]),
        ],
        {
          steps: [{ fromCurrency: 'RUB', toCurrency: 'THB' }],
          intakeItemId: 702,
          settlesItemId: 701,
        },
      )

    const settled = read([...ops, reimbursement(1_000n)], { provisional })
    expect(known(settled.spent)).toBe(27_000n)
    expect(project(settled, P)).toBe(25_000n)
    expect(project(settled, FUND)).toBe(1_000n)
    expect(known(settled.breakdown.exchangeResult)).toBe(1_000n)
    expect(known(settled.owed)).toBe(0n)
    expect(settled.owedProvisional).toBe(false)
    expect(known(settled.cashAtCost)).toBe(73_000n)
    expectIdentity(settled)
    expectBreakdownSums(settled)

    const noFee = read([...ops, reimbursement(null)], { provisional })
    expect(known(noFee.breakdown.exchangeResult)).toBe(2_000n)
    expect(known(noFee.spent)).toBe(27_000n)
    expectIdentity(noFee)
  })

  it("EARS-340: fixture 13 — a fee on the member's own charge settles with its debt as ONE lot", () => {
    const provisional = (currency: string, _date: string, quantity: bigint) =>
      currency === 'THB' ? (quantity * 5n) / 2n : null
    const debt = personalExpense('2026-11-02', 'THB', 10_000n, P, 801, 400n)
    const ops = [contribute('2026-11-01', 'RUB', 100_000n), debt]
    const open = read(ops, { provisional })
    expect(known(open.spent)).toBe(26_000n)
    expect(project(open, P)).toBe(26_000n)
    expect(known(open.owed)).toBe(26_000n)
    expectIdentity(open)

    const reimbursement = op(
      '2026-11-20',
      [
        leg(bank('RUB'), -27_000n),
        leg(sys('conversion', 'RUB'), 27_000n, { conversionStepNo: 1 }),
        leg(sys('conversion', 'THB'), -10_400n, { conversionStepNo: 1 }),
        leg(sys('liability', 'THB'), 10_400n, { memberId: MEMBER }),
      ],
      {
        steps: [{ fromCurrency: 'RUB', toCurrency: 'THB' }],
        intakeItemId: 802,
        settlesItemId: 801,
      },
    )
    const settled = read([...ops, reimbursement], { provisional })
    expect(known(settled.breakdown.exchangeResult)).toBe(1_000n)
    expect(known(settled.owed)).toBe(0n)
    expect(known(settled.spent)).toBe(27_000n)
    expect(known(settled.cashAtCost)).toBe(73_000n)
    expectIdentity(settled)
  })

  it('EARS-340: a backfill reimbursement with no settles_item draws the member lots oldest first', () => {
    const provisional = (currency: string, _date: string, quantity: bigint) =>
      currency === 'THB' ? (quantity * 5n) / 2n : null
    const reading = read(
      [
        contribute('2026-11-01', 'RUB', 100_000n),
        personalExpense('2026-11-02', 'THB', 4_000n, P, 901),
        personalExpense('2026-11-03', 'THB', 6_000n, P, 902),
        op(
          '2026-11-20',
          [
            leg(bank('RUB'), -26_000n),
            leg(sys('conversion', 'RUB'), 26_000n, { conversionStepNo: 1 }),
            leg(sys('conversion', 'THB'), -10_000n, { conversionStepNo: 1 }),
            leg(sys('liability', 'THB'), 10_000n, { memberId: MEMBER }),
          ],
          { steps: [{ fromCurrency: 'RUB', toCurrency: 'THB' }] },
        ),
      ],
      { provisional },
    )
    expect(known(reading.owed)).toBe(0n)
    expect(known(reading.breakdown.exchangeResult)).toBe(1_000n)
    expectIdentity(reading)
  })

  it('EARS-719: a partly repaid backfill debt is provisional only in its outstanding share', () => {
    const provisional = (currency: string, _date: string, quantity: bigint) =>
      currency === 'THB' ? (quantity * 5n) / 2n : null
    const reading = read(
      [
        contribute('2026-11-01', 'RUB', 100_000n),
        personalExpense('2026-11-02', 'THB', 4_000n, P, 901),
        personalExpense('2026-11-03', 'THB', 6_000n, P, 902),
        // a backfill draws the oldest lot whole and 1 000 THB of the second
        op(
          '2026-11-20',
          [
            leg(bank('RUB'), -13_000n),
            leg(sys('conversion', 'RUB'), 13_000n, { conversionStepNo: 1 }),
            leg(sys('conversion', 'THB'), -5_000n, { conversionStepNo: 1 }),
            leg(sys('liability', 'THB'), 5_000n, { memberId: MEMBER }),
          ],
          { steps: [{ fromCurrency: 'RUB', toCurrency: 'THB' }] },
        ),
      ],
      { provisional },
    )
    // the second debt: 15 000 provisional, 2 500 of it repaid
    expect(known(reading.owed)).toBe(12_500n)
    expect(reading.provisional).toEqual({ count: 1, amount: { status: 'known', amount: 12_500n } })
    expectIdentity(reading)
  })

  it('EARS-340: a posting the replay does not model (an expense credit outside a reversed pair) withholds the figures', () => {
    const reading = read([
      contribute('2026-02-01', 'RUB', 100_000n),
      op('2026-02-02', [
        leg(bank('RUB'), 1_000n),
        leg(sys('expense', 'RUB'), -1_000n, { projectId: P }),
      ]),
    ])
    expect(reading.spent).toEqual({ status: 'withheld', currencies: ['RUB'] })
  })
})
