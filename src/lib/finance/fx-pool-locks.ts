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

  const affectedPairs = new Map<string, readonly [string, string]>()
  for (const step of steps) {
    const currencies = [step.fromCurrency, step.toCurrency].sort() as [string, string]
    affectedPairs.set(currencies.join('/'), currencies)
  }

  for (const [pair, [leftCurrency, rightCurrency]] of [...affectedPairs].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!locks.pairs.has(pair)) {
      throw new Error('The realized-FX pool must be locked before its write order is checked.')
    }
    const latest = await tx.execute(sql`
      select max(o.occurred_on)::text as occurred_on
        from core.finance_conversion_step cs
        join core.finance_operation o on o.id = cs.operation_id
       where (cs.from_currency = ${leftCurrency} and cs.to_currency = ${rightCurrency})
          or (cs.from_currency = ${rightCurrency} and cs.to_currency = ${leftCurrency})
    `)
    const latestOccurredOn = (latest.rows[0] as { occurred_on: string | null }).occurred_on
    if (latestOccurredOn !== null && occurredOn < latestOccurredOn) {
      throw new FinanceRefusal(
        `Операция от ${occurredOn} не может быть записана после уже проведённой операции валютной пары ${pair} от ${latestOccurredOn}: ` +
          'неизменяемый ledger не пересчитывает уже признанный FX-результат (EARS-319/328). ' +
          'История вносится источником backfill в хронологическом порядке.',
      )
    }
  }
}

/** Refuse retroactive cancellation once a later immutable fact used the pair. */
export async function assertRealizedFxReversalOrder(
  tx: PlatformTx,
  steps: readonly FxPoolPairInput[],
  locks: RealizedFxPoolLocks,
  operation: { id: number; occurredOn: string },
): Promise<void> {
  const affectedPairs = new Map<string, readonly [string, string]>()
  for (const step of steps) {
    const currencies = [step.fromCurrency, step.toCurrency].sort() as [string, string]
    affectedPairs.set(currencies.join('/'), currencies)
  }

  for (const [pair, [leftCurrency, rightCurrency]] of [...affectedPairs].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!locks.pairs.has(pair)) {
      throw new Error('The realized-FX pool must be locked before a reversal order is checked.')
    }
    const later = await tx.execute(sql`
      select o.id, o.occurred_on::text as occurred_on
        from core.finance_operation o
        join core.finance_posting p on p.operation_id = o.id
        join core.finance_conversion_step cs on cs.id = p.conversion_step_id
       where ((cs.from_currency = ${leftCurrency} and cs.to_currency = ${rightCurrency})
          or  (cs.from_currency = ${rightCurrency} and cs.to_currency = ${leftCurrency}))
         and (o.occurred_on > ${operation.occurredOn}
          or (o.occurred_on = ${operation.occurredOn} and o.id > ${operation.id}))
       order by o.occurred_on, o.id
       limit 1
    `)
    const dependency = later.rows[0] as { id: number; occurred_on: string } | undefined
    if (dependency !== undefined) {
      throw new FinanceRefusal(
        `Операцию #${operation.id} нельзя сторнировать после операции #${dependency.id} от ${dependency.occurred_on}: ` +
          `более поздняя операция уже использовала валютную пару ${pair}, а неизменяемый ledger не пересчитывает признанный FX-результат (EARS-314/328). ` +
          'Сначала сторнируйте более поздние операции этой пары в обратном порядке.',
      )
    }
  }
}
