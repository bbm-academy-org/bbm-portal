/**
 * The budget dashboard read model — spec 584 (issue #586), as a PURE function
 * over the §D replay's reading (`./replay.ts`).
 *
 * It buckets and groups the replay's per-item values; it never re-values one
 * (EARS-702): a value enters a month, a line or a drill-down row exactly as the
 * replay produced it, so the months and every grouping sum to spent exactly.
 *
 * The reporting currency `D` (spec 584 §G) converts what is shown, never the
 * computation: each flow item is converted once (EARS-728/729) and the same
 * buckets are summed over the converted items, so the sums hold exactly in `D`;
 * the stock figures are converted from `B` at the latest Bank of Russia rate;
 * ratios and states are the `B` ones (EARS-722).
 */
import {
  convertOwnAmount,
  rateStaleSince,
  type CbrFallback,
  type DisplayAmount,
  type DisplayStep,
} from './display-currency'
import type { BudgetFigure, BudgetItem, BudgetReading, CbrMark } from './replay'

// ── the period (EARS-715) ────────────────────────────────────────────────────

export const BUDGET_PERIODS = [
  { value: 'month', label: 'Этот месяц' },
  { value: 'quarter', label: 'Этот квартал' },
  { value: 'year', label: 'Этот год' },
  { value: '12m', label: 'Последние 12 месяцев' },
  { value: 'all', label: 'С начала бюджета' },
] as const

export type BudgetPeriodKey = (typeof BUDGET_PERIODS)[number]['value']

/** EARS-715 — an unknown value falls back to «С начала бюджета». */
export function parseBudgetPeriod(value: string | null | undefined): BudgetPeriodKey {
  return BUDGET_PERIODS.find((period) => period.value === value)?.value ?? 'all'
}

function monthStart(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10)
}

/** The period clipped to `[starts_on, today]` (EARS-715). */
export function budgetPeriodBounds(
  key: BudgetPeriodKey,
  startsOn: string,
  today: string,
): { from: string; to: string } {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7)) - 1
  const from = {
    month: monthStart(year, month),
    quarter: monthStart(year, month - (month % 3)),
    year: monthStart(year, 0),
    '12m': monthStart(year, month - 11),
    all: startsOn,
  }[key]
  return { from: from < startsOn ? startsOn : from, to: today }
}

// ── input / output ───────────────────────────────────────────────────────────

/** What the drill-down shows of an operation beyond its values (EARS-718). */
export type BudgetOperationMeta = {
  purpose: string | null
  counterpartyId: number | null
  /** The intake item the row links to: its own, or the one a reimbursement settles. */
  requestItemId: number | null
}

export type BudgetDashboardInput = {
  reading: BudgetReading
  today: string
  period: BudgetPeriodKey
  operations: ReadonlyMap<number, BudgetOperationMeta>
  names: {
    projects: ReadonlyMap<number, string>
    categories: ReadonlyMap<number, string>
    counterparties: ReadonlyMap<number, string>
  }
  /** Spec 584 §G — absent or `D` = `B`: every figure is shown exactly, in `B`. */
  display?: BudgetDisplayInput
}

export type BudgetDisplayInput = {
  /** `D`. */
  currency: string
  /** Each operation's conversion steps with their recorded amounts (EARS-728 item 1). */
  operationSteps: ReadonlyMap<number, readonly DisplayStep[]>
  precisions: ReadonlyMap<string, number>
  /** `B` → `D` at the Bank of Russia rate of a date (EARS-729). */
  fallback: CbrFallback
  /** `B` → `D` at the latest Bank of Russia rate (EARS-722 item 2); null when none qualifies. */
  latest: { rateDate: string; convert: (amountB: bigint) => bigint } | null
  /** The newest stored Bank of Russia rate, for EARS-703's stale notice. */
  newestRateOn: string | null
}

export type BudgetMonth = {
  /** `YYYY-MM`. */
  month: string
  gross: BudgetFigure
  income: BudgetFigure
  net: BudgetFigure
  /** EARS-711 — the first month when `starts_on` is not its first day; today's month. */
  partial: 'first' | 'current' | null
  provisional: boolean
  inPeriod: boolean
}

export type BudgetWaterlinePoint = {
  month: string
  /** Σ (income − gross burn) from `starts_on` through the month's end, or today. */
  net: BudgetFigure
  contributed: BudgetFigure
  provisional: boolean
}

export type RunwayCase = 'withheld' | 'exhausted' | 'needMonth' | 'noSpend' | 'value'

export type BudgetDrillRow = {
  operationId: number
  occurredOn: string
  purpose: string | null
  project: string | null
  counterparty: string | null
  /** The expense amounts in their own currencies; empty for an exchange result. */
  ownAmounts: { currency: string; amount: bigint }[]
  value: BudgetFigure
  provisional: boolean
  requestItemId: number | null
}

export type BudgetLine = {
  key: string
  name: string
  value: BudgetFigure
  /** The line's share of the grouping's total, one decimal; null while either is withheld. */
  share: string | null
  provisional: boolean
  exchange: boolean
  /**
   * The hue slot (0–2) of the line's entity: the three largest over the
   * budget's lifetime per grouping, so a period change never repaints one
   * (`design-source/finance/BudgetDashboard.research.md`, «Colour follows the
   * entity»); null for every other line and the exchange-result line.
   */
  slot: number | null
  rows: BudgetDrillRow[]
}

export type BudgetGrouping = {
  lines: BudgetLine[]
  total: BudgetFigure
  /** EARS-720 — false while any line is withheld: the grouping claims no sum then. */
  addsUp: boolean
}

export type BudgetDashboard = {
  currency: string
  startsOn: string
  today: string
  empty: boolean
  glass: {
    limit: BudgetFigure
    spent: BudgetFigure
    remaining: BudgetFigure
    /** Spent ÷ limit as a percentage, one decimal; null while spent is withheld. */
    shareUsed: string | null
    /** Remaining ÷ limit, the share still in the glass, one decimal; null while withheld. */
    remainingShare: string | null
    /** The share filled for the glass's geometry, 0…∞ (overflow past 1). */
    fill: number | null
    state: 'normal' | 'overflow' | 'exhausted' | 'withheld'
    spentProvisional: boolean
    provisional: { count: number; amount: BudgetFigure } | null
  }
  runway: {
    case: RunwayCase
    months: string | null
    n: number
    avgGross: BudgetFigure | null
    avgNet: BudgetFigure | null
    averagedMonths: string[]
    provisional: boolean
  }
  money: {
    contributed: BudgetFigure
    income: BudgetFigure
    spent: BudgetFigure
    owed: BudgetFigure
    owedProvisional: boolean
    cashAtCost: BudgetFigure
    reconciles: boolean
    /** EARS-709 — both sides of contributed + income = spent + cash − owed; null when not shown. */
    equation: { left: bigint; right: bigint } | null
    /** EARS-708 — spent − owed, shown only where the budget reconciles. */
    paidOut: BudgetFigure | null
  }
  /** Spec 584 §G — what the shown figures are in, and what the conversion did. */
  display: {
    /** `D`. */
    currency: string
    converted: boolean
    /** The latest Bank of Russia rate's date the stock figures carry; null in `B` or with no rate. */
    stockRate: string | null
    /** EARS-729 item 2 — operations of the period with an item at a dated rate, of all of them. */
    fallback: { operations: number; of: number } | null
    /** EARS-722 item 4 — each relation's difference as shown in `D`; null where no line is shown. */
    differences: {
      limit: bigint | null
      equation: bigint | null
      paidOut: bigint | null
      provisional: bigint | null
    }
    /** EARS-703 — the stale Bank of Russia rates' date, while one converts or values what is shown. */
    staleSince: string | null
  }
  period: { key: BudgetPeriodKey; from: string; to: string }
  months: BudgetMonth[]
  waterline: BudgetWaterlinePoint[]
  /**
   * EARS-713 — the chart's one note: `rate` WHILE `D` ≠ `B` (the −limit crossing need not
   * coincide with «лимит исчерпан», decided in `B`), else `income` while cumulative income is
   * not zero (the crossing coincides with an empty glass only while income is zero), else none.
   */
  waterlineNote: 'income' | 'rate' | null
  breakdown: {
    project: BudgetGrouping
    category: BudgetGrouping
    counterparty: BudgetGrouping
  }
}

// ── figure arithmetic ────────────────────────────────────────────────────────

const ZERO: BudgetFigure = { status: 'known', amount: 0n }

/**
 * EARS-720 — the start of every aggregate: zero, or withheld while the replay met a posting
 * it does not model. In `B` every item is then withheld already; in `D` an item on its own
 * chain still converts, so its drill-down row shows, but no sum it enters may (lead
 * decision, 2026-11-26: the converted view withholds what the `B` view withholds).
 */
function aggregateStart(reading: BudgetReading): BudgetFigure {
  return reading.opaque.length === 0
    ? ZERO
    : { status: 'withheld', currencies: [...reading.opaque] }
}

function mergeMarks(a: CbrMark | undefined, b: CbrMark | undefined): CbrMark | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  const merged: CbrMark = { amount: a.amount + b.amount, items: a.items + b.items, of: a.of + b.of }
  const dates = new Set([a.rateDate, b.rateDate].filter((date) => date !== undefined))
  if (dates.size === 1) merged.rateDate = [...dates][0]
  return merged
}

function add(a: BudgetFigure, b: BudgetFigure): BudgetFigure {
  if (a.status === 'known' && b.status === 'known') {
    const cbr = mergeMarks(a.cbr, b.cbr)
    const amount = a.amount + b.amount
    return cbr === undefined ? { status: 'known', amount } : { status: 'known', amount, cbr }
  }
  const currencies = new Set([
    ...(a.status === 'withheld' ? a.currencies : []),
    ...(b.status === 'withheld' ? b.currencies : []),
  ])
  const noRateOn = new Set([
    ...(a.status === 'withheld' ? (a.noRateOn ?? []) : []),
    ...(b.status === 'withheld' ? (b.noRateOn ?? []) : []),
  ])
  const withheld = { status: 'withheld' as const, currencies: [...currencies].sort() }
  return noRateOn.size === 0 ? withheld : { ...withheld, noRateOn: [...noRateOn].sort() }
}

function negate(a: BudgetFigure): BudgetFigure {
  if (a.status !== 'known') return a
  return a.cbr === undefined
    ? { status: 'known', amount: -a.amount }
    : { status: 'known', amount: -a.amount, cbr: { ...a.cbr, amount: -a.cbr.amount } }
}

function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const rounded = (2n * n + d) / (2n * d)
  return negative ? -rounded : rounded
}

/** Tenths as «12,3» — the one-decimal display of spec 584. */
function tenths(value: bigint): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  return `${negative ? '−' : ''}${abs / 10n},${abs % 10n}`
}

function percentage(part: bigint, whole: bigint): string | null {
  if (whole === 0n) return null
  return tenths(roundHalfAwayFromZero(part * 1000n, whole))
}

// ── months ───────────────────────────────────────────────────────────────────

function monthOf(date: string): string {
  return date.slice(0, 7)
}

function monthsFrom(first: string, last: string): string[] {
  const out: string[] = []
  let year = Number(first.slice(0, 4))
  let month = Number(first.slice(5, 7))
  const lastKey = last
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`
    out.push(key)
    if (key >= lastKey) return out
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
}

function monthEnd(month: string): string {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10)
}

const isSpend = (item: BudgetItem) => item.kind === 'expense' || item.kind === 'exchangeResult'

// ── the read model ───────────────────────────────────────────────────────────

function buildInOneCurrency(input: BudgetDashboardInput): Omit<BudgetDashboard, 'display'> {
  const { reading, today, names } = input
  const { startsOn } = reading
  const AGG = aggregateStart(reading)
  // EARS-715 — the replay read the ledger as of today, so no item lies past today's month.
  const { items } = reading
  const bounds = budgetPeriodBounds(input.period, startsOn, today)
  const currentMonth = monthOf(today)

  // EARS-710 / 711
  const monthKeys = monthsFrom(
    monthOf(startsOn),
    currentMonth > monthOf(startsOn) ? currentMonth : monthOf(startsOn),
  )
  const months: BudgetMonth[] = monthKeys.map((month) => {
    const inMonth = items.filter((item) => monthOf(item.occurredOn) === month)
    const gross = inMonth.filter(isSpend).reduce((sum, item) => add(sum, item.value), AGG)
    const income = inMonth
      .filter((item) => item.kind === 'income')
      .reduce((sum, item) => add(sum, item.value), AGG)
    const partial =
      month === currentMonth
        ? 'current'
        : month === monthOf(startsOn) && !startsOn.endsWith('-01')
          ? 'first'
          : null
    return {
      month,
      gross,
      income,
      net: add(gross, negate(income)),
      partial,
      provisional: inMonth.some((item) => item.provisional),
      inPeriod: month >= monthOf(bounds.from) && month <= monthOf(bounds.to),
    }
  })

  // EARS-712 — the last ≤ 3 complete months.
  const complete = months.filter((month) => month.partial === null && month.month < currentMonth)
  const averaged = complete.slice(-3)
  const n = averaged.length
  const sumGross = averaged.reduce((sum, month) => add(sum, month.gross), ZERO)
  const sumNet = averaged.reduce((sum, month) => add(sum, month.net), ZERO)
  const mean = (total: BudgetFigure): BudgetFigure =>
    total.status === 'known'
      ? { ...total, amount: roundHalfAwayFromZero(total.amount, BigInt(n)) }
      : total
  const avgGross = n === 0 ? null : mean(sumGross)
  const avgNet = n === 0 ? null : mean(sumNet)
  const averagedProvisional = averaged.some((month) => month.provisional)

  // EARS-707 — the first case that holds.
  const remaining = reading.remaining
  let runwayCase: RunwayCase
  let runwayMonths: string | null = null
  if (remaining.status === 'withheld') runwayCase = 'withheld'
  else if (remaining.amount <= 0n) runwayCase = 'exhausted'
  else if (averaged.some((month) => month.gross.status === 'withheld')) runwayCase = 'withheld'
  else if (n === 0) runwayCase = 'needMonth'
  else if (sumGross.status !== 'known' || sumGross.amount <= 0n) runwayCase = 'noSpend'
  else {
    runwayCase = 'value'
    runwayMonths = tenths((remaining.amount * BigInt(n) * 10n) / sumGross.amount)
  }

  const spentProvisional = reading.provisional !== null
  const spent = reading.spent
  let state: BudgetDashboard['glass']['state'] = 'withheld'
  let fill: number | null = null
  if (spent.status === 'known' && remaining.status === 'known') {
    state = remaining.amount < 0n ? 'overflow' : remaining.amount === 0n ? 'exhausted' : 'normal'
    fill = reading.limit > 0n ? Number((spent.amount * 10000n) / reading.limit) / 10000 : null
  }

  // EARS-713
  let cumulativeNet: BudgetFigure = ZERO
  let cumulativeContributed: BudgetFigure = ZERO
  let provisionalSoFar = false
  let incomeSoFar: BudgetFigure = ZERO
  const waterline: BudgetWaterlinePoint[] = months.map((month) => {
    const end = month.month === currentMonth ? today : monthEnd(month.month)
    const contributions = items
      .filter(
        (item) =>
          item.kind === 'contribution' &&
          monthOf(item.occurredOn) === month.month &&
          item.occurredOn <= end,
      )
      .reduce((sum, item) => add(sum, item.value), AGG)
    cumulativeNet = add(cumulativeNet, negate(month.net))
    cumulativeContributed = add(cumulativeContributed, contributions)
    incomeSoFar = add(incomeSoFar, month.income)
    provisionalSoFar ||= month.provisional
    return {
      month: month.month,
      net: cumulativeNet,
      contributed: cumulativeContributed,
      provisional: provisionalSoFar,
    }
  })
  const waterlineNote: BudgetDashboard['waterlineNote'] =
    incomeSoFar.status !== 'known' || incomeSoFar.amount !== 0n ? 'income' : null

  // EARS-708 / 709
  const { contributed, income, owed, cashAtCost } = reading
  let equation: BudgetDashboard['money']['equation'] = null
  let paidOut: BudgetFigure | null = null
  if (reading.reconciles) {
    if (
      contributed.status === 'known' &&
      income.status === 'known' &&
      spent.status === 'known' &&
      owed.status === 'known' &&
      cashAtCost.status === 'known'
    ) {
      equation = {
        left: contributed.amount + income.amount,
        right: spent.amount + cashAtCost.amount - owed.amount,
      }
    }
    paidOut = add(spent, negate(owed))
  }

  // EARS-716…718
  const periodItems = items.filter(
    (item) => isSpend(item) && item.occurredOn >= bounds.from && item.occurredOn <= bounds.to,
  )
  const metaOf = (operationId: number) => input.operations.get(operationId)
  const counterpartyName = (operationId: number) => {
    const id = metaOf(operationId)?.counterpartyId ?? null
    return id === null ? null : (names.counterparties.get(id) ?? null)
  }
  const projectName = (id: number | null) => (id === null ? null : (names.projects.get(id) ?? null))
  const grouping = (
    keyOf: (item: Extract<BudgetItem, { kind: 'expense' }>) => {
      key: string
      name: string
    },
  ): BudgetGrouping => {
    const lifetime = new Map<string, bigint>()
    for (const item of items) {
      if (item.kind !== 'expense' || item.occurredOn < startsOn || item.value.status !== 'known')
        continue
      const { key } = keyOf(item)
      lifetime.set(key, (lifetime.get(key) ?? 0n) + item.value.amount)
    }
    const slots = new Map(
      [...lifetime]
        .filter(([, amount]) => amount > 0n)
        .sort(([ka, a], [kb, b]) => (a === b ? ka.localeCompare(kb) : a > b ? -1 : 1))
        .slice(0, 3)
        .map(([key], index) => [key, index]),
    )
    const lines = new Map<string, { name: string; items: BudgetItem[] }>()
    const exchange: BudgetItem[] = []
    for (const item of periodItems) {
      if (item.kind !== 'expense') {
        exchange.push(item)
        continue
      }
      const { key, name } = keyOf(item)
      const line = lines.get(key) ?? { name, items: [] }
      line.items.push(item)
      lines.set(key, line)
    }
    const built: BudgetLine[] = [...lines].map(([key, line]) => ({
      ...buildLine(key, line.name, line.items, false),
      slot: slots.get(key) ?? null,
    }))
    built.sort((a, b) => compareValue(b.value, a.value) || a.name.localeCompare(b.name, 'ru'))
    if (exchange.length > 0) built.push(buildLine('fx', 'курсовой результат', exchange, true))
    const total = built.reduce((sum, line) => add(sum, line.value), ZERO)
    const addsUp = built.every((line) => line.value.status === 'known')
    for (const line of built) {
      line.share =
        line.value.status === 'known' && total.status === 'known'
          ? percentage(line.value.amount, total.amount)
          : null
    }
    return { lines: built, total, addsUp }
  }
  const buildLine = (
    key: string,
    name: string,
    lineItems: BudgetItem[],
    exchange: boolean,
  ): BudgetLine => {
    const rows = new Map<number, BudgetDrillRow>()
    for (const item of lineItems) {
      let row = rows.get(item.operationId)
      if (row === undefined) {
        const meta = metaOf(item.operationId)
        row = {
          operationId: item.operationId,
          occurredOn: item.occurredOn,
          purpose: meta?.purpose ?? null,
          project: item.kind === 'expense' ? projectName(item.projectId) : null,
          counterparty: counterpartyName(item.operationId),
          ownAmounts: [],
          value: ZERO,
          provisional: false,
          requestItemId: meta?.requestItemId ?? null,
        }
        rows.set(item.operationId, row)
      }
      row.value = add(row.value, item.value)
      row.provisional ||= item.provisional
      if (item.kind === 'expense') {
        const own = row.ownAmounts.find((amount) => amount.currency === item.currency)
        if (own === undefined)
          row.ownAmounts.push({ currency: item.currency, amount: item.quantity })
        else own.amount += item.quantity
      }
    }
    const ordered = [...rows.values()].sort(
      (a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.operationId - a.operationId,
    )
    return {
      key,
      name,
      value: ordered.reduce((sum, row) => add(sum, row.value), AGG),
      share: null,
      provisional: ordered.some((row) => row.provisional),
      exchange,
      slot: null,
      rows: ordered,
    }
  }

  const windowItems = items.filter((item) => item.occurredOn >= startsOn)
  return {
    currency: reading.currency,
    startsOn,
    today,
    empty: windowItems.length === 0,
    glass: {
      limit: { status: 'known', amount: reading.limit },
      spent,
      remaining,
      shareUsed: spent.status === 'known' ? percentage(spent.amount, reading.limit) : null,
      remainingShare:
        remaining.status === 'known' ? percentage(remaining.amount, reading.limit) : null,
      fill,
      state,
      spentProvisional,
      provisional: reading.provisional,
    },
    runway: {
      case: runwayCase,
      months: runwayMonths,
      n,
      avgGross,
      avgNet,
      averagedMonths: averaged.map((month) => month.month),
      provisional: spentProvisional || averagedProvisional,
    },
    money: {
      contributed,
      income,
      spent,
      owed,
      owedProvisional: reading.owedProvisional,
      cashAtCost,
      reconciles: reading.reconciles,
      equation,
      paidOut,
    },
    period: { key: input.period, ...bounds },
    months,
    waterline,
    waterlineNote,
    breakdown: {
      project: grouping((item) => ({
        key: `p${item.projectId ?? 0}`,
        name: projectName(item.projectId) ?? 'без проекта',
      })),
      category: grouping((item) => ({
        key: `c${item.categoryId ?? 0}`,
        name:
          item.categoryId === null
            ? 'без категории'
            : (names.categories.get(item.categoryId) ?? 'без категории'),
      })),
      counterparty: grouping((item) => {
        const id = metaOf(item.operationId)?.counterpartyId ?? null
        return {
          key: `k${id ?? 0}`,
          name:
            id === null ? 'без контрагента' : (names.counterparties.get(id) ?? 'без контрагента'),
        }
      }),
    },
  }
}

// ── the reporting currency (spec 584 §G) ─────────────────────────────────────

function displayFigure(amount: DisplayAmount): BudgetFigure {
  switch (amount.status) {
    case 'actual':
      return { status: 'known', amount: amount.amount, cbr: { amount: 0n, items: 0, of: 1 } }
    case 'cbr':
      return {
        status: 'known',
        amount: amount.amount,
        cbr: { amount: amount.amount, items: 1, of: 1, rateDate: amount.rateDate },
      }
    case 'noRate':
      return { status: 'withheld', currencies: [], noRateOn: [amount.date] }
    case 'withheld':
      return { status: 'withheld', currencies: amount.currencies }
  }
}

const sumOf = (figures: readonly BudgetFigure[]) => figures.reduce(add, ZERO)

/** The shown difference of two sides, or null where either is withheld or it rounds to zero. */
function difference(left: BudgetFigure[], right: BudgetFigure[]): bigint | null {
  const l = sumOf(left)
  const r = sumOf(right)
  if (l.status !== 'known' || r.status !== 'known') return null
  return l.amount === r.amount ? null : l.amount - r.amount
}

export function buildBudgetDashboard(input: BudgetDashboardInput): BudgetDashboard {
  const base = buildInOneCurrency(input)
  const { reading, display, today } = input
  const B = reading.currency
  const newestRateOn = display?.newestRateOn ?? null
  if (display === undefined || display.currency === B) {
    return {
      ...base,
      display: {
        currency: B,
        converted: false,
        stockRate: null,
        fallback: null,
        differences: { limit: null, equation: null, paidOut: null, provisional: null },
        // EARS-703 — in `B` only the provisional value is a Bank of Russia rate.
        staleSince: base.glass.provisional === null ? null : rateStaleSince(newestRateOn, today),
      },
    }
  }

  const D = display.currency
  const convert = (item: {
    operationId: number
    occurredOn: string
    currency: string
    quantity: bigint
    value: BudgetFigure
    kind?: BudgetItem['kind']
  }): BudgetFigure =>
    displayFigure(
      convertOwnAmount({
        currency: item.currency,
        // An unknown exchange result has no own amount, so no own chain (EARS-720).
        amount:
          item.kind === 'exchangeResult' && item.value.status === 'withheld' ? null : item.quantity,
        valueB: item.value,
        occurredOn: item.occurredOn,
        steps: display.operationSteps.get(item.operationId) ?? [],
        display: D,
        precisions: display.precisions,
        fallback: display.fallback,
      }),
    )
  const items: BudgetItem[] = reading.items.map((item) => ({ ...item, value: convert(item) }))
  const stock = (figure: BudgetFigure): BudgetFigure => {
    if (figure.status === 'withheld') return figure
    if (display.latest === null) return { status: 'withheld', currencies: [], noRateOn: [today] }
    return { status: 'known', amount: display.latest.convert(figure.amount) }
  }
  const spentItems = items.filter(isSpend).map((item) => item.value)
  const AGG = aggregateStart(reading)
  const aggregate = (figures: readonly BudgetFigure[]) => figures.reduce(add, AGG)
  const spent = aggregate(spentItems)
  // EARS-719 — the outstanding share of each open foreign debt, at its own operation.
  const provisionalAmount = aggregate(
    reading.owedParts.filter((part) => part.provisional).map((part) => convert(part)),
  )
  const converted = buildInOneCurrency({
    ...input,
    reading: {
      ...reading,
      items,
      spent,
      remaining: stock(reading.remaining),
      contributed: aggregate(items.filter((i) => i.kind === 'contribution').map((i) => i.value)),
      income: aggregate(items.filter((i) => i.kind === 'income').map((i) => i.value)),
      owed: stock(reading.owed),
      cashAtCost: stock(reading.cashAtCost),
      provisional:
        reading.provisional === null
          ? null
          : { count: reading.provisional.count, amount: provisionalAmount },
    },
  })
  const limit = stock({ status: 'known', amount: reading.limit })
  const { money } = converted

  // EARS-722 item 1 — «paid out» is spent's items less the part still owed, each at its own operation.
  let paidOut: BudgetFigure | null = null
  if (reading.reconciles) {
    paidOut = aggregate([...spentItems, ...reading.owedParts.map((part) => negate(convert(part)))])
  }

  // EARS-729 item 2 — «по курсу ЦБ: N из M операций периода».
  const { from, to } = converted.period
  const periodOperations = new Map<number, boolean>()
  for (const item of items) {
    if (item.occurredOn < from || item.occurredOn > to) continue
    const marked = item.value.status === 'known' && (item.value.cbr?.items ?? 0) > 0
    periodOperations.set(
      item.operationId,
      (periodOperations.get(item.operationId) ?? false) || marked,
    )
  }
  const fallback = {
    operations: [...periodOperations.values()].filter(Boolean).length,
    of: periodOperations.size,
  }

  const provisionalStock = reading.provisional === null ? null : stock(reading.provisional.amount)
  const stockRate = display.latest === null ? null : display.latest.rateDate
  const slotsFrom = (shown: BudgetGrouping, exact: BudgetGrouping): BudgetGrouping => ({
    ...shown,
    lines: shown.lines.map((line) => ({
      ...line,
      slot: exact.lines.find((candidate) => candidate.key === line.key)?.slot ?? null,
    })),
  })
  return {
    ...converted,
    breakdown: {
      project: slotsFrom(converted.breakdown.project, base.breakdown.project),
      category: slotsFrom(converted.breakdown.category, base.breakdown.category),
      counterparty: slotsFrom(converted.breakdown.counterparty, base.breakdown.counterparty),
    },
    empty: base.empty,
    glass: {
      ...base.glass,
      limit,
      spent: converted.glass.spent,
      remaining: converted.glass.remaining,
      provisional: converted.glass.provisional,
    },
    runway: {
      ...base.runway,
      avgGross: converted.runway.avgGross,
      avgNet: converted.runway.avgNet,
    },
    money: { ...money, reconciles: base.money.reconciles, paidOut },
    waterlineNote: 'rate',
    display: {
      currency: D,
      converted: true,
      stockRate,
      fallback,
      differences: {
        limit: difference([limit], [spent, converted.glass.remaining]),
        equation: difference(
          [money.contributed, money.income],
          [spent, money.cashAtCost, negate(money.owed)],
        ),
        paidOut: paidOut === null ? null : difference([spent], [paidOut, money.owed]),
        provisional:
          provisionalStock === null ? null : difference([provisionalAmount], [provisionalStock]),
      },
      staleSince:
        stockRate !== null || fallback.operations > 0 || base.glass.provisional !== null
          ? rateStaleSince(newestRateOn, today)
          : null,
    },
  }
}

/** Withheld lines sort after known ones; known by amount. */
function compareValue(a: BudgetFigure, b: BudgetFigure): number {
  if (a.status !== 'known' || b.status !== 'known') {
    return (a.status === 'known' ? 1 : 0) - (b.status === 'known' ? 1 : 0)
  }
  return a.amount === b.amount ? 0 : a.amount > b.amount ? 1 : -1
}
