/**
 * The budget dashboard's reporting currency — spec 584 §G (issue #586), PURE.
 *
 * A flow item is converted along its own chain (EARS-728): its own currency
 * and amount plus the conversion steps of its own operation, each step joining
 * its two currencies by its two recorded amounts — what the account actually
 * lost, never a rate fetched at read time (decision 18). Only where that chain
 * misses `D` does the item take its `B` value at the Bank of Russia rate of its
 * operation's date (EARS-729); that rate arrives as the injected `fallback`, so
 * no rate store is read here (spec 339 EARS-553, the budget reading being the
 * one allowlisted reader).
 */
import type { BudgetFigure, BudgetOperationFact } from './replay'

/** One conversion step of an operation with its two recorded amounts (spec 338 EARS-318). */
export type DisplayStep = {
  stepNo: number
  fromCurrency: string
  toCurrency: string
  fromAmount: bigint
  toAmount: bigint
}

/** `amountB` of `B` in `D` at the Bank of Russia rate of `date` (EARS-558), or null. */
export type CbrFallback = (
  amountB: bigint,
  date: string,
) => { amount: bigint; rateDate: string } | null

export type DisplayAmount =
  | { status: 'actual'; amount: bigint }
  | { status: 'cbr'; amount: bigint; rateDate: string }
  | { status: 'noRate'; date: string }
  | { status: 'withheld'; currencies: string[] }

const USD_PEGGED = new Set(['USDT', 'USDC'])

/** The steps of an operation, each with the amounts its conversion postings recorded. */
export function operationSteps(operation: BudgetOperationFact): DisplayStep[] {
  return [...operation.steps]
    .sort((a, b) => a.stepNo - b.stepNo)
    .map((step) => {
      const side = (currency: string) =>
        operation.postings
          .filter(
            (posting) =>
              posting.conversionStepNo === step.stepNo &&
              posting.accountKind === 'conversion' &&
              posting.currency === currency,
          )
          .reduce(
            (sum, posting) => sum + (posting.amount < 0n ? -posting.amount : posting.amount),
            0n,
          )
      return { ...step, fromAmount: side(step.fromCurrency), toAmount: side(step.toCurrency) }
    })
}

function roundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const rounded = (2n * n + d) / (2n * d)
  return negative ? -rounded : rounded
}

type Path = { node: string; stepNos: number[]; numerator: bigint; denominator: bigint }

function lexLess(a: number[], b: number[]): boolean {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]!
  }
  return false
}

/**
 * EARS-728 item 2 — the fewest steps from `own` to a currency that reaches `D`,
 * a step walked either way; among equally short paths the lexicographically
 * lowest `step_no` sequence. Level by level, the best path to a node at depth
 * k+1 is the least extension of a best path at depth k.
 */
function shortestPath(own: string, reaches: (currency: string) => boolean, steps: DisplayStep[]) {
  let frontier: Path[] = [{ node: own, stepNos: [], numerator: 1n, denominator: 1n }]
  const seen = new Set([own])
  while (frontier.length > 0) {
    const hits = frontier.filter((path) => reaches(path.node))
    if (hits.length > 0) {
      return hits.reduce((best, path) => (lexLess(path.stepNos, best.stepNos) ? path : best))
    }
    const next = new Map<string, Path>()
    for (const path of frontier) {
      for (const step of steps) {
        const forward = step.fromCurrency === path.node
        const backward = step.toCurrency === path.node
        if (!forward && !backward) continue
        const node = forward ? step.toCurrency : step.fromCurrency
        if (seen.has(node)) continue
        if (step.fromAmount === 0n || step.toAmount === 0n) continue
        const candidate: Path = {
          node,
          stepNos: [...path.stepNos, step.stepNo],
          numerator: path.numerator * (forward ? step.toAmount : step.fromAmount),
          denominator: path.denominator * (forward ? step.fromAmount : step.toAmount),
        }
        const held = next.get(node)
        if (held === undefined || lexLess(candidate.stepNos, held.stepNos))
          next.set(node, candidate)
      }
    }
    for (const node of next.keys()) seen.add(node)
    frontier = [...next.values()]
  }
  return null
}

/** One item in `D`: its own chain first (EARS-728), the dated Bank of Russia fallback else (EARS-729). */
export function convertOwnAmount(input: {
  currency: string
  amount: bigint
  valueB: BudgetFigure
  occurredOn: string
  steps: readonly DisplayStep[]
  display: string
  precisions: ReadonlyMap<string, number>
  fallback: CbrFallback
}): DisplayAmount {
  const D = input.display
  const reaches = (currency: string) => currency === D || (D === 'USD' && USD_PEGGED.has(currency))
  const path = shortestPath(input.currency, reaches, [...input.steps])
  if (path !== null) {
    let numerator = input.amount * path.numerator
    let denominator = path.denominator
    if (path.node !== D) {
      // The peg of decision 41: the same number of dollars, one to one.
      const from = input.precisions.get(path.node)
      const to = input.precisions.get(D)
      if (from === undefined || to === undefined)
        return { status: 'noRate', date: input.occurredOn }
      if (to >= from) numerator *= 10n ** BigInt(to - from)
      else denominator *= 10n ** BigInt(from - to)
    }
    return { status: 'actual', amount: roundHalfAwayFromZero(numerator, denominator) }
  }
  if (input.valueB.status === 'withheld') {
    return { status: 'withheld', currencies: input.valueB.currencies }
  }
  const converted = input.fallback(input.valueB.amount, input.occurredOn)
  if (converted === null) return { status: 'noRate', date: input.occurredOn }
  return { status: 'cbr', amount: converted.amount, rateDate: converted.rateDate }
}

// ── the switch (EARS-721) and the stale notice (EARS-703) ────────────────────

export type BudgetDisplayCandidate = { code: string; disabled: boolean }

/** ₽, $ and €, and `B` where it is none of them; a candidate is disabled where nothing converts to it. */
export function budgetDisplayCandidates(
  B: string,
  convertible: (code: string) => boolean,
): BudgetDisplayCandidate[] {
  const codes = ['RUB', 'USD', 'EUR']
  if (!codes.includes(B)) codes.push(B)
  return codes.map((code) => ({ code, disabled: code !== B && !convertible(code) }))
}

/** An unknown or unavailable value falls back to RUB, or to `B` where RUB is unavailable. */
export function parseBudgetDisplayCurrency(
  value: string | null | undefined,
  candidates: readonly BudgetDisplayCandidate[],
  B: string,
): string {
  const available = (code: string | null | undefined) =>
    candidates.some((candidate) => candidate.code === code && !candidate.disabled)
  if (available(value)) return value as string
  if (available('RUB')) return 'RUB'
  return B
}

/** EARS-552's condition: the newest stored rate is more than three days older than today. */
export function rateStaleSince(latest: string | null, today: string): string | null {
  if (latest === null) return null
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / 86_400_000
  return age > 3 ? latest : null
}
