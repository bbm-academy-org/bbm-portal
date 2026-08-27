// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  accountBalances,
  createAccount,
  createCurrency,
  FinanceRefusal,
  listAccounts,
  recordConversion,
  recordOperation,
  reverseOperation,
  systemAccount,
} from '@/lib/finance'
import { closePlatformDb, getPlatformDb } from '@/lib/platform/db/client'

import { ADMIN, APPROVER, fundProjectId, truncateFinanceTables } from './finance-helpers'

/**
 * Conversions, frozen rates and realized FX (spec 338 EARS-318/319/328/329;
 * Accounting policy, ruling 3).
 *
 * These clauses are about what SURVIVES in the database — a rate read back a
 * year later, an average computed off recorded postings, an operation that
 * establishes no rate and therefore recognises nothing — so they are asserted
 * against the real tables rather than against the module's own arithmetic.
 */
const db = getPlatformDb()

beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

/** THB (2 dp), USDT (6 dp) and RUB (2 dp), one money account each. */
async function seedWallets() {
  await createCurrency(ADMIN, { code: 'THB', name: 'Бат', precision: 2 })
  await createCurrency(ADMIN, { code: 'USDT', name: 'Tether', precision: 6 })
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  const thb = await createAccount(ADMIN, { name: 'Kasikorn THB', kind: 'bank', currency: 'THB' })
  const usdt = await createAccount(ADMIN, {
    name: 'Кошелёк USDT',
    kind: 'crypto',
    currency: 'USDT',
  })
  const rub = await createAccount(ADMIN, { name: 'Тинькофф RUB', kind: 'bank', currency: 'RUB' })
  return { thb, usdt, rub }
}

/** Every `conversion`-kind account balance, by currency. */
async function clearingBalances(): Promise<Record<string, bigint>> {
  const out: Record<string, bigint> = {}
  for (const row of await accountBalances()) {
    if (row.kind !== 'conversion') continue
    out[row.currency] = (out[row.currency] ?? 0n) + row.balance
  }
  return out
}

/** Buy `usdtMinor` USDT for `thbMinor` THB at `rate` THB per USDT. */
async function buyUsdt(
  wallets: Awaited<ReturnType<typeof seedWallets>>,
  thbMinor: bigint,
  usdtMinor: bigint,
  rate: string,
  occurredOn = '2026-01-10',
) {
  return recordConversion(APPROVER, {
    occurredOn,
    sourceAccountId: wallets.thb.id,
    targetAccountId: wallets.usdt.id,
    steps: [
      {
        fromCurrency: 'THB',
        toCurrency: 'USDT',
        fromAmount: thbMinor,
        toAmount: usdtMinor,
        rate,
      },
    ],
  })
}

/** Sell `usdtMinor` USDT for `thbMinor` THB at `rate` THB per USDT. */
async function sellUsdt(
  wallets: Awaited<ReturnType<typeof seedWallets>>,
  usdtMinor: bigint,
  thbMinor: bigint,
  rate: string,
  occurredOn = '2026-03-10',
) {
  return recordConversion(APPROVER, {
    occurredOn,
    sourceAccountId: wallets.usdt.id,
    targetAccountId: wallets.thb.id,
    steps: [
      {
        fromCurrency: 'USDT',
        toCurrency: 'THB',
        fromAmount: usdtMinor,
        toAmount: thbMinor,
        rate,
      },
    ],
  })
}

/** The fx_result leg of one operation, in minimal units (a gain is negative). */
async function fxResultOf(operationId: number, currency: string): Promise<bigint> {
  const result = await db.execute(sql`
    select coalesce(sum(p.amount), 0)::text as total
      from core.finance_posting p
      join core.finance_account a on a.id = p.account_id
     where p.operation_id = ${operationId} and a.kind = 'fx_result' and p.currency = ${currency}
  `)
  return BigInt((result.rows[0] as { total: string }).total)
}

describe('a conversion is ONE operation with frozen rates (EARS-318, EARS-319)', () => {
  it('EARS-318: records the chain as one operation, its steps as rows, and balances every currency through the conversion account', async () => {
    const wallets = await seedWallets()
    // 35 000.00 THB → 1 000.000000 USDT at 35 THB per USDT.
    const operation = await buyUsdt(wallets, 3_500_000n, 1_000_000_000n, '35')

    const operations = await db.execute(
      sql`select count(*)::int as count from core.finance_operation`,
    )
    expect(Number((operations.rows[0] as { count: number }).count)).toBe(1)

    const steps = await db.execute(
      sql`select step_no, from_currency, to_currency, rate
            from core.finance_conversion_step where operation_id = ${operation.id} order by step_no`,
    )
    expect(steps.rows).toEqual([
      { step_no: 1, from_currency: 'THB', to_currency: 'USDT', rate: '35' },
    ])

    // Per-currency zero-sum holds (EARS-311) with the conversion account as the
    // pivot; the money accounts show exactly what moved.
    const balances = await accountBalances()
    expect(balances.find((row) => row.accountId === wallets.thb.id)?.balance).toBe(-3_500_000n)
    expect(balances.find((row) => row.accountId === wallets.usdt.id)?.balance).toBe(1_000_000_000n)
    const conversionAccounts = (await listAccounts()).filter((a) => a.kind === 'conversion')
    expect(conversionAccounts.map((a) => a.currency).sort()).toEqual(['THB', 'USDT'])
    for (const currency of ['THB', 'USDT']) {
      const perCurrency = balances
        .filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + row.balance, 0n)
      expect(perCurrency).toBe(0n)
    }
  })

  it("EARS-318: a step's fee is its own posting, charged against the money account it left", async () => {
    const wallets = await seedWallets()
    await recordConversion(APPROVER, {
      occurredOn: '2026-01-10',
      sourceAccountId: wallets.thb.id,
      targetAccountId: wallets.usdt.id,
      steps: [
        {
          fromCurrency: 'THB',
          toCurrency: 'USDT',
          fromAmount: 3_500_000n,
          toAmount: 1_000_000_000n,
          rate: '35',
          fee: { amount: 5_000n, currency: 'THB' },
        },
      ],
    })
    const expense = (await listAccounts()).find(
      (account) => account.kind === 'expense' && account.currency === 'THB',
    )
    const balances = await accountBalances()
    expect(balances.find((row) => row.accountId === expense?.id)?.balance).toBe(5_000n)
    // The fee left the THB account on top of what was exchanged.
    expect(balances.find((row) => row.accountId === wallets.thb.id)?.balance).toBe(-3_505_000n)
    // And the fee posting names its step (EARS-318).
    const fee = await db.execute(sql`
      select p.conversion_step_id from core.finance_posting p
        join core.finance_account a on a.id = p.account_id
       where a.kind = 'expense' and p.currency = 'THB'
    `)
    expect((fee.rows[0] as { conversion_step_id: number | null }).conversion_step_id).not.toBeNull()
  })

  it('EARS-318: refuses a system account as either end of the chain, naming why', async () => {
    const wallets = await seedWallets()
    const conversion = await systemAccount(ADMIN, 'conversion', 'THB')
    for (const ends of [
      { sourceAccountId: conversion.id, targetAccountId: wallets.usdt.id },
      { sourceAccountId: wallets.thb.id, targetAccountId: conversion.id },
    ]) {
      await expect(
        recordConversion(APPROVER, {
          occurredOn: '2026-01-10',
          ...ends,
          steps: [
            {
              fromCurrency: 'THB',
              toCurrency: 'USDT',
              fromAmount: 100_000n,
              toAmount: 10_000_000n,
              rate: '100',
            },
          ],
        }),
      ).rejects.toThrow(/EARS-305/)
    }
  })

  it('EARS-318: refuses a chain whose steps do not carry the amount through, before the generic balance check', async () => {
    const wallets = await seedWallets()
    await expect(
      recordConversion(APPROVER, {
        occurredOn: '2026-01-10',
        sourceAccountId: wallets.thb.id,
        targetAccountId: wallets.rub.id,
        steps: [
          {
            fromCurrency: 'THB',
            toCurrency: 'USDT',
            fromAmount: 3_500_000n,
            toAmount: 1_000_000_000n,
            rate: '35',
          },
          {
            fromCurrency: 'USDT',
            toCurrency: 'RUB',
            // The chain drops 100.000000 USDT on the floor.
            fromAmount: 900_000_000n,
            toAmount: 8_100_000n,
            rate: '90',
          },
        ],
      }),
    ).rejects.toThrow(/не стыкуются по сумме/)
  })

  it('EARS-319: the recorded rate is never restated — a conversion read later shows the rate of its day', async () => {
    const wallets = await seedWallets()
    const operation = await buyUsdt(wallets, 3_450_000n, 1_000_000_000n, '34.50')

    // Later, the market moves. Nothing in the estate rewrites the row…
    await buyUsdt(wallets, 3_800_000n, 1_000_000_000n, '38', '2026-06-10')
    const steps = await db.execute(
      sql`select rate from core.finance_conversion_step where operation_id = ${operation.id}`,
    )
    // …and the trailing zero survives, because `rate` is text as recorded.
    expect((steps.rows[0] as { rate: string }).rate).toBe('34.50')

    // Nor does anything revalue the holding by posting (ruling 3): the USDT
    // balance is exactly the quantity acquired, unchanged by the later rate.
    const usdt = (await accountBalances()).find((row) => row.accountId === wallets.usdt.id)
    expect(usdt?.balance).toBe(2_000_000_000n)
  })

  it('EARS-319: refuses a rate that is not a positive decimal literal, before anything is written', async () => {
    const wallets = await seedWallets()
    await expect(
      recordConversion(APPROVER, {
        occurredOn: '2026-01-10',
        sourceAccountId: wallets.thb.id,
        targetAccountId: wallets.usdt.id,
        steps: [
          {
            fromCurrency: 'THB',
            toCurrency: 'USDT',
            fromAmount: 1n,
            toAmount: 1n,
            rate: '34,50',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(FinanceRefusal)
    const operations = await db.execute(
      sql`select count(*)::int as count from core.finance_operation`,
    )
    expect(Number((operations.rows[0] as { count: number }).count)).toBe(0)
  })
})

describe('a conversion is reversible like any other operation (EARS-314, EARS-319)', () => {
  it('EARS-314/319: a conversion is reversible, and its сторно names the SAME conversion steps', async () => {
    const wallets = await seedWallets()
    // Two steps: 35 000.00 THB → 1 000.000000 USDT → 90 000.00 RUB.
    const original = await recordConversion(APPROVER, {
      occurredOn: '2026-01-10',
      sourceAccountId: wallets.thb.id,
      targetAccountId: wallets.rub.id,
      steps: [
        {
          fromCurrency: 'THB',
          toCurrency: 'USDT',
          fromAmount: 3_500_000n,
          toAmount: 1_000_000_000n,
          rate: '35',
        },
        {
          fromCurrency: 'USDT',
          toCurrency: 'RUB',
          fromAmount: 1_000_000_000n,
          toAmount: 9_000_000n,
          rate: '90',
        },
      ],
    })

    const reversal = await reverseOperation(APPROVER, original.id)
    expect(reversal.reverses).toBe(original.id)

    // The сторно names the SAME steps — a conversion and its reversal are one
    // story, and no new step row was invented (EARS-319).
    const steps = await db.execute(
      sql`select count(*)::int as count from core.finance_conversion_step`,
    )
    expect(Number((steps.rows[0] as { count: number }).count)).toBe(2)

    const linked = await db.execute(sql`
      select operation_id, account_id, amount::text as amount, currency, conversion_step_id
        from core.finance_posting
       where operation_id in (${original.id}, ${reversal.id})
       order by operation_id, id
    `)
    const rows = linked.rows as Record<string, unknown>[]
    const originals = rows.filter((row) => Number(row.operation_id) === original.id)
    const mirrors = rows.filter((row) => Number(row.operation_id) === reversal.id)
    expect(mirrors).toHaveLength(originals.length)
    for (const [index, row] of originals.entries()) {
      expect(mirrors[index].conversion_step_id).toEqual(row.conversion_step_id)
      expect(BigInt(String(mirrors[index].amount))).toBe(-BigInt(String(row.amount)))
    }
    // At least one leg really did carry a step — otherwise this proves nothing.
    expect(originals.some((row) => row.conversion_step_id !== null)).toBe(true)

    // And every account is back where it started (EARS-314).
    for (const balance of await accountBalances()) {
      expect(balance.balance).toBe(0n)
    }
  })
})

describe('realized FX on a disposal (EARS-328, EARS-329)', () => {
  it('EARS-328: posts the difference between the actual rate and the weighted-average recorded rate to the fund fx_result', async () => {
    const wallets = await seedWallets()
    // Two acquisitions: 1 000 USDT at 30 THB, then 1 000 USDT at 40 THB.
    // Weighted average = 70 000 THB / 2 000 USDT = 35 THB per USDT.
    await buyUsdt(wallets, 3_000_000n, 1_000_000_000n, '30', '2026-01-10')
    await buyUsdt(wallets, 4_000_000n, 1_000_000_000n, '40', '2026-02-10')

    // Dispose of 1 000 USDT at 38 THB → proceeds 38 000, basis 35 000, gain 3 000.00 THB.
    const disposal = await recordConversion(APPROVER, {
      occurredOn: '2026-03-10',
      sourceAccountId: wallets.usdt.id,
      targetAccountId: wallets.thb.id,
      steps: [
        {
          fromCurrency: 'USDT',
          toCurrency: 'THB',
          fromAmount: 1_000_000_000n,
          toAmount: 3_800_000n,
          rate: '38',
        },
      ],
    })

    const fund = await fundProjectId()
    const fx = await systemAccount(ADMIN, 'fx_result', 'THB')
    const fxLegs = await db.execute(sql`
      select amount::text as amount, project_id, product_id
        from core.finance_posting
       where operation_id = ${disposal.id} and account_id = ${fx.id}
    `)
    expect(fxLegs.rows).toHaveLength(1)
    const leg = fxLegs.rows[0] as { amount: string; project_id: number; product_id: number | null }
    // A gain CREDITS the result account: 300 000 THB minimal units = 3 000.00 THB.
    expect(BigInt(leg.amount)).toBe(-300_000n)
    // On the fund, never on a product (EARS-328).
    expect(Number(leg.project_id)).toBe(fund)
    expect(leg.product_id).toBeNull()

    // Per-currency zero-sum survives the extra pair (EARS-311).
    const balances = await accountBalances()
    for (const currency of ['THB', 'USDT']) {
      const perCurrency = balances
        .filter((row) => row.currency === currency)
        .reduce((sum, row) => sum + row.balance, 0n)
      expect(perCurrency).toBe(0n)
    }
  })

  it('EARS-328: a disposal below the average records a LOSS on the same account', async () => {
    const wallets = await seedWallets()
    await buyUsdt(wallets, 4_000_000n, 1_000_000_000n, '40', '2026-01-10')
    const disposal = await recordConversion(APPROVER, {
      occurredOn: '2026-03-10',
      sourceAccountId: wallets.usdt.id,
      targetAccountId: wallets.thb.id,
      steps: [
        {
          fromCurrency: 'USDT',
          toCurrency: 'THB',
          fromAmount: 500_000_000n,
          toAmount: 1_750_000n,
          rate: '35',
        },
      ],
    })
    const fx = await systemAccount(ADMIN, 'fx_result', 'THB')
    const legs = await db.execute(sql`
      select amount::text as amount from core.finance_posting
       where operation_id = ${disposal.id} and account_id = ${fx.id}
    `)
    // Basis 500 USDT × 40 = 20 000.00 THB; proceeds 17 500.00 → loss 2 500.00.
    expect(BigInt((legs.rows[0] as { amount: string }).amount)).toBe(250_000n)
  })

  it('EARS-328: the first acquisition of a currency has no average to compare against and posts no FX result', async () => {
    const wallets = await seedWallets()
    const first = await buyUsdt(wallets, 3_500_000n, 1_000_000_000n, '35')
    const fxAccounts = (await listAccounts()).filter((account) => account.kind === 'fx_result')
    expect(fxAccounts).toEqual([])
    const legs = await db.execute(
      sql`select count(*)::int as count from core.finance_posting where operation_id = ${first.id}`,
    )
    // Exactly four legs: the two money ends and the two conversion legs.
    expect(Number((legs.rows[0] as { count: number }).count)).toBe(4)
  })

  it("EARS-328: an acquisition made AFTER a disposal prices the next disposal at the remaining holding's average, not at the lifetime average", async () => {
    const wallets = await seedWallets()
    // The pool must DEPLETE. Buy 10 USDT for 1 000.00 THB, sell all 10 for
    // 1 200.00 (gain 200.00), buy 10 again for 2 000.00, sell all 10 for
    // 2 000.00 — the second disposal is exactly at the remaining holding's cost,
    // so it recognises NOTHING. A lifetime average of (1 000 + 2 000)/20 = 150
    // would invent a 500.00 gain out of a 200.00 cash movement.
    await buyUsdt(wallets, 100_000n, 10_000_000n, '100', '2026-01-10')
    const firstSale = await sellUsdt(wallets, 10_000_000n, 120_000n, '120', '2026-02-10')
    await buyUsdt(wallets, 200_000n, 10_000_000n, '200', '2026-03-10')
    const secondSale = await sellUsdt(wallets, 10_000_000n, 200_000n, '200', '2026-04-10')

    expect(await fxResultOf(firstSale.id, 'THB')).toBe(-20_000n)
    expect(await fxResultOf(secondSale.id, 'THB')).toBe(0n)
  })

  it('EARS-328: when every acquired unit has been disposed of, every conversion account is back to zero', async () => {
    const wallets = await seedWallets()
    await buyUsdt(wallets, 100_000n, 10_000_000n, '100', '2026-01-10')
    await sellUsdt(wallets, 10_000_000n, 120_000n, '120', '2026-02-10')
    await buyUsdt(wallets, 200_000n, 10_000_000n, '200', '2026-03-10')
    await sellUsdt(wallets, 10_000_000n, 200_000n, '200', '2026-04-10')

    // The conversion account is a CLEARING account: it carries historical cost
    // between an acquisition and its disposal and holds nothing of its own. A
    // non-zero residue after a complete cycle is an asset corresponding to
    // nothing, and is the ledger evidencing an invented gain.
    expect(await clearingBalances()).toEqual({ THB: 0n, USDT: 0n })

    // Cross-check against the cash: the THB account moved by exactly the sum of
    // the recognised results.
    const thb = (await accountBalances()).find((row) => row.accountId === wallets.thb.id)
    expect(thb?.balance).toBe(20_000n)
  })

  it('EARS-314/328: a reversed acquisition does not price a later disposal', async () => {
    const wallets = await seedWallets()
    // A purchase entered wrong, сторнирована, then entered again at the real
    // rate. Only the surviving acquisition may price the disposal — otherwise
    // an operation and its сторно do not «sum to zero in every cut» (EARS-314),
    // and the FX average is a cut.
    const wrong = await buyUsdt(wallets, 100_000n, 10_000_000n, '100', '2026-01-10')
    await reverseOperation(APPROVER, wrong.id)
    await buyUsdt(wallets, 200_000n, 10_000_000n, '200', '2026-01-11')

    const sale = await sellUsdt(wallets, 10_000_000n, 250_000n, '250', '2026-02-10')
    // Basis is the surviving 2 000.00 alone, so the gain is 500.00 — not the
    // 1 000.00 a (1 000 + 2 000)/20 average would produce.
    expect(await fxResultOf(sale.id, 'THB')).toBe(-50_000n)
  })

  it('EARS-329: an operation with no conversion step posts no FX result at all', async () => {
    const wallets = await seedWallets()
    await buyUsdt(wallets, 3_500_000n, 1_000_000_000n, '35')

    // A plain payment in one currency — a transfer, not an exchange.
    const fund = await fundProjectId()
    const expense = await systemAccount(ADMIN, 'expense', 'THB')
    const payment = await recordOperation(APPROVER, {
      occurredOn: '2026-04-01',
      source: 'manual',
      postings: [
        { accountId: expense.id, amount: 120_000n, currency: 'THB', projectId: fund },
        { accountId: wallets.thb.id, amount: -120_000n, currency: 'THB' },
      ],
    })

    const steps = await db.execute(
      sql`select count(*)::int as count from core.finance_conversion_step where operation_id = ${payment.id}`,
    )
    expect(Number((steps.rows[0] as { count: number }).count)).toBe(0)
    const fxAccounts = (await listAccounts()).filter((account) => account.kind === 'fx_result')
    expect(fxAccounts).toEqual([])
  })

  it('EARS-329: recordConversion refuses an operation with no steps, naming the door that does take one', async () => {
    const wallets = await seedWallets()
    await expect(
      recordConversion(APPROVER, {
        occurredOn: '2026-04-01',
        sourceAccountId: wallets.thb.id,
        targetAccountId: wallets.usdt.id,
        steps: [],
      }),
    ).rejects.toThrow(/EARS-329/)
  })
})
