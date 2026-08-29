import { sql } from 'drizzle-orm'

import type { PlatformTx } from '@/lib/platform/db/transaction'

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
