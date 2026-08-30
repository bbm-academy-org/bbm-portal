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

export type CurrentMoneyPool = {
  quantity: bigint
  cost: bigint | null
  known: boolean
}

export type CurrentMoneyValuation = {
  accounts: CurrentMoneyAccount[]
  reportingCurrency: string
  status: 'complete' | 'incomplete'
  total: bigint | null
  missingCurrencies: string[]
  currencyPools: Record<string, CurrentMoneyPool>
}

type MutablePool = CurrentMoneyPool & { invalid: boolean }

function operationOrder(a: CurrentMoneyOperationFact, b: CurrentMoneyOperationFact): number {
  return a.occurredOn.localeCompare(b.occurredOn) || a.operationId - b.operationId
}

function poolFor(pools: Map<string, MutablePool>, currency: string): MutablePool {
  let pool = pools.get(currency)
  if (pool === undefined) {
    pool = { quantity: 0n, cost: 0n, known: true, invalid: false }
    pools.set(currency, pool)
  }
  return pool
}

function resetIfEmpty(pool: MutablePool): void {
  if (pool.quantity === 0n) {
    pool.cost = 0n
    pool.known = true
  }
}

function markInvalid(pools: Map<string, MutablePool>, currencies: Iterable<string>): void {
  for (const currency of currencies) poolFor(pools, currency).invalid = true
}

function removeForeign(
  pools: Map<string, MutablePool>,
  currency: string,
  quantity: bigint,
): bigint | null {
  const pool = poolFor(pools, currency)
  if (quantity <= 0n || pool.quantity <= 0n || quantity > pool.quantity) {
    pool.invalid = true
    pool.quantity -= quantity
    pool.cost = null
    pool.known = false
    return null
  }

  const removedCost =
    pool.known && pool.cost !== null ? costBasisAtAverage(quantity, pool.cost, pool.quantity) : null
  pool.quantity -= quantity
  if (removedCost === null) {
    pool.cost = null
    pool.known = false
  } else {
    pool.cost = (pool.cost ?? 0n) - removedCost
  }
  resetIfEmpty(pool)
  return removedCost
}

function addForeign(
  pools: Map<string, MutablePool>,
  currency: string,
  quantity: bigint,
  transferredCost: bigint | null,
): void {
  const pool = poolFor(pools, currency)
  resetIfEmpty(pool)
  if (quantity <= 0n) {
    pool.invalid = true
    return
  }
  pool.quantity += quantity
  if (!pool.known || pool.cost === null || transferredCost === null) {
    pool.cost = null
    pool.known = false
    return
  }
  pool.cost += transferredCost
}

function ordinaryMovement(
  pools: Map<string, MutablePool>,
  reportingCurrency: string,
  currency: string,
  movement: bigint,
): void {
  if (movement === 0n || currency === reportingCurrency) return
  if (movement > 0n) {
    addForeign(pools, currency, movement, null)
    return
  }
  removeForeign(pools, currency, -movement)
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

function operationCurrencies(operation: CurrentMoneyOperationFact): Set<string> {
  return new Set([
    ...operation.steps.flatMap((step) => [step.fromCurrency, step.toCurrency]),
    ...operation.postings.map((posting) => posting.currency),
  ])
}

function replayConversion(
  operation: CurrentMoneyOperationFact,
  pools: Map<string, MutablePool>,
  reportingCurrency: string,
): void {
  const touched = operationCurrencies(operation)
  const orderedSteps = [...operation.steps].sort((a, b) => a.stepNo - b.stepNo)
  const endpoints: Array<{ currency: string; amount: bigint }> = []

  for (const step of orderedSteps) {
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
    const hasOtherCurrency = exchange.some(
      (posting) => posting.currency !== step.fromCurrency && posting.currency !== step.toCurrency,
    )
    if (fromNet <= 0n || toNet >= 0n || hasOtherCurrency) {
      markInvalid(pools, touched)
      continue
    }

    const disposed = fromNet
    const received = -toNet
    endpoints.push({ currency: step.fromCurrency, amount: -disposed })
    endpoints.push({ currency: step.toCurrency, amount: received })

    let transferredCost: bigint | null
    if (step.fromCurrency === reportingCurrency) {
      transferredCost = disposed
    } else {
      transferredCost = removeForeign(pools, step.fromCurrency, disposed)
    }

    if (step.toCurrency !== reportingCurrency) {
      addForeign(pools, step.toCurrency, received, transferredCost)
    }

    const feePostings = operation.postings.filter(
      (posting) => !posting.isSystem && posting.conversionStepNo === step.stepNo,
    )
    if (feePostings.length > 1 || feePostings.some((posting) => posting.amount >= 0n)) {
      markInvalid(pools, touched)
      continue
    }
    const fee = feePostings[0]
    if (fee !== undefined) {
      ordinaryMovement(pools, reportingCurrency, fee.currency, fee.amount)
    }
  }

  const first = orderedSteps[0]
  const last = orderedSteps.at(-1)
  if (first === undefined || last === undefined) return
  const expectedEndpoints = new Map<string, number>()
  for (const endpoint of [endpoints[0], endpoints.at(-1)]) {
    if (endpoint === undefined) continue
    const key = `${endpoint.currency}:${endpoint.amount.toString()}`
    expectedEndpoints.set(key, (expectedEndpoints.get(key) ?? 0) + 1)
  }
  for (const posting of operation.postings.filter(
    (candidate) => !candidate.isSystem && candidate.conversionStepNo === null,
  )) {
    const key = `${posting.currency}:${posting.amount.toString()}`
    const remaining = expectedEndpoints.get(key) ?? 0
    if (remaining === 0) {
      markInvalid(pools, touched)
    } else {
      expectedEndpoints.set(key, remaining - 1)
    }
  }
}

function replayOrdinary(
  operation: CurrentMoneyOperationFact,
  pools: Map<string, MutablePool>,
  reportingCurrency: string,
): void {
  const net = new Map<string, bigint>()
  for (const posting of operation.postings) {
    if (posting.isSystem) continue
    net.set(posting.currency, (net.get(posting.currency) ?? 0n) + posting.amount)
  }
  for (const currency of [...net.keys()].sort()) {
    ordinaryMovement(pools, reportingCurrency, currency, net.get(currency) ?? 0n)
  }
}

/** Pure EARS-325 replay; the DB read side supplies immutable facts and final balances. */
export function evaluateCurrentMoney(input: {
  reportingCurrency: string
  accounts: CurrentMoneyAccount[]
  operations: CurrentMoneyOperationFact[]
}): CurrentMoneyValuation {
  const pools = new Map<string, MutablePool>()
  for (const account of input.accounts) {
    if (account.currency !== input.reportingCurrency) poolFor(pools, account.currency)
  }

  for (const operation of activeOperations(input.operations)) {
    if (operation.steps.length === 0) {
      replayOrdinary(operation, pools, input.reportingCurrency)
    } else {
      replayConversion(operation, pools, input.reportingCurrency)
    }
  }

  const aggregates = new Map<string, bigint>()
  for (const account of input.accounts) {
    aggregates.set(account.currency, (aggregates.get(account.currency) ?? 0n) + account.balance)
  }

  let total = aggregates.get(input.reportingCurrency) ?? 0n
  const missingCurrencies: string[] = []
  for (const [currency, balance] of [...aggregates.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (currency === input.reportingCurrency || balance === 0n) continue
    const pool = poolFor(pools, currency)
    if (
      balance < 0n ||
      pool.invalid ||
      !pool.known ||
      pool.cost === null ||
      pool.quantity !== balance
    ) {
      missingCurrencies.push(currency)
      continue
    }
    total += pool.cost
  }

  const currencyPools = Object.fromEntries(
    [...pools.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, pool]) => [
        currency,
        { quantity: pool.quantity, cost: pool.cost, known: pool.known },
      ]),
  )
  const complete = missingCurrencies.length === 0
  return {
    accounts: input.accounts,
    reportingCurrency: input.reportingCurrency,
    status: complete ? 'complete' : 'incomplete',
    total: complete ? total : null,
    missingCurrencies,
    currencyPools,
  }
}
