import { sql } from 'drizzle-orm'

import type { PlatformTx } from '@/lib/platform/db/transaction'

import { FinanceRefusal } from './core/errors'

export type FxPoolPairInput = {
  fromCurrency: string
  toCurrency: string
}

export type RealizedFxPoolLocks = {
  readonly pairs: ReadonlySet<string>
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
