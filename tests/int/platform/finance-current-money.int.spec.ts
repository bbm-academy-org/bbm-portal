// @vitest-environment node
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createAccount,
  createCurrency,
  currentMoneyOverview,
  recordConversion,
  recordOperation,
  reverseOperation,
  systemAccount,
} from '@/lib/finance'
import { closePlatformDb } from '@/lib/platform/db/client'

import { refusalText } from './audit-helpers'
import {
  ADMIN,
  APPROVER,
  fixtureWrite,
  fundProjectId,
  truncateFinanceTables,
} from './finance-helpers'

beforeEach(async () => {
  await truncateFinanceTables()
})

afterAll(async () => {
  await closePlatformDb()
})

/** RUB + USD with one money account each — the minimum a pair pool needs. */
async function seedRubUsd() {
  await createCurrency(ADMIN, { code: 'RUB', name: 'Рубль', precision: 2 })
  await createCurrency(ADMIN, { code: 'USD', name: 'Доллар США', precision: 2 })
  const bank = await createAccount(ADMIN, { name: 'Банк RUB', kind: 'bank', currency: 'RUB' })
  const card = await createAccount(ADMIN, { name: 'Карта USD', kind: 'card', currency: 'USD' })
  return { bank, card }
}

/** Money into a RUB account, balanced through the system income account. */
async function creditRub(accountId: number, amount: bigint) {
  const income = await systemAccount(ADMIN, 'income', 'RUB')
  await recordOperation(APPROVER, {
    occurredOn: '2026-09-01',
    source: 'manual',
    postings: [
      { accountId, amount, currency: 'RUB' },
      { accountId: income.id, amount: -amount, currency: 'RUB', projectId: await fundProjectId() },
    ],
  })
}

describe('EARS-325: current-money public read model', () => {
  it('reads immutable postings and steps into exact complete RUB, USD and THB views', async () => {
    for (const input of [
      { code: 'RUB', name: 'Рубль', precision: 2 },
      { code: 'USD', name: 'Доллар США', precision: 2 },
      { code: 'THB', name: 'Бат', precision: 2 },
    ]) {
      await createCurrency(ADMIN, input)
    }
    const bank = await createAccount(ADMIN, {
      name: 'Банк RUB',
      kind: 'bank',
      currency: 'RUB',
    })
    const cash = await createAccount(ADMIN, {
      name: 'Наличные RUB',
      kind: 'cash',
      currency: 'RUB',
    })
    const usd = await createAccount(ADMIN, {
      name: 'Карта USD',
      kind: 'card',
      currency: 'USD',
    })
    const thb = await createAccount(ADMIN, {
      name: 'Карта THB',
      kind: 'card',
      currency: 'THB',
    })
    const income = await systemAccount(ADMIN, 'income', 'RUB')
    await recordOperation(APPROVER, {
      occurredOn: '2026-08-20',
      source: 'manual',
      postings: [
        { accountId: bank.id, amount: 150_000_000n, currency: 'RUB' },
        { accountId: cash.id, amount: 50_000_000n, currency: 'RUB' },
        {
          accountId: income.id,
          amount: -200_000_000n,
          currency: 'RUB',
          projectId: await fundProjectId(),
        },
      ],
    })

    for (const input of [
      {
        occurredOn: '2026-08-21',
        sourceAccountId: bank.id,
        targetAccountId: usd.id,
        fromCurrency: 'RUB',
        toCurrency: 'USD',
        fromAmount: 60_000_000n,
        toAmount: 1_000_000n,
        rate: '60',
      },
      {
        occurredOn: '2026-08-22',
        sourceAccountId: usd.id,
        targetAccountId: thb.id,
        fromCurrency: 'USD',
        toCurrency: 'THB',
        fromAmount: 400_000n,
        toAmount: 14_000_000n,
        rate: '35',
      },
      {
        occurredOn: '2026-08-23',
        sourceAccountId: usd.id,
        targetAccountId: bank.id,
        fromCurrency: 'USD',
        toCurrency: 'RUB',
        fromAmount: 200_000n,
        toAmount: 13_000_000n,
        rate: '65',
      },
      {
        occurredOn: '2026-08-24',
        sourceAccountId: bank.id,
        targetAccountId: usd.id,
        fromCurrency: 'RUB',
        toCurrency: 'USD',
        fromAmount: 12_000_000n,
        toAmount: 150_000n,
        rate: '80',
      },
    ]) {
      await recordConversion(APPROVER, {
        occurredOn: input.occurredOn,
        sourceAccountId: input.sourceAccountId,
        targetAccountId: input.targetAccountId,
        steps: [input],
      })
    }

    const rub = await currentMoneyOverview()
    expect(rub).toMatchObject({
      reportingCurrency: 'RUB',
      status: 'complete',
      total: 201_000_000n,
      missingCurrencies: [],
      availableReportingCurrencies: ['RUB', 'USD', 'THB'],
    })
    expect(
      rub.accounts.map(({ name, balance, currency }) => ({ name, balance, currency })),
    ).toEqual([
      { name: 'Банк RUB', balance: 91_000_000n, currency: 'RUB' },
      { name: 'Наличные RUB', balance: 50_000_000n, currency: 'RUB' },
      { name: 'Карта USD', balance: 550_000n, currency: 'USD' },
      { name: 'Карта THB', balance: 14_000_000n, currency: 'THB' },
    ])

    await expect(currentMoneyOverview('USD')).resolves.toMatchObject({
      reportingCurrency: 'USD',
      status: 'complete',
      total: 3_182_500n,
      missingCurrencies: [],
    })
    await expect(currentMoneyOverview('THB')).resolves.toMatchObject({
      reportingCurrency: 'THB',
      status: 'complete',
      total: 111_387_500n,
      missingCurrencies: [],
    })
  })

  /**
   * Fixture 9 through the REAL writer.
   *
   * The unit suite builds the fee's postings by hand, which is an assumption
   * about what `recordConversion` posts. Here `recordConversion` posts them: the
   * fee's expense leg is step-linked but not `conversion`-kind, so the derived
   * RUB/USD rate must stay 3/2 and the total must stay 32 500.
   */
  it("EARS-325: a conversion fee posted by recordConversion does not pollute the pair's rate", async () => {
    const { bank, card } = await seedRubUsd()
    await creditRub(bank.id, 40_000n)

    await recordConversion(APPROVER, {
      occurredOn: '2026-09-02',
      sourceAccountId: bank.id,
      targetAccountId: card.id,
      steps: [
        {
          fromCurrency: 'RUB',
          toCurrency: 'USD',
          fromAmount: 20_000n,
          toAmount: 10_000n,
          rate: '0.5',
        },
      ],
    })
    await recordConversion(APPROVER, {
      occurredOn: '2026-09-03',
      sourceAccountId: bank.id,
      targetAccountId: card.id,
      steps: [
        {
          fromCurrency: 'RUB',
          toCurrency: 'USD',
          fromAmount: 10_000n,
          toAmount: 10_000n,
          rate: '1',
          fee: { amount: 5_000n, currency: 'USD', projectId: await fundProjectId() },
        },
      ],
    })

    const rub = await currentMoneyOverview()
    expect(rub.accounts.map(({ name, balance }) => ({ name, balance }))).toEqual([
      { name: 'Банк RUB', balance: 10_000n },
      { name: 'Карта USD', balance: 15_000n },
    ])
    expect(rub).toMatchObject({ status: 'complete', total: 32_500n, missingCurrencies: [] })
  })

  /**
   * Fixture 2 through the REAL writer, plus the even-parity half of the rule.
   *
   * `reverseOperation` copies `conversion_step_id` onto every mirrored posting —
   * the hand-built unit fixture does not. The chain parity must therefore be read
   * off the `reverses` pointer, and a reversal of a reversal must put the
   * original conversion back into the replay.
   */
  it('EARS-325: a reversed conversion leaves no rate, and reversing the reversal restores it', async () => {
    const { bank, card } = await seedRubUsd()
    await creditRub(bank.id, 100_000n)

    const converted = await recordConversion(APPROVER, {
      occurredOn: '2026-09-02',
      sourceAccountId: bank.id,
      targetAccountId: card.id,
      steps: [
        {
          fromCurrency: 'RUB',
          toCurrency: 'USD',
          fromAmount: 60_000n,
          toAmount: 1_000n,
          rate: '0.0166666667',
        },
      ],
    })

    const undo = await reverseOperation(APPROVER, converted.id, { occurredOn: '2026-09-03' })
    const reversed = await currentMoneyOverview()
    expect(reversed.accounts.map(({ name, balance }) => ({ name, balance }))).toEqual([
      { name: 'Банк RUB', balance: 100_000n },
      { name: 'Карта USD', balance: 0n },
    ])
    expect(reversed).toMatchObject({
      status: 'complete',
      total: 100_000n,
      availableReportingCurrencies: ['RUB'],
    })

    await reverseOperation(APPROVER, undo.id, { occurredOn: '2026-09-04' })
    const restored = await currentMoneyOverview()
    expect(restored.accounts.map(({ name, balance }) => ({ name, balance }))).toEqual([
      { name: 'Банк RUB', balance: 40_000n },
      { name: 'Карта USD', balance: 1_000n },
    ])
    expect(restored).toMatchObject({
      status: 'complete',
      total: 100_000n,
      missingCurrencies: [],
      availableReportingCurrencies: ['RUB', 'USD'],
    })
  })

  /**
   * EARS-325 is written over MONEY accounts, and the database agrees: a
   * non-system row of a ledger kind is refused outright by the
   * `finance_account_system_kind_agreement` CHECK. The read model's own
   * predicate is pinned at the unit tier (`tests/unit/finance-current-money.spec.ts`);
   * this case pins that the constraint is what makes the two sets coincide, so
   * the day it is relaxed the pin is here rather than in nobody's test.
   */
  it('EARS-325/305: the database refuses a non-system account of a ledger kind', async () => {
    await seedRubUsd()
    const refusal = await fixtureWrite((tx) =>
      tx.execute(sql`
        insert into core.finance_account (name, kind, currency, is_system)
        values ('Доход RUB (не системный)', 'income', 'RUB', false)
      `),
    ).then(
      () => null,
      (error: unknown) => refusalText(error),
    )
    expect(refusal).toMatch(/finance_account_system_kind_agreement/)
  })
})
