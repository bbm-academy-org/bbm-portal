import { costBasisAtAverage } from './core/money'

export type CurrentMoneyAccount = {
  accountId: number
  name: string
  kind: string
  currency: string
  balance: bigint
}

export type CurrentMoneyPostingFact = {
  accountId: number
  accountKind: string
  isSystem: boolean
  currency: string
  amount: bigint
  conversionStepNo: number | null
}

export type CurrentMoneyConversionStepFact = {
  stepNo: number
  fromCurrency: string
  toCurrency: string
}

export type CurrentMoneyOperationFact = {
  operationId: number
  occurredOn: string
  reverses: number | null
  steps: CurrentMoneyConversionStepFact[]
  postings: CurrentMoneyPostingFact[]
}

export type CurrentMoneyPool =
  | { status: 'empty' }
  | {
      status: 'available'
      heldCurrency: string
      heldQuantity: bigint
      costCurrency: string
      heldCost: bigint
    }
  | { status: 'unavailable' }

export type CurrentMoneyValuation = {
  accounts: CurrentMoneyAccount[]
  reportingCurrency: string
  availableReportingCurrencies: string[]
  status: 'complete' | 'incomplete'
  total: bigint | null
  missingCurrencies: string[]
}

type Ratio = { numerator: bigint; denominator: bigint }
type GraphEdge = Ratio & { to: string }
type RateGraph = Map<string, GraphEdge[]>

function compareCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function operationOrder(a: CurrentMoneyOperationFact, b: CurrentMoneyOperationFact): number {
  return compareCodes(a.occurredOn, b.occurredOn) || a.operationId - b.operationId
}

function activeOperations(operations: CurrentMoneyOperationFact[]): CurrentMoneyOperationFact[] {
  const excluded = new Set<number>()
  for (const operation of [...operations].sort(operationOrder).reverse()) {
    if (operation.reverses === null || excluded.has(operation.operationId)) continue
    excluded.add(operation.operationId)
    excluded.add(operation.reverses)
  }
  return operations.filter((operation) => !excluded.has(operation.operationId)).sort(operationOrder)
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`
}

function pairPool(pools: Map<string, CurrentMoneyPool>, key: string): CurrentMoneyPool {
  const existing = pools.get(key)
  if (existing !== undefined) return existing
  const empty: CurrentMoneyPool = { status: 'empty' }
  pools.set(key, empty)
  return empty
}

function markUnavailable(pools: Map<string, CurrentMoneyPool>, key: string): void {
  pools.set(key, { status: 'unavailable' })
}

function replayStep(
  operation: CurrentMoneyOperationFact,
  step: CurrentMoneyConversionStepFact,
  pools: Map<string, CurrentMoneyPool>,
): void {
  const key = pairKey(step.fromCurrency, step.toCurrency)
  const exchange = operation.postings.filter(
    (posting) =>
      posting.isSystem &&
      posting.accountKind === 'conversion' &&
      posting.conversionStepNo === step.stepNo,
  )
  const fromNet = exchange
    .filter((posting) => posting.currency === step.fromCurrency)
    .reduce((sum, posting) => sum + posting.amount, 0n)
  const toNet = exchange
    .filter((posting) => posting.currency === step.toCurrency)
    .reduce((sum, posting) => sum + posting.amount, 0n)
  const hasThirdCurrency = exchange.some(
    (posting) => posting.currency !== step.fromCurrency && posting.currency !== step.toCurrency,
  )

  if (step.fromCurrency === step.toCurrency || fromNet <= 0n || toNet >= 0n || hasThirdCurrency) {
    markUnavailable(pools, key)
    return
  }

  const current = pairPool(pools, key)
  if (current.status === 'unavailable') return

  const disposed = fromNet
  const received = -toNet
  if (current.status === 'empty') {
    pools.set(key, {
      status: 'available',
      heldCurrency: step.toCurrency,
      heldQuantity: received,
      costCurrency: step.fromCurrency,
      heldCost: disposed,
    })
    return
  }

  if (current.heldCurrency === step.toCurrency) {
    pools.set(key, {
      ...current,
      heldQuantity: current.heldQuantity + received,
      heldCost: current.heldCost + disposed,
    })
    return
  }

  if (current.heldCurrency !== step.fromCurrency) {
    markUnavailable(pools, key)
    return
  }

  if (disposed < current.heldQuantity) {
    const removedCost = costBasisAtAverage(disposed, current.heldCost, current.heldQuantity)
    pools.set(key, {
      ...current,
      heldQuantity: current.heldQuantity - disposed,
      heldCost: current.heldCost - removedCost,
    })
    return
  }

  if (disposed === current.heldQuantity) {
    pools.set(key, { status: 'empty' })
    return
  }

  const attributedReceived = costBasisAtAverage(current.heldQuantity, received, disposed)
  const residualQuantity = received - attributedReceived
  const residualCost = disposed - current.heldQuantity
  if (residualQuantity <= 0n || residualCost <= 0n) {
    markUnavailable(pools, key)
    return
  }
  pools.set(key, {
    status: 'available',
    heldCurrency: step.toCurrency,
    heldQuantity: residualQuantity,
    costCurrency: step.fromCurrency,
    heldCost: residualCost,
  })
}

function replayPairPools(operations: CurrentMoneyOperationFact[]): Map<string, CurrentMoneyPool> {
  const pools = new Map<string, CurrentMoneyPool>()
  for (const operation of activeOperations(operations)) {
    for (const step of [...operation.steps].sort((a, b) => a.stepNo - b.stepNo)) {
      replayStep(operation, step, pools)
    }
  }
  return pools
}

function addEdge(graph: RateGraph, from: string, edge: GraphEdge): void {
  const adjacent = graph.get(from) ?? []
  adjacent.push(edge)
  adjacent.sort((a, b) => compareCodes(a.to, b.to))
  graph.set(from, adjacent)
}

function rateGraph(pools: Map<string, CurrentMoneyPool>): RateGraph {
  const graph: RateGraph = new Map()
  for (const pool of pools.values()) {
    if (pool.status !== 'available' || pool.heldQuantity <= 0n || pool.heldCost <= 0n) continue
    addEdge(graph, pool.heldCurrency, {
      to: pool.costCurrency,
      numerator: pool.heldCost,
      denominator: pool.heldQuantity,
    })
    addEdge(graph, pool.costCurrency, {
      to: pool.heldCurrency,
      numerator: pool.heldQuantity,
      denominator: pool.heldCost,
    })
  }
  return graph
}

function greatestCommonDivisor(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a
  let right = b < 0n ? -b : b
  while (right !== 0n) {
    const remainder = left % right
    left = right
    right = remainder
  }
  return left
}

function multiplyRatios(left: Ratio, right: Ratio): Ratio {
  const numerator = left.numerator * right.numerator
  const denominator = left.denominator * right.denominator
  const divisor = greatestCommonDivisor(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

function comparePaths(a: string[], b: string[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const comparison = compareCodes(a[index] ?? '', b[index] ?? '')
    if (comparison !== 0) return comparison
  }
  return a.length - b.length
}

function findRatio(graph: RateGraph, from: string, to: string): Ratio | null {
  if (from === to) return { numerator: 1n, denominator: 1n }

  let frontier: Array<{ path: string[]; ratio: Ratio }> = [
    { path: [from], ratio: { numerator: 1n, denominator: 1n } },
  ]
  while (frontier.length > 0) {
    const next: typeof frontier = []
    for (const candidate of frontier) {
      const last = candidate.path.at(-1)
      if (last === undefined) continue
      for (const edge of graph.get(last) ?? []) {
        if (candidate.path.includes(edge.to)) continue
        next.push({
          path: [...candidate.path, edge.to],
          ratio: multiplyRatios(candidate.ratio, edge),
        })
      }
    }
    next.sort((a, b) => comparePaths(a.path, b.path))
    const match = next.find((candidate) => candidate.path.at(-1) === to)
    if (match !== undefined) return match.ratio
    frontier = next
  }
  return null
}

function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n
  const absoluteNumerator = numerator < 0n ? -numerator : numerator
  const absoluteDenominator = denominator < 0n ? -denominator : denominator
  const rounded = (2n * absoluteNumerator + absoluteDenominator) / (2n * absoluteDenominator)
  return negative ? -rounded : rounded
}

function aggregateBalances(accounts: CurrentMoneyAccount[]): Map<string, bigint> {
  const aggregates = new Map<string, bigint>()
  for (const account of accounts) {
    aggregates.set(account.currency, (aggregates.get(account.currency) ?? 0n) + account.balance)
  }
  return aggregates
}

function reportingCurrencyCandidates(accounts: CurrentMoneyAccount[]): string[] {
  const candidates = ['RUB']
  const seen = new Set(candidates)
  for (const account of accounts) {
    if (seen.has(account.currency)) continue
    seen.add(account.currency)
    candidates.push(account.currency)
  }
  return candidates
}

function availableReportingCurrencies(
  accounts: CurrentMoneyAccount[],
  aggregates: Map<string, bigint>,
  graph: RateGraph,
): string[] {
  const candidates = reportingCurrencyCandidates(accounts)
  const nonzeroAggregates = [...aggregates.entries()].filter(([, balance]) => balance !== 0n)
  if (nonzeroAggregates.length === 0) return candidates

  return candidates.filter(
    (candidate) =>
      candidate === 'RUB' ||
      nonzeroAggregates.every(
        ([currency]) => currency === candidate || findRatio(graph, currency, candidate) !== null,
      ),
  )
}

/** Pure EARS-325 replay; the DB read side supplies immutable facts and final balances. */
export function evaluateCurrentMoney(input: {
  reportingCurrency?: string
  accounts: CurrentMoneyAccount[]
  operations: CurrentMoneyOperationFact[]
}): CurrentMoneyValuation {
  const graph = rateGraph(replayPairPools(input.operations))
  const aggregates = aggregateBalances(input.accounts)
  const available = availableReportingCurrencies(input.accounts, aggregates, graph)
  const requestedCurrency = input.reportingCurrency ?? 'RUB'
  const reportingCurrency = available.includes(requestedCurrency) ? requestedCurrency : 'RUB'

  let total = 0n
  const missingCurrencies: string[] = []
  for (const [currency, balance] of [...aggregates.entries()].sort(([a], [b]) =>
    compareCodes(a, b),
  )) {
    if (balance === 0n) continue
    const ratio = findRatio(graph, currency, reportingCurrency)
    if (ratio === null) {
      missingCurrencies.push(currency)
      continue
    }
    total += roundHalfAwayFromZero(balance * ratio.numerator, ratio.denominator)
  }

  const complete = missingCurrencies.length === 0
  return {
    accounts: input.accounts,
    reportingCurrency,
    availableReportingCurrencies: available,
    status: complete ? 'complete' : 'incomplete',
    total: complete ? total : null,
    missingCurrencies,
  }
}
