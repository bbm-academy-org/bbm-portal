import { sql } from 'drizzle-orm'

import type { FinanceSystemAccountKind } from '@/lib/platform/db/schema/finance/finance-account'
import type { PlatformTx } from '@/lib/platform/db/transaction'

import { FinanceRefusal } from './core/errors'

export type FxPoolPairInput = {
  fromCurrency: string
  toCurrency: string
}

export type RealizedFxPoolLocks = {
  readonly pairs: ReadonlySet<string>
}

export type FxSystemAccountResource = {
  kind: FinanceSystemAccountKind
  currency: string
}

type FxPair = {
  key: string
  leftCurrency: string
  rightCurrency: string
}

type PairEvent = {
  id: number
  occurredOn: string
}

export function realizedFxPair(step: FxPoolPairInput): string {
  return [step.fromCurrency, step.toCurrency].sort().join('/')
}

/** Lock every affected pair in stable order before any realized-FX pool read or write. */
export async function lockRealizedFxPools(
  tx: PlatformTx,
  steps: readonly FxPoolPairInput[],
): Promise<RealizedFxPoolLocks> {
  const pairs = [...new Set(steps.map(realizedFxPair))].sort()
  for (const pair of pairs) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`finance:fx-pool:${pair}`}, 0))`,
    )
  }
  return { pairs: new Set(pairs) }
}

/**
 * Pair locks always come first; every possibly-needed system account then locks
 * by one global kind/currency order. Distinct pairs may share these unique rows,
 * so ordering only inside each writer can otherwise deadlock on first creation.
 */
export async function lockFxSystemAccounts(
  tx: PlatformTx,
  resources: readonly FxSystemAccountResource[],
): Promise<void> {
  const keys = [...new Set(resources.map(({ kind, currency }) => `${kind}/${currency}`))].sort()
  for (const key of keys) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`finance:fx-system-account:${key}`}, 0))`,
    )
  }
}

function affectedPairs(steps: readonly FxPoolPairInput[]): FxPair[] {
  const pairs = new Map<string, FxPair>()
  for (const step of steps) {
    const [leftCurrency, rightCurrency] = [step.fromCurrency, step.toCurrency].sort() as [
      string,
      string,
    ]
    const key = `${leftCurrency}/${rightCurrency}`
    pairs.set(key, { key, leftCurrency, rightCurrency })
  }
  return [...pairs.values()].sort((left, right) => left.key.localeCompare(right.key))
}

function requirePairLock(locks: RealizedFxPoolLocks, pair: FxPair): void {
  if (!locks.pairs.has(pair.key)) {
    throw new Error('The realized-FX pool must be locked before its chronology is read.')
  }
}

async function latestPairEvent(tx: PlatformTx, pair: FxPair): Promise<PairEvent | null> {
  const latest = await tx.execute(sql`
    select o.id, o.occurred_on::text as occurred_on
      from core.finance_operation o
      join core.finance_posting p on p.operation_id = o.id
      join core.finance_conversion_step cs on cs.id = p.conversion_step_id
     where ((cs.from_currency = ${pair.leftCurrency} and cs.to_currency = ${pair.rightCurrency})
        or  (cs.from_currency = ${pair.rightCurrency} and cs.to_currency = ${pair.leftCurrency}))
     order by o.occurred_on desc, o.id desc
     limit 1
  `)
  const row = latest.rows[0] as { id: number; occurred_on: string } | undefined
  return row === undefined ? null : { id: Number(row.id), occurredOn: row.occurred_on }
}

/** Refuse a live write that would make immutable realized-FX history arrive out of order. */
export async function assertRealizedFxWriteOrder(
  tx: PlatformTx,
  steps: readonly FxPoolPairInput[],
  locks: RealizedFxPoolLocks,
  occurredOn: string,
  source: string,
): Promise<void> {
  // The bulk backfill workflow owns chronological reconstruction in #387. This
  // guard keeps live/manual writes safe without inventing that rebuild here.
  if (source === 'backfill') return

  for (const pair of affectedPairs(steps)) {
    requirePairLock(locks, pair)
    const latest = await latestPairEvent(tx, pair)
    if (latest !== null && occurredOn < latest.occurredOn) {
      throw new FinanceRefusal(
        `Операция от ${occurredOn} не может быть записана после уже проведённой операции валютной пары ${pair.key} от ${latest.occurredOn}: ` +
          'неизменяемый ledger не пересчитывает уже признанный FX-результат (EARS-319/328). ' +
          'История вносится источником backfill в хронологическом порядке.',
      )
    }
  }
}

async function reversalRoot(tx: PlatformTx, operationId: number): Promise<PairEvent> {
  const result = await tx.execute(sql`
    with recursive lineage as (
      select o.id, o.occurred_on, o.reverses, 0 as depth
        from core.finance_operation o
       where o.id = ${operationId}
      union all
      select parent.id, parent.occurred_on, parent.reverses, child.depth + 1
        from lineage child
        join core.finance_operation parent on parent.id = child.reverses
    )
    select id, occurred_on::text as occurred_on
      from lineage
     order by depth desc
     limit 1
  `)
  const row = result.rows[0] as { id: number; occurred_on: string } | undefined
  if (row === undefined) {
    throw new Error(`FX reversal root for operation #${operationId} is absent.`)
  }
  return { id: Number(row.id), occurredOn: row.occurred_on }
}

async function laterActiveRoot(
  tx: PlatformTx,
  pair: FxPair,
  root: PairEvent,
): Promise<PairEvent | null> {
  const result = await tx.execute(sql`
    with recursive pair_roots as (
      select distinct o.id, o.occurred_on
        from core.finance_operation o
        join core.finance_conversion_step cs on cs.operation_id = o.id
       where (cs.from_currency = ${pair.leftCurrency} and cs.to_currency = ${pair.rightCurrency})
          or (cs.from_currency = ${pair.rightCurrency} and cs.to_currency = ${pair.leftCurrency})
    ), chains as (
      select root.id as root_id, root.occurred_on as root_occurred_on,
             root.id as event_id, 0 as depth
        from pair_roots root
      union all
      select chain.root_id, chain.root_occurred_on, child.id, chain.depth + 1
        from chains chain
        join core.finance_operation child on child.reverses = chain.event_id
    ), states as (
      select root_id, root_occurred_on, max(depth) as tip_depth
        from chains
       group by root_id, root_occurred_on
    )
    select root_id as id, root_occurred_on::text as occurred_on
      from states
     where mod(tip_depth, 2) = 0
       and (root_occurred_on > ${root.occurredOn}
        or (root_occurred_on = ${root.occurredOn} and root_id > ${root.id}))
     order by root_occurred_on, root_id
     limit 1
  `)
  const row = result.rows[0] as { id: number; occurred_on: string } | undefined
  return row === undefined ? null : { id: Number(row.id), occurredOn: row.occurred_on }
}

/** Resolve an append-only FX reversal after checking the active root stack. */
export async function resolveRealizedFxReversalOccurredOn(
  tx: PlatformTx,
  steps: readonly FxPoolPairInput[],
  locks: RealizedFxPoolLocks,
  targetOperationId: number,
  requestedOccurredOn?: string,
): Promise<string> {
  const childResult = await tx.execute(sql`
    select id from core.finance_operation where reverses = ${targetOperationId} limit 1
  `)
  const existingChild = childResult.rows[0] as { id: number } | undefined
  if (existingChild !== undefined) {
    throw new FinanceRefusal(
      `Операция #${targetOperationId} уже сторнирована операцией #${existingChild.id} (EARS-315).`,
    )
  }

  const root = await reversalRoot(tx, targetOperationId)
  let occurredOn = requestedOccurredOn ?? root.occurredOn
  for (const pair of affectedPairs(steps)) {
    requirePairLock(locks, pair)
    const dependency = await laterActiveRoot(tx, pair, root)
    if (dependency !== null) {
      throw new FinanceRefusal(
        `Операцию #${targetOperationId} нельзя сторнировать, пока активна более поздняя операция #${dependency.id} от ${dependency.occurredOn} валютной пары ${pair.key}: ` +
          'неизменяемый ledger не пересчитывает признанный FX-результат (EARS-314/328). ' +
          'Сначала сторнируйте более поздние операции этой пары в обратном порядке.',
      )
    }
    const frontier = await latestPairEvent(tx, pair)
    if (frontier === null) continue
    if (requestedOccurredOn !== undefined && requestedOccurredOn < frontier.occurredOn) {
      throw new FinanceRefusal(
        `Сторно операции #${targetOperationId} от ${requestedOccurredOn} не может предшествовать последнему событию валютной пары ${pair.key} от ${frontier.occurredOn} (EARS-314/319/328).`,
      )
    }
    if (occurredOn < frontier.occurredOn) occurredOn = frontier.occurredOn
  }
  return occurredOn
}
