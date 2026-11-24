/**
 * The budget cost-basis replay — spec 338 §D EARS-340…345, as a PURE function.
 *
 * One pass over every operation BBM has, in `(occurred_on, operation_id)` order
 * after fully reversed pairs are removed (EARS-340 item 1), carrying a cost in
 * the budget's currency `B` through every supply and use. It is deliberately NOT
 * the EARS-325 pair-rate graph and NOT EARS-328's per-pair pool: those are built
 * from conversion steps alone, so a spend out of a foreign holding never depletes
 * them (§D fixtures 2 and 4). It reads no `fx_result` posting.
 *
 * No Bank of Russia rate enters this file. The one exception the spec allows —
 * the provisional value of a member's open foreign-currency debt (EARS-340 item
 * 3) — arrives as the injected `provisionalValue` function, wired by the loader
 * in `./reading.ts`, the allowlisted reader of spec 339 EARS-553. Nothing here is
 * stored: every figure is a read model (EARS-344).
 */
import { activeOperations, isCurrentMoneyAccount } from '../current-money'

// ── input ────────────────────────────────────────────────────────────────────

export type BudgetPostingFact = {
  postingId: number
  accountId: number
  accountKind: string
  isSystem: boolean
  currency: string
  /** Signed minimal units: debit > 0, credit < 0. */
  amount: bigint
  projectId: number | null
  memberId: number | null
  conversionStepNo: number | null
}

export type BudgetStepFact = { stepNo: number; fromCurrency: string; toCurrency: string }

export type BudgetOperationFact = {
  operationId: number
  occurredOn: string
  reverses: number | null
  /** The intake item this operation posted (`finance_intake_item.operation_id`), if any. */
  intakeItemId: number | null
  /** That item's `settles_item` (spec 339 EARS-528) — the debt it settles. */
  settlesItemId: number | null
  steps: BudgetStepFact[]
  postings: BudgetPostingFact[]
}

/**
 * EARS-340 item 3 — `quantity` minor units of `currency` at the Bank of Russia
 * rate of `occurredOn`, in minor units of `B`, rounded once; `null` when no rate
 * exists for that currency or day (item 7).
 */
export type ProvisionalValuer = (
  currency: string,
  occurredOn: string,
  quantity: bigint,
) => bigint | null

export type BudgetReplayInput = {
  budget: { currency: string; limitAmount: bigint; startsOn: string }
  operations: readonly BudgetOperationFact[]
  provisionalValue: ProvisionalValuer
}

// ── output ───────────────────────────────────────────────────────────────────

/** A figure is a number, or withheld with the currencies that caused it (EARS-340 item 7). */
export type BudgetFigure =
  { status: 'known'; amount: bigint } | { status: 'withheld'; currencies: string[] }

export type BudgetReading = {
  /** `B` — every figure is in it, whatever the reporting currency (EARS-344). */
  currency: string
  limit: bigint
  startsOn: string
  spent: BudgetFigure
  /** Limit − spent, negative when overspent, never clipped (EARS-342). */
  remaining: BudgetFigure
  contributed: BudgetFigure
  income: BudgetFigure
  owed: BudgetFigure
  /** True while «owed» includes an open foreign-currency lot at its provisional value (EARS-343). */
  owedProvisional: boolean
  /** «по себестоимости» — the one cash figure of the reading (EARS-343). */
  cashAtCost: BudgetFigure
  /** EARS-345 — one line per project plus the projectless exchange-result line. */
  breakdown: {
    projects: { projectId: number; spent: BudgetFigure }[]
    exchangeResult: BudgetFigure
  }
  /**
   * EARS-344 — whether the four figures may be presented as reconciling on the
   * screen: only when `starts_on` is on or before BBM's first operation.
   */
  reconciles: boolean
}

// ── cost arithmetic ──────────────────────────────────────────────────────────

type Cost = { known: true; value: bigint } | { known: false; currencies: Set<string> }

const ZERO: Cost = { known: true, value: 0n }
const knownCost = (value: bigint): Cost => ({ known: true, value })
const unknownCost = (...currencies: string[]): Cost => ({
  known: false,
  currencies: new Set(currencies),
})

function addCost(a: Cost, b: Cost): Cost {
  if (a.known && b.known) return knownCost(a.value + b.value)
  return {
    known: false,
    currencies: new Set([...(a.known ? [] : a.currencies), ...(b.known ? [] : b.currencies)]),
  }
}

function negate(a: Cost): Cost {
  return a.known ? knownCost(-a.value) : a
}

function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const rounded = (2n * n + d) / (2n * d)
  return negative ? -rounded : rounded
}

/** A (quantity, cost) holding: a pool, a lot or an operation's supply of one currency. */
type Holding = { quantity: bigint; cost: Cost }

/**
 * EARS-340 item 2 — draw `q` from a holding: `K` when `q = Q`, otherwise
 * `round_half_away_from_zero(q × K ÷ Q)`; the drawn cost leaves `K` exactly. A
 * draw larger than the holding has no cost to take and is unknown (item 7).
 */
function draw(holding: Holding, q: bigint, currency: string): Cost {
  if (q > holding.quantity) {
    holding.quantity -= q
    holding.cost = unknownCost(currency)
    return unknownCost(currency)
  }
  let drawn: Cost
  if (!holding.cost.known) drawn = holding.cost
  else if (q === holding.quantity) drawn = holding.cost
  else drawn = knownCost(roundHalfAwayFromZero(q * holding.cost.value, holding.quantity))
  holding.quantity -= q
  holding.cost =
    holding.cost.known && drawn.known ? knownCost(holding.cost.value - drawn.value) : holding.cost
  resetIfEmpty(holding)
  return drawn
}

/** EARS-325's reset, which EARS-340 item 7 applies: an emptied pool forgets an unknown cost. */
function resetIfEmpty(holding: Holding): void {
  if (holding.quantity === 0n) holding.cost = ZERO
}

function figure(cost: Cost): BudgetFigure {
  return cost.known
    ? { status: 'known', amount: cost.value }
    : { status: 'withheld', currencies: [...cost.currencies].sort() }
}

// ── the replay ───────────────────────────────────────────────────────────────

type Lot = Holding & { key: string }

type Use =
  | { kind: 'money'; postingId: number; quantity: bigint }
  | { kind: 'expense'; postingId: number; quantity: bigint; projectId: number | null }
  | { kind: 'liability'; postingId: number; quantity: bigint; memberId: number }
  | { kind: 'opaque'; postingId: number; quantity: bigint }

export function replayBudget(input: BudgetReplayInput): BudgetReading {
  const { budget, provisionalValue } = input
  const B = budget.currency
  const inWindow = (occurredOn: string) => occurredOn >= budget.startsOn

  /** Company money in `B` — a balance, it needs no cost. */
  let cashB = 0n
  /** Per currency X ≠ B — the holding pool mirroring company money in X. */
  const holdingPools = new Map<string, Holding>()
  /** Member debt in `B` — a balance. */
  let owedB = 0n
  /** Per member, per currency X ≠ B — one lot per posted personal-funds item, in booking order. */
  const owedLots = new Map<string, Lot[]>()

  let spent: Cost = ZERO
  let exchangeResult: Cost = ZERO
  let contributed: Cost = ZERO
  let income: Cost = ZERO
  const byProject = new Map<number, Cost>()
  /** Currencies of postings the replay does not model — every figure is withheld (item 3). */
  const opaque = new Set<string>()

  const pool = (currency: string): Holding => {
    let found = holdingPools.get(currency)
    if (found === undefined) {
      found = { quantity: 0n, cost: ZERO }
      holdingPools.set(currency, found)
    }
    return found
  }
  const lotsOf = (memberId: number, currency: string): Lot[] => {
    const key = `${memberId}\0${currency}`
    let found = owedLots.get(key)
    if (found === undefined) {
      found = []
      owedLots.set(key, found)
    }
    return found
  }

  for (const operation of activeOperations(input.operations)) {
    const counted = inWindow(operation.occurredOn)
    const supplies = new Map<string, Holding>()
    const uses = new Map<string, Use[]>()
    const disposed = new Map<number, bigint>()
    const received = new Map<number, bigint>()
    const moneyNet = new Map<string, { net: bigint; firstPostingId: number }>()

    const supply = (currency: string, quantity: bigint, cost: Cost) => {
      const found = supplies.get(currency) ?? { quantity: 0n, cost: ZERO }
      found.quantity += quantity
      found.cost = addCost(found.cost, cost)
      supplies.set(currency, found)
    }
    const addUse = (currency: string, entry: Use) => {
      const list = uses.get(currency) ?? []
      list.push(entry)
      uses.set(currency, list)
    }
    const opaquePosting = (posting: BudgetPostingFact) => {
      opaque.add(posting.currency)
      if (posting.amount < 0n)
        supply(posting.currency, -posting.amount, unknownCost(posting.currency))
      else
        addUse(posting.currency, {
          kind: 'opaque',
          postingId: posting.postingId,
          quantity: posting.amount,
        })
    }

    const postings = [...operation.postings].sort((a, b) => a.postingId - b.postingId)
    for (const posting of postings) {
      const { currency, amount } = posting
      if (isCurrentMoneyAccount({ kind: posting.accountKind, isSystem: posting.isSystem })) {
        const found = moneyNet.get(currency)
        if (found === undefined)
          moneyNet.set(currency, { net: amount, firstPostingId: posting.postingId })
        else found.net += amount
        continue
      }
      switch (posting.accountKind) {
        case 'fx_result':
          // Item 1 — the ledger's own EARS-328 result is skipped; the replay derives its own.
          continue
        case 'conversion': {
          // A non-step conversion posting balances an `fx_result` one and is skipped with it.
          if (posting.conversionStepNo === null) continue
          const target = amount > 0n ? disposed : received
          target.set(
            posting.conversionStepNo,
            (target.get(posting.conversionStepNo) ?? 0n) + (amount > 0n ? amount : -amount),
          )
          continue
        }
        case 'expense':
          if (amount > 0n) {
            addUse(currency, {
              kind: 'expense',
              postingId: posting.postingId,
              quantity: amount,
              projectId: posting.projectId,
            })
          } else opaquePosting(posting)
          continue
        case 'income':
        case 'equity': {
          if (amount > 0n) {
            opaquePosting(posting)
            continue
          }
          // Item 3 — a credit on equity or income costs its own amount in B; in X ≠ B it is unknown.
          const cost = currency === B ? knownCost(-amount) : unknownCost(currency)
          supply(currency, -amount, cost)
          if (counted) {
            if (posting.accountKind === 'equity') contributed = addCost(contributed, cost)
            else income = addCost(income, cost)
          }
          continue
        }
        case 'liability': {
          if (posting.memberId === null) {
            opaquePosting(posting)
            continue
          }
          if (amount > 0n) {
            addUse(currency, {
              kind: 'liability',
              postingId: posting.postingId,
              quantity: amount,
              memberId: posting.memberId,
            })
            continue
          }
          const quantity = -amount
          if (currency === B) {
            owedB += quantity
            supply(currency, quantity, knownCost(quantity))
            continue
          }
          // Item 3 — the provisional value at the Bank of Russia rate of the spend day.
          const value = provisionalValue(currency, operation.occurredOn, quantity)
          const cost = value === null ? unknownCost(currency) : knownCost(value)
          supply(currency, quantity, cost)
          // Item 2 — one lot per item, holding ALL its credits (the fee leg included).
          const key =
            operation.intakeItemId === null
              ? `operation:${operation.operationId}`
              : `item:${operation.intakeItemId}`
          const lots = lotsOf(posting.memberId, currency)
          const lot = lots.find((candidate) => candidate.key === key)
          if (lot === undefined) lots.push({ key, quantity, cost })
          else {
            lot.quantity += quantity
            lot.cost = addCost(lot.cost, cost)
          }
          continue
        }
        default:
          opaquePosting(posting)
      }
    }

    // Item 3 — the net decrease of company money is a supply drawn from the holding pool;
    // the net increase is a use, added to the pool once its cost is known.
    for (const [currency, { net, firstPostingId }] of moneyNet) {
      if (net < 0n) {
        const quantity = -net
        if (currency === B) {
          cashB -= quantity
          supply(currency, quantity, knownCost(quantity))
        } else supply(currency, quantity, draw(pool(currency), quantity, currency))
      } else if (net > 0n) {
        addUse(currency, { kind: 'money', postingId: firstPostingId, quantity: net })
      }
    }

    // Item 4 — steps in step_no order draw from the supply of their from-currency as it stands.
    for (const step of [...operation.steps].sort((a, b) => a.stepNo - b.stepNo)) {
      const out = disposed.get(step.stepNo) ?? 0n
      const into = received.get(step.stepNo) ?? 0n
      const from = supplies.get(step.fromCurrency) ?? { quantity: 0n, cost: ZERO }
      supplies.set(step.fromCurrency, from)
      const drawn = draw(from, out, step.fromCurrency)
      supply(step.toCurrency, into, drawn)
    }

    // Item 4 — then each currency's non-step uses, in posting-id order, the last taking the remainder.
    let operationResult: Cost = ZERO
    for (const [currency, list] of uses) {
      const available = supplies.get(currency) ?? { quantity: 0n, cost: ZERO }
      const ordered = [...list].sort((a, b) => a.postingId - b.postingId)
      for (const entry of ordered) {
        const drawn = draw(available, entry.quantity, currency)
        // Item 5 — value: own amount in B; the owed-pool draw for a member's debt in X ≠ B;
        // the drawn cost otherwise. Only the first two can differ from the drawn cost.
        let value: Cost = drawn
        if (entry.kind === 'liability') {
          if (currency === B) {
            owedB -= entry.quantity
            value = knownCost(entry.quantity)
          } else {
            value = drawOwed(
              lotsOf(entry.memberId, currency),
              entry.quantity,
              currency,
              operation.settlesItemId,
            )
          }
        } else if (currency === B && entry.kind !== 'opaque') {
          value = knownCost(entry.quantity)
        }
        if (value !== drawn)
          operationResult = addCost(operationResult, addCost(drawn, negate(value)))

        if (entry.kind === 'money') {
          if (currency === B) cashB += entry.quantity
          else {
            const target = pool(currency)
            target.quantity += entry.quantity
            target.cost = addCost(target.cost, drawn)
            resetIfEmpty(target)
          }
        } else if (entry.kind === 'expense' && counted) {
          spent = addCost(spent, value)
          const projectId = entry.projectId ?? 0
          byProject.set(projectId, addCost(byProject.get(projectId) ?? ZERO, value))
        }
      }
    }
    if (counted) {
      spent = addCost(spent, operationResult)
      exchangeResult = addCost(exchangeResult, operationResult)
    }
  }

  let cash: Cost = knownCost(cashB)
  for (const holding of holdingPools.values()) cash = addCost(cash, holding.cost)
  let owed: Cost = knownCost(owedB)
  let owedProvisional = false
  for (const lots of owedLots.values()) {
    for (const lot of lots) {
      owed = addCost(owed, lot.cost)
      if (lot.quantity !== 0n) owedProvisional = true
    }
  }

  const withOpaque = (cost: Cost): Cost =>
    opaque.size === 0 ? cost : addCost(cost, unknownCost(...opaque))
  spent = withOpaque(spent)
  const remaining = addCost(knownCost(budget.limitAmount), negate(spent))
  const firstOperation = [...input.operations].map((o) => o.occurredOn).sort()[0]

  return {
    currency: B,
    limit: budget.limitAmount,
    startsOn: budget.startsOn,
    spent: figure(spent),
    remaining: figure(remaining),
    contributed: figure(withOpaque(contributed)),
    income: figure(withOpaque(income)),
    owed: figure(withOpaque(owed)),
    owedProvisional,
    cashAtCost: figure(withOpaque(cash)),
    breakdown: {
      projects: [...byProject]
        .sort(([a], [b]) => a - b)
        .map(([projectId, cost]) => ({ projectId, spent: figure(withOpaque(cost)) })),
      exchangeResult: figure(withOpaque(exchangeResult)),
    },
    reconciles: firstOperation === undefined || budget.startsOn <= firstOperation,
  }
}

/**
 * EARS-340 item 3 — a liability debit in X ≠ B draws the member's owed pool: the
 * named item's lot whole WHERE the reimbursement names it (`settles_item`), and
 * otherwise (a `backfill`, pair-level) the member's lots oldest first, the last
 * one drawn per item 2.
 */
function drawOwed(
  lots: Lot[],
  quantity: bigint,
  currency: string,
  settlesItemId: number | null,
): Cost {
  if (settlesItemId !== null) {
    const lot = lots.find((candidate) => candidate.key === `item:${settlesItemId}`)
    if (lot === undefined) return unknownCost(currency)
    return draw(lot, quantity, currency)
  }
  let left = quantity
  let total: Cost = ZERO
  for (const lot of lots) {
    if (left === 0n) break
    if (lot.quantity <= 0n) continue
    const take = left < lot.quantity ? left : lot.quantity
    total = addCost(total, draw(lot, take, currency))
    left -= take
  }
  return left === 0n ? total : unknownCost(currency)
}
